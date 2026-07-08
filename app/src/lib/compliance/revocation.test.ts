import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  assertIngestAllowed,
  ConsentError,
  getConsentHistory,
  getConsentStates,
  getObservations,
  grantConsent,
} from "../consent";
import { prisma } from "../db";
import { setSimClock } from "../simclock";
import { addDays } from "../synthetic/profiles";
import {
  countRowsByDataClass,
  restoreAllConsents,
  revokeAllConsents,
  snapshotConsentImpact,
} from "./revocation";

/**
 * Revocation kill-switch round-trip (DEMO.md Act 6 finale): revoke → ingest
 * gate throws + reads block + cohort counts drop; restore → everything flows
 * again AND the append-only ledger shows the full grant → revoke → re-grant
 * history.
 */

const SIM_TODAY = new Date(Date.UTC(2026, 5, 30));

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

async function createMarcusLike(): Promise<string> {
  const id = randomUUID();
  const enrolled = addDays(SIM_TODAY, -90);
  await prisma.participant.create({
    data: {
      id,
      yearOfBirth: 1974,
      sex: "male",
      enrollmentTouchpoint: "retail",
      createdAt: enrolled,
    },
  });
  await grantConsent(id, "LANE_B", { grantedAt: enrolled });
  await grantConsent(id, "LANE_A", { grantedAt: addDays(enrolled, 7) });
  await grantConsent(id, "LANE_C", { grantedAt: addDays(enrolled, 7) });

  // Supine-predominant HST + delivered mattress → in the positional cohort.
  await prisma.observation.createMany({
    data: [
      { concept: "ahi", valueNumeric: 24 },
      { concept: "supine_ahi", valueNumeric: 41 },
      { concept: "nonsupine_ahi", valueNumeric: 9.8 },
    ].map((row) => ({
      participantId: id,
      source: "hst",
      effectiveDate: addDays(enrolled, 7),
      grain: "session",
      qualityFlags: "[]",
      ...row,
    })),
  });
  await prisma.mattressCatalog.create({
    data: {
      sku: "REVO-SKU",
      brand: "Tempur-Pedic",
      model: "Revo Medium Hybrid",
      firmnessRating: 6,
      materialClass: "hybrid",
      size: "Queen",
    },
  });
  await prisma.mattressPurchase.create({
    data: {
      participantId: id,
      sku: "REVO-SKU",
      purchaseDate: addDays(enrolled, 3),
      deliveryDate: addDays(enrolled, 13),
      storeId: "MH-TEST",
    },
  });
  // CPAP nights inside the coach's 30-day window.
  await prisma.observation.createMany({
    data: Array.from({ length: 10 }, (_, i) => ({
      participantId: id,
      source: "airview",
      concept: "cpap_usage_minutes",
      valueNumeric: 380,
      unit: "min",
      effectiveDate: addDays(SIM_TODAY, -(i + 1)),
      grain: "day",
      qualityFlags: "[]",
    })),
  });
  return id;
}

beforeEach(async () => {
  await wipe();
  await setSimClock(SIM_TODAY);
});

describe("revocation kill switch", () => {
  it("revoke → gates throw, reads block, cohort counts decrement; restore → flows again with full audit trail", async () => {
    const marcus = await createMarcusLike();
    // A bystander who must be unaffected throughout.
    const bystander = randomUUID();
    await prisma.participant.create({
      data: {
        id: bystander,
        yearOfBirth: 1980,
        sex: "female",
        enrollmentTouchpoint: "clinic",
        createdAt: addDays(SIM_TODAY, -50),
      },
    });
    await grantConsent(bystander, "LANE_A", { grantedAt: addDays(SIM_TODAY, -50) });

    // --- before ---------------------------------------------------------------
    const baseline = await snapshotConsentImpact(marcus);
    expect(baseline.researchCohortCount).toBe(2);
    expect(baseline.positionalCohortCount).toBe(1);
    expect(baseline.displayNameVisible).toBe(true);
    expect(baseline.coachAdherencePct).toBe(100);
    expect(baseline.laneAStatus).toBe("granted");

    // --- revoke -----------------------------------------------------------------
    const report = await revokeAllConsents(marcus);
    expect(report.instruments.sort()).toEqual(["LANE_A", "LANE_B", "LANE_C"]);
    expect(report.before.researchCohortCount).toBe(2);
    expect(report.after.researchCohortCount).toBe(1); // Marcus vanished
    expect(report.after.positionalCohortCount).toBe(0);
    expect(report.after.displayNameVisible).toBe(false);
    expect(report.after.coachAdherencePct).toBeNull();
    expect(report.after.viewableDataClasses).toHaveLength(0);
    expect(report.after.researchDataClasses).toHaveLength(0);
    expect(report.after.laneAStatus).toBe("revoked");

    // Ingest gate: every probed class throws ConsentError.
    expect(report.ingestProbes.every((probe) => !probe.allowed)).toBe(true);
    expect(report.ingestProbes[0].error).toContain("Consent denied");
    await expect(assertIngestAllowed(marcus, "cpap_telemetry")).rejects.toBeInstanceOf(
      ConsentError
    );

    // Read gates: both tiers blocked, zero rows.
    expect(report.identifiedReadProbe.blocked).toBe(true);
    expect(report.identifiedReadProbe.rowsReturned).toBe(0);
    expect(report.researchReadProbe.blocked).toBe(true);

    // Rows at rest are quarantined, NOT deleted.
    const counts = await countRowsByDataClass(marcus);
    const cpapRow = counts.find((row) => row.dataClass === "cpap_telemetry")!;
    expect(cpapRow.rows).toBe(10);
    expect(cpapRow.viewIdentified).toBe(false);
    expect(cpapRow.researchDeid).toBe(false);

    // Bystander untouched.
    const bystanderRead = await getObservations(bystander, { use: "research_deid" });
    expect(bystanderRead.blocked).toBe(false);

    // --- restore ----------------------------------------------------------------
    const restore = await restoreAllConsents(marcus);
    expect(restore.instruments.sort()).toEqual(["LANE_A", "LANE_B", "LANE_C"]);
    expect(restore.after.researchCohortCount).toBe(2);
    expect(restore.after.positionalCohortCount).toBe(1);
    expect(restore.ingestProbes.every((probe) => probe.allowed)).toBe(true);
    expect(restore.identifiedReadProbe.blocked).toBe(false);
    expect(restore.identifiedReadProbe.rowsReturned).toBeGreaterThan(0);

    // Audit trail: re-grant created NEW records; history preserves the arc.
    const states = await getConsentStates(marcus);
    for (const state of states) {
      expect(state.status).toBe("granted");
      expect(state.historyCount).toBe(2); // original + re-grant
    }
    const history = await getConsentHistory(marcus);
    expect(history).toHaveLength(6); // 3 instruments × (grant, re-grant); revocation flipped in place
    const laneA = history.filter((record) => record.instrumentType === "LANE_A");
    expect(laneA[0].status).toBe("revoked"); // the original grant, revoked in place
    expect(laneA[0].revokedAt).not.toBeNull();
    expect(laneA[1].status).toBe("granted"); // the demo-reset re-grant
    expect(laneA[1].revokedAt).toBeNull();
  });

  it("restore is a no-op for instruments still granted", async () => {
    const marcus = await createMarcusLike();
    const restore = await restoreAllConsents(marcus);
    expect(restore.instruments).toHaveLength(0);
    const states = await getConsentStates(marcus);
    for (const state of states) expect(state.historyCount).toBe(1);
  });
});
