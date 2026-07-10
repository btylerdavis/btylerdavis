import type { Prisma } from "@prisma/client";
import { INSTRUMENT_SCOPES, type InstrumentType } from "../consent";
import { Rng } from "./prng";
import { addDays, COHORT_SEED, type ParticipantProfile } from "./profiles";

/**
 * Static (enrollment-time) rows for one participant: the participant record,
 * its DemoIdentity, consent records, episodes, scheduled treatment events,
 * device assignments and — consent permitting — the mattress purchase.
 *
 * Consent records are built from the engine's INSTRUMENT_SCOPES templates and
 * are created BEFORE any observation writes, so ingest gates evaluate against
 * a real consent history.
 *
 * Note on scheduling: cpap_setup / appliance_delivery / mattress_delivery are
 * scheduled events, written at enrollment even when their date is after the
 * sim clock (the POS flow records a delivery date ten days out). Nightly
 * generation only applies treatment effects once the date has passed;
 * therapy_stop is an *outcome* and is emitted by nightly generation instead.
 */
export interface EnrollmentRows {
  participant: Prisma.ParticipantCreateManyInput;
  identity: Prisma.DemoIdentityCreateManyInput;
  consentRecords: Prisma.ConsentRecordCreateManyInput[];
  episodes: Prisma.EpisodeCreateManyInput[];
  treatmentEvents: Prisma.TreatmentEventCreateManyInput[];
  devices: Prisma.DeviceCreateManyInput[];
  /** requires a mattress_purchase "collect" grant before writing */
  mattressPurchase: Prisma.MattressPurchaseCreateManyInput | null;
}

export function enrollmentRows(profile: ParticipantProfile): EnrollmentRows {
  const p = profile;
  const rng = new Rng(`${COHORT_SEED}:static:${p.id}`);

  const hstDate = addDays(p.enrollmentDate, p.hstOffsetDays);
  const treatmentDate = addDays(p.enrollmentDate, p.treatmentStartOffsetDays);
  const purchaseDate = addDays(p.enrollmentDate, p.mattressPurchaseOffsetDays);
  const deliveryDate = addDays(p.enrollmentDate, p.mattressDeliveryOffsetDays);

  // --- consent history ------------------------------------------------------
  const consents: { instrumentType: InstrumentType; grantedAt: Date }[] = [];
  if (p.enrollmentTouchpoint === "clinic") {
    consents.push({ instrumentType: "LANE_A", grantedAt: p.enrollmentDate });
    if (p.hasMattress) consents.push({ instrumentType: "LANE_B", grantedAt: purchaseDate });
  } else {
    // Retail door: consumer consent at enrollment; clinical consent when the
    // high-risk screen converts to an HST + clinic intake.
    consents.push({ instrumentType: "LANE_B", grantedAt: p.enrollmentDate });
    consents.push({ instrumentType: "LANE_A", grantedAt: hstDate });
  }
  if (p.laneC) {
    consents.push({
      instrumentType: "LANE_C",
      grantedAt: p.enrollmentTouchpoint === "retail" ? hstDate : addDays(p.enrollmentDate, 1),
    });
  }
  const consentRecords: Prisma.ConsentRecordCreateManyInput[] = consents.map((c) => ({
    id: rng.uuid(),
    participantId: p.id,
    instrumentType: c.instrumentType,
    instrumentVersion: "1.0-demo",
    status: "granted",
    grantedAt: c.grantedAt,
    // Determinism rule: seeded consent records are created the moment they
    // are granted. Runtime flows (enroll actions, revocation console) keep
    // the schema's now() default — only synthetic writes pin this.
    createdAt: c.grantedAt,
    scope: JSON.stringify(INSTRUMENT_SCOPES[c.instrumentType]),
  }));

  // --- episodes -------------------------------------------------------------
  // Baseline runs from enrollment to the treatment anchor (first exposure
  // change); intervention is open-ended from there.
  const anchor = p.hasCpap || p.hasAppliance ? treatmentDate : deliveryDate;
  const episodes: Prisma.EpisodeCreateManyInput[] = [
    {
      id: rng.uuid(),
      participantId: p.id,
      protocolPhase: "baseline",
      startDate: p.enrollmentDate,
      endDate: anchor,
    },
    {
      id: rng.uuid(),
      participantId: p.id,
      protocolPhase: "intervention",
      startDate: anchor,
      endDate: null,
    },
  ];

  // --- scheduled treatment events --------------------------------------------
  const treatmentEvents: Prisma.TreatmentEventCreateManyInput[] = [];
  if (p.hasCpap) {
    treatmentEvents.push({
      id: rng.uuid(),
      participantId: p.id,
      type: "cpap_setup",
      eventDate: treatmentDate,
      detail: JSON.stringify({ make: p.cpapMake, model: p.cpapModel, mode: "APAP" }),
    });
  }
  if (p.hasAppliance) {
    treatmentEvents.push({
      id: rng.uuid(),
      participantId: p.id,
      type: "appliance_delivery",
      eventDate: treatmentDate,
      detail: JSON.stringify({ make: p.applianceMake, model: p.applianceModel }),
    });
  }
  if (p.hasMattress && p.mattressSku) {
    treatmentEvents.push({
      id: rng.uuid(),
      participantId: p.id,
      type: "mattress_delivery",
      eventDate: deliveryDate,
      detail: JSON.stringify({ sku: p.mattressSku }),
    });
  }

  // --- devices ---------------------------------------------------------------
  const devices: Prisma.DeviceCreateManyInput[] = [
    {
      id: p.wearableDeviceId,
      participantId: p.id,
      deviceClass: "wearable",
      make: p.wearable.make,
      model: p.wearable.model,
      assignedAt: p.enrollmentDate,
    },
  ];
  if (p.hasCpap) {
    devices.push({
      id: p.cpapDeviceId,
      participantId: p.id,
      deviceClass: "cpap",
      make: p.cpapMake,
      model: p.cpapModel,
      assignedAt: treatmentDate,
    });
  }
  if (p.hasSleepMat) {
    devices.push({
      id: p.sleepMatDeviceId,
      participantId: p.id,
      deviceClass: "sleep_mat",
      make: "Withings",
      model: "Sleep Analyzer",
      assignedAt: addDays(p.enrollmentDate, 2),
    });
  }
  if (p.hasAppliance) {
    devices.push({
      id: p.applianceDeviceId,
      participantId: p.id,
      deviceClass: "appliance",
      make: p.applianceMake,
      model: p.applianceModel,
      assignedAt: treatmentDate,
    });
  }

  return {
    participant: {
      id: p.id,
      yearOfBirth: p.yearOfBirth,
      sex: p.sex,
      enrollmentTouchpoint: p.enrollmentTouchpoint,
      createdAt: p.enrollmentDate,
    },
    identity: {
      id: rng.uuid(),
      participantId: p.id,
      displayName: p.displayName,
      email: p.email,
    },
    consentRecords,
    episodes,
    treatmentEvents,
    devices,
    mattressPurchase:
      p.hasMattress && p.mattressSku
        ? {
            id: rng.uuid(),
            participantId: p.id,
            sku: p.mattressSku,
            purchaseDate,
            deliveryDate,
            storeId: "MH-WICHITA-01",
          }
        : null,
  };
}
