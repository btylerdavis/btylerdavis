/**
 * Consent-state model types (TECHNICAL.md §T2.6).
 *
 * A ConsentRecord's `scope` column is a JSON string encoding ConsentScope —
 * an array of (dataClass, use) grants. Every read/write path in the system
 * checks these grants; this module is the demo's production-semantics spine.
 */

export const DATA_CLASSES = [
  "wearable_sleep",
  "cpap_telemetry",
  "hst_clinical",
  "mattress_purchase",
  "sleep_mat",
  "pro_responses",
  "linkage",
] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

export const CONSENT_USES = ["collect", "view_identified", "research_deid"] as const;
export type ConsentUse = (typeof CONSENT_USES)[number];

export interface ScopeGrant {
  dataClass: DataClass;
  use: ConsentUse;
}

/** The JSON payload stored in ConsentRecord.scope. */
export type ConsentScope = ScopeGrant[];

export const INSTRUMENT_TYPES = ["LANE_A", "LANE_B", "LANE_C"] as const;
export type InstrumentType = (typeof INSTRUMENT_TYPES)[number];

export const CONSENT_STATUSES = ["granted", "revoked", "expired"] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

/** Thrown by ingest gates when a required "collect" grant is not current. */
export class ConsentError extends Error {
  readonly code = "CONSENT_DENIED";
  readonly participantId: string;
  readonly dataClass: DataClass;
  readonly use: ConsentUse;

  constructor(participantId: string, dataClass: DataClass, use: ConsentUse) {
    super(
      `Consent denied: participant ${participantId} has no current "${use}" grant for data class "${dataClass}"`
    );
    this.name = "ConsentError";
    this.participantId = participantId;
    this.dataClass = dataClass;
    this.use = use;
  }
}
