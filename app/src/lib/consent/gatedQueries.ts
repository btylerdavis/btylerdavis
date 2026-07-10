import type { Device, Observation, SleepSession, ProResponse, TreatmentEvent } from "@prisma/client";
import { prisma } from "../db";
import { grantsFor, grantSetHas, loadAllGrants, loadGrants, type GrantSet } from "./engine";
import { sourceToDataClass } from "./scopes";
import { DATA_CLASSES, type ConsentUse, type DataClass } from "./types";

/**
 * Consent-gated read helpers (the "read gate" of T2.6). Every query path
 * that surfaces participant data goes through these: rows whose data class
 * lacks a current grant for the requested use are filtered out, and the
 * result carries a `blocked` marker naming the refused data classes.
 *
 * NOTE (identity split): none of these helpers join DemoIdentity. The only
 * identity join in the codebase is getLinkedProfile, an explicitly
 * identified-tier view, and it is double-gated (linkage + view_identified).
 */

export interface GatedResult<T> {
  data: T[];
  /** true when at least one requested data class had no current grant */
  blocked: boolean;
  blockedDataClasses: DataClass[];
}

const OBSERVATION_DATA_CLASSES = DATA_CLASSES.filter((c) => c !== "linkage");

interface GatedReadOptions {
  use: ConsentUse;
  /** restrict to these data classes (default: all observation classes) */
  dataClasses?: DataClass[];
  concepts?: string[];
  from?: Date;
  to?: Date;
  /** preloaded grants (bulk callers); loaded on demand otherwise */
  grants?: GrantSet;
}

function splitGranted(
  grants: GrantSet,
  requested: DataClass[],
  use: ConsentUse
): { granted: Set<DataClass>; blocked: DataClass[] } {
  const granted = new Set<DataClass>();
  const blocked: DataClass[] = [];
  for (const dataClass of requested) {
    if (grantSetHas(grants, dataClass, use)) granted.add(dataClass);
    else blocked.push(dataClass);
  }
  return { granted, blocked };
}

/**
 * Applies the read gate to fetched rows.
 *
 * "Requested" classes are either the explicit opts.dataClasses or the classes
 * actually present in the fetched rows; any requested class without a current
 * grant marks the result blocked and its rows are filtered out. When nothing
 * was fetched and nothing was explicitly requested, the result is blocked
 * unless the participant holds at least one grant for the use — so a
 * no-grant participant always reads as { data: [], blocked: true }.
 */
function gateRows<T>(
  rows: T[],
  classOf: (row: T) => DataClass,
  grants: GrantSet,
  use: ConsentUse,
  explicit: DataClass[] | undefined,
  fallbackClasses: DataClass[]
): GatedResult<T> {
  const inScope = explicit ? rows.filter((row) => explicit.includes(classOf(row))) : rows;
  const encountered = [...new Set(inScope.map(classOf))];
  const requested = explicit ?? encountered;
  const { granted, blocked } = splitGranted(grants, requested, use);

  if (requested.length === 0) {
    // Nothing stored and nothing explicitly asked for: blocked unless some
    // grant exists for this use.
    const anyGrant = fallbackClasses.some((dc) => grantSetHas(grants, dc, use));
    return anyGrant
      ? { data: [], blocked: false, blockedDataClasses: [] }
      : { data: [], blocked: true, blockedDataClasses: fallbackClasses };
  }

  return {
    data: inScope.filter((row) => granted.has(classOf(row))),
    blocked: blocked.length > 0,
    blockedDataClasses: blocked,
  };
}

/**
 * Observations for a participant, filtered by consent grant for the given
 * use. With no current grant this returns data: [] and blocked: true.
 */
export async function getObservations(
  participantId: string,
  opts: GatedReadOptions
): Promise<GatedResult<Observation>> {
  const grants = opts.grants ?? (await loadGrants(participantId));
  const rows = await prisma.observation.findMany({
    where: {
      participantId,
      ...(opts.concepts ? { concept: { in: opts.concepts } } : {}),
      ...(opts.from || opts.to
        ? { effectiveDate: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } }
        : {}),
    },
    orderBy: { effectiveDate: "asc" },
  });
  return gateRows(
    rows,
    (row) => sourceToDataClass(row.source),
    grants,
    opts.use,
    opts.dataClasses,
    OBSERVATION_DATA_CLASSES
  );
}

/** Sleep sessions, gated the same way (sources: wearable / sleep_mat). */
export async function getSleepSessions(
  participantId: string,
  opts: GatedReadOptions
): Promise<GatedResult<SleepSession>> {
  const grants = opts.grants ?? (await loadGrants(participantId));
  const rows = await prisma.sleepSession.findMany({
    where: {
      participantId,
      ...(opts.from || opts.to
        ? { startTs: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } }
        : {}),
    },
    orderBy: { startTs: "asc" },
  });
  return gateRows(
    rows,
    (row) => sourceToDataClass(row.source),
    grants,
    opts.use,
    opts.dataClasses,
    ["wearable_sleep", "sleep_mat"]
  );
}

/** PRO responses, gated on the pro_responses data class. */
export async function getProResponses(
  participantId: string,
  opts: { use: ConsentUse; instruments?: string[]; grants?: GrantSet }
): Promise<GatedResult<ProResponse>> {
  const grants = opts.grants ?? (await loadGrants(participantId));
  if (!grantSetHas(grants, "pro_responses", opts.use)) {
    return { data: [], blocked: true, blockedDataClasses: ["pro_responses"] };
  }
  const data = await prisma.proResponse.findMany({
    where: {
      participantId,
      ...(opts.instruments ? { instrument: { in: opts.instruments } } : {}),
    },
    orderBy: { administeredAt: "asc" },
  });
  return { data, blocked: false, blockedDataClasses: [] };
}

/**
 * Treatment events (cpap_setup, mattress_delivery, therapy_stop, ...) are
 * clinical-lane data, gated on hst_clinical — the same rule getLinkedProfile
 * applies. Refused outright without a current grant for the requested use.
 */
export async function getTreatmentEvents(
  participantId: string,
  opts: { use: ConsentUse; types?: string[]; grants?: GrantSet }
): Promise<GatedResult<TreatmentEvent>> {
  const grants = opts.grants ?? (await loadGrants(participantId));
  if (!grantSetHas(grants, "hst_clinical", opts.use)) {
    return { data: [], blocked: true, blockedDataClasses: ["hst_clinical"] };
  }
  const data = await prisma.treatmentEvent.findMany({
    where: {
      participantId,
      ...(opts.types ? { type: { in: opts.types } } : {}),
    },
    orderBy: { eventDate: "asc" },
  });
  return { data, blocked: false, blockedDataClasses: [] };
}

/**
 * Consent policy for device registrations: each device class is gated by the
 * data class whose payloads the device produces. Appliances are clinic-
 * provisioned therapy hardware → clinical-lane data (hst_clinical), the same
 * rule treatment events follow.
 */
export const DEVICE_CLASS_TO_DATA_CLASS = {
  wearable: "wearable_sleep",
  cpap: "cpap_telemetry",
  sleep_mat: "sleep_mat",
  appliance: "hst_clinical",
} as const satisfies Record<string, DataClass>;

export type DeviceClass = keyof typeof DEVICE_CLASS_TO_DATA_CLASS;

/** Unique data classes the device gate spans (getDevices' fallback set). */
const DEVICE_DATA_CLASSES = [
  ...new Set(Object.values(DEVICE_CLASS_TO_DATA_CLASS)),
] as DataClass[];

/**
 * Maps a Device.deviceClass to the data class whose consent grant gates it.
 * Unknown classes map to null and are NEVER readable (fail closed).
 */
export function deviceClassToDataClass(deviceClass: string): DataClass | null {
  return DEVICE_CLASS_TO_DATA_CLASS[deviceClass as DeviceClass] ?? null;
}

/**
 * Devices for a participant, filtered by consent grant for the given use —
 * the device counterpart of getObservations. A device row is visible only
 * while a current grant covers its mapped data class; with no current grant
 * this returns data: [] and blocked: true.
 */
export async function getDevices(
  participantId: string,
  opts: { use: ConsentUse; grants?: GrantSet; classes?: DeviceClass[] }
): Promise<GatedResult<Device>> {
  const grants = opts.grants ?? (await loadGrants(participantId));
  const rows = await prisma.device.findMany({
    where: {
      participantId,
      ...(opts.classes ? { deviceClass: { in: opts.classes } } : {}),
    },
    orderBy: { assignedAt: "asc" },
  });
  const known = rows.filter((row) => deviceClassToDataClass(row.deviceClass) !== null);
  const explicit = opts.classes
    ? [...new Set(opts.classes.map((c) => DEVICE_CLASS_TO_DATA_CLASS[c]))]
    : undefined;
  return gateRows(
    known,
    (row) => deviceClassToDataClass(row.deviceClass) as DataClass,
    grants,
    opts.use,
    explicit,
    DEVICE_DATA_CLASSES
  );
}

/**
 * Bulk device reader for cohort-scale aggregates (the loadAllGrants
 * pattern): ONE table read, then only devices whose participant holds a
 * current grant for the device's data class under the requested use are
 * returned. Aggregate callers (coach / research / exec) preload grants once
 * and pass them in so consent stays a single scan.
 */
export async function getAllGrantedDevices(opts: {
  use: ConsentUse;
  classes?: DeviceClass[];
  grants?: Map<string, GrantSet>;
}): Promise<Device[]> {
  const grants = opts.grants ?? (await loadAllGrants());
  const rows = await prisma.device.findMany({
    where: opts.classes ? { deviceClass: { in: opts.classes } } : undefined,
  });
  return rows.filter((row) => {
    const dataClass = deviceClassToDataClass(row.deviceClass);
    if (dataClass === null) return false; // unknown class: fail closed
    return grantSetHas(grantsFor(grants, row.participantId), dataClass, opts.use);
  });
}

export interface LinkedProfile {
  blocked: boolean;
  blockedReason?: string;
  /** Present ONLY for use === "view_identified" (identified-tier view). */
  identity?: { displayName: string; email: string } | null;
  retail?: {
    mattressPurchases: {
      sku: string;
      brand: string;
      model: string;
      firmnessRating: number;
      materialClass: string;
      purchaseDate: Date;
      deliveryDate: Date | null;
    }[];
  };
  clinical?: {
    hstObservations: { concept: string; valueNumeric: number | null; effectiveDate: Date }[];
    treatmentEvents: { type: string; eventDate: Date }[];
  };
}

/**
 * Lane C join: the ONE place retail-originated and clinic-originated data
 * (and, for identified-tier views, the DemoIdentity display record) are
 * combined. Refused outright without a current linkage grant.
 */
export async function getLinkedProfile(
  participantId: string,
  opts: { use: ConsentUse; grants?: GrantSet }
): Promise<LinkedProfile> {
  const grants = opts.grants ?? (await loadGrants(participantId));

  if (!grantSetHas(grants, "linkage", opts.use)) {
    return {
      blocked: true,
      blockedReason: `linkage join refused: no current Lane C ("linkage", "${opts.use}") grant`,
    };
  }

  const [purchases, hst, events, identity] = await Promise.all([
    grantSetHas(grants, "mattress_purchase", opts.use)
      ? prisma.mattressPurchase.findMany({
          where: { participantId },
          include: { catalogItem: true },
        })
      : Promise.resolve([]),
    grantSetHas(grants, "hst_clinical", opts.use)
      ? prisma.observation.findMany({
          where: { participantId, source: "hst" },
          orderBy: { effectiveDate: "asc" },
        })
      : Promise.resolve([]),
    // Treatment events are clinical-lane data: gated on hst_clinical like HST rows.
    grantSetHas(grants, "hst_clinical", opts.use)
      ? prisma.treatmentEvent.findMany({ where: { participantId }, orderBy: { eventDate: "asc" } })
      : Promise.resolve([]),
    // Identity join is allowed ONLY in the identified tier.
    opts.use === "view_identified"
      ? prisma.demoIdentity.findUnique({ where: { participantId } })
      : Promise.resolve(null),
  ]);

  return {
    blocked: false,
    identity: identity ? { displayName: identity.displayName, email: identity.email } : null,
    retail: {
      mattressPurchases: purchases.map((p) => ({
        sku: p.sku,
        brand: p.catalogItem.brand,
        model: p.catalogItem.model,
        firmnessRating: p.catalogItem.firmnessRating,
        materialClass: p.catalogItem.materialClass,
        purchaseDate: p.purchaseDate,
        deliveryDate: p.deliveryDate,
      })),
    },
    clinical: {
      hstObservations: hst.map((o) => ({
        concept: o.concept,
        valueNumeric: o.valueNumeric,
        effectiveDate: o.effectiveDate,
      })),
      treatmentEvents: events.map((e) => ({ type: e.type, eventDate: e.eventDate })),
    },
  };
}
