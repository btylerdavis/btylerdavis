import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getTreatmentEvents,
  grantConsent,
  revokeConsent,
} from "../consent";
import { prisma } from "../db";
import { getLinkedDisplayNames, registerIdentity } from "../identity";
import { setSimClock } from "../simclock";
import { addDays } from "../synthetic/profiles";
import { loadCoachDashboard } from "./queries";

/**
 * Coach-portal read paths: the treatment-event gated reader, the
 * identity-service bulk name gate, and a small-cohort smoke test of the
 * dashboard aggregates (consent filtering included).
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

async function createPatient(name: string): Promise<string> {
  const id = randomUUID();
  await prisma.participant.create({
    data: {
      id,
      yearOfBirth: 1970,
      sex: "female",
      enrollmentTouchpoint: "clinic",
      createdAt: addDays(SIM_TODAY, -60),
    },
  });
  await registerIdentity(id, name, `${name.toLowerCase().replace(/ /g, ".")}@example.com`);
  return id;
}

beforeEach(async () => {
  await wipe();
  await setSimClock(SIM_TODAY);
});

describe("getTreatmentEvents (gated reader)", () => {
  it("returns events with an hst_clinical grant and refuses without one", async () => {
    const id = await createPatient("Gate Check");
    await prisma.treatmentEvent.create({
      data: {
        participantId: id,
        type: "cpap_setup",
        eventDate: addDays(SIM_TODAY, -30),
        detail: "{}",
      },
    });

    const blocked = await getTreatmentEvents(id, { use: "view_identified" });
    expect(blocked.blocked).toBe(true);
    expect(blocked.data).toHaveLength(0);
    expect(blocked.blockedDataClasses).toEqual(["hst_clinical"]);

    await grantConsent(id, "LANE_A", { grantedAt: SIM_TODAY });
    const open = await getTreatmentEvents(id, { use: "view_identified" });
    expect(open.blocked).toBe(false);
    expect(open.data).toHaveLength(1);
    expect(open.data[0].type).toBe("cpap_setup");
  });
});

describe("getLinkedDisplayNames (identity gate)", () => {
  it("returns names only for participants with a current Lane C grant", async () => {
    const linked = await createPatient("Linda Linked");
    const sealed = await createPatient("Sealed Sam");
    await grantConsent(linked, "LANE_C", { grantedAt: SIM_TODAY });
    await grantConsent(sealed, "LANE_A", { grantedAt: SIM_TODAY }); // no linkage scope

    const names = await getLinkedDisplayNames([linked, sealed]);
    expect(names.get(linked)).toBe("Linda Linked");
    expect(names.has(sealed)).toBe(false);

    // Revocation seals the name again.
    await revokeConsent(linked, "LANE_C");
    const after = await getLinkedDisplayNames([linked, sealed]);
    expect(after.size).toBe(0);
  });
});

describe("loadCoachDashboard (small-cohort smoke)", () => {
  it("aggregates adherence, roster, and funnel with consent filtering", async () => {
    // Patient A: Lane A + Lane C, CPAP set up 40 days ago, adherent usage.
    const adherent = await createPatient("Ada Adherent");
    await grantConsent(adherent, "LANE_A", { grantedAt: addDays(SIM_TODAY, -60) });
    await grantConsent(adherent, "LANE_C", { grantedAt: addDays(SIM_TODAY, -60) });
    const setupA = addDays(SIM_TODAY, -40);
    await prisma.treatmentEvent.create({
      data: { participantId: adherent, type: "cpap_setup", eventDate: setupA, detail: "{}" },
    });
    await prisma.device.create({
      data: {
        participantId: adherent,
        deviceClass: "cpap",
        make: "ResMed",
        model: "AirSense 11",
        assignedAt: setupA,
      },
    });
    await prisma.observation.createMany({
      data: Array.from({ length: 39 }, (_, i) => ({
        participantId: adherent,
        source: "airview",
        concept: "cpap_usage_minutes",
        valueNumeric: 380, // ≥ 4 h every night
        unit: "min",
        effectiveDate: addDays(setupA, i + 1),
        grain: "day",
        qualityFlags: "[]",
      })),
    });

    // Patient B: Lane A only, CPAP with an active therapy-gap streak.
    const lapsed = await createPatient("Gap Gary");
    await grantConsent(lapsed, "LANE_A", { grantedAt: addDays(SIM_TODAY, -60) });
    const setupB = addDays(SIM_TODAY, -20);
    await prisma.treatmentEvent.create({
      data: { participantId: lapsed, type: "cpap_setup", eventDate: setupB, detail: "{}" },
    });
    await prisma.observation.createMany({
      data: [
        ...Array.from({ length: 10 }, (_, i) => ({
          participantId: lapsed,
          source: "airview",
          concept: "cpap_usage_minutes",
          valueNumeric: 120, // under the 4 h bar
          unit: "min",
          effectiveDate: addDays(setupB, i + 1),
          grain: "day",
          qualityFlags: "[]",
        })),
        // Gap streak runs through the clock date, as the generator emits.
        ...Array.from({ length: 10 }, (_, i) => ({
          participantId: lapsed,
          source: "airview",
          concept: "therapy_gap",
          valueNumeric: 1,
          effectiveDate: addDays(setupB, 11 + i),
          grain: "day",
          qualityFlags: '["device_gap"]',
        })),
      ],
    });

    // Patient C: retail-only (Lane B) — NOT in the clinic roster.
    const retail = randomUUID();
    await prisma.participant.create({
      data: {
        id: retail,
        yearOfBirth: 1985,
        sex: "male",
        enrollmentTouchpoint: "retail",
        createdAt: addDays(SIM_TODAY, -10),
      },
    });
    await grantConsent(retail, "LANE_B", { grantedAt: addDays(SIM_TODAY, -10) });

    const dashboard = await loadCoachDashboard({ page: 1, sortDir: "desc" });

    expect(dashboard.tiles.enrolled).toBe(2); // Lane A holders only
    expect(dashboard.tiles.linked).toBe(1); // Ada's Lane C
    expect(dashboard.tiles.cpapAdherent).toBe(1);

    // Funnel: both set up + flowing; only Ada is 30d-eligible AND adherent.
    expect(dashboard.funnel[0]).toMatchObject({ stage: "CPAP set up", count: 2 });
    expect(dashboard.funnel[1]).toMatchObject({ stage: "Telemetry flowing", count: 2 });
    expect(dashboard.funnel[2].count).toBe(1);

    // Patient rows: sorted by adherence desc — Ada 100% first, Gary later.
    const [first, second] = dashboard.patients.rows;
    expect(first.participantId).toBe(adherent);
    expect(first.adherencePct).toBe(100);
    expect(first.displayName).toBe("Ada Adherent"); // Lane C name
    expect(second.participantId).toBe(lapsed);
    expect(second.displayName).toBeNull(); // no Lane C → pseudonymous
    expect(second.adherencePct).toBeLessThan(50);

    // Gary's 10-night gap streak is flagged with its start date.
    const gapFlag = dashboard.flags.therapyGaps.find(
      (row) => row.participantId === lapsed
    );
    expect(gapFlag).toBeDefined();
    expect(gapFlag?.sinceIso).toBe(
      addDays(setupB, 11).toISOString().slice(0, 10)
    );
    expect(second.flags).toContain("Therapy gap");

    // Revoke Ada entirely: without a CURRENT Lane A grant she leaves the
    // roster and appears in NO coach number — tile, funnel, table, or flag.
    // (Her revocation remains visible on /compliance/revocation, which reads
    // the consent ledger directly.)
    await revokeConsent(adherent, "LANE_A");
    await revokeConsent(adherent, "LANE_C");
    const after = await loadCoachDashboard({ page: 1, sortDir: "desc" });
    expect(after.tiles.enrolled).toBe(1); // Gary only
    expect(after.tiles.cpapAdherent).toBe(0);
    expect(after.tiles.linked).toBe(0);
    expect(after.funnel[0].count).toBe(1); // only Gary's telemetry is viewable now
    expect(after.patients.total).toBe(1);
    expect(after.patients.rows.map((row) => row.participantId)).toEqual([lapsed]);
    const flagIds = [
      ...after.flags.wearableGaps,
      ...after.flags.therapyGaps,
      ...after.flags.overduePros,
    ].map((row) => row.participantId);
    expect(flagIds).not.toContain(adherent);
  });
});
