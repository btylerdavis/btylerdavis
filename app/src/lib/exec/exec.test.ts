import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { grantConsent, revokeConsent } from "../consent";
import { prisma } from "../db";
import { setSimClock } from "../simclock";
import { addDays } from "../synthetic/profiles";
import { loadExecDashboard, parseAssumptions, DEFAULT_ASSUMPTIONS } from "./queries";

/**
 * Exec funnel over a handcrafted retail→clinic cohort: stage membership,
 * revenue math, and the consent filter (a revoked participant vanishes from
 * every stage and every asset tile on the next load).
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

interface FunnelSpec {
  door?: "retail" | "clinic";
  stopBang?: number;
  hst?: boolean;
  therapy?: "cpap" | "appliance" | null;
  lanes?: ("LANE_A" | "LANE_B" | "LANE_C")[];
  sleepMat?: boolean;
  /** nights of day-grain wearable observations to write */
  nights?: number;
}

async function createParticipant(spec: FunnelSpec): Promise<string> {
  const id = randomUUID();
  const enrolled = addDays(SIM_TODAY, -60);
  await prisma.participant.create({
    data: {
      id,
      yearOfBirth: 1974,
      sex: "male",
      enrollmentTouchpoint: spec.door ?? "retail",
      createdAt: enrolled,
    },
  });
  for (const lane of spec.lanes ?? ["LANE_B", "LANE_A"]) {
    await grantConsent(id, lane, { grantedAt: enrolled });
  }
  if (spec.stopBang !== undefined) {
    await prisma.proResponse.create({
      data: {
        id: randomUUID(),
        participantId: id,
        instrument: "STOP_BANG",
        instrumentVersion: "1.0",
        administeredAt: enrolled,
        itemScores: "[]",
        totalScore: spec.stopBang,
      },
    });
  }
  if (spec.hst) {
    await prisma.observation.create({
      data: {
        id: randomUUID(),
        participantId: id,
        source: "hst",
        concept: "ahi",
        valueNumeric: 24,
        effectiveDate: addDays(enrolled, 7),
        grain: "session",
        qualityFlags: "[]",
      },
    });
  }
  if (spec.therapy) {
    await prisma.treatmentEvent.create({
      data: {
        id: randomUUID(),
        participantId: id,
        type: spec.therapy === "cpap" ? "cpap_setup" : "appliance_delivery",
        eventDate: addDays(enrolled, 14),
        detail: "{}",
      },
    });
  }
  if (spec.sleepMat) {
    await prisma.device.create({
      data: {
        id: randomUUID(),
        participantId: id,
        deviceClass: "sleep_mat",
        make: "Withings",
        model: "Sleep Analyzer",
        assignedAt: enrolled,
      },
    });
  }
  for (let night = 0; night < (spec.nights ?? 0); night++) {
    await prisma.observation.create({
      data: {
        id: randomUUID(),
        participantId: id,
        source: "healthkit",
        concept: "sleep_efficiency",
        valueNumeric: 85,
        effectiveDate: addDays(enrolled, night + 1),
        grain: "day",
        qualityFlags: "[]",
      },
    });
  }
  return id;
}

beforeEach(async () => {
  await wipe();
  await setSimClock(SIM_TODAY);
});

describe("loadExecDashboard funnel", () => {
  it("counts the four stages from actual retail→clinic data", async () => {
    // full-funnel converter (CPAP)
    await createParticipant({ stopBang: 6, hst: true, therapy: "cpap" });
    // full-funnel converter (appliance — counts as conversion, not CPAP value)
    await createParticipant({ stopBang: 5, hst: true, therapy: "appliance" });
    // at-risk, HST done, no therapy yet
    await createParticipant({ stopBang: 4, hst: true, therapy: null });
    // at-risk, never accepted the HST referral
    await createParticipant({ stopBang: 3, hst: false, therapy: null });
    // low-risk screen: leaves the funnel after stage 1
    await createParticipant({ stopBang: 2, hst: true, therapy: null });
    // clinic-door patient: not part of the retail funnel at all
    await createParticipant({ door: "clinic", hst: true, therapy: "cpap", lanes: ["LANE_A"] });

    const dash = await loadExecDashboard();
    expect(dash.funnel.map((stage) => stage.count)).toEqual([5, 4, 3, 2]);
    expect(dash.funnel[0].stage).toContain("STOP-BANG");
  });

  it("computes referral-funnel value from the assumptions", async () => {
    await createParticipant({ stopBang: 6, hst: true, therapy: "cpap" });
    await createParticipant({ stopBang: 5, hst: true, therapy: "appliance" });
    await createParticipant({ stopBang: 4, hst: true, therapy: null });

    const dash = await loadExecDashboard({ hstValue: 300, cpapValue: 1200 });
    expect(dash.revenue.hstCount).toBe(3);
    expect(dash.revenue.cpapSetupCount).toBe(1);
    expect(dash.revenue.totalValue).toBe(3 * 300 + 1 * 1200);
  });

  it("drops revoked participants from every stage and every asset tile", async () => {
    const kept = await createParticipant({
      stopBang: 6,
      hst: true,
      therapy: "cpap",
      sleepMat: true,
      nights: 3,
    });
    const revoked = await createParticipant({
      stopBang: 6,
      hst: true,
      therapy: "cpap",
      sleepMat: true,
      nights: 5,
    });

    const before = await loadExecDashboard();
    expect(before.funnel.map((stage) => stage.count)).toEqual([2, 2, 2, 2]);
    expect(before.growth.consented).toBe(2);
    expect(before.assets.instrumented).toBe(2);
    expect(before.assets.observationNights).toBe(8);

    await revokeConsent(revoked, "LANE_A");
    await revokeConsent(revoked, "LANE_B");

    const after = await loadExecDashboard();
    expect(after.funnel.map((stage) => stage.count)).toEqual([1, 1, 1, 1]);
    expect(after.growth.consented).toBe(1);
    expect(after.assets.instrumented).toBe(1);
    expect(after.assets.observationNights).toBe(3);
    expect(after.growth.linked).toBe(0);

    // kept participant still fully counted
    expect(kept).toBeTruthy();
  });

  it("counts Lane C linkage grants for the linked target", async () => {
    await createParticipant({ stopBang: 4, hst: true, lanes: ["LANE_B", "LANE_A", "LANE_C"] });
    await createParticipant({ stopBang: 4, hst: true });
    const dash = await loadExecDashboard();
    expect(dash.growth.linked).toBe(1);
  });
});

describe("parseAssumptions", () => {
  it("round-trips URL params with demo defaults and clamping", () => {
    expect(parseAssumptions({})).toEqual(DEFAULT_ASSUMPTIONS);
    expect(parseAssumptions({ hst: "450", cpap: "900" })).toEqual({
      hstValue: 450,
      cpapValue: 900,
    });
    expect(parseAssumptions({ hst: "junk", cpap: "-50" })).toEqual({
      hstValue: DEFAULT_ASSUMPTIONS.hstValue,
      cpapValue: 0,
    });
    expect(parseAssumptions({ hst: "99999999" }).hstValue).toBe(100_000);
  });
});
