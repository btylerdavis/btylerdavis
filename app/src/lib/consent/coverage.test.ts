import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { revokeDataClass } from "../compliance/revocation";
import { prisma } from "../db";
import { setSimClock } from "../simclock";
import { addDays } from "../synthetic/profiles";
import { consentCoverage } from "./aggregates";
import { grantConsent, revokeConsent } from "./engine";

/**
 * Consent-coverage denominators (level-up 9): the eligible → consented →
 * contributing → fresh-last-7-days funnel the CoverageStrip renders. The
 * decisive behavior is PARTIAL revocation: sealing one class must move
 * "contributing"/"fresh" exactly as far as that class's data reaches — and
 * no further — while "consented" tracks whether ANY grant remains.
 */

const SIM_TODAY = new Date(Date.UTC(2026, 5, 30));

async function wipe() {
  await prisma.releaseLedgerEntry.deleteMany();
  await prisma.deletionRequest.deleteMany();
  await prisma.savedCohort.deleteMany();
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

async function createParticipant(
  overrides: { lifecycleState?: string; deletedAt?: Date } = {}
): Promise<string> {
  const id = randomUUID();
  await prisma.participant.create({
    data: {
      id,
      yearOfBirth: 1975,
      sex: "female",
      enrollmentTouchpoint: "clinic",
      createdAt: addDays(SIM_TODAY, -90),
      ...overrides,
    },
  });
  return id;
}

async function addObservation(participantId: string, source: string, daysAgo: number) {
  await prisma.observation.create({
    data: {
      participantId,
      source,
      concept: source === "airview" ? "cpap_usage_minutes" : "sleep_duration_min",
      valueNumeric: 300,
      effectiveDate: addDays(SIM_TODAY, -daysAgo),
      grain: "day",
      qualityFlags: "[]",
    },
  });
}

beforeEach(async () => {
  await wipe();
  await setSimClock(SIM_TODAY);
});

describe("consentCoverage", () => {
  it("computes the eligible → consented → contributing → fresh funnel; tombstones excluded", async () => {
    const fresh = await createParticipant(); // consented, fresh wearable + old cpap
    const stale = await createParticipant(); // consented, old data only
    const silent = await createParticipant(); // consented, no data
    const unconsented = await createParticipant(); // recent rows but NO grant
    await createParticipant({ lifecycleState: "deleted", deletedAt: SIM_TODAY }); // tombstone

    for (const id of [fresh, stale, silent]) {
      await grantConsent(id, "LANE_A", { grantedAt: addDays(SIM_TODAY, -90) });
    }
    await addObservation(fresh, "healthkit", 2); // fresh wearable night
    await addObservation(fresh, "airview", 30); // old CPAP night
    await addObservation(stale, "airview", 30);
    await addObservation(unconsented, "healthkit", 1); // gate-less fixture row

    const coverage = await consentCoverage({ use: "view_identified", clock: SIM_TODAY });
    expect(coverage).toEqual({
      eligible: 4, // the tombstone is not eligible
      consented: 3, // fresh, stale, silent
      contributing: 2, // fresh + stale (the unconsented row clears no gate)
      freshLast7: 1, // only `fresh`
    });
  });

  it("partial revocation: sealing one class moves contributing/fresh exactly as far as that class reaches", async () => {
    const subject = await createParticipant();
    await grantConsent(subject, "LANE_A", { grantedAt: addDays(SIM_TODAY, -90) });
    await addObservation(subject, "healthkit", 2); // ONLY recent row: wearable
    await addObservation(subject, "airview", 30); // older CPAP row

    const before = await consentCoverage({ use: "view_identified", clock: SIM_TODAY });
    expect(before).toEqual({ eligible: 1, consented: 1, contributing: 1, freshLast7: 1 });

    // Revoke ONLY wearable_sleep: still consented (other classes intact),
    // still contributing (old CPAP row clears its gate) — but no longer
    // fresh, because the only last-7-days row is now sealed.
    await revokeDataClass(subject, "wearable_sleep");
    const after = await consentCoverage({ use: "view_identified", clock: SIM_TODAY });
    expect(after).toEqual({ eligible: 1, consented: 1, contributing: 1, freshLast7: 0 });

    // Full revocation: eligible stays (the row exists), everything else drops.
    await revokeConsent(subject, "LANE_A");
    const revoked = await consentCoverage({ use: "view_identified", clock: SIM_TODAY });
    expect(revoked).toEqual({ eligible: 1, consented: 0, contributing: 0, freshLast7: 0 });
  });

  it("scopes to a metric context via dataClasses (per-context strips)", async () => {
    const subject = await createParticipant();
    await grantConsent(subject, "LANE_A", { grantedAt: addDays(SIM_TODAY, -90) });
    await addObservation(subject, "airview", 3); // fresh CPAP night

    // Wearable-only context: consented (wearable grant exists) but nothing
    // contributes — the CPAP row belongs to another class.
    const wearableContext = await consentCoverage({
      use: "view_identified",
      clock: SIM_TODAY,
      dataClasses: ["wearable_sleep"],
    });
    expect(wearableContext).toEqual({
      eligible: 1,
      consented: 1,
      contributing: 0,
      freshLast7: 0,
    });

    // CPAP context: fully covered.
    const cpapContext = await consentCoverage({
      use: "view_identified",
      clock: SIM_TODAY,
      dataClasses: ["cpap_telemetry"],
    });
    expect(cpapContext).toEqual({ eligible: 1, consented: 1, contributing: 1, freshLast7: 1 });

    // After revoking the class the context measures, "consented" empties too.
    await revokeDataClass(subject, "cpap_telemetry");
    const sealed = await consentCoverage({
      use: "view_identified",
      clock: SIM_TODAY,
      dataClasses: ["cpap_telemetry"],
    });
    expect(sealed).toEqual({ eligible: 1, consented: 0, contributing: 0, freshLast7: 0 });
  });

  it("quarantined (unknown-source) rows never make a participant contributing (F-10)", async () => {
    const subject = await createParticipant();
    await grantConsent(subject, "LANE_A", { grantedAt: addDays(SIM_TODAY, -90) });
    await addObservation(subject, "airveiw" /* the audit's typo'd connector */, 1);

    const coverage = await consentCoverage({ use: "view_identified", clock: SIM_TODAY });
    expect(coverage).toEqual({ eligible: 1, consented: 1, contributing: 0, freshLast7: 0 });
  });
});
