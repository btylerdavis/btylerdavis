import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getLinkedProfile, hasGrant } from "@/lib/consent";
import { setSimClock } from "@/lib/simclock";
import { MATTRESS_CATALOG } from "@/lib/synthetic/catalog";
import type { StopBangAnswers } from "@/lib/stopbang";
import { connectWearable, enrollRetail, recordMattressPurchase } from "./retail/actions";
import {
  confirmHstIntake,
  enrollClinicPatient,
  grantLinkage,
  linkedView,
  loadSampleHst,
  lookupRetailParticipants,
  recordCpapSetup,
} from "./clinic/actions";

/**
 * Integration tests for the enrollment server actions: both doors write
 * through the consent gates, and the Lane C blocked → linked demo beat
 * behaves exactly as scripted.
 */

const SIM_TODAY = new Date(Date.UTC(2026, 5, 30)); // 2026-06-30

const MARCUS_ANSWERS: StopBangAnswers = {
  snoring: true,
  tiredness: true,
  observed_apnea: true,
  pressure: true,
  bmi: false,
  age: true,
  neck: true,
  gender: true,
};

const ALL_ON = {
  wearable_sleep: true,
  sleep_mat: true,
  mattress_purchase: true,
  pro_responses: true,
};

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

beforeEach(async () => {
  await wipe();
  await setSimClock(SIM_TODAY);
  await prisma.mattressCatalog.createMany({ data: MATTRESS_CATALOG });
});

describe("retail door", () => {
  it("enrolls with Lane B custom scope and stores the STOP-BANG through the gate", async () => {
    const result = await enrollRetail({
      displayName: "Testy Marcus",
      answers: MARCUS_ANSWERS,
      toggles: ALL_ON,
    });

    expect(result.score).toBe(7);
    expect(result.band).toBe("high");
    expect(result.screenerStored).toBe(true);

    const participant = await prisma.participant.findUnique({
      where: { id: result.participantId },
    });
    expect(participant?.enrollmentTouchpoint).toBe("retail");
    expect(participant?.createdAt).toEqual(SIM_TODAY); // sim clock, not wall clock
    expect(participant?.sex).toBe("male");

    const consent = await prisma.consentRecord.findFirst({
      where: { participantId: result.participantId, instrumentType: "LANE_B" },
    });
    expect(consent?.status).toBe("granted");
    expect(consent?.eventType).toBe("grant"); // SIGNED event — extends the ceiling
    expect(consent?.revision).toBe(1);
    expect(consent?.grantedAt).toEqual(SIM_TODAY);
    const scope = JSON.parse(consent?.scope ?? "[]") as { dataClass: string }[];
    // The signed Lane B scope names the toggled classes PLUS the base
    // registry record (registry_demographics — audit F-11).
    expect(new Set(scope.map((s) => s.dataClass))).toEqual(
      new Set([
        "wearable_sleep",
        "sleep_mat",
        "mattress_purchase",
        "pro_responses",
        "registry_demographics",
      ])
    );

    const pro = await prisma.proResponse.findFirst({
      where: { participantId: result.participantId, instrument: "STOP_BANG" },
    });
    expect(pro?.totalScore).toBe(7);
    expect(JSON.parse(pro?.itemScores ?? "[]")).toHaveLength(8);
  });

  it("drops the STOP-BANG write when questionnaires are not consented", async () => {
    const result = await enrollRetail({
      displayName: "Quiet Quinn",
      answers: MARCUS_ANSWERS,
      toggles: { ...ALL_ON, pro_responses: false },
    });

    expect(result.screenerStored).toBe(false);
    expect(result.score).toBe(7); // still scored and routed
    const pros = await prisma.proResponse.count({
      where: { participantId: result.participantId },
    });
    expect(pros).toBe(0);
    expect(await hasGrant(result.participantId, "pro_responses", "collect")).toBe(false);
    expect(await hasGrant(result.participantId, "wearable_sleep", "collect")).toBe(true);
  });

  it("records purchase + delivery event on sim-clock dates, and blocks without consent", async () => {
    const consented = await enrollRetail({
      displayName: "Buyer Bell",
      answers: MARCUS_ANSWERS,
      toggles: ALL_ON,
    });
    const purchase = await recordMattressPurchase(consented.participantId, "TP-PROADAPT-MH-Q");
    expect(purchase.blocked).toBe(false);
    if (!purchase.blocked) {
      expect(purchase.purchaseDateIso).toBe("2026-06-30");
      expect(purchase.deliveryDateIso).toBe("2026-07-10"); // +10 days
    }
    const events = await prisma.treatmentEvent.findMany({
      where: { participantId: consented.participantId, type: "mattress_delivery" },
    });
    expect(events).toHaveLength(1);
    const episodes = await prisma.episode.findMany({
      where: { participantId: consented.participantId },
    });
    expect(episodes.map((e) => e.protocolPhase).sort()).toEqual([
      "baseline",
      "intervention",
    ]);

    const declined = await enrollRetail({
      displayName: "Window Shopper",
      answers: MARCUS_ANSWERS,
      toggles: { ...ALL_ON, mattress_purchase: false },
    });
    const blocked = await recordMattressPurchase(declined.participantId, "TP-PROADAPT-MH-Q");
    expect(blocked.blocked).toBe(true);
    expect(
      await prisma.mattressPurchase.count({ where: { participantId: declined.participantId } })
    ).toBe(0);
  });

  // UPDATED for audit F-03: device registration is consent-owned data. The
  // old behavior (register the device anyway, just refuse its payloads)
  // bypassed the ingest gate — now NO device row is created without a
  // wearable_sleep collect grant.
  it("refuses the wearable device registration itself without wearable consent", async () => {
    const enrolled = await enrollRetail({
      displayName: "Watch Wanda",
      answers: MARCUS_ANSWERS,
      toggles: { ...ALL_ON, wearable_sleep: false },
    });
    const connection = await connectWearable(enrolled.participantId, "apple");
    expect(connection.connected).toBe(false);
    expect(connection.dataConsented).toBe(false);
    expect(connection.deviceId).toBeNull();
    expect(
      await prisma.device.count({ where: { participantId: enrolled.participantId } })
    ).toBe(0);

    // With the grant, the registration flows and carries its lineage class.
    const consented = await enrollRetail({
      displayName: "Watch Wendy",
      answers: MARCUS_ANSWERS,
      toggles: ALL_ON,
    });
    const ok = await connectWearable(consented.participantId, "apple");
    expect(ok.connected).toBe(true);
    expect(ok.dataConsented).toBe(true);
    if (!ok.connected) return;
    const device = await prisma.device.findUnique({ where: { id: ok.deviceId } });
    expect(device?.deviceClass).toBe("wearable");
    expect(device?.dataClass).toBe("wearable_sleep");
    expect(device?.assignedAt).toEqual(SIM_TODAY);
  });
});

describe("clinic door + the Lane C blocked → linked beat", () => {
  it("runs the scripted arc: retail record sealed until linkage consent", async () => {
    // Act 1 — Marcus-alike enrolls at the store, buys a mattress.
    const retail = await enrollRetail({
      displayName: "Marcus Testreed",
      answers: MARCUS_ANSWERS,
      toggles: ALL_ON,
    });
    const purchase = await recordMattressPurchase(retail.participantId, "TP-PROADAPT-MH-Q");
    expect(purchase.blocked).toBe(false);

    // Act 2 — the coach finds him by display name (identity service only).
    const matches = await lookupRetailParticipants("Testreed");
    expect(matches).toEqual([
      { participantId: retail.participantId, displayName: "Marcus Testreed" },
    ]);

    // Lane A on the SAME participant.
    const clinic = await enrollClinicPatient(
      { mode: "existing", participantId: retail.participantId },
      true
    );
    expect(clinic.fromRetail).toBe(true);
    expect(clinic.participantId).toBe(retail.participantId);

    // HST intake from the sample report, written through the ingest gate.
    const sample = await loadSampleHst("report");
    expect(sample.ok).toBe(true);
    if (!sample.ok) return;
    const intake = await confirmHstIntake(clinic.participantId, sample.parsed);
    expect(intake).toMatchObject({
      blocked: false,
      observationsWritten: 7,
      supinePredominant: true,
    });
    const hstRows = await prisma.observation.findMany({
      where: { participantId: clinic.participantId, source: "hst" },
    });
    expect(hstRows).toHaveLength(7);

    // CPAP setup recorded (policy-guarded write, cpap_telemetry lineage).
    const cpap = await recordCpapSetup(clinic.participantId, "airsense11");
    expect(cpap.blocked).toBe(false);
    if (cpap.blocked) return;
    expect(cpap.model).toBe("AirSense 11 AutoSet");
    expect(cpap.setupDateIso).toBe("2026-06-30");
    const cpapEvent = await prisma.treatmentEvent.findFirst({
      where: { participantId: clinic.participantId, type: "cpap_setup" },
    });
    expect(cpapEvent?.dataClass).toBe("cpap_telemetry");

    // THE BEAT, part 1: the joined view is REFUSED — no Lane C.
    const before = await linkedView(clinic.participantId);
    expect(before.blocked).toBe(true);
    if (before.blocked) {
      expect(before.blockedReason).toMatch(/linkage join refused/);
    }

    // THE BEAT, part 2: grant Lane C, same call now joins everything.
    await grantLinkage(clinic.participantId);
    const after = await linkedView(clinic.participantId);
    expect(after.blocked).toBe(false);
    if (after.blocked) return;
    expect(after.identity?.displayName).toBe("Marcus Testreed");
    expect(after.retail.purchases).toHaveLength(1);
    expect(after.retail.purchases[0].model).toContain("ProAdapt");
    expect(after.retail.stopBang?.score).toBe(7);
    expect(after.clinical.hst).toHaveLength(7);
    expect(after.clinical.events.map((e) => e.type).sort()).toEqual([
      "cpap_setup",
      "mattress_delivery",
    ]);
  });

  it("enrolls a brand-new clinic patient with Lane A only", async () => {
    const clinic = await enrollClinicPatient(
      { mode: "new", displayName: "Nora Newman", yearOfBirth: 1969, sex: "female" },
      true
    );
    expect(clinic.fromRetail).toBe(false);
    expect(await hasGrant(clinic.participantId, "hst_clinical", "collect")).toBe(true);
    expect(await hasGrant(clinic.participantId, "mattress_purchase", "collect")).toBe(false);

    // HST via the CSV sample also flows.
    const sample = await loadSampleHst("csv");
    expect(sample.ok).toBe(true);
    if (!sample.ok) return;
    expect(sample.format).toBe("csv");
    const intake = await confirmHstIntake(clinic.participantId, sample.parsed);
    expect(intake.blocked).toBe(false);

    // No Lane C: the linkage join stays refused.
    const profile = await getLinkedProfile(clinic.participantId, {
      use: "view_identified",
    });
    expect(profile.blocked).toBe(true);
  });

  it("refuses HST intake before Lane A consent exists", async () => {
    // A retail participant WITHOUT clinical consent.
    const retail = await enrollRetail({
      displayName: "No Lane A",
      answers: MARCUS_ANSWERS,
      toggles: ALL_ON,
    });
    const sample = await loadSampleHst("csv");
    if (!sample.ok) throw new Error("fixture should parse");
    const intake = await confirmHstIntake(retail.participantId, sample.parsed);
    expect(intake.blocked).toBe(true);
    expect(
      await prisma.observation.count({
        where: { participantId: retail.participantId, source: "hst" },
      })
    ).toBe(0);
  });
});
