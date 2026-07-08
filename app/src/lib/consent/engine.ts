import type { ConsentRecord, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { INSTRUMENT_SCOPES } from "./scopes";
import {
  ConsentError,
  type ConsentScope,
  type ConsentStatus,
  type DataClass,
  type ConsentUse,
  type InstrumentType,
} from "./types";

/**
 * Consent engine (TECHNICAL.md §T2.6).
 *
 * Records are append-only by convention: revocation flips `status` and sets
 * `revokedAt` on the existing record (never deletes); a re-grant creates a
 * new record, preserving history. The *current* state of an instrument is
 * its most recent record (by grantedAt, then createdAt); grants only flow
 * from a current record whose status is "granted".
 */

/** Set of effective "dataClass|use" grant keys for one participant. */
export type GrantSet = ReadonlySet<string>;

const grantKey = (dataClass: DataClass, use: ConsentUse) => `${dataClass}|${use}`;

type Db = Prisma.TransactionClient | typeof prisma;

function parseScope(record: ConsentRecord): ConsentScope {
  try {
    const parsed = JSON.parse(record.scope);
    return Array.isArray(parsed) ? (parsed as ConsentScope) : [];
  } catch {
    return [];
  }
}

/** Pure evaluation of a participant's consent history into effective grants. */
export function evaluateGrants(records: ConsentRecord[]): GrantSet {
  const latestByInstrument = new Map<string, ConsentRecord>();
  for (const record of records) {
    const current = latestByInstrument.get(record.instrumentType);
    if (
      !current ||
      record.grantedAt > current.grantedAt ||
      (record.grantedAt.getTime() === current.grantedAt.getTime() &&
        record.createdAt > current.createdAt)
    ) {
      latestByInstrument.set(record.instrumentType, record);
    }
  }

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
 * future ingestion connectors) must call this before writing rows of the
 * given data class. Throws ConsentError when no current "collect" grant.
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

/**
 * Records a (re-)grant as a NEW ConsentRecord — history is preserved.
 * Scope defaults to the instrument's template (INSTRUMENT_SCOPES).
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
  const db = opts.db ?? prisma;
  return db.consentRecord.create({
    data: {
      participantId,
      instrumentType,
      instrumentVersion: opts.instrumentVersion ?? "1.0-demo",
      status: "granted" satisfies ConsentStatus,
      grantedAt: opts.grantedAt ?? new Date(),
      scope: JSON.stringify(opts.scope ?? INSTRUMENT_SCOPES[instrumentType]),
    },
  });
}

/**
 * Revokes the current grant for an instrument: flips status to "revoked" and
 * sets revokedAt on the existing record (append-only convention — no delete).
 * All data classes scoped to that instrument immediately fail ingest gates
 * and read gates, unless another still-granted instrument also covers them.
 * Returns the updated record, or null when there is no current grant.
 */
export async function revokeConsent(
  participantId: string,
  instrumentType: InstrumentType,
  opts: { revokedAt?: Date; db?: Db } = {}
): Promise<ConsentRecord | null> {
  const db = opts.db ?? prisma;
  const current = await db.consentRecord.findFirst({
    where: { participantId, instrumentType, status: "granted", revokedAt: null },
    orderBy: [{ grantedAt: "desc" }, { createdAt: "desc" }],
  });
  if (!current) return null;
  return db.consentRecord.update({
    where: { id: current.id },
    data: { status: "revoked" satisfies ConsentStatus, revokedAt: opts.revokedAt ?? new Date() },
  });
}

/** Latest record per instrument — for status/audit views. */
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
  const records = await db.consentRecord.findMany({
    where: { participantId },
    orderBy: [{ grantedAt: "asc" }, { createdAt: "asc" }],
  });
  const byInstrument = new Map<string, { latest: ConsentRecord; count: number }>();
  for (const record of records) {
    const entry = byInstrument.get(record.instrumentType);
    byInstrument.set(record.instrumentType, {
      latest: record,
      count: (entry?.count ?? 0) + 1,
    });
  }
  return [...byInstrument.entries()].map(([instrumentType, { latest, count }]) => ({
    instrumentType,
    status: latest.status,
    grantedAt: latest.grantedAt,
    revokedAt: latest.revokedAt,
    instrumentVersion: latest.instrumentVersion,
    historyCount: count,
  }));
}
