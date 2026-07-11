import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { countRowsByDataClass, revokeDataClass } from "../compliance/revocation";
import { prisma } from "../db";
import { deidExportRow } from "../research/deidExport";
import { loadResearchCohort } from "../research/cohort";
import { setSimClock } from "../simclock";
import { addDays } from "../synthetic/profiles";
import {
  getDevices,
  getLinkedProfile,
  getObservations,
  getSleepSessions,
  getTreatmentEvents,
  grantConsent,
  sourceToDataClass,
  storedDataClass,
  treatmentEventTypeToDataClass,
  TREATMENT_EVENT_DATA_CLASSES,
} from "./index";

/**
 * Data-class lineage (audit F-03/F-06/F-09/F-10/F-11, level-up 3): every
 * subject-data row carries a validated class; classification is exhaustive
 * and FAIL CLOSED — unknown event types, sources and lineage values are
 * quarantined, never absorbed into a more permissive class.
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
  return id;
}

beforeEach(async () => {
  await wipe();
  await setSimClock(SIM_TODAY);
});

describe("classification maps are exhaustive and fail closed", () => {
  it("treatment-event types map to their owning class; unknown → null", () => {
    expect(TREATMENT_EVENT_DATA_CLASSES).toEqual({
      cpap_setup: "cpap_telemetry",
      titration_change: "cpap_telemetry",
      therapy_stop: "cpap_telemetry",
      appliance_delivery: "hst_clinical",
      mattress_delivery: "mattress_purchase",
    });
    expect(treatmentEventTypeToDataClass("cpap_setup")).toBe("cpap_telemetry");
    expect(treatmentEventTypeToDataClass("mattress_delivery")).toBe("mattress_purchase");
    expect(treatmentEventTypeToDataClass("firmware_update")).toBeNull();
    expect(treatmentEventTypeToDataClass("")).toBeNull();
  });

  it("sourceToDataClass recognizes the documented sources and returns null for everything else (audit F-10)", () => {
    expect(sourceToDataClass("hst")).toBe("hst_clinical");
    expect(sourceToDataClass("airview")).toBe("cpap_telemetry");
    expect(sourceToDataClass("sd_card")).toBe("cpap_telemetry");
    expect(sourceToDataClass("sleep_mat")).toBe("sleep_mat");
    expect(sourceToDataClass("pro")).toBe("pro_responses");
    expect(sourceToDataClass("pos")).toBe("mattress_purchase");
    expect(sourceToDataClass("healthkit")).toBe("wearable_sleep");
    expect(sourceToDataClass("aggregator:garmin")).toBe("wearable_sleep");
    expect(sourceToDataClass("wearable:oura")).toBe("wearable_sleep");
    // The audit's exact repro plus adjacent typos: no fail-open to wearable.
    expect(sourceToDataClass("airveiw")).toBeNull();
    expect(sourceToDataClass("AirView")).toBeNull();
    expect(sourceToDataClass("garmin")).toBeNull();
    expect(sourceToDataClass("")).toBeNull();
  });

  it("storedDataClass validates persisted lineage values", () => {
    expect(storedDataClass("cpap_telemetry")).toBe("cpap_telemetry");
    expect(storedDataClass("registry_demographics")).toBe("registry_demographics");
    expect(storedDataClass("not_a_class")).toBeNull();
    expect(storedDataClass(null)).toBeNull();
  });
});

describe("AUDIT REPRO F-06: treatment events are sealed by their OWN class", () => {
  async function subjectWithMixedEvents(): Promise<string> {
    const id = await makeParticipant();
    await grantConsent(id, "LANE_A", { grantedAt: addDays(SIM_TODAY, -90) });
    await grantConsent(id, "LANE_B", { grantedAt: addDays(SIM_TODAY, -90) });
    await grantConsent(id, "LANE_C", { grantedAt: addDays(SIM_TODAY, -90) });
    await prisma.treatmentEvent.createMany({
      data: [
        {
          participantId: id,
          type: "cpap_setup",
          eventDate: addDays(SIM_TODAY, -60),
          detail: "{}",
          dataClass: "cpap_telemetry",
        },
        {
          participantId: id,
          type: "mattress_delivery",
          eventDate: addDays(SIM_TODAY, -50),
          detail: "{}",
          dataClass: "mattress_purchase",
        },
        {
          participantId: id,
          type: "appliance_delivery",
          eventDate: addDays(SIM_TODAY, -40),
          detail: "{}",
          dataClass: "hst_clinical",
        },
      ],
    });
    return id;
  }

  it("revoking only mattress_purchase hides mattress_delivery while clinical grants stay live", async () => {
    const id = await subjectWithMixedEvents();
    await revokeDataClass(id, "mattress_purchase");

    for (const use of ["view_identified", "research_deid"] as const) {
      const events = await getTreatmentEvents(id, { use });
      // The audit's repro: mattress_delivery kept leaking under hst_clinical.
      expect(events.data.map((event) => event.type).sort()).toEqual([
        "appliance_delivery",
        "cpap_setup",
      ]);
      expect(events.blocked).toBe(true);
      expect(events.blockedDataClasses).toEqual(["mattress_purchase"]);
    }

    // The linked profile's event timeline honors the same per-event rule.
    const profile = await getLinkedProfile(id, { use: "view_identified" });
    expect(profile.blocked).toBe(false);
    expect(profile.clinical?.treatmentEvents.map((event) => event.type).sort()).toEqual([
      "appliance_delivery",
      "cpap_setup",
    ]);
  });

  it("conversely, CPAP events are sealed by cpap_telemetry — NOT exposed under an HST permission", async () => {
    const id = await subjectWithMixedEvents();
    await revokeDataClass(id, "cpap_telemetry");

    const events = await getTreatmentEvents(id, { use: "view_identified" });
    expect(events.data.map((event) => event.type).sort()).toEqual([
      "appliance_delivery",
      "mattress_delivery",
    ]);
    expect(events.blockedDataClasses).toEqual(["cpap_telemetry"]);

    // And revoking hst_clinical does NOT take CPAP events with it.
    await revokeDataClass(id, "hst_clinical");
    const after = await getTreatmentEvents(id, { use: "view_identified" });
    expect(after.data.map((event) => event.type)).toEqual(["mattress_delivery"]);
  });

  it("at-rest counts classify events by lineage, not blanket hst_clinical", async () => {
    const id = await subjectWithMixedEvents();
    const atRest = await countRowsByDataClass(id);
    const rows = new Map(atRest.rows.map((row) => [row.dataClass, row.rows]));
    expect(rows.get("cpap_telemetry")).toBe(1);
    expect(rows.get("hst_clinical")).toBe(1);
    expect(rows.get("mattress_purchase")).toBe(1);
    expect(atRest.unclassifiedRows).toBe(0);
  });

  it("an unknown event type with no lineage is quarantined everywhere", async () => {
    const id = await subjectWithMixedEvents();
    await prisma.treatmentEvent.create({
      data: {
        participantId: id,
        type: "mystery_procedure",
        eventDate: addDays(SIM_TODAY, -10),
        detail: "{}",
        dataClass: null,
      },
    });

    const events = await getTreatmentEvents(id, { use: "view_identified" });
    expect(events.data.map((event) => event.type)).not.toContain("mystery_procedure");
    expect(events.unclassifiedRows).toBe(1);

    const atRest = await countRowsByDataClass(id);
    expect(atRest.unclassifiedRows).toBe(1);
  });
});

describe("AUDIT REPRO F-10: unknown sources are quarantined, never fail open", () => {
  it("a typo'd CPAP source with wearable-only consent is unreadable on every tier", async () => {
    const id = await makeParticipant();
    // Wearable research/view permission, NO CPAP permission — the exact
    // fixture from the audit.
    await grantConsent(id, "LANE_B", { grantedAt: addDays(SIM_TODAY, -90) });
    await prisma.observation.create({
      data: {
        participantId: id,
        source: "airveiw", // misspelled connector
        concept: "residual_ahi",
        valueNumeric: 12.3,
        unit: "events/h",
        effectiveDate: addDays(SIM_TODAY, -1),
        grain: "day",
        qualityFlags: "[]",
      },
    });
    await prisma.sleepSession.create({
      data: {
        participantId: id,
        source: "helthkit", // misspelled wearable
        startTs: addDays(SIM_TODAY, -1),
        endTs: SIM_TODAY,
        summary: "{}",
      },
    });

    for (const use of ["view_identified", "research_deid"] as const) {
      const observations = await getObservations(id, { use });
      expect(observations.data).toHaveLength(0);
      expect(observations.unclassifiedRows).toBe(1);
      const sessions = await getSleepSessions(id, { use });
      expect(sessions.data).toHaveLength(0);
      expect(sessions.unclassifiedRows).toBe(1);
    }

    // The quarantine is visible in the at-rest accounting.
    const atRest = await countRowsByDataClass(id);
    expect(atRest.unclassifiedRows).toBe(2);
  });

  it("a device with unknown class/lineage is unreadable (fail closed)", async () => {
    const id = await makeParticipant();
    await grantConsent(id, "LANE_A", { grantedAt: addDays(SIM_TODAY, -90) });
    await prisma.device.create({
      data: {
        participantId: id,
        deviceClass: "hoverboard",
        make: "Acme",
        model: "X",
        assignedAt: SIM_TODAY,
        dataClass: "not_a_class",
      },
    });
    const devices = await getDevices(id, { use: "view_identified" });
    expect(devices.data).toHaveLength(0);
    expect(devices.unclassifiedRows).toBe(1);
  });
});

describe("registry demographics are a consented class (audit F-11)", () => {
  it("a linkage-only research member exports NO demographic fields", async () => {
    const id = await makeParticipant();
    await grantConsent(id, "LANE_C", { grantedAt: addDays(SIM_TODAY, -90) });

    const cohort = await loadResearchCohort();
    const member = cohort.byId.get(id);
    // Still a member (linkage research grant)…
    expect(member).toBeDefined();
    if (!member) return;
    // …but the registry record is sealed: no demographics on the member…
    expect(member.sex).toBeNull();
    expect(member.age).toBeNull();
    expect(member.yearOfBirth).toBeNull();
    expect(member.door).toBeNull();
    expect(member.enrollmentDate).toBeNull();
    // …and none in the row-level export (age_band, sex, door, enrollment date
    // are all empty).
    const row = deidExportRow(member);
    const fields = row.split(",");
    expect(fields.slice(1, 5)).toEqual(["", "", "", ""]);
  });

  it("with a Lane A/B signature the demographics flow (registry_demographics is in the signed scope)", async () => {
    const id = await makeParticipant();
    await grantConsent(id, "LANE_A", { grantedAt: addDays(SIM_TODAY, -90) });

    const cohort = await loadResearchCohort();
    const member = cohort.byId.get(id);
    expect(member?.sex).toBe("male");
    expect(member?.door).toBe("retail");
    expect(member?.age).not.toBeNull();
  });

  it("revoking registry_demographics seals demographics while other classes keep flowing", async () => {
    const id = await makeParticipant();
    await grantConsent(id, "LANE_A", { grantedAt: addDays(SIM_TODAY, -90) });
    await prisma.observation.create({
      data: {
        participantId: id,
        source: "hst",
        concept: "ahi",
        valueNumeric: 24,
        unit: "events/h",
        effectiveDate: addDays(SIM_TODAY, -80),
        grain: "session",
        qualityFlags: "[]",
      },
    });

    await revokeDataClass(id, "registry_demographics");

    const cohort = await loadResearchCohort();
    const member = cohort.byId.get(id);
    expect(member).toBeDefined();
    expect(member?.sex).toBeNull();
    expect(member?.door).toBeNull();
    expect(member?.ahi).toBe(24); // hst_clinical untouched
  });
});
