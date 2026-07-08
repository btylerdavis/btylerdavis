import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { grantConsent, revokeConsent } from "../consent";
import { prisma } from "../db";
import { setSimClock } from "../simclock";
import { addDays } from "../synthetic/profiles";
import { loadResearchCohort } from "./cohort";
import { loadExplorer, memberMatches, parseFilters, filtersHref, patchedHref } from "./explorer";
import { buildPositionalDashboard } from "./positional";

/**
 * Research-tier read paths over a small handcrafted cohort: attribute
 * derivation, consent filtering (research_deid), the explorer's outcome
 * summaries, and the positional dashboard's cohort rule — including the
 * revocation-vanishing behavior the Act 6 demo depends on.
 */

const SIM_TODAY = new Date(Date.UTC(2026, 5, 30)); // 2026-06-30

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

const CATALOG_SKU = "TEST-MH-Q";

interface PatientSpec {
  enrolledDaysAgo?: number;
  yearOfBirth?: number;
  sex?: "male" | "female";
  door?: "clinic" | "retail";
  ahi?: number;
  supineAhi?: number;
  nonsupineAhi?: number;
  cpap?: boolean;
  mattress?: { deliveredDaysAgo: number };
  essBaseline?: number;
  essDay90?: number;
  supineNights?: { dayOffsetFromDelivery: number; value: number }[];
  lanes?: ("LANE_A" | "LANE_B" | "LANE_C")[];
}

async function createPatient(spec: PatientSpec): Promise<string> {
  const id = randomUUID();
  const enrolled = addDays(SIM_TODAY, -(spec.enrolledDaysAgo ?? 100));
  await prisma.participant.create({
    data: {
      id,
      yearOfBirth: spec.yearOfBirth ?? 1974,
      sex: spec.sex ?? "male",
      enrollmentTouchpoint: spec.door ?? "clinic",
      createdAt: enrolled,
    },
  });
  for (const lane of spec.lanes ?? ["LANE_A", "LANE_B"]) {
    await grantConsent(id, lane, { grantedAt: enrolled });
  }
  if (spec.ahi !== undefined) {
    await prisma.observation.createMany({
      data: [
        { concept: "ahi", valueNumeric: spec.ahi },
        { concept: "supine_ahi", valueNumeric: spec.supineAhi ?? spec.ahi * 1.5 },
        { concept: "nonsupine_ahi", valueNumeric: spec.nonsupineAhi ?? spec.ahi * 0.5 },
      ].map((row) => ({
        participantId: id,
        source: "hst",
        effectiveDate: addDays(enrolled, 3),
        grain: "session",
        qualityFlags: "[]",
        unit: "events/h",
        ...row,
      })),
    });
  }
  if (spec.cpap) {
    await prisma.device.create({
      data: {
        participantId: id,
        deviceClass: "cpap",
        make: "ResMed",
        model: "AirSense 11",
        assignedAt: addDays(enrolled, 10),
      },
    });
    // 10 usage nights: 8 adherent (≥240 min), 2 not → 80%.
    await prisma.observation.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({
        participantId: id,
        source: "airview",
        concept: "cpap_usage_minutes",
        valueNumeric: i < 8 ? 360 : 100,
        unit: "min",
        effectiveDate: addDays(enrolled, 11 + i),
        grain: "day",
        qualityFlags: "[]",
      })),
    });
  }
  if (spec.mattress) {
    const delivery = addDays(SIM_TODAY, -spec.mattress.deliveredDaysAgo);
    await prisma.mattressPurchase.create({
      data: {
        participantId: id,
        sku: CATALOG_SKU,
        purchaseDate: addDays(delivery, -10),
        deliveryDate: delivery,
        storeId: "MH-TEST",
      },
    });
    for (const night of spec.supineNights ?? []) {
      await prisma.observation.create({
        data: {
          participantId: id,
          source: "sleep_mat",
          concept: "supine_time_pct",
          valueNumeric: night.value,
          unit: "%",
          effectiveDate: addDays(delivery, night.dayOffsetFromDelivery),
          grain: "day",
          qualityFlags: "[]",
        },
      });
    }
  }
  if (spec.essBaseline !== undefined) {
    await prisma.proResponse.create({
      data: {
        participantId: id,
        instrument: "ESS",
        instrumentVersion: "1.0",
        administeredAt: new Date(enrolled.getTime() + 9 * 3_600_000),
        itemScores: "[]",
        totalScore: spec.essBaseline,
      },
    });
  }
  if (spec.essDay90 !== undefined) {
    await prisma.proResponse.create({
      data: {
        participantId: id,
        instrument: "ESS",
        instrumentVersion: "1.0",
        administeredAt: new Date(addDays(enrolled, 90).getTime() + 9 * 3_600_000),
        itemScores: "[]",
        totalScore: spec.essDay90,
      },
    });
  }
  return id;
}

beforeEach(async () => {
  await wipe();
  await setSimClock(SIM_TODAY);
  await prisma.mattressCatalog.create({
    data: {
      sku: CATALOG_SKU,
      brand: "Tempur-Pedic",
      model: "Test Medium Hybrid",
      firmnessRating: 6,
      materialClass: "hybrid",
      size: "Queen",
    },
  });
});

describe("loadResearchCohort", () => {
  it("derives attributes and outcomes from the store, consent-scoped", async () => {
    const supineNights = [
      // pre window (−28..−1): 8 nights at ~52%
      ...Array.from({ length: 8 }, (_, i) => ({ dayOffsetFromDelivery: -25 + i * 3, value: 52 })),
      // post window (+8..+35): 8 nights at ~40%
      ...Array.from({ length: 8 }, (_, i) => ({ dayOffsetFromDelivery: 8 + i * 3, value: 40 })),
    ];
    const id = await createPatient({
      ahi: 24,
      supineAhi: 41,
      nonsupineAhi: 9.8,
      cpap: true,
      mattress: { deliveredDaysAgo: 60 },
      supineNights,
      essBaseline: 14,
      essDay90: 9,
      enrolledDaysAgo: 100,
      yearOfBirth: 1974,
    });

    const cohort = await loadResearchCohort();
    expect(cohort.members).toHaveLength(1);
    const member = cohort.byId.get(id)!;
    expect(member.severity).toBe("moderate");
    expect(member.supinePredominant).toBe(true);
    expect(member.arm).toBe("cpap_mattress");
    expect(member.brand).toBe("Tempur-Pedic");
    expect(member.firmnessBand).toBe("medium");
    expect(member.age).toBe(52);
    expect(member.cpapAdherencePct).toBe(80);
    expect(member.essChange90).toBe(-5);
    expect(member.supinePre).toBeCloseTo(52, 5);
    expect(member.supinePost).toBeCloseTo(40, 5);
    expect(member.supineChange).toBeCloseTo(-12, 5);
    expect(cohort.supineNights.filter((n) => n.participantId === id).length).toBe(16);
  });

  it("excludes participants with no research_deid grant and nulls unscoped attributes", async () => {
    // Lane B only: no hst_clinical scope → severity/arm null, but member.
    const laneBOnly = await createPatient({ ahi: 35, lanes: ["LANE_B"] });
    // No lanes at all → not a member.
    const noConsent = await createPatient({ ahi: 20, lanes: [] });

    const cohort = await loadResearchCohort();
    expect(cohort.byId.has(noConsent)).toBe(false);
    const member = cohort.byId.get(laneBOnly)!;
    expect(member.severity).toBeNull();
    expect(member.arm).toBeNull();
  });

  it("drops a revoked participant from the cohort entirely", async () => {
    const id = await createPatient({ ahi: 24 });
    expect((await loadResearchCohort()).byId.has(id)).toBe(true);

    await revokeConsent(id, "LANE_A");
    await revokeConsent(id, "LANE_B");
    const after = await loadResearchCohort();
    expect(after.byId.has(id)).toBe(false);
    expect(after.members).toHaveLength(0);
  });
});

describe("explorer filters", () => {
  it("round-trips through the query string and drops junk values", () => {
    const filters = parseFilters({
      severity: "moderate",
      supine: "y",
      arm: "cpap_mattress",
      brand: "Tempur-Pedic",
      firmness: "banana", // invalid → dropped
      age: "45-54",
    });
    expect(filters).toEqual({
      severity: "moderate",
      supine: "y",
      arm: "cpap_mattress",
      brand: "Tempur-Pedic",
      age: "45-54",
    });
    expect(filtersHref(filters)).toContain("severity=moderate");
    expect(filtersHref({})).toBe("/research");
    expect(patchedHref(filters, "severity", undefined)).not.toContain("severity");
  });

  it("a filter on an attribute consent leaves null excludes the member", async () => {
    const laneBOnly = await createPatient({ ahi: 35, lanes: ["LANE_B"] });
    const cohort = await loadResearchCohort();
    const member = cohort.byId.get(laneBOnly)!;
    expect(memberMatches(member, {})).toBe(true);
    expect(memberMatches(member, { severity: "severe" })).toBe(false); // unreadable ≠ match
  });

  it("summarizes filtered outcomes and decrements on revocation", async () => {
    const moderate = await createPatient({
      ahi: 20,
      cpap: true,
      essBaseline: 14,
      essDay90: 10,
    });
    await createPatient({ ahi: 40, essBaseline: 16, essDay90: 15 }); // severe

    const before = await loadExplorer({ severity: "moderate" });
    expect(before.cohortTotal).toBe(2);
    expect(before.matched).toBe(1);
    expect(before.outcomes.essChange90).toEqual({ mean: -4, n: 1 });
    expect(before.outcomes.cpapAdherencePct.mean).toBe(80);

    await revokeConsent(moderate, "LANE_A");
    await revokeConsent(moderate, "LANE_B");
    const after = await loadExplorer({ severity: "moderate" });
    expect(after.cohortTotal).toBe(1);
    expect(after.matched).toBe(0);
    expect(after.outcomes.essChange90).toEqual({ mean: null, n: 0 });
  });
});

describe("positional dashboard", () => {
  it("counts the flagship cohort and buckets supine nights by week and band", async () => {
    const nights = [
      ...Array.from({ length: 14 }, (_, i) => ({ dayOffsetFromDelivery: -28 + i * 2, value: 50 })),
      ...Array.from({ length: 14 }, (_, i) => ({ dayOffsetFromDelivery: 8 + i * 2, value: 38 })),
    ];
    await createPatient({
      ahi: 24,
      supineAhi: 41,
      nonsupineAhi: 9.8,
      mattress: { deliveredDaysAgo: 45 },
      supineNights: nights,
      essBaseline: 14,
      essDay90: 9,
    });
    // Non-supine-predominant with mattress → NOT in the flagship cohort.
    await createPatient({
      ahi: 20,
      supineAhi: 20,
      nonsupineAhi: 20,
      mattress: { deliveredDaysAgo: 45 },
    });

    const dashboard = buildPositionalDashboard(await loadResearchCohort());
    expect(dashboard.cohortCount).toBe(1);
    expect(dashboard.instrumentedCount).toBe(1);
    expect(dashboard.bandN.medium).toBe(1);
    const preWeek = dashboard.weekly.find((point) => point.week === -2)!;
    expect(preWeek.medium).toBeCloseTo(50, 1);
    const postWeek = dashboard.weekly.find((point) => point.week === 2)!;
    expect(postWeek.medium).toBeCloseTo(38, 1);
    // n=1 brand pair is flagged insufficient.
    expect(dashboard.brandPairs).toHaveLength(1);
    expect(dashboard.brandPairs[0]).toMatchObject({
      brand: "Tempur-Pedic",
      n: 1,
      insufficient: true,
    });
    // supine change −12 ⇒ responder, ESS change −5 lands in the "≤ −6"… no: −5 bucket.
    expect(dashboard.respondersN).toBe(1);
    expect(dashboard.nonRespondersN).toBe(0);
    const bucket = dashboard.essDist.find((b) => b.bucket === "−5 to −4")!;
    expect(bucket.respondersCount).toBe(1);
    expect(bucket.respondersPct).toBe(100);
  });
});
