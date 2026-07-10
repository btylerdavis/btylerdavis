import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { loadCoachDashboard } from "../coach/queries";
import { prisma } from "../db";
import { pseudonym } from "../deid";
import { loadExecDashboard } from "../exec/queries";
import { registerIdentity } from "../identity";
import { loadPartnerDashboard, PARTNER_BRAND } from "../partner/queries";
import {
  loadRecommendations,
  RECOMMENDATION_DATA_CLASSES,
} from "../recommendations/queries";
import { loadResearchCohort } from "../research/cohort";
import { buildDeidExportCsv } from "../research/deidExport";
import { loadExplorer } from "../research/explorer";
import { buildPositionalDashboard } from "../research/positional";
import { setSimClock } from "../simclock";
import { addDays } from "../synthetic/profiles";
import {
  getDevices,
  getLinkedProfile,
  getObservations,
  getProResponses,
  getSleepSessions,
  getTreatmentEvents,
  grantConsent,
  grantSetHas,
  loadGrants,
  revokeConsent,
  type ConsentUse,
} from "./index";

/**
 * Revocation-surface sweep (audit F3): one participant with FULL grants and
 * data in every class is revoked across all instruments, then EVERY surface
 * loader in the product must serve NOTHING for them — gated readers,
 * participant-page data functions, recommendations, the coach roster and all
 * its aggregates, research cohort/explorer/positional membership, partner
 * aggregates, exec funnel counts, and the de-id export row set. Rows at rest
 * must still exist (sealed behind the gates, never deleted).
 */

const SIM_TODAY = new Date(Date.UTC(2026, 5, 30)); // 2026-06-30

const TP_SKU = "RSURF-TP";
const OTHER_SKU = "RSURF-SERTA";

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

/**
 * A retail→clinic participant with all three lanes, one device per class,
 * and data in every data class: HST, CPAP telemetry, wearable nights, sleep-
 * mat nights around a mattress delivery, a sleep session, STOP-BANG + ESS
 * PROs, a cpap_setup treatment event, and a mattress purchase.
 */
async function seedFullParticipant(name: string, sku: string): Promise<string> {
  const id = randomUUID();
  const enrolled = addDays(SIM_TODAY, -90);
  const delivery = addDays(enrolled, 13);
  await prisma.participant.create({
    data: {
      id,
      yearOfBirth: 1974,
      sex: "male",
      enrollmentTouchpoint: "retail",
      createdAt: enrolled,
    },
  });
  await registerIdentity(id, name, `${name.toLowerCase().replace(/ /g, ".")}@example.com`);
  await grantConsent(id, "LANE_B", { grantedAt: enrolled });
  await grantConsent(id, "LANE_A", { grantedAt: addDays(enrolled, 7) });
  await grantConsent(id, "LANE_C", { grantedAt: addDays(enrolled, 7) });

  await prisma.device.createMany({
    data: [
      { participantId: id, deviceClass: "wearable", make: "Apple", model: "Watch S10", assignedAt: enrolled },
      { participantId: id, deviceClass: "cpap", make: "ResMed", model: "AirSense 11", assignedAt: addDays(enrolled, 14) },
      { participantId: id, deviceClass: "sleep_mat", make: "Withings", model: "Sleep Analyzer", assignedAt: addDays(enrolled, 2) },
      { participantId: id, deviceClass: "appliance", make: "SomnoMed", model: "SomnoDent Avant", assignedAt: addDays(enrolled, 14) },
    ],
  });

  // HST (hst_clinical): supine-predominant, moderate.
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
      unit: "events/h",
      ...row,
    })),
  });

  // CPAP telemetry: 10 adherent nights inside the coach's 30-day window.
  await prisma.treatmentEvent.create({
    data: { participantId: id, type: "cpap_setup", eventDate: addDays(enrolled, 14), detail: "{}" },
  });
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

  // Wearable nights (+ one sleep session).
  await prisma.observation.createMany({
    data: Array.from({ length: 3 }, (_, i) => ({
      participantId: id,
      source: "healthkit",
      concept: "sleep_duration_min",
      valueNumeric: 420,
      unit: "min",
      effectiveDate: addDays(SIM_TODAY, -(i + 1)),
      grain: "day",
      qualityFlags: "[]",
    })),
  });
  await prisma.sleepSession.create({
    data: {
      participantId: id,
      source: "healthkit",
      startTs: addDays(SIM_TODAY, -1),
      endTs: new Date(addDays(SIM_TODAY, -1).getTime() + 8 * 3_600_000),
      summary: "{}",
    },
  });

  // Sleep-mat nights around delivery (6 pre / 6 post window nights).
  await prisma.mattressPurchase.create({
    data: {
      participantId: id,
      sku,
      purchaseDate: addDays(enrolled, 3),
      deliveryDate: delivery,
      storeId: "MH-TEST",
    },
  });
  const supineNights = [
    ...Array.from({ length: 6 }, (_, i) => ({ offset: -25 + i * 4, value: 52 })),
    ...Array.from({ length: 6 }, (_, i) => ({ offset: 8 + i * 4, value: 40 })),
  ];
  await prisma.observation.createMany({
    data: supineNights.map((night) => ({
      participantId: id,
      source: "sleep_mat",
      concept: "supine_time_pct",
      valueNumeric: night.value,
      unit: "%",
      effectiveDate: addDays(delivery, night.offset),
      grain: "day",
      qualityFlags: "[]",
    })),
  });

  // PROs: retail STOP-BANG screen + ESS baseline / day-90.
  await prisma.proResponse.createMany({
    data: [
      {
        participantId: id,
        instrument: "STOP_BANG",
        instrumentVersion: "1.0",
        administeredAt: enrolled,
        itemScores: "[]",
        totalScore: 6,
      },
      {
        participantId: id,
        instrument: "ESS",
        instrumentVersion: "1.0",
        administeredAt: new Date(enrolled.getTime() + 9 * 3_600_000),
        itemScores: "[]",
        totalScore: 14,
      },
      {
        participantId: id,
        instrument: "ESS",
        instrumentVersion: "1.0",
        administeredAt: new Date(addDays(enrolled, 88).getTime() + 9 * 3_600_000),
        itemScores: "[]",
        totalScore: 9,
      },
    ],
  });

  return id;
}

beforeEach(async () => {
  await wipe();
  await setSimClock(SIM_TODAY);
  await prisma.mattressCatalog.createMany({
    data: [
      {
        sku: TP_SKU,
        brand: PARTNER_BRAND,
        model: "TEMPUR-ProAdapt Medium Hybrid",
        firmnessRating: 6,
        materialClass: "hybrid",
        size: "Queen",
      },
      {
        sku: OTHER_SKU,
        brand: "Serta",
        model: "iSeries Hybrid 3000 Medium",
        firmnessRating: 6,
        materialClass: "hybrid",
        size: "Queen",
      },
    ],
  });
});

describe("full revocation seals every product surface", () => {
  it("revoked participant serves NOTHING anywhere; rows at rest survive; control participant unaffected", async () => {
    const subject = await seedFullParticipant("Revoked Ray", TP_SKU);
    const control = await seedFullParticipant("Kept Kim", OTHER_SKU);

    // --- sanity BEFORE revocation: the subject is visible everywhere -------
    const devicesBefore = await getDevices(subject, { use: "view_identified" });
    expect(devicesBefore.blocked).toBe(false);
    expect(devicesBefore.data).toHaveLength(4);

    const coachBefore = await loadCoachDashboard({ page: 1, sortDir: "desc" });
    expect(coachBefore.tiles.enrolled).toBe(2);
    const researchBefore = await loadResearchCohort();
    expect(researchBefore.byId.has(subject)).toBe(true);
    const execBefore = await loadExecDashboard();
    expect(execBefore.funnel.map((stage) => stage.count)).toEqual([2, 2, 2, 2]);
    const exportBefore = buildDeidExportCsv(researchBefore.members, "2026-06-30");
    expect(exportBefore).toContain(pseudonym(subject));
    const partnerBefore = await loadPartnerDashboard();
    expect(partnerBefore.partnerPurchasers.suppressed).toBe(true); // n=1 (< k)

    // --- revoke ALL instruments --------------------------------------------
    for (const instrument of ["LANE_A", "LANE_B", "LANE_C"] as const) {
      const revoked = await revokeConsent(subject, instrument);
      expect(revoked?.status).toBe("revoked");
    }

    // 1. Gated readers: nothing, on both tiers.
    for (const use of ["view_identified", "research_deid"] as ConsentUse[]) {
      const [obs, sessions, pros, events, devices] = await Promise.all([
        getObservations(subject, { use }),
        getSleepSessions(subject, { use }),
        getProResponses(subject, { use }),
        getTreatmentEvents(subject, { use }),
        getDevices(subject, { use }),
      ]);
      for (const result of [obs, sessions, pros, events, devices]) {
        expect(result.blocked).toBe(true);
        expect(result.data).toHaveLength(0);
      }
      expect(pros.blockedDataClasses).toEqual(["pro_responses"]);
      expect(events.blockedDataClasses).toEqual(["hst_clinical"]);
      expect([...devices.blockedDataClasses].sort()).toEqual([
        "cpap_telemetry",
        "hst_clinical",
        "sleep_mat",
        "wearable_sleep",
      ]);
    }

    // 2. Participant-page data functions: identity sealed, purchases refused.
    const grants = await loadGrants(subject);
    expect(grants.size).toBe(0);
    expect(grantSetHas(grants, "mattress_purchase", "view_identified")).toBe(false);
    const linked = await getLinkedProfile(subject, { use: "view_identified", grants });
    expect(linked.blocked).toBe(true);
    expect(linked.identity).toBeUndefined();

    // 3. Recommendations: fully blocked, no cards, empty series.
    const recs = await loadRecommendations(subject);
    expect(recs.blocked).toBe(true);
    expect([...recs.blockedDataClasses].sort()).toEqual(
      [...RECOMMENDATION_DATA_CLASSES].sort()
    );
    expect(recs.recommendations).toHaveLength(0);
    expect(recs.inputs.hasCpap).toBe(false);
    expect(recs.inputs.cpapNights30).toBe(0);
    for (const series of Object.values(recs.series)) {
      expect(series.every((point) => point.value === null)).toBe(true);
    }

    // 4. Coach: off the roster and out of every number, badge and flag.
    const coach = await loadCoachDashboard({ page: 1, sortDir: "desc" });
    expect(coach.tiles.enrolled).toBe(1);
    expect(coach.patients.total).toBe(1);
    expect(coach.patients.rows.map((row) => row.participantId)).toEqual([control]);
    expect(coach.patients.rows[0].armBadges).toContain("CPAP");
    expect(coach.tiles.cpapAdherent).toBe(1); // control only
    expect(coach.tiles.linked).toBe(1); // control's Lane C
    expect(coach.funnel[0]).toMatchObject({ stage: "CPAP set up", count: 1 });
    const flagIds = [
      ...coach.flags.wearableGaps,
      ...coach.flags.therapyGaps,
      ...coach.flags.overduePros,
    ].map((row) => row.participantId);
    expect(flagIds).not.toContain(subject);

    // 5. Research: cohort, explorer and positional membership all gone.
    const research = await loadResearchCohort();
    expect(research.byId.has(subject)).toBe(false);
    expect(research.members.map((member) => member.id)).toEqual([control]);
    expect(
      research.supineNights.some((night) => night.participantId === subject)
    ).toBe(false);
    const explorer = await loadExplorer({});
    expect(explorer.cohortTotal).toBe(1);
    expect(explorer.matched).toBe(1);
    const positional = buildPositionalDashboard(research);
    expect(positional.cohortCount).toBe(1); // control is supine-predominant + delivered
    expect(positional.instrumentedCount).toBe(1);

    // 6. Partner aggregates: the only Tempur-Pedic purchaser vanished → 0
    //    (released as a true zero, not suppressed).
    const partner = await loadPartnerDashboard();
    expect(partner.partnerPurchasers).toEqual({ suppressed: false, display: "0" });

    // 7. Exec funnel: every stage and asset tile forgets the subject.
    const exec = await loadExecDashboard();
    expect(exec.funnel.map((stage) => stage.count)).toEqual([1, 1, 1, 1]);
    expect(exec.growth.consented).toBe(1);
    expect(exec.growth.linked).toBe(1);
    expect(exec.assets.instrumented).toBe(1);

    // 8. De-id export row set: subject's pseudonym is absent, control's present.
    const exportAfter = buildDeidExportCsv(research.members, "2026-06-30");
    expect(exportAfter).not.toContain(pseudonym(subject));
    expect(exportAfter).toContain(pseudonym(control));

    // 9. Rows at rest: sealed behind the gates, NOT deleted.
    expect(await prisma.observation.count({ where: { participantId: subject } })).toBeGreaterThan(0);
    expect(await prisma.sleepSession.count({ where: { participantId: subject } })).toBe(1);
    expect(await prisma.proResponse.count({ where: { participantId: subject } })).toBe(3);
    expect(await prisma.treatmentEvent.count({ where: { participantId: subject } })).toBe(1);
    expect(await prisma.device.count({ where: { participantId: subject } })).toBe(4);
    expect(await prisma.mattressPurchase.count({ where: { participantId: subject } })).toBe(1);
    const ledger = await prisma.consentRecord.findMany({ where: { participantId: subject } });
    expect(ledger).toHaveLength(3); // append-only: flipped, never deleted
    expect(ledger.every((record) => record.status === "revoked" && record.revokedAt !== null)).toBe(true);
  });
});
