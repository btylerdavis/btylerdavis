import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { evaluateGrants, revokeConsent } from "./consent";
import { advanceDays, getSimClock, MAX_SIM_DAYS, maxSimDate, setSimClock, simDayNumber } from "./simclock";
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
});
