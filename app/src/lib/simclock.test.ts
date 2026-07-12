import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { evaluateGrants, revokeConsent } from "./consent";
import { advanceDays, getSimClock, MAX_SIM_DAYS, maxSimDate, setSimClock, simDayNumber } from "./simclock";
import { MATTRESS_CATALOG } from "./synthetic/catalog";
import { enrollmentRows } from "./synthetic/enrollment";
import { buildIngestGate, nightlyRows } from "./synthetic/generator";
import {
  addDays,
  buildProfile,
  DEMO_EPOCH,
  MARCUS_REED_PARTICIPANT_ID,
  participantIdForIndex,
  type ParticipantProfile,
} from "./synthetic/profiles";
import { connectWearable, enrollRetail, recordMattressPurchase } from "@/app/enroll/retail/actions";
import { confirmHstIntake, enrollClinicPatient, loadSampleHst, recordCpapSetup } from "@/app/enroll/clinic/actions";
import type { StopBangAnswers } from "./stopbang";

async function wipe() {
  await prisma.observation.deleteMany();
  await prisma.sleepSession.deleteMany();
  await prisma.proResponse.deleteMany();
  await prisma.mattressPurchase.deleteMany();
  await prisma.mattressCatalog.deleteMany();
  await prisma.device.deleteMany();
  await prisma.treatmentEvent.deleteMany();
  await prisma.episode.deleteMany();
  await prisma.consentRecord.deleteMany();
  await prisma.demoIdentity.deleteMany();
  await prisma.participant.deleteMany();
  await prisma.simClock.deleteMany();
}

/** Insert the minimum enrollment-time rows nightly generation depends on. */
async function insertParticipant(profile: ParticipantProfile) {
  const rows = enrollmentRows(profile);
  await prisma.participant.create({ data: rows.participant });
  await prisma.consentRecord.createMany({ data: rows.consentRecords });
  await prisma.device.createMany({ data: rows.devices });
}

/** A cohort participant (≠ Marcus) enrolled by DEMO_EPOCH + 10. */
function findEarlyEnrollee(): ParticipantProfile {
  for (let i = 1; i < 500; i++) {
    const profile = buildProfile(participantIdForIndex(i));
    if (profile.enrollmentDate <= addDays(DEMO_EPOCH, 10)) return profile;
  }
  throw new Error("no early enrollee found in first 500 cohort indices");
}

describe("time machine (sim clock)", () => {
  beforeEach(wipe);

  it("advancing 7 days adds 7 nights of observations for an adherent participant", async () => {
    const marcus = buildProfile(MARCUS_REED_PARTICIPANT_ID);
    expect(marcus.cpapAdherent).toBe(true);
    await insertParticipant(marcus);

    // Day 30: CPAP (setup day 14) is active, mattress delivered day 13.
    const start = addDays(DEMO_EPOCH, 30);
    await setSimClock(start);

    const summary = await advanceDays(7);
    expect(summary.daysAdvanced).toBe(7);
    expect((await getSimClock()).toISOString()).toBe(addDays(start, 7).toISOString());

    // One cpap_usage_minutes row per elapsed night — 7 nights, 7 rows
    // (adherent CPAP emits usage every night; skipped nights are usage=0,
    // abandonment would be therapy_gap — never silent nulls).
    const usageRows = await prisma.observation.findMany({
      where: { participantId: marcus.id, concept: "cpap_usage_minutes" },
      orderBy: { effectiveDate: "asc" },
    });
    expect(usageRows).toHaveLength(7);
    const nights = new Set(usageRows.map((row) => row.effectiveDate.toISOString().slice(0, 10)));
    expect(nights.size).toBe(7);
    for (const row of usageRows) {
      expect(row.effectiveDate > start).toBe(true);
      expect(row.effectiveDate <= addDays(start, 7)).toBe(true);
    }

    // Advancing another 7 days adds the next 7 nights, no duplicates.
    await advanceDays(7);
    const allUsage = await prisma.observation.findMany({
      where: { participantId: marcus.id, concept: "cpap_usage_minutes" },
    });
    expect(allUsage).toHaveLength(14);
    expect(new Set(allUsage.map((r) => r.effectiveDate.toISOString())).size).toBe(14);
  });

  it("respects revoked consent — no new rows for a revoked participant", async () => {
    const marcus = buildProfile(MARCUS_REED_PARTICIPANT_ID);
    const revokee = findEarlyEnrollee();
    await insertParticipant(marcus);
    await insertParticipant(revokee);

    // Revoke every instrument the participant holds.
    const instruments = await prisma.consentRecord.findMany({
      where: { participantId: revokee.id },
      select: { instrumentType: true },
    });
    for (const { instrumentType } of instruments) {
      await revokeConsent(revokee.id, instrumentType as "LANE_A" | "LANE_B" | "LANE_C");
    }

    await setSimClock(addDays(DEMO_EPOCH, 30));
    const summary = await advanceDays(7);

    expect(summary.participantsConsentLimited).toBe(1);
    expect(await prisma.observation.count({ where: { participantId: revokee.id } })).toBe(0);
    expect(await prisma.sleepSession.count({ where: { participantId: revokee.id } })).toBe(0);
    expect(await prisma.proResponse.count({ where: { participantId: revokee.id } })).toBe(0);

    // ...while the consented participant still accrues data.
    expect(await prisma.observation.count({ where: { participantId: marcus.id } })).toBeGreaterThan(0);
  });

  it("nightly generation is deterministic per (participant, date)", async () => {
    const marcus = buildProfile(MARCUS_REED_PARTICIPANT_ID);
    await insertParticipant(marcus);
    const records = await prisma.consentRecord.findMany({ where: { participantId: marcus.id } });
    const gate = await buildIngestGate(marcus.id, evaluateGrants(records));

    const night = addDays(DEMO_EPOCH, 42);
    expect(nightlyRows(marcus, night, gate)).toEqual(nightlyRows(marcus, night, gate));
  });

  it("getSimClock throws before seeding", async () => {
    await expect(getSimClock()).rejects.toThrow(/npm run seed/);
  });

  it("refuses to advance past day 400 of the demo timeline", async () => {
    // No participants inserted: generation is a no-op, only the rail matters.
    await setSimClock(addDays(maxSimDate(), -1));
    const summary = await advanceDays(1); // lands exactly on the rail — allowed
    expect(simDayNumber(summary.to)).toBe(MAX_SIM_DAYS);

    await expect(advanceDays(1)).rejects.toThrow(/day 400/);
    // Overshooting from below is refused whole, not clamped.
    await setSimClock(addDays(maxSimDate(), -3));
    await expect(advanceDays(10)).rejects.toThrow(/day 400/);
    expect(simDayNumber(await getSimClock())).toBe(MAX_SIM_DAYS - 3);
  });

  // Regression (live-demo bug): advancing the clock AFTER a participant was
  // created through the real enrollment flow used to abort the whole cohort's
  // advance. A live-enrolled participant has a random id whose buildProfile-
  // derived device ids were never persisted, so their generated nightly rows
  // referenced non-existent Device rows and the batched createMany failed with
  // a foreign-key violation (Prisma P2003) — "the clock stopped safely". Live
  // participants must now be SKIPPED cleanly: the seeded cohort still accrues
  // nights, the live participant gets no synthetic nightly stream (their real
  // data would arrive from device sync), and nothing throws.
  it("skips a live-enrolled participant and still advances the seeded cohort", async () => {
    const marcus = buildProfile(MARCUS_REED_PARTICIPANT_ID);
    await insertParticipant(marcus);

    // Live enrollment through the real actions (retail → clinic → HST → CPAP →
    // mattress): a real Participant with Lane A/B/C data but NO synthetic
    // profile or nightly history.
    await prisma.mattressCatalog.createMany({ data: MATTRESS_CATALOG });
    await setSimClock(new Date(Date.UTC(2026, 5, 30)));
    const answers: StopBangAnswers = {
      snoring: true, tiredness: true, observed_apnea: true, pressure: true,
      bmi: false, age: true, neck: true, gender: true,
    };
    const togglesAllOn = { wearable_sleep: true, sleep_mat: true, mattress_purchase: true, pro_responses: true };
    const retail = await enrollRetail({ displayName: "Live Enrollee", answers, toggles: togglesAllOn });
    await connectWearable(retail.participantId, "apple");
    await recordMattressPurchase(retail.participantId, "TP-PROADAPT-MH-Q");
    const clinic = await enrollClinicPatient({ mode: "existing", participantId: retail.participantId }, true);
    const hst = await loadSampleHst("report");
    expect(hst.ok).toBe(true);
    if (hst.ok) await confirmHstIntake(clinic.participantId, hst.parsed);
    await recordCpapSetup(clinic.participantId, "airsense11");

    // Day 90: every derived enrollment date (≤ DEMO_EPOCH+75) is behind the
    // window, so pre-fix the live participant WOULD have generated nights and
    // FK-crashed. Post-fix they are skipped.
    await setSimClock(addDays(DEMO_EPOCH, 90));
    const liveObsBefore = await prisma.observation.count({ where: { participantId: retail.participantId } });

    const summary = await advanceDays(7); // must not throw
    expect(summary.daysAdvanced).toBe(7);
    // The clock advanced (it never would have, had generation aborted).
    expect((await getSimClock()).toISOString()).toBe(addDays(DEMO_EPOCH, 97).toISOString());

    // The live participant is skipped: no synthetic nightly stream fabricated.
    expect(summary.participantsSkipped).toBe(1);
    expect(await prisma.sleepSession.count({ where: { participantId: retail.participantId } })).toBe(0);
    // No new observations for the live participant — only their enrollment-time
    // HST rows remain (their own-page data is untouched).
    const liveObsAfter = await prisma.observation.findMany({
      where: { participantId: retail.participantId },
      select: { source: true },
    });
    expect(liveObsAfter).toHaveLength(liveObsBefore);
    expect(new Set(liveObsAfter.map((o) => o.source))).toEqual(new Set(["hst"]));

    // The seeded cohort (Marcus) still accrues its nights.
    const marcusUsage = await prisma.observation.count({
      where: { participantId: marcus.id, concept: "cpap_usage_minutes" },
    });
    expect(marcusUsage).toBe(7);
  });
});
