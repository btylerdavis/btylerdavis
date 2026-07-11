/**
 * Consent-state model types (TECHNICAL.md §T2.6).
 *
 * A ConsentRecord row is an IMMUTABLE EVENT (grant / revoke / scope
 * revision); its `scope` column is a JSON string encoding ConsentScope — an
 * array of (dataClass, use) grants. Current state is projected from the
 * event stream. Every read/write path in the system checks these grants;
 * this module is the demo's production-semantics spine.
 */

export const DATA_CLASSES = [
  "wearable_sleep",
  "cpap_telemetry",
  "hst_clinical",
  "mattress_purchase",
  "sleep_mat",
  "pro_responses",
  "linkage",
  // Base registry record: sex, year of birth, enrollment door and date
  // (audit F-11). Included in the Lane A and Lane B signed scopes; without a
  // current grant the demographic fields are unreadable and unexportable.
  "registry_demographics",
] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

export function isDataClass(value: string | null | undefined): value is DataClass {
  return typeof value === "string" && (DATA_CLASSES as readonly string[]).includes(value);
}

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

/**
 * Immutable event kinds (consent state machine v2):
 * - "grant": a participant-SIGNED authorization. Only grant events (plus the
 *   scope captured on revoke events, which is always a subset of what was
 *   signed) contribute to the authorized-scope ceiling.
 * - "revoke": ends the instrument's current grant; carries the scope that
 *   was in force so the event is self-describing.
 * - "scope_revision": administrative revision (partial revocation console /
 *   restore). MUST stay inside the signed ceiling — expanding scope requires
 *   a fresh signed grant (the re-consent flow).
 */
export const CONSENT_EVENT_TYPES = ["grant", "revoke", "scope_revision"] as const;
export type ConsentEventType = (typeof CONSENT_EVENT_TYPES)[number];

/** Participant lifecycle (audit F-01): "deleted" is terminal. */
export const PARTICIPANT_LIFECYCLE_STATES = [
  "active",
  "deletion_pending",
  "deleting",
  "deleted",
] as const;
export type ParticipantLifecycleState = (typeof PARTICIPANT_LIFECYCLE_STATES)[number];

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

/**
 * Thrown when a consent mutation or subject-data write targets a participant
 * whose lifecycle state forbids it (deleted tombstones above all — audit
 * F-01). Enforced INSIDE the same transaction as the mutation/write.
 */
export class LifecycleError extends Error {
  readonly code = "LIFECYCLE_DENIED";
  readonly participantId: string;
  readonly lifecycleState: string;

  constructor(participantId: string, lifecycleState: string) {
    super(
      `Lifecycle denied: participant ${participantId} is "${lifecycleState}" — ` +
        `consent mutations and data writes are refused`
    );
    this.name = "LifecycleError";
    this.participantId = participantId;
    this.lifecycleState = lifecycleState;
  }
}

/**
 * Thrown when a consent revision loses a compare-and-swap race (the expected
 * latest revision moved underneath the caller — audit F-05). Callers either
 * retry against the fresh state or surface the conflict.
 */
export class ConsentConflictError extends Error {
  readonly code = "CONSENT_CONFLICT";

  constructor(participantId: string, instrumentType: string, expected: number, actual: number) {
    super(
      `Consent revision conflict: ${instrumentType} for participant ${participantId} ` +
        `is at revision ${actual}, expected ${expected}`
    );
    this.name = "ConsentConflictError";
  }
}

/**
 * Thrown when an administrative scope revision would grant something the
 * participant never signed for (audit F-02). Expansion beyond the signed
 * ceiling requires a fresh participant-facing re-consent signature.
 */
export class ScopeCeilingError extends Error {
  readonly code = "SCOPE_CEILING_EXCEEDED";
  readonly participantId: string;
  readonly instrumentType: string;
  readonly deniedGrants: ScopeGrant[];

  constructor(participantId: string, instrumentType: string, deniedGrants: ScopeGrant[]) {
    super(
      `Scope ceiling exceeded: ${instrumentType} revision for participant ${participantId} ` +
        `includes never-signed grants (${deniedGrants
          .map((grant) => `${grant.dataClass}|${grant.use}`)
          .join(", ")}) — a new signed consent (re-consent flow) is required`
    );
    this.name = "ScopeCeilingError";
    this.participantId = participantId;
    this.instrumentType = instrumentType;
    this.deniedGrants = deniedGrants;
  }
}
