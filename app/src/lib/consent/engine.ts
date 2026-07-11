import type { ConsentRecord, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { INSTRUMENT_SCOPES } from "./scopes";
import {
  ConsentConflictError,
  ConsentError,
  CONSENT_USES,
  DATA_CLASSES,
  LifecycleError,
  ScopeCeilingError,
  type ConsentEventType,
  type ConsentScope,
  type ConsentStatus,
  type DataClass,
  type ConsentUse,
  type InstrumentType,
  type ScopeGrant,
} from "./types";

/**
 * Consent engine (TECHNICAL.md §T2.6) — consent state machine v2.
 *
 * The ledger is EVENT-SOURCED AND IMMUTABLE: a grant, a revocation, and a
 * scope revision each append a NEW ConsentRecord event; no record is ever
 * updated or deleted, so "append-only" is literally true. The *current*
 * state of an instrument is projected from its highest-revision event;
 * grants only flow from a current event whose status is "granted".
 *
 * Invariants enforced here, inside the SAME transaction as every mutation:
 * - lifecycle: a deleted participant can never receive a consent event
 *   (audit F-01);
 * - monotonic per-instrument revisions with a database unique constraint —
 *   the compare-and-swap anchor that makes concurrent revisions safe
 *   (audit F-05);
 * - the signed-scope ceiling: administrative scope revisions (partial
 *   revocation console, restores) can only carry grants the participant
 *   proved in a SIGNED grant event; expansion requires a fresh signature
 *   via the re-consent flow (audit F-02).
 */

/** Set of effective "dataClass|use" grant keys for one participant. */
export type GrantSet = ReadonlySet<string>;

const grantKey = (dataClass: DataClass, use: ConsentUse) => `${dataClass}|${use}`;

type Db = Prisma.TransactionClient | typeof prisma;

/** Runs fn transactionally: reuses an ambient transaction client if given. */
async function withTx<T>(
  db: Db,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  if ("$transaction" in db) return db.$transaction(fn);
  return fn(db);
}

/**
 * Lifecycle guard (audit F-01): every consent mutation and subject-data
 * write calls this INSIDE its own transaction. Tombstoned ("deleted") and
 * mid-deletion ("deleting") participants are terminal — nothing may be
 * granted, revised, restored, or written for them, ever.
 */
export async function assertActiveParticipant(
  participantId: string,
  db: Db = prisma
): Promise<void> {
  const participant = await db.participant.findUnique({
    where: { id: participantId },
    select: { lifecycleState: true, deletedAt: true },
  });
  if (!participant) throw new LifecycleError(participantId, "missing");
  const state = participant.lifecycleState;
  const alive =
    participant.deletedAt === null && (state === "active" || state === "deletion_pending");
  if (!alive) throw new LifecycleError(participantId, participant.deletedAt ? "deleted" : state);
}

/** Parses a ConsentRecord.scope JSON string; malformed scopes read as empty (fail closed). */
export function parseScopeJson(scope: string): ConsentScope {
  try {
    const parsed = JSON.parse(scope);
    return Array.isArray(parsed) ? (parsed as ConsentScope) : [];
  } catch {
    return [];
  }
}

function parseScope(record: ConsentRecord): ConsentScope {
  return parseScopeJson(record.scope);
}

/** Rejects scope payloads with unknown classes/uses (fail closed at write). */
function assertValidScope(scope: ConsentScope): void {
  for (const grant of scope) {
    if (
      !(DATA_CLASSES as readonly string[]).includes(grant.dataClass) ||
      !(CONSENT_USES as readonly string[]).includes(grant.use)
    ) {
      throw new Error(
        `Invalid consent scope entry: ${JSON.stringify(grant)} — unknown data class or use`
      );
    }
  }
}

/**
 * Latest event per instrument — the event that defines an instrument's
 * *current* state. Ordered by the monotonic `revision`; the legacy
 * (grantedAt, createdAt) ordering only breaks ties for pre-v2 rows that
 * share a revision.
 */
export function latestRecordsByInstrument(records: ConsentRecord[]): Map<string, ConsentRecord> {
  const latestByInstrument = new Map<string, ConsentRecord>();
  for (const record of records) {
    const current = latestByInstrument.get(record.instrumentType);
    if (
      !current ||
      record.revision > current.revision ||
      (record.revision === current.revision &&
        (record.grantedAt > current.grantedAt ||
          (record.grantedAt.getTime() === current.grantedAt.getTime() &&
            record.createdAt > current.createdAt)))
    ) {
      latestByInstrument.set(record.instrumentType, record);
    }
  }
  return latestByInstrument;
}

/** Pure evaluation of a participant's consent event stream into effective grants. */
export function evaluateGrants(records: ConsentRecord[]): GrantSet {
  const latestByInstrument = latestRecordsByInstrument(records);

  const grants = new Set<string>();
  for (const record of latestByInstrument.values()) {
    if (record.status !== "granted" || record.revokedAt !== null) continue; // revoked/expired fail
    for (const { dataClass, use } of parseScope(record)) {
      grants.add(grantKey(dataClass, use));
    }
  }
  return grants;
}

/**
 * The SIGNED-SCOPE CEILING (audit F-02): every grant the participant has
 * ever proven with a signature. Signed "grant" events define it directly;
 * "revoke" events carry the scope that was in force (always a subset of what
 * was signed), which keeps pre-v2 flipped-in-place rows counted. Purely
 * administrative "scope_revision" events NEVER extend the ceiling.
 */
export function signedScopeCeiling(records: ConsentRecord[]): GrantSet {
  const ceiling = new Set<string>();
  for (const record of records) {
    if ((record.eventType as ConsentEventType) === "scope_revision") continue;
    for (const { dataClass, use } of parseScope(record)) {
      ceiling.add(grantKey(dataClass, use));
    }
  }
  return ceiling;
}

/** Per-instrument signed ceilings (restore-all restores to these, never the template). */
export function signedScopeCeilingByInstrument(
  records: ConsentRecord[]
): Map<InstrumentType, GrantSet> {
  const ceilings = new Map<InstrumentType, Set<string>>();
  for (const record of records) {
    if ((record.eventType as ConsentEventType) === "scope_revision") continue;
    const instrument = record.instrumentType as InstrumentType;
    const ceiling = ceilings.get(instrument) ?? new Set<string>();
    for (const { dataClass, use } of parseScope(record)) {
      ceiling.add(grantKey(dataClass, use));
    }
    ceilings.set(instrument, ceiling);
  }
  return ceilings;
}

export function ceilingHas(ceiling: GrantSet, dataClass: DataClass, use: ConsentUse): boolean {
  return ceiling.has(grantKey(dataClass, use));
}

/** true when the class appears in the ceiling under ANY use. */
export function ceilingCoversClass(ceiling: GrantSet, dataClass: DataClass): boolean {
  return CONSENT_USES.some((use) => ceiling.has(grantKey(dataClass, use)));
}

/**
 * Loads and evaluates a participant's effective grants in one query.
 * Bulk paths (generator, time machine) preload this once per participant and
 * pass it to assertIngestAllowed / gated readers via `opts.grants`.
 */
export async function loadGrants(participantId: string, db: Db = prisma): Promise<GrantSet> {
  const records = await db.consentRecord.findMany({ where: { participantId } });
  return evaluateGrants(records);
}

export function grantSetHas(grants: GrantSet, dataClass: DataClass, use: ConsentUse): boolean {
  return grants.has(grantKey(dataClass, use));
}

const NO_GRANTS: GrantSet = new Set<string>();

/**
 * Effective grants for EVERY participant in one query — the cohort-scale
 * counterpart of loadGrants. Bulk read paths (coach portal aggregates, time
 * machine) use this so consent filtering stays a single table scan instead
 * of N per-participant queries. Participants with no records map to an
 * empty set (everything refused).
 */
export async function loadAllGrants(db: Db = prisma): Promise<Map<string, GrantSet>> {
  const records = await db.consentRecord.findMany();
  const byParticipant = new Map<string, ConsentRecord[]>();
  for (const record of records) {
    const list = byParticipant.get(record.participantId) ?? [];
    list.push(record);
    byParticipant.set(record.participantId, list);
  }
  const grants = new Map<string, GrantSet>();
  for (const [participantId, list] of byParticipant) {
    grants.set(participantId, evaluateGrants(list));
  }
  return grants;
}

/** Missing-safe accessor for loadAllGrants results: absent = no grants. */
export function grantsFor(all: Map<string, GrantSet>, participantId: string): GrantSet {
  return all.get(participantId) ?? NO_GRANTS;
}

/** Checks the latest consent state; revoked/expired grants fail. */
export async function hasGrant(
  participantId: string,
  dataClass: DataClass,
  use: ConsentUse,
  opts: { grants?: GrantSet; db?: Db } = {}
): Promise<boolean> {
  const grants = opts.grants ?? (await loadGrants(participantId, opts.db));
  return grantSetHas(grants, dataClass, use);
}

/**
 * Ingest gate. EVERY data-write path (synthetic generator, time machine,
 * ingestion connectors, enrollment flows) must call this before writing rows
 * of the given data class — and re-check it (plus the lifecycle guard)
 * inside the write transaction via the policy repository. Throws
 * ConsentError when no current "collect" grant.
 */
export async function assertIngestAllowed(
  participantId: string,
  dataClass: DataClass,
  opts: { grants?: GrantSet; db?: Db } = {}
): Promise<void> {
  if (!(await hasGrant(participantId, dataClass, "collect", opts))) {
    throw new ConsentError(participantId, dataClass, "collect");
  }
}

/** The consent event a "collect" admission would be recorded under. */
export interface CollectAuthority {
  instrumentType: InstrumentType;
  /** revision of the instrument's current (authorizing) event */
  revision: number;
}

/**
 * Identifies the consent event that CURRENTLY authorizes collecting
 * `dataClass` for this participant: the highest-revision event of an
 * instrument whose current state is granted and whose scope contains
 * (dataClass, "collect"). Used for import provenance receipts and the
 * consent-impact preview (audit v2 prioritized fixes 6 + 11). When more
 * than one instrument grants the class, the lexicographically first
 * instrument (LANE_A < LANE_B < LANE_C) is reported, deterministically.
 * Returns null when no current grant exists — the ingest gate will refuse.
 */
export async function collectAuthority(
  participantId: string,
  dataClass: DataClass,
  db: Db = prisma
): Promise<CollectAuthority | null> {
  const records = await db.consentRecord.findMany({ where: { participantId } });
  const authorizing = [...latestRecordsByInstrument(records).values()]
    .filter(
      (record) =>
        record.status === "granted" &&
        record.revokedAt === null &&
        parseScope(record).some((grant) => grant.dataClass === dataClass && grant.use === "collect")
    )
    .sort((a, b) => a.instrumentType.localeCompare(b.instrumentType));
  const record = authorizing[0];
  return record
    ? { instrumentType: record.instrumentType as InstrumentType, revision: record.revision }
    : null;
}

interface AppendEventInput {
  eventType: ConsentEventType;
  status: ConsentStatus;
  grantedAt: Date;
  revokedAt: Date | null;
  scope: ConsentScope;
  instrumentVersion: string;
  /** CAS precondition: the latest revision the caller derived its change from. */
  expectedRevision?: number;
}

/**
 * The single event-append primitive. Runs inside the caller's transaction:
 * lifecycle guard, CAS against the instrument's latest revision, then an
 * insert at revision+1 (the DB unique constraint backstops any race the
 * in-transaction read misses).
 */
async function appendConsentEvent(
  tx: Prisma.TransactionClient,
  participantId: string,
  instrumentType: InstrumentType,
  input: AppendEventInput
): Promise<ConsentRecord> {
  await assertActiveParticipant(participantId, tx);
  assertValidScope(input.scope);

  const latest = await tx.consentRecord.findFirst({
    where: { participantId, instrumentType },
    orderBy: { revision: "desc" },
    select: { revision: true },
  });
  const current = latest?.revision ?? 0;
  if (input.expectedRevision !== undefined && input.expectedRevision !== current) {
    throw new ConsentConflictError(participantId, instrumentType, input.expectedRevision, current);
  }

  return tx.consentRecord.create({
    data: {
      participantId,
      instrumentType,
      instrumentVersion: input.instrumentVersion,
      eventType: input.eventType,
      revision: current + 1,
      status: input.status,
      grantedAt: input.grantedAt,
      revokedAt: input.revokedAt,
      scope: JSON.stringify(input.scope),
    },
  });
}

/** Retries fn on CAS conflicts / unique-revision races (audit F-05). */
export async function withConsentRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const conflict =
        error instanceof ConsentConflictError ||
        (typeof error === "object" &&
          error !== null &&
          (error as { code?: string }).code === "P2002");
      if (!conflict) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * Records a SIGNED (re-)grant as a NEW immutable grant event. Signed grants
 * are the only events that extend the authorized-scope ceiling, so this must
 * only be called from flows that capture a participant signature (enrollment
 * doors, the re-consent flow) — administrative restores go through
 * restoreConsentScope instead. Scope defaults to the instrument's template.
 */
export async function grantConsent(
  participantId: string,
  instrumentType: InstrumentType,
  opts: {
    grantedAt?: Date;
    instrumentVersion?: string;
    scope?: ConsentScope;
    db?: Db;
  } = {}
): Promise<ConsentRecord> {
  const grantedAt = opts.grantedAt ?? new Date();
  return withTx(opts.db ?? prisma, (tx) =>
    appendConsentEvent(tx, participantId, instrumentType, {
      eventType: "grant",
      status: "granted" satisfies ConsentStatus,
      grantedAt,
      revokedAt: null,
      scope: opts.scope ?? INSTRUMENT_SCOPES[instrumentType],
      instrumentVersion: opts.instrumentVersion ?? "1.0-demo",
    })
  );
}

/**
 * Revokes the current grant for an instrument by APPENDING an immutable
 * revoke event (the prior grant record is never touched). The event carries
 * the scope that was in force, so the ledger reads as a self-contained
 * story. All data classes scoped to that instrument immediately fail ingest
 * gates and read gates, unless another still-granted instrument also covers
 * them. Returns the new revoke event, or null when there is no current
 * grant.
 */
export async function revokeConsent(
  participantId: string,
  instrumentType: InstrumentType,
  opts: { revokedAt?: Date; db?: Db } = {}
): Promise<ConsentRecord | null> {
  const revokedAt = opts.revokedAt ?? new Date();
  return withTx(opts.db ?? prisma, async (tx) => {
    const records = await tx.consentRecord.findMany({
      where: { participantId, instrumentType },
    });
    const current = latestRecordsByInstrument(records).get(instrumentType);
    if (!current || current.status !== "granted" || current.revokedAt !== null) return null;
    return appendConsentEvent(tx, participantId, instrumentType, {
      eventType: "revoke",
      status: "revoked" satisfies ConsentStatus,
      grantedAt: current.grantedAt,
      revokedAt,
      scope: parseScope(current),
      instrumentVersion: current.instrumentVersion,
      expectedRevision: current.revision,
    });
  });
}

/** The grants in `scope` that exceed the instrument's signed ceiling. */
function grantsBeyondCeiling(scope: ConsentScope, ceiling: GrantSet): ScopeGrant[] {
  return scope.filter((grant) => !ceiling.has(grantKey(grant.dataClass, grant.use)));
}

/**
 * Partial revocation / administrative revision (DEMO.md §3): revises an
 * instrument's scope by appending a NEW scope_revision event carrying the
 * reduced (or re-expanded) scope. The prior event stays in the ledger
 * untouched; the new event, being the highest revision, becomes the
 * instrument's current state, so every ingest/read gate re-evaluates against
 * the revised scope immediately.
 *
 * Guardrails:
 * - CAS: pass `expectedRevision` (the latest revision the new scope was
 *   derived from); a concurrent revision raises ConsentConflictError instead
 *   of silently reinstating a just-revoked class (audit F-05).
 * - Ceiling: the revised scope must stay inside the participant's SIGNED
 *   ceiling for the instrument — a revision can never grant what was never
 *   signed (audit F-02).
 *
 * Returns null when the instrument has no current granted record: a fully
 * revoked instrument is re-enabled via restoreConsentScope (administrative,
 * ceiling-bounded) or a fresh signed grant.
 */
export async function reviseConsentScope(
  participantId: string,
  instrumentType: InstrumentType,
  scope: ConsentScope,
  opts: { grantedAt?: Date; db?: Db; expectedRevision?: number } = {}
): Promise<ConsentRecord | null> {
  const grantedAt = opts.grantedAt ?? new Date();
  return withTx(opts.db ?? prisma, async (tx) => {
    const records = await tx.consentRecord.findMany({
      where: { participantId, instrumentType },
    });
    const current = latestRecordsByInstrument(records).get(instrumentType);
    if (!current || current.status !== "granted" || current.revokedAt !== null) return null;

    const ceiling = signedScopeCeilingByInstrument(records).get(instrumentType) ?? NO_GRANTS;
    const denied = grantsBeyondCeiling(scope, ceiling);
    if (denied.length > 0) throw new ScopeCeilingError(participantId, instrumentType, denied);

    return appendConsentEvent(tx, participantId, instrumentType, {
      eventType: "scope_revision",
      status: "granted" satisfies ConsentStatus,
      grantedAt,
      revokedAt: null,
      scope,
      instrumentVersion: current.instrumentVersion,
      expectedRevision: opts.expectedRevision ?? current.revision,
    });
  });
}

/**
 * Administrative RESTORE of a fully revoked instrument: appends a
 * scope_revision event that re-enables a scope the participant already
 * proved with a signature — never more (the ceiling check refuses
 * expansion; audit F-02). Returns null when the instrument was never signed
 * or is currently granted (revise instead).
 */
export async function restoreConsentScope(
  participantId: string,
  instrumentType: InstrumentType,
  scope: ConsentScope,
  opts: { grantedAt?: Date; db?: Db; expectedRevision?: number } = {}
): Promise<ConsentRecord | null> {
  const grantedAt = opts.grantedAt ?? new Date();
  return withTx(opts.db ?? prisma, async (tx) => {
    const records = await tx.consentRecord.findMany({
      where: { participantId, instrumentType },
    });
    const current = latestRecordsByInstrument(records).get(instrumentType);
    if (!current || current.status === "granted") return null;

    const ceiling = signedScopeCeilingByInstrument(records).get(instrumentType) ?? NO_GRANTS;
    const denied = grantsBeyondCeiling(scope, ceiling);
    if (denied.length > 0) throw new ScopeCeilingError(participantId, instrumentType, denied);

    return appendConsentEvent(tx, participantId, instrumentType, {
      eventType: "scope_revision",
      status: "granted" satisfies ConsentStatus,
      grantedAt,
      revokedAt: null,
      scope,
      instrumentVersion: current.instrumentVersion,
      expectedRevision: opts.expectedRevision ?? current.revision,
    });
  });
}

/**
 * Full immutable consent ledger for a participant, oldest first — the audit
 * trail the revocation console renders (grant → revoke → revision events all
 * stay visible; nothing is ever updated or deleted).
 */
export async function getConsentHistory(
  participantId: string,
  db: Db = prisma
): Promise<ConsentRecord[]> {
  return db.consentRecord.findMany({
    where: { participantId },
    orderBy: [{ createdAt: "asc" }, { instrumentType: "asc" }, { revision: "asc" }],
  });
}

/** Latest event per instrument — for status/audit views. */
export async function getConsentStates(
  participantId: string,
  db: Db = prisma
): Promise<
  {
    instrumentType: string;
    status: string;
    grantedAt: Date;
    revokedAt: Date | null;
    instrumentVersion: string;
    historyCount: number;
  }[]
> {
  const records = await db.consentRecord.findMany({ where: { participantId } });
  const latest = latestRecordsByInstrument(records);
  const counts = new Map<string, number>();
  for (const record of records) {
    counts.set(record.instrumentType, (counts.get(record.instrumentType) ?? 0) + 1);
  }
  return [...latest.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([instrumentType, record]) => ({
      instrumentType,
      status: record.status,
      grantedAt: record.grantedAt,
      revokedAt: record.revokedAt,
      instrumentVersion: record.instrumentVersion,
      historyCount: counts.get(instrumentType) ?? 0,
    }));
}
