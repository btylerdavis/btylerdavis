import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import {
  assertActiveParticipant,
  assertIngestAllowed,
  evaluateGrants,
  grantConsent,
  grantSetHas,
  type GrantSet,
} from "./engine";
import { sourceToDataClass, storedDataClass, uniformRowDataClass } from "./scopes";
import {
  ConsentError,
  LifecycleError,
  LineageError,
  type ConsentScope,
  type DataClass,
} from "./types";

/**
 * Policy-enforced write repository (audit F-03/F-04, level-up 4).
 *
 * This module is the ONLY sanctioned path for subject-data writes. Every
 * write here runs inside ONE transaction that:
 *   1. re-checks the participant lifecycle (a tombstone can never receive
 *      rows — audit F-01), and
 *   2. re-checks the current "collect" grant for every data class being
 *      written (a consent check taken before the transaction is treated as
 *      advisory only — the in-transaction check is authoritative, which
 *      closes the check-then-write race of audit F-04).
 *
 * Bulk generation paths (seed, time machine) use the guarded batch writer,
 * which re-validates per participant per flush and silently DROPS rows whose
 * consent or lifecycle changed since generation (T2.6 "connector drops
 * payloads" semantics). Interactive paths (enrollment actions, imports) use
 * guardedSubjectWrite, which throws instead.
 */

type Db = Prisma.TransactionClient | typeof prisma;

async function withTx<T>(db: Db, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  if ("$transaction" in db) return db.$transaction(fn, { timeout: 30_000 });
  return fn(db);
}

/**
 * Runs `write` inside a transaction after asserting the participant is
 * writable (lifecycle) and holds a current "collect" grant for every data
 * class in `dataClasses`. Throws LifecycleError / ConsentError otherwise —
 * nothing is written.
 */
export async function guardedSubjectWrite<T>(
  participantId: string,
  dataClasses: DataClass[],
  write: (tx: Prisma.TransactionClient, grants: GrantSet) => Promise<T>,
  opts: { db?: Db } = {}
): Promise<T> {
  return withTx(opts.db ?? prisma, async (tx) => {
    await assertActiveParticipant(participantId, tx);
    const records = await tx.consentRecord.findMany({ where: { participantId } });
    const grants = evaluateGrants(records);
    for (const dataClass of dataClasses) {
      await assertIngestAllowed(participantId, dataClass, { grants });
    }
    return write(tx, grants);
  });
}

/**
 * Row-lineage-authorized guarded write (audit v2 HIGH fix, prioritized fix
 * 2). The consent class the chunk is admitted under is DERIVED from the
 * rows' own persisted `source` lineage — the caller never supplies it — and
 * asserted equal to `expectedClass` (the connector schema's class). Batches
 * with an unknown source, mixed classes, or a lineage/connector disagreement
 * are refused whole with LineageError BEFORE the transaction opens: no
 * quarantine writes, nothing reaches the primary tables.
 */
export async function guardedImportRowsWrite<T extends { source: string }>(
  participantId: string,
  expectedClass: DataClass,
  rows: T[],
  write: (tx: Prisma.TransactionClient, rows: T[]) => Promise<number>,
  opts: { db?: Db } = {}
): Promise<number> {
  const lineage = uniformRowDataClass(rows);
  if (!lineage.ok) {
    throw new LineageError(participantId, lineage.code, lineage.detail);
  }
  if (lineage.dataClass !== expectedClass) {
    throw new LineageError(
      participantId,
      "class_mismatch",
      `rows carry ${lineage.dataClass} lineage but the connector admits ${expectedClass}`
    );
  }
  return guardedSubjectWrite(participantId, [lineage.dataClass], (tx) => write(tx, rows), opts);
}

/** guardedSubjectWrite variant that maps refusals to a blocked result. */
export async function guardedSubjectWriteOrBlocked<T>(
  participantId: string,
  dataClasses: DataClass[],
  write: (tx: Prisma.TransactionClient, grants: GrantSet) => Promise<T>,
  opts: { db?: Db } = {}
): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
  try {
    return { ok: true, value: await guardedSubjectWrite(participantId, dataClasses, write, opts) };
  } catch (error) {
    if (error instanceof ConsentError || error instanceof LifecycleError) {
      return { ok: false, reason: error.message };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Guarded bulk generation writes (seed + time machine)
// ---------------------------------------------------------------------------

export interface GeneratedRows {
  observations: Prisma.ObservationCreateManyInput[];
  sleepSessions: Prisma.SleepSessionCreateManyInput[];
  proResponses: Prisma.ProResponseCreateManyInput[];
  treatmentEvents: Prisma.TreatmentEventCreateManyInput[];
}

export interface GuardedWriteCounts {
  observations: number;
  sleepSessions: number;
  proResponses: number;
  treatmentEvents: number;
  /** rows dropped because lifecycle/consent changed since generation */
  dropped: number;
}

const CHUNK_ROWS = 2000;

async function createManyChunked<T>(
  rows: T[],
  create: (chunk: T[]) => Promise<{ count: number }>
): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK_ROWS) {
    const { count } = await create(rows.slice(i, i + CHUNK_ROWS));
    written += count;
  }
  return written;
}

function chunkedIn<T>(values: T[], size = 500): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
  return chunks;
}

/**
 * Re-reads lifecycle + consent for every participant present in the batch,
 * INSIDE the write transaction, and returns the per-participant admission
 * state. Participants that vanished, tombstoned, or entered deletion
 * execution are refused wholesale.
 */
async function loadBatchPolicy(
  tx: Prisma.TransactionClient,
  participantIds: string[]
): Promise<Map<string, { writable: boolean; grants: GrantSet }>> {
  const policy = new Map<string, { writable: boolean; grants: GrantSet }>();
  for (const chunk of chunkedIn(participantIds)) {
    const [participants, consentRecords] = await Promise.all([
      tx.participant.findMany({
        where: { id: { in: chunk } },
        select: { id: true, lifecycleState: true, deletedAt: true },
      }),
      tx.consentRecord.findMany({ where: { participantId: { in: chunk } } }),
    ]);
    const recordsByParticipant = new Map<string, typeof consentRecords>();
    for (const record of consentRecords) {
      const list = recordsByParticipant.get(record.participantId) ?? [];
      list.push(record);
      recordsByParticipant.set(record.participantId, list);
    }
    for (const participant of participants) {
      const writable =
        participant.deletedAt === null &&
        (participant.lifecycleState === "active" ||
          participant.lifecycleState === "deletion_pending");
      policy.set(participant.id, {
        writable,
        grants: writable
          ? evaluateGrants(recordsByParticipant.get(participant.id) ?? [])
          : new Set<string>(),
      });
    }
  }
  return policy;
}

/**
 * Writes a generated batch through the policy gate: ONE transaction that
 * re-validates lifecycle + per-class collect grants for every participant in
 * the batch (the time machine's per-flush revalidation — audit F-04), drops
 * any row that no longer clears the gate, and inserts the rest chunked.
 */
export async function writeGeneratedBatchGuarded(
  batch: GeneratedRows,
  db: Db = prisma
): Promise<GuardedWriteCounts> {
  const participantIds = [
    ...new Set(
      [
        ...batch.observations,
        ...batch.sleepSessions,
        ...batch.proResponses,
        ...batch.treatmentEvents,
      ].map((row) => row.participantId)
    ),
  ];
  if (participantIds.length === 0) {
    return { observations: 0, sleepSessions: 0, proResponses: 0, treatmentEvents: 0, dropped: 0 };
  }

  return withTx(db, async (tx) => {
    const policy = await loadBatchPolicy(tx, participantIds);
    let dropped = 0;
    const admit = (participantId: string, dataClass: DataClass | null): boolean => {
      const entry = policy.get(participantId);
      const ok =
        dataClass !== null &&
        entry !== undefined &&
        entry.writable &&
        grantSetHas(entry.grants, dataClass, "collect");
      if (!ok) dropped += 1;
      return ok;
    };

    const observations = batch.observations.filter((row) =>
      admit(row.participantId, sourceToDataClass(row.source))
    );
    const sleepSessions = batch.sleepSessions.filter((row) =>
      admit(row.participantId, sourceToDataClass(row.source))
    );
    const proResponses = batch.proResponses.filter((row) =>
      admit(row.participantId, "pro_responses")
    );
    const treatmentEvents = batch.treatmentEvents.filter((row) =>
      admit(row.participantId, storedDataClass(row.dataClass ?? null))
    );

    return {
      observations: await createManyChunked(observations, (data) =>
        tx.observation.createMany({ data })
      ),
      sleepSessions: await createManyChunked(sleepSessions, (data) =>
        tx.sleepSession.createMany({ data })
      ),
      proResponses: await createManyChunked(proResponses, (data) =>
        tx.proResponse.createMany({ data })
      ),
      treatmentEvents: await createManyChunked(treatmentEvents, (data) =>
        tx.treatmentEvent.createMany({ data })
      ),
      dropped,
    };
  });
}

/**
 * Guarded bulk insert for enrollment-time subject-data artifacts (episodes,
 * scheduled treatment events, device registrations — audit F-03: these are
 * consent-owned rows, not exempt metadata). One transaction; lifecycle +
 * the row's own lineage class re-checked per participant against the
 * consent records already in the database; rows that fail the gate are
 * dropped and counted.
 */
export async function writeEnrollmentArtifactsGuarded(
  artifacts: {
    episodes: Prisma.EpisodeCreateManyInput[];
    treatmentEvents: Prisma.TreatmentEventCreateManyInput[];
    devices: Prisma.DeviceCreateManyInput[];
  },
  db: Db = prisma
): Promise<{ episodes: number; treatmentEvents: number; devices: number; dropped: number }> {
  const participantIds = [
    ...new Set(
      [...artifacts.episodes, ...artifacts.treatmentEvents, ...artifacts.devices].map(
        (row) => row.participantId
      )
    ),
  ];
  if (participantIds.length === 0) return { episodes: 0, treatmentEvents: 0, devices: 0, dropped: 0 };

  return withTx(db, async (tx) => {
    const policy = await loadBatchPolicy(tx, participantIds);
    let dropped = 0;
    const admit = (participantId: string, dataClass: DataClass | null): boolean => {
      const entry = policy.get(participantId);
      const ok =
        dataClass !== null &&
        entry !== undefined &&
        entry.writable &&
        grantSetHas(entry.grants, dataClass, "collect");
      if (!ok) dropped += 1;
      return ok;
    };

    const episodes = artifacts.episodes.filter((row) =>
      admit(row.participantId, storedDataClass(row.dataClass ?? null))
    );
    const treatmentEvents = artifacts.treatmentEvents.filter((row) =>
      admit(row.participantId, storedDataClass(row.dataClass ?? null))
    );
    const devices = artifacts.devices.filter((row) =>
      admit(row.participantId, storedDataClass(row.dataClass ?? null))
    );

    return {
      episodes: await createManyChunked(episodes, (data) => tx.episode.createMany({ data })),
      treatmentEvents: await createManyChunked(treatmentEvents, (data) =>
        tx.treatmentEvent.createMany({ data })
      ),
      devices: await createManyChunked(devices, (data) => tx.device.createMany({ data })),
      dropped,
    };
  });
}

/**
 * Guarded bulk mattress-purchase insert (seed): one transaction, lifecycle +
 * mattress_purchase collect grant re-checked per participant; rows that fail
 * are dropped (returned in `droppedParticipants` so the seed can fail loudly
 * if determinism would be broken).
 */
export async function writeMattressPurchasesGuarded(
  purchases: Prisma.MattressPurchaseCreateManyInput[],
  db: Db = prisma
): Promise<{ written: number; droppedParticipants: string[] }> {
  if (purchases.length === 0) return { written: 0, droppedParticipants: [] };
  return withTx(db, async (tx) => {
    const policy = await loadBatchPolicy(tx, [
      ...new Set(purchases.map((purchase) => purchase.participantId)),
    ]);
    const droppedParticipants: string[] = [];
    const admitted = purchases.filter((purchase) => {
      const entry = policy.get(purchase.participantId);
      const ok =
        entry !== undefined &&
        entry.writable &&
        grantSetHas(entry.grants, "mattress_purchase", "collect");
      if (!ok) droppedParticipants.push(purchase.participantId);
      return ok;
    });
    const written = await createManyChunked(admitted, (data) =>
      tx.mattressPurchase.createMany({ data })
    );
    return { written, droppedParticipants };
  });
}

// ---------------------------------------------------------------------------
// Participant + reference-data access for pages/actions (no raw prisma
// imports outside approved persistence modules — audit level-up 4)
// ---------------------------------------------------------------------------

export interface ParticipantRecord {
  id: string;
  yearOfBirth: number;
  sex: string;
  enrollmentTouchpoint: string;
  createdAt: Date;
  lifecycleState: string;
  deletedAt: Date | null;
}

export async function getParticipant(
  participantId: string,
  db: Db = prisma
): Promise<ParticipantRecord | null> {
  return db.participant.findUnique({
    where: { id: participantId },
    select: {
      id: true,
      yearOfBirth: true,
      sex: true,
      enrollmentTouchpoint: true,
      createdAt: true,
      lifecycleState: true,
      deletedAt: true,
    },
  });
}

/** true iff the participant exists and may receive consent/data mutations. */
export function isWritableLifecycle(participant: ParticipantRecord | null): boolean {
  return (
    participant !== null &&
    participant.deletedAt === null &&
    (participant.lifecycleState === "active" ||
      participant.lifecycleState === "deletion_pending")
  );
}

/**
 * Creates a brand-new participant (with its identity display record) in one
 * transaction. Only enrollment flows call this; existing ids must go through
 * lifecycle-checked paths instead.
 */
export async function createEnrolledParticipant(input: {
  id: string;
  yearOfBirth: number;
  sex: string;
  enrollmentTouchpoint: "clinic" | "retail";
  createdAt: Date;
  displayName: string;
  email: string;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.participant.create({
      data: {
        id: input.id,
        yearOfBirth: input.yearOfBirth,
        sex: input.sex,
        enrollmentTouchpoint: input.enrollmentTouchpoint,
        createdAt: input.createdAt,
      },
    });
    await tx.demoIdentity.create({
      data: {
        participantId: input.id,
        displayName: input.displayName,
        email: input.email,
      },
    });
  });
}

/**
 * Retail-door enrollment: creates the participant + identity, records the
 * SIGNED Lane B grant event, and — re-evaluating the just-written consent
 * inside the SAME transaction — stores the STOP-BANG screener only when
 * pro_responses cleared the gate. Returns whether the screener was stored.
 */
export async function createRetailEnrollment(input: {
  id: string;
  yearOfBirth: number;
  sex: string;
  createdAt: Date;
  displayName: string;
  email: string;
  laneBScope: ConsentScope;
  screener: {
    instrument: string;
    instrumentVersion: string;
    administeredAt: Date;
    itemScores: string;
    totalScore: number;
  };
}): Promise<{ screenerStored: boolean }> {
  return prisma.$transaction(async (tx) => {
    await tx.participant.create({
      data: {
        id: input.id,
        yearOfBirth: input.yearOfBirth,
        sex: input.sex,
        enrollmentTouchpoint: "retail",
        createdAt: input.createdAt,
      },
    });
    await tx.demoIdentity.create({
      data: { participantId: input.id, displayName: input.displayName, email: input.email },
    });
    await grantConsent(input.id, "LANE_B", {
      grantedAt: input.createdAt,
      scope: input.laneBScope,
      db: tx,
    });

    // The STOP-BANG response is pro_responses-class data: gate it against
    // the consent event just recorded, in THIS transaction.
    const records = await tx.consentRecord.findMany({ where: { participantId: input.id } });
    const grants = evaluateGrants(records);
    if (!grantSetHas(grants, "pro_responses", "collect")) {
      return { screenerStored: false };
    }
    await tx.proResponse.create({
      data: { participantId: input.id, ...input.screener },
    });
    return { screenerStored: true };
  });
}

export interface SeedInfoRecord {
  scenario: string;
  cohortSize: number;
  clockDate: Date;
}

/**
 * The seed-stamped scenario marker (level-up 11 scenario sweep hook):
 * which effect-size scenario `npm run seed` actually built the database
 * with. Null on databases seeded before the marker existed — surfaces
 * render an "unknown (re-seed to stamp)" state rather than guessing.
 */
export async function getSeedInfo(db: Db = prisma): Promise<SeedInfoRecord | null> {
  const row = await db.seedInfo.findUnique({ where: { id: "singleton" } });
  return row
    ? { scenario: row.scenario, cohortSize: row.cohortSize, clockDate: row.clockDate }
    : null;
}

export interface CatalogItem {
  sku: string;
  brand: string;
  model: string;
  firmnessRating: number;
  materialClass: string;
  size: string;
}

export async function findCatalogItem(sku: string): Promise<CatalogItem | null> {
  return prisma.mattressCatalog.findUnique({ where: { sku } });
}

export async function listCatalogItems(): Promise<CatalogItem[]> {
  return prisma.mattressCatalog.findMany({
    orderBy: [{ brand: "asc" }, { model: "asc" }, { size: "asc" }],
  });
}
