import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { loadCoachDashboard } from "../coach/queries";
import { revokeDataClass } from "../compliance/revocation";
import { prisma } from "../db";
import { loadExecDashboard } from "../exec/queries";
import { setSimClock } from "../simclock";
import { addDays } from "../synthetic/profiles";
import {
  activeParticipantIds,
  countActiveLast7,
  gatedRegistryTotals,
  grantConsent,
  grantedObservationNights,
  latestGrantedObservationDates,
  revokeConsent,
} from "./index";

/**
 * Consent-aware aggregates (audit F-07, level-up 4): every count classifies
 * rows into data classes BEFORE aggregation. This suite runs the audit's
 * exact reproductions — a wearable-only-recent participant revoking
 * wearable_sleep while keeping another class must vanish from coach
 * activity, last-data freshness, exec observation nights, and time-machine
 * totals — plus mixed-grant noninterference (a revoked class never bleeds
 * into a granted class's numbers, and vice versa).
 */

const SIM_TODAY = new Date(Date.UTC(2026, 5, 30));

async function wipe() {
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

async function makeParticipant(): Promise<string> {
  const id = randomUUID();
  await prisma.participant.create({
    data: {
      id,
      yearOfBirth: 1975,
      sex: "male",
      enrollmentTouchpoint: "retail",
      createdAt: addDays(SIM_TODAY, -90),
    },
  });
  await grantConsent(id, "LANE_A", { grantedAt: addDays(SIM_TODAY, -90) });
  await grantConsent(id, "LANE_B", { grantedAt: addDays(SIM_TODAY, -90) });
  return id;
}

async function addWearableNights(id: string, nights: number, endOffset = -1): Promise<void> {
  await prisma.observation.createMany({
    data: Array.from({ length: nights }, (_, i) => ({
      participantId: id,
      source: "healthkit",
      concept: "sleep_duration_min",
      valueNumeric: 400,
      unit: "min",
      effectiveDate: addDays(SIM_TODAY, endOffset - i),
      grain: "day",
      qualityFlags: "[]",
    })),
  });
}

async function addCpapNights(id: string, nights: number, endOffset = -1): Promise<void> {
  await prisma.observation.createMany({
    data: Array.from({ length: nights }, (_, i) => ({
      participantId: id,
      source: "airview",
      concept: "cpap_usage_minutes",
      valueNumeric: 380,
      unit: "min",
      effectiveDate: addDays(SIM_TODAY, endOffset - i),
      grain: "day",
      qualityFlags: "[]",
    })),
  });
}

beforeEach(async () => {
  await wipe();
  await setSimClock(SIM_TODAY);
});

describe("AUDIT REPRO F-07: partial revocation removes the class from every aggregate", () => {
  it("wearable-only-recent participant: revoke wearable_sleep (keep other grants) → not active, no last-data, zero nights", async () => {
    const subject = await makeParticipant(); // wearable-only recent rows
    await addWearableNights(subject, 3);
    const control = await makeParticipant(); // CPAP data, untouched
    await addCpapNights(control, 5);

    // Before: both are active with fresh data.
    expect(await countActiveLast7(SIM_TODAY)).toBe(2);

    await revokeDataClass(subject, "wearable_sleep");

    // Coach activity / freshness (repro #4): the subject retains other
    // grants but their only recent class is sealed.
    const active = await activeParticipantIds(
      { from: addDays(SIM_TODAY, -7), to: SIM_TODAY },
      { use: "view_identified" }
    );
    expect(active.has(subject)).toBe(false);
    expect(active.has(control)).toBe(true);
    expect(await countActiveLast7(SIM_TODAY)).toBe(1);

    const lastData = await latestGrantedObservationDates([subject, control], {
      use: "view_identified",
    });
    expect(lastData.has(subject)).toBe(false); // freshness must not leak
    expect(lastData.get(control)).toEqual(addDays(SIM_TODAY, -1));

    // Exec observation nights (repro: "still contributed one night").
    const nights = await grantedObservationNights({ use: "view_identified" });
    expect(nights.has(subject)).toBe(false);
    expect(nights.get(control)).toBe(5);

    // The full dashboards agree.
    const coach = await loadCoachDashboard({ page: 1, sortDir: "desc" });
    expect(coach.tiles.activeLast7).toBe(1);
    const subjectRow = coach.patients.rows.find((row) => row.participantId === subject);
    expect(subjectRow?.lastDataIso).toBeNull();
    const exec = await loadExecDashboard();
    expect(exec.assets.observationNights).toBe(5); // control only
  });

  it("mixed-grant noninterference: sealing wearable leaves the CPAP contribution exactly intact", async () => {
    const subject = await makeParticipant();
    await addCpapNights(subject, 10, -1);
    await addWearableNights(subject, 3, -1); // overlapping recent wearable rows

    const before = await grantedObservationNights({ use: "view_identified" });
    expect(before.get(subject)).toBe(10); // distinct nights across classes

    await revokeDataClass(subject, "wearable_sleep");

    // CPAP freshness/activity/nights are untouched by the wearable seal.
    const nights = await grantedObservationNights({ use: "view_identified" });
    expect(nights.get(subject)).toBe(10);
    const lastData = await latestGrantedObservationDates([subject], {
      use: "view_identified",
    });
    expect(lastData.get(subject)).toEqual(addDays(SIM_TODAY, -1));
    const active = await activeParticipantIds(
      { from: addDays(SIM_TODAY, -7), to: SIM_TODAY },
      { use: "view_identified" }
    );
    expect(active.has(subject)).toBe(true);

    // And the sealed class contributes nothing anywhere: revoking CPAP too
    // now zeroes the participant out.
    await revokeDataClass(subject, "cpap_telemetry");
    expect((await grantedObservationNights({ use: "view_identified" })).has(subject)).toBe(false);
  });

  it("exec CPAP revenue prices only consent-covered setups (audit F-07: revenue gate)", async () => {
    const subject = await makeParticipant();
    // Full funnel membership: retail screen + HST + CPAP setup.
    await prisma.proResponse.create({
      data: {
        participantId: subject,
        instrument: "STOP_BANG",
        instrumentVersion: "1.0",
        administeredAt: addDays(SIM_TODAY, -90),
        itemScores: "[]",
        totalScore: 6,
      },
    });
    await prisma.observation.create({
      data: {
        participantId: subject,
        source: "hst",
        concept: "ahi",
        valueNumeric: 24,
        unit: "events/h",
        effectiveDate: addDays(SIM_TODAY, -80),
        grain: "session",
        qualityFlags: "[]",
      },
    });
    await prisma.treatmentEvent.create({
      data: {
        participantId: subject,
        type: "cpap_setup",
        eventDate: addDays(SIM_TODAY, -70),
        detail: "{}",
        dataClass: "cpap_telemetry",
      },
    });

    const before = await loadExecDashboard({ hstValue: 300, cpapValue: 1200 });
    expect(before.revenue.hstCount).toBe(1);
    expect(before.revenue.cpapSetupCount).toBe(1);
    expect(before.revenue.totalValue).toBe(300 + 1200);

    // Revoke ONLY cpap_telemetry: the setup event is sealed — no CPAP value
    // — while the HST referral (hst_clinical) keeps counting.
    await revokeDataClass(subject, "cpap_telemetry");
    const after = await loadExecDashboard({ hstValue: 300, cpapValue: 1200 });
    expect(after.revenue.hstCount).toBe(1);
    expect(after.revenue.cpapSetupCount).toBe(0);
    expect(after.revenue.totalValue).toBe(300);
  });

  it("time-machine registry totals are consent-gated per class (audit repro: totals must drop)", async () => {
    const subject = await makeParticipant();
    await addWearableNights(subject, 4);
    await addCpapNights(subject, 6);
    await prisma.sleepSession.create({
      data: {
        participantId: subject,
        source: "healthkit",
        startTs: addDays(SIM_TODAY, -1),
        endTs: SIM_TODAY,
        summary: "{}",
      },
    });
    await prisma.proResponse.create({
      data: {
        participantId: subject,
        instrument: "ESS",
        instrumentVersion: "1.0",
        administeredAt: addDays(SIM_TODAY, -5),
        itemScores: "[]",
        totalScore: 12,
      },
    });

    const before = await gatedRegistryTotals();
    expect(before).toEqual({
      participants: 1,
      observations: 10,
      sleepSessions: 1,
      proResponses: 1,
    });

    // Partial revocation: exactly the wearable rows drop.
    await revokeDataClass(subject, "wearable_sleep");
    const partial = await gatedRegistryTotals();
    expect(partial.observations).toBe(6); // CPAP only
    expect(partial.sleepSessions).toBe(0); // the only session was wearable
    expect(partial.proResponses).toBe(1);
    expect(partial.participants).toBe(1);

    // Full revocation: the participant and every at-rest row drop from the
    // product-facing totals ("drops from every count") — while the physical
    // rows still exist underneath (sealed, not deleted).
    await revokeConsent(subject, "LANE_A");
    await revokeConsent(subject, "LANE_B");
    const after = await gatedRegistryTotals();
    expect(after).toEqual({
      participants: 0,
      observations: 0,
      sleepSessions: 0,
      proResponses: 0,
    });
    expect(await prisma.observation.count()).toBe(10); // rows at rest survive
  });
});
