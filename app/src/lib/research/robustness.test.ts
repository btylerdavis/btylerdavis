import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeDeletion, requestDeletion } from "../compliance/deletion";
import { revokeDataClass } from "../compliance/revocation";
import { grantConsent } from "../consent";
import { prisma } from "../db";
import { setSimClock } from "../simclock";
import { nightlyRows } from "../synthetic/generator";
import {
  addDays,
  buildProfile,
  catalogBySku,
  participantIdForIndex,
  type ParticipantProfile,
} from "../synthetic/profiles";
import { firmnessBand, type FirmnessBand } from "./cohort";
import {
  bandDeltas,
  computeMissingness,
  deliveryWindowChanges,
  loadRobustness,
  sensitivityNote,
  type InstrumentWindow,
  type MemberChange,
} from "./robustness";
import { meanCi95 } from "./stats";

/**
 * Bias & robustness views (audit level-up 11):
 * 1. missingness arithmetic (pure);
 * 2. NEGATIVE-CONTROL FLATNESS ON THE DEFAULT SEED — the generator gives the
 *    mattress no pathway to resting HR, so the firmness-band contrast in
 *    resting-HR change must be flat while the supine effect is large;
 * 3. the full loader under partial revocation + deletion — a revoked class
 *    leaves numerator AND denominator; a deleted participant leaves every
 *    cell; the timeline records each ledger event in its sim-month.
 */

const SIM_TODAY = new Date(Date.UTC(2026, 5, 30)); // 2026-06-30
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

// ---------------------------------------------------------------------------
// 1. computeMissingness (pure)
// ---------------------------------------------------------------------------

describe("computeMissingness", () => {
  const window = (participantId: string, dataClass: "wearable_sleep" | "cpap_telemetry" | "sleep_mat", firstNight: Date): InstrumentWindow => ({
    participantId,
    dataClass,
    firstNight,
  });

  it("expected nights honor month boundaries, the window start, and the clock", () => {
    const cells = computeMissingness({
      windows: [window("p1", "wearable_sleep", day("2026-05-21"))],
      presentRows: [
        { participantId: "p1", dataClass: "wearable_sleep", month: "2026-05", nights: 9 },
        { participantId: "p1", dataClass: "wearable_sleep", month: "2026-06", nights: 8 },
      ],
      clock: day("2026-06-10"),
    });
    const may = cells.find((c) => c.month === "2026-05" && c.dataClass === "wearable_sleep");
    const june = cells.find((c) => c.month === "2026-06" && c.dataClass === "wearable_sleep");
    expect(may).toMatchObject({ participants: 1, expectedNights: 11, presentNights: 9 }); // May 21–31
    expect(may?.pctPresent).toBeCloseTo(81.8, 1);
    expect(june).toMatchObject({ participants: 1, expectedNights: 10, presentNights: 8 }); // Jun 1–10
    expect(june?.pctPresent).toBeCloseTo(80, 1);
  });

  it("present nights are capped at expected (a class can never exceed 100%)", () => {
    const cells = computeMissingness({
      windows: [window("p1", "sleep_mat", day("2026-06-01"))],
      presentRows: [
        { participantId: "p1", dataClass: "sleep_mat", month: "2026-06", nights: 99 },
      ],
      clock: day("2026-06-30"),
    });
    const june = cells.find((c) => c.dataClass === "sleep_mat");
    expect(june).toMatchObject({ expectedNights: 30, presentNights: 30, pctPresent: 100 });
  });

  it("a class with no instrument windows reads null, and no windows at all reads empty", () => {
    const cells = computeMissingness({
      windows: [window("p1", "wearable_sleep", day("2026-06-01"))],
      presentRows: [],
      clock: day("2026-06-30"),
    });
    const cpap = cells.find((c) => c.dataClass === "cpap_telemetry");
    expect(cpap).toMatchObject({ participants: 0, expectedNights: 0, pctPresent: null });
    expect(computeMissingness({ windows: [], presentRows: [], clock: SIM_TODAY })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Negative-control flatness on the default seed (generator-level)
// ---------------------------------------------------------------------------

describe("negative control: resting HR is flat by firmness band on the default seed", () => {
  const setScenario = (value?: string) => {
    if (value === undefined) delete process.env.SCENARIO;
    else process.env.SCENARIO = value;
  };
  beforeEach(() => setScenario(undefined)); // default scenario
  afterEach(() => setScenario(undefined));

  interface Sample {
    profile: ParticipantProfile;
    band: FirmnessBand;
    restingHrChange: number | null;
    supineChange: number | null;
  }

  /** Deterministic generated nights around delivery for one profile. */
  function sampleProfile(profile: ParticipantProfile): Sample {
    const delivery = addDays(profile.enrollmentDate, profile.mattressDeliveryOffsetDays);
    const hrRows: { pid: string; dayOffset: number; value: number }[] = [];
    const supineRows: { pid: string; dayOffset: number; value: number }[] = [];
    for (let offset = -28; offset <= 35; offset++) {
      const night = nightlyRows(profile, addDays(delivery, offset), () => true);
      for (const obs of night.observations) {
        if (obs.valueNumeric === null || obs.valueNumeric === undefined) continue;
        if (obs.concept === "resting_hr") {
          hrRows.push({ pid: profile.id, dayOffset: offset, value: obs.valueNumeric });
        }
        if (obs.concept === "supine_time_pct" && obs.source === "sleep_mat") {
          supineRows.push({ pid: profile.id, dayOffset: offset, value: obs.valueNumeric });
        }
      }
    }
    const band = firmnessBand(catalogBySku(profile.mattressSku as string).firmnessRating);
    return {
      profile,
      band,
      restingHrChange: deliveryWindowChanges(hrRows).get(profile.id) ?? null,
      supineChange: deliveryWindowChanges(supineRows).get(profile.id) ?? null,
    };
  }

  it("the SAME pipeline shows a large supine effect and a flat resting-HR control", () => {
    // The flagship cohort: supine-predominant members with a delivered
    // mattress, sampled deterministically from the seeded id sequence.
    const samples: Sample[] = [];
    for (let index = 1; index < 700; index++) {
      const profile = buildProfile(participantIdForIndex(index));
      if (!profile.hasMattress || !profile.supinePredominant || !profile.mattressSku) continue;
      samples.push(sampleProfile(profile));
    }

    // --- the effect: supine time drops hard in the medium band ------------
    const supineChanges: MemberChange[] = samples
      .filter((sample) => sample.supineChange !== null)
      .map((sample) => ({
        participantId: sample.profile.id,
        band: sample.band,
        change: sample.supineChange as number,
      }));
    const supine = bandDeltas(supineChanges);
    const supineMedium = supine.find((delta) => delta.band === "medium")?.stats;
    expect(supineMedium?.n ?? 0).toBeGreaterThanOrEqual(10);
    expect(supineMedium?.mean ?? 0).toBeLessThan(-5); // the flagship signal

    // --- the negative control: resting HR, mattress-only arm --------------
    // Restricted to members whose ONLY intervention is the mattress, so any
    // band contrast could come only from the mattress itself.
    const hrChanges: MemberChange[] = samples
      .filter(
        (sample) => sample.profile.arm === "mattress_only" && sample.restingHrChange !== null
      )
      .map((sample) => ({
        participantId: sample.profile.id,
        band: sample.band,
        change: sample.restingHrChange as number,
      }));
    const medium = meanCi95(
      hrChanges.filter((change) => change.band === "medium").map((change) => change.change)
    );
    const others = meanCi95(
      hrChanges.filter((change) => change.band !== "medium").map((change) => change.change)
    );
    expect(medium.n).toBeGreaterThanOrEqual(10);
    expect(others.n).toBeGreaterThanOrEqual(10);
    // FLAT: each group's mean change is noise-scale…
    expect(Math.abs(medium.mean as number)).toBeLessThan(0.6);
    expect(Math.abs(others.mean as number)).toBeLessThan(0.6);
    // …and the medium-vs-others contrast is an order of magnitude smaller
    // than the supine effect it controls for.
    const contrast = Math.abs((medium.mean as number) - (others.mean as number));
    expect(contrast).toBeLessThan(0.75);
    expect(Math.abs(supineMedium?.mean as number)).toBeGreaterThan(5 * contrast);
  });

  it("the E-value sensitivity note reports a strong flagship contrast", () => {
    const changes: MemberChange[] = [];
    for (let index = 1; index < 700; index++) {
      const profile = buildProfile(participantIdForIndex(index));
      if (!profile.hasMattress || !profile.supinePredominant || !profile.mattressSku) continue;
      if (!profile.hasSleepMat) continue;
      const sample = sampleProfile(profile);
      if (sample.supineChange !== null) {
        changes.push({
          participantId: profile.id,
          band: sample.band,
          change: sample.supineChange,
        });
      }
    }
    const note = sensitivityNote(changes);
    expect(note.medium.n).toBeGreaterThanOrEqual(10);
    expect(note.others.n).toBeGreaterThanOrEqual(5);
    expect(note.contrastPp as number).toBeLessThan(-5);
    expect(note.eValue).not.toBeNull();
    expect(note.eValue?.eValue as number).toBeGreaterThan(2); // an implausible confounder
  });
});

// ---------------------------------------------------------------------------
// 3. loadRobustness under partial revocation + deletion (database)
// ---------------------------------------------------------------------------

async function wipe() {
  await prisma.seedInfo.deleteMany();
  await prisma.modelDecisionLog.deleteMany();
  await prisma.releaseLedgerEntry.deleteMany();
  await prisma.deletionRequest.deleteMany();
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

const ENROLLED = day("2026-05-31"); // first night June 1; June has 30 nights

async function makeParticipant(): Promise<string> {
  const id = randomUUID();
  await prisma.participant.create({
    data: {
      id,
      yearOfBirth: 1974,
      sex: "female",
      enrollmentTouchpoint: "retail",
      createdAt: ENROLLED,
    },
  });
  await prisma.demoIdentity.create({
    data: { participantId: id, displayName: "Fixture Person", email: "fixture@example.com" },
  });
  await grantConsent(id, "LANE_A", { grantedAt: ENROLLED });
  await grantConsent(id, "LANE_B", { grantedAt: ENROLLED });
  return id;
}

async function addDevice(
  participantId: string,
  deviceClass: "wearable" | "sleep_mat",
  dataClass: "wearable_sleep" | "sleep_mat"
): Promise<void> {
  await prisma.device.create({
    data: {
      participantId,
      deviceClass,
      make: "Fixture",
      model: deviceClass,
      assignedAt: ENROLLED,
      dataClass,
    },
  });
}

async function addNights(
  participantId: string,
  source: string,
  concept: string,
  nights: number
): Promise<void> {
  await prisma.observation.createMany({
    data: Array.from({ length: nights }, (_, i) => ({
      participantId,
      source,
      concept,
      valueNumeric: 60,
      effectiveDate: addDays(day("2026-06-01"), i),
      grain: "day",
      qualityFlags: "[]",
    })),
  });
}

describe("loadRobustness: consent-aware missingness + attrition timeline (database)", () => {
  beforeEach(async () => {
    await wipe();
    await setSimClock(SIM_TODAY);
    delete process.env.SCENARIO;
  });
  afterEach(() => {
    delete process.env.SCENARIO;
  });

  it("partial revocation removes the class from numerator AND denominator; deletion removes the participant everywhere", async () => {
    const p1 = await makeParticipant(); // wearable (24/30 nights) + mat (27/30)
    await addDevice(p1, "wearable", "wearable_sleep");
    await addDevice(p1, "sleep_mat", "sleep_mat");
    await addNights(p1, "healthkit", "resting_hr", 24);
    await addNights(p1, "sleep_mat", "supine_time_pct", 27);

    const p2 = await makeParticipant(); // wearable only, complete month
    await addDevice(p2, "wearable", "wearable_sleep");
    await addNights(p2, "healthkit", "resting_hr", 30);

    // --- baseline ---------------------------------------------------------
    let dash = await loadRobustness();
    let june = (dc: string) =>
      dash.missingness.find((cell) => cell.month === "2026-06" && cell.dataClass === dc);
    expect(june("wearable_sleep")).toMatchObject({
      participants: 2,
      expectedNights: 60,
      presentNights: 54,
      pctPresent: 90,
    });
    expect(june("sleep_mat")).toMatchObject({
      participants: 1,
      expectedNights: 30,
      presentNights: 27,
      pctPresent: 90,
    });
    expect(june("cpap_telemetry")).toMatchObject({ participants: 0, pctPresent: null });
    // Timeline: two enrollments in May, nothing else yet.
    expect(dash.timeline.find((row) => row.month === "2026-05")).toMatchObject({
      enrollments: 2,
      fullRevocations: 0,
      classRevocations: 0,
      deletions: 0,
    });
    // Unstamped database: scenario marker absent, no mismatch (env unset).
    expect(dash.scenario.seeded).toBeNull();
    expect(dash.scenario.mismatch).toBe(false);

    // --- partial revocation: p1's wearable class --------------------------
    await revokeDataClass(p1, "wearable_sleep");
    dash = await loadRobustness();
    june = (dc: string) =>
      dash.missingness.find((cell) => cell.month === "2026-06" && cell.dataClass === dc);
    // p1 leaves the wearable denominator (not just the numerator)…
    expect(june("wearable_sleep")).toMatchObject({
      participants: 1,
      expectedNights: 30,
      presentNights: 30,
      pctPresent: 100,
    });
    // …while p1's OTHER class keeps flowing untouched.
    expect(june("sleep_mat")).toMatchObject({ participants: 1, pctPresent: 90 });
    // The ledger timeline shows the class revocation in the clock month
    // (LANE_A and LANE_B both covered wearable_sleep → 2 scope revisions).
    expect(dash.timeline.find((row) => row.month === "2026-06")).toMatchObject({
      classRevocations: 2,
    });

    // --- deletion: p2 ------------------------------------------------------
    const filed = await requestDeletion(p2);
    expect(filed.ok).toBe(true);
    const executed = await executeDeletion(
      (filed as { ok: true; request: { id: string } }).request.id
    );
    expect(executed.ok).toBe(true);

    dash = await loadRobustness();
    june = (dc: string) =>
      dash.missingness.find((cell) => cell.month === "2026-06" && cell.dataClass === dc);
    // p2 is gone from every wearable cell — tombstones hold nothing.
    expect(june("wearable_sleep")).toMatchObject({
      participants: 0,
      expectedNights: 0,
      pctPresent: null,
    });
    expect(june("sleep_mat")).toMatchObject({ participants: 1, pctPresent: 90 });
    // Timeline: the deletion and its 2 full revocations land in June; the
    // May enrollments REMAIN — history is not rewritten by deletion.
    expect(dash.timeline.find((row) => row.month === "2026-05")).toMatchObject({
      enrollments: 2,
    });
    expect(dash.timeline.find((row) => row.month === "2026-06")).toMatchObject({
      deletions: 1,
      fullRevocations: 2,
      classRevocations: 2,
    });
  });

  it("scenario banner states the seeded scenario and flags an env mismatch", async () => {
    await prisma.seedInfo.create({
      data: { id: "singleton", scenario: "default", cohortSize: 2000, clockDate: SIM_TODAY },
    });

    let dash = await loadRobustness();
    expect(dash.scenario.seeded?.scenario).toBe("default");
    expect(dash.scenario.env).toBeNull();
    expect(dash.scenario.mismatch).toBe(false);

    process.env.SCENARIO = "null"; // server env disagrees with the seed stamp
    dash = await loadRobustness();
    expect(dash.scenario.env).toBe("null");
    expect(dash.scenario.mismatch).toBe(true);

    process.env.SCENARIO = "default"; // agreement → no warning
    dash = await loadRobustness();
    expect(dash.scenario.mismatch).toBe(false);
  });
});
