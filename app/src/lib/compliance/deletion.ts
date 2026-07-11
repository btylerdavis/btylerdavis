import { createHash } from "node:crypto";
import type { DeletionRequest, Prisma } from "@prisma/client";
import { getConsentStates, revokeConsent, type InstrumentType } from "../consent";
import { prisma } from "../db";
import { getSimClock } from "../simclock";

/**
 * Deletion-request workflow (SPEC §9.4 withdrawal & deletion). Deletion is
 * STRONGER than revocation:
 *
 * - Revocation seals rows behind the read gates — the rows stay at rest.
 * - Executing a deletion request revokes every consent (so ingest stops the
 *   same instant) AND hard-deletes the identified-tier rows themselves:
 *   observations, sleep sessions, PROs, devices, purchases, treatment
 *   events, episodes and the DemoIdentity display record.
 *
 * Deletion is TERMINAL (audit F-01/F-08). The whole execution — the
 * pending→executing claim, the consent revocations, the hard deletes, the
 * tombstone, and the certificate snapshot — runs in ONE transaction, so a
 * failure anywhere rolls the request back to `pending` (retryable, never
 * wedged in `executing`) and a concurrent second execute loses the claim and
 * is refused. The participant's lifecycleState becomes `deleted`, which
 * every consent mutation and subject-data write re-checks inside its own
 * transaction: a tombstone can never be re-enrolled, re-granted, restored,
 * or written to again.
 *
 * What survives, by design:
 * - The consent ledger (immutable events, legally required) — the
 *   revocations are appended there like any other event, and no
 *   ConsentRecord is ever updated or deleted.
 * - The Participant row, tombstoned with `deletedAt` + lifecycleState
 *   `deleted`, so the ledger keeps a valid subject reference.
 * - Already-published de-identified mart releases: immutable — per SPEC §9.4
 *   participants are told up front, in plain language, that
 *   already-de-identified data in the research tier cannot be recalled.
 *
 * Everything here runs on the sim clock so the demo timeline stays coherent.
 */

export const DELETION_STATUSES = ["pending", "executing", "executed", "declined"] as const;
export type DeletionStatus = (typeof DELETION_STATUSES)[number];

/** Identified-tier tables the execution hard-deletes, in FK-safe order. */
export const DELETION_TABLES = [
  { key: "observations", label: "Observations (nightly signals)" },
  { key: "sleepSessions", label: "Sleep sessions" },
  { key: "proResponses", label: "Questionnaire responses (PROs)" },
  { key: "devices", label: "Device registrations" },
  { key: "mattressPurchases", label: "Mattress purchases" },
  { key: "treatmentEvents", label: "Treatment events" },
  { key: "episodes", label: "Protocol episodes" },
  // Import trust boundary tables (audit v2 HIGH fix): staged payloads hold
  // subject data awaiting confirmation, and batch receipts carry per-subject
  // provenance — both are identified-tier and must die with the participant.
  { key: "pendingImports", label: "Staged import payloads" },
  { key: "importBatches", label: "Import provenance receipts" },
  { key: "demoIdentity", label: "Identity record (name + email)" },
] as const;

export type DeletionTableKey = (typeof DELETION_TABLES)[number]["key"];

export type DeletionCounts = Record<DeletionTableKey, number>;

export function totalDeleted(counts: DeletionCounts): number {
  return DELETION_TABLES.reduce((sum, table) => sum + (counts[table.key] ?? 0), 0);
}

/** Parses a stored deletionCounts JSON string; malformed reads as all-zero. */
export function parseDeletionCounts(json: string | null): DeletionCounts {
  const zero = Object.fromEntries(DELETION_TABLES.map((t) => [t.key, 0])) as DeletionCounts;
  if (!json) return zero;
  try {
    const parsed = JSON.parse(json) as Partial<DeletionCounts>;
    for (const table of DELETION_TABLES) {
      const value = parsed[table.key];
      if (typeof value === "number" && Number.isFinite(value)) zero[table.key] = value;
    }
    return zero;
  } catch {
    return zero;
  }
}

/**
 * Immutable certificate content hash (level-up 8): SHA-256 over the stored
 * execution-snapshot fields, in canonical order. Computed INSIDE the
 * execution transaction and stored on the request; the certificate displays
 * it, and recomputing it from the stored fields must always reproduce it —
 * any divergence means the snapshot was tampered with after execution.
 */
export function certificateContentHash(input: {
  requestId: string;
  participantId: string;
  requestedAt: Date;
  executedAt: Date;
  counts: DeletionCounts;
  ledgerCount: number;
  ledgerRef: string;
}): string {
  const canonical = JSON.stringify({
    requestId: input.requestId,
    participantId: input.participantId,
    requestedAt: input.requestedAt.toISOString(),
    executedAt: input.executedAt.toISOString(),
    counts: DELETION_TABLES.map((table) => [table.key, input.counts[table.key] ?? 0]),
    ledgerCount: input.ledgerCount,
    ledgerRef: input.ledgerRef,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export type RequestDeletionResult =
  | { ok: true; request: DeletionRequest }
  | { ok: false; error: string };

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002"
  );
}

/**
 * Files a deletion request (the participant-page button). At most ONE active
 * (pending/executing) request per participant — enforced by the database
 * unique `activeKey`, not just a pre-check (audit F-08). Filing moves the
 * participant to `deletion_pending`; a tombstone cannot file another.
 */
export async function requestDeletion(
  participantId: string,
  note?: string
): Promise<RequestDeletionResult> {
  const clock = await getSimClock();
  const trimmed = note?.trim();
  try {
    const request = await prisma.$transaction(async (tx) => {
      const participant = await tx.participant.findUnique({
        where: { id: participantId },
        select: { id: true, deletedAt: true, lifecycleState: true },
      });
      if (!participant) throw new RequestRefused("Unknown participant");
      if (participant.deletedAt !== null || participant.lifecycleState === "deleted") {
        throw new RequestRefused("This record has already been deleted");
      }
      const created = await tx.deletionRequest.create({
        data: {
          participantId,
          requestedAt: clock,
          status: "pending" satisfies DeletionStatus,
          activeKey: participantId, // unique: one active request per subject
          note: trimmed ? trimmed.slice(0, 500) : null,
        },
      });
      await tx.participant.update({
        where: { id: participantId },
        data: { lifecycleState: "deletion_pending" },
      });
      return created;
    });
    return { ok: true, request };
  } catch (error) {
    if (error instanceof RequestRefused) return { ok: false, error: error.message };
    if (isUniqueViolation(error)) {
      return { ok: false, error: "A deletion request is already pending" };
    }
    throw error;
  }
}

class RequestRefused extends Error {}

/** Live identified-tier row counts — what execution WOULD delete. */
export async function countIdentifiedRows(
  participantId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<DeletionCounts> {
  const where = { where: { participantId } };
  const [
    observations,
    sleepSessions,
    proResponses,
    devices,
    mattressPurchases,
    treatmentEvents,
    episodes,
    pendingImports,
    importBatches,
    demoIdentity,
  ] = await Promise.all([
    db.observation.count(where),
    db.sleepSession.count(where),
    db.proResponse.count(where),
    db.device.count(where),
    db.mattressPurchase.count(where),
    db.treatmentEvent.count(where),
    db.episode.count(where),
    db.pendingImport.count(where),
    db.importBatch.count(where),
    db.demoIdentity.count(where),
  ]);
  return {
    observations,
    sleepSessions,
    proResponses,
    devices,
    mattressPurchases,
    treatmentEvents,
    episodes,
    pendingImports,
    importBatches,
    demoIdentity,
  };
}

export interface DeletionExecutionReport {
  requestId: string;
  participantId: string;
  requestedAt: Date;
  executedAt: Date;
  /** instruments revoked as part of the execution (already-revoked ones skip) */
  revokedInstruments: InstrumentType[];
  counts: DeletionCounts;
  totalRows: number;
  /** consent events retained in the immutable ledger */
  ledgerRecords: number;
  ledgerRef: string;
  /** which execution attempt succeeded (observable workflow, level-up 8) */
  attempt: number;
  /** immutable SHA-256 over the stored execution snapshot */
  contentHash: string;
}

export type ExecuteDeletionResult =
  | { ok: true; report: DeletionExecutionReport }
  | { ok: false; error: string };

/**
 * Executes a pending request in ONE atomic transaction:
 * 1. claims the request (pending → executing, conditional update — a
 *    concurrent execute loses the claim and is refused);
 * 2. marks the participant `deleting` (no writer admitted from here on);
 * 3. appends a revoke event for every currently-granted instrument (the
 *    immutable ledger records the revocations; nothing is deleted from it);
 * 4. hard-deletes the identified-tier rows per table, capturing counts;
 * 5. tombstones the Participant row (deletedAt = sim clock, lifecycleState
 *    `deleted` — TERMINAL);
 * 6. marks the request executed and stores the counts + ledger snapshot so
 *    the confirmation panel and certificate render from the stored record
 *    ONLY — never a live query.
 *
 * If anything throws, the whole transaction rolls back and the request is
 * still `pending` — retryable, never wedged in `executing` (audit F-08).
 *
 * OBSERVABLE workflow (level-up 8): every execution attempt is recorded
 * OUTSIDE the transaction (attempts counter + lastAttemptAt before the run;
 * lastAttemptError after a failure), so a rolled-back attempt still leaves a
 * visible retryable-failure trace on the request. The error itself is still
 * rethrown — callers surface it and offer retry.
 */
export async function executeDeletion(requestId: string): Promise<ExecuteDeletionResult> {
  const request = await prisma.deletionRequest.findUnique({ where: { id: requestId } });
  if (!request) return { ok: false, error: "Unknown deletion request" };
  if (request.status !== "pending") {
    return { ok: false, error: `Request is already ${request.status}` };
  }

  // Attempt metadata: recorded before the transaction so a failure anywhere
  // below still leaves the attempt visible (uses wall-clock time on purpose
  // — the injected fault of audit F-08 is a MISSING sim clock).
  const attempted = await prisma.deletionRequest.update({
    where: { id: requestId },
    data: { attempts: { increment: 1 }, lastAttemptAt: new Date() },
    select: { attempts: true },
  });
  const attempt = attempted.attempts;

  const participantId = request.participantId;

  try {
    const clock = await getSimClock();
    const report = await prisma.$transaction(async (tx) => {
      // 1. Atomic claim INSIDE the transaction: only one execution can move
      //    pending → executing; everything below rolls back with it.
      const claimed = await tx.deletionRequest.updateMany({
        where: { id: requestId, status: "pending" },
        data: { status: "executing" satisfies DeletionStatus },
      });
      if (claimed.count === 0) throw new ExecutionRefused("Request is already being executed");

      // 2. Revoke every current grant — the ledger records it as immutable
      //    revoke events. (Runs before the lifecycle flips to `deleting`,
      //    which the consent engine — correctly — refuses to mutate under.)
      const states = await getConsentStates(participantId, tx);
      const revokedInstruments: InstrumentType[] = [];
      for (const state of states) {
        if (state.status !== "granted") continue;
        const revoked = await revokeConsent(participantId, state.instrumentType as InstrumentType, {
          revokedAt: clock,
          db: tx,
        });
        if (revoked) revokedInstruments.push(state.instrumentType as InstrumentType);
      }

      // 3. Close the write gate before touching data: from here to the
      //    tombstone the participant is `deleting`, which every guarded
      //    write path refuses.
      await tx.participant.update({
        where: { id: participantId },
        data: { lifecycleState: "deleting" },
      });

      // 4. Hard-delete identified-tier rows (FK-safe order: children of Device
      //    first, then devices, then the rest).
      const where = { where: { participantId } };
      const counts: DeletionCounts = {
        observations: (await tx.observation.deleteMany(where)).count,
        sleepSessions: (await tx.sleepSession.deleteMany(where)).count,
        proResponses: (await tx.proResponse.deleteMany(where)).count,
        devices: (await tx.device.deleteMany(where)).count,
        mattressPurchases: (await tx.mattressPurchase.deleteMany(where)).count,
        treatmentEvents: (await tx.treatmentEvent.deleteMany(where)).count,
        episodes: (await tx.episode.deleteMany(where)).count,
        // Import trust boundary (audit v2): staged payloads + provenance
        // receipts are subject data — deleted with everything else.
        pendingImports: (await tx.pendingImport.deleteMany(where)).count,
        importBatches: (await tx.importBatch.deleteMany(where)).count,
        demoIdentity: (await tx.demoIdentity.deleteMany(where)).count,
      };

      // 5. Tombstone the participant row — TERMINAL.
      await tx.participant.update({
        where: { id: participantId },
        data: { deletedAt: clock, lifecycleState: "deleted" },
      });

      // 6. Certificate snapshot: ledger count + head captured here, stored on
      //    the request — the certificate never recomputes them live.
      const ledger = await tx.consentRecord.findMany({
        where: { participantId },
        orderBy: [{ createdAt: "desc" }, { revision: "desc" }],
        select: { id: true },
      });
      const ledgerRef = `LEDGER/${ledger.length} records retained/head ${
        ledger[0]?.id.slice(0, 8) ?? "none"
      }`;

      // Immutable certificate hash over the snapshot being stored, computed
      // inside the same transaction (level-up 8).
      const contentHash = certificateContentHash({
        requestId,
        participantId,
        requestedAt: request.requestedAt,
        executedAt: clock,
        counts,
        ledgerCount: ledger.length,
        ledgerRef,
      });

      await tx.deletionRequest.update({
        where: { id: requestId },
        data: {
          status: "executed" satisfies DeletionStatus,
          activeKey: null,
          resolvedAt: clock,
          deletionCounts: JSON.stringify(counts),
          ledgerRef,
          ledgerCount: ledger.length,
          contentHash,
          lastAttemptError: null, // this attempt succeeded
        },
      });

      return {
        requestId,
        participantId,
        requestedAt: request.requestedAt,
        executedAt: clock,
        revokedInstruments,
        counts,
        totalRows: totalDeleted(counts),
        ledgerRecords: ledger.length,
        ledgerRef,
        attempt,
        contentHash,
      } satisfies DeletionExecutionReport;
    }, { timeout: 30_000 }); // headroom for participants with many nightly rows

    return { ok: true, report };
  } catch (error) {
    if (error instanceof ExecutionRefused) return { ok: false, error: error.message };
    // The retryable failure path (audit F-08 / level-up 8): the transaction
    // rolled back — the request is still `pending` — but the attempt stays
    // observable. `updateMany` guards against clobbering a concurrent
    // execution that succeeded in the meantime.
    await prisma.deletionRequest.updateMany({
      where: { id: requestId, status: "pending" satisfies DeletionStatus },
      data: {
        lastAttemptError:
          error instanceof Error ? error.message.slice(0, 500) : "Unknown execution error",
      },
    });
    throw error;
  }
}

class ExecutionRefused extends Error {}

export type DeclineDeletionResult =
  | { ok: true; request: DeletionRequest }
  | { ok: false; error: string };

/**
 * Declines a pending request (demo: e.g. filed against the wrong record).
 * Conditional update — a request that resolved concurrently is refused, not
 * clobbered. The participant returns to `active`.
 */
export async function declineDeletion(
  requestId: string,
  reason?: string
): Promise<DeclineDeletionResult> {
  const request = await prisma.deletionRequest.findUnique({ where: { id: requestId } });
  if (!request) return { ok: false, error: "Unknown deletion request" };
  if (request.status !== "pending") {
    return { ok: false, error: `Request is already ${request.status}` };
  }
  const clock = await getSimClock();
  const trimmed = reason?.trim();
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const declined = await tx.deletionRequest.updateMany({
        where: { id: requestId, status: "pending" },
        data: {
          status: "declined" satisfies DeletionStatus,
          activeKey: null,
          resolvedAt: clock,
          ...(trimmed ? { note: trimmed.slice(0, 500) } : {}),
        },
      });
      if (declined.count === 0) throw new ExecutionRefused("Request is already resolved");
      await tx.participant.updateMany({
        where: { id: request.participantId, lifecycleState: "deletion_pending" },
        data: { lifecycleState: "active" },
      });
      return tx.deletionRequest.findUniqueOrThrow({ where: { id: requestId } });
    });
    return { ok: true, request: updated };
  } catch (error) {
    if (error instanceof ExecutionRefused) return { ok: false, error: error.message };
    throw error;
  }
}

export interface DeletionRequestListItem {
  request: DeletionRequest;
  participant: {
    id: string;
    enrollmentTouchpoint: string;
    deletedAt: Date | null;
    lifecycleState: string;
  };
  /** live per-table counts for pending requests; stored counts for executed */
  counts: DeletionCounts;
  totalRows: number;
}

/** Console list: newest first, with the counts each row will show. */
export async function listDeletionRequests(): Promise<DeletionRequestListItem[]> {
  const requests = await prisma.deletionRequest.findMany({
    orderBy: [{ requestedAt: "desc" }, { createdAt: "desc" }],
    include: {
      participant: {
        select: { id: true, enrollmentTouchpoint: true, deletedAt: true, lifecycleState: true },
      },
    },
  });
  return Promise.all(
    requests.map(async ({ participant, ...request }) => {
      const counts =
        request.status === "pending" || request.status === "executing"
          ? await countIdentifiedRows(request.participantId)
          : parseDeletionCounts(request.deletionCounts);
      return { request, participant, counts, totalRows: totalDeleted(counts) };
    })
  );
}

/**
 * Latest request per status for one participant (participant-page state).
 * The FULL state machine is surfaced (level-up 8): `pending` (including the
 * retryable-failure path via attempts/lastAttemptError on the request),
 * `executing` (with the single-transaction design it never persists, but if
 * it is ever observed the UI must say so), `executed`, and the latest
 * `declined` (so the page can explain the routing explicitly).
 */
export async function getParticipantDeletionState(participantId: string): Promise<{
  pending: DeletionRequest | null;
  executing: DeletionRequest | null;
  executed: DeletionRequest | null;
  declined: DeletionRequest | null;
}> {
  const requests = await prisma.deletionRequest.findMany({
    where: { participantId },
    orderBy: [{ requestedAt: "desc" }, { createdAt: "desc" }],
  });
  return {
    pending: requests.find((request) => request.status === "pending") ?? null,
    executing: requests.find((request) => request.status === "executing") ?? null,
    executed: requests.find((request) => request.status === "executed") ?? null,
    declined: requests.find((request) => request.status === "declined") ?? null,
  };
}

export interface DeletionCertificate {
  request: DeletionRequest;
  counts: DeletionCounts;
  totalRows: number;
  /** stored at execution — NEVER recomputed live (audit F-01) */
  ledgerCount: number;
  ledgerRef: string;
  /** immutable SHA-256 over the stored snapshot (level-up 8) */
  contentHash: string;
  /** true when the stored hash matches a recomputation over the stored
   *  snapshot fields — the certificate's own integrity check */
  contentHashVerified: boolean;
}

/**
 * Certificate data for an executed request — rendered ONLY from the stored
 * execution snapshot (counts, ledger count, ledger reference and content
 * hash captured atomically inside the execution transaction). Returns null
 * unless the request is executed.
 */
export async function getDeletionCertificate(
  requestId: string
): Promise<DeletionCertificate | null> {
  const request = await prisma.deletionRequest.findUnique({ where: { id: requestId } });
  if (!request || request.status !== "executed" || !request.resolvedAt) return null;
  const counts = parseDeletionCounts(request.deletionCounts);
  // ledgerCount is the stored snapshot; legacy rows (pre-snapshot) fall back
  // to the count embedded in the stored ledgerRef string — still a stored
  // execution fact, never a live query.
  const fromRef = request.ledgerRef?.match(/^LEDGER\/(\d+) /);
  const ledgerCount = request.ledgerCount ?? (fromRef ? Number(fromRef[1]) : 0);
  const ledgerRef = request.ledgerRef ?? `LEDGER/${ledgerCount} records retained`;
  // Recompute the hash from the STORED snapshot fields (never a live query):
  // for post-hash rows this verifies integrity; for legacy rows it derives
  // the canonical hash of the stored facts.
  const recomputed = certificateContentHash({
    requestId: request.id,
    participantId: request.participantId,
    requestedAt: request.requestedAt,
    executedAt: request.resolvedAt,
    counts,
    ledgerCount,
    ledgerRef,
  });
  return {
    request,
    counts,
    totalRows: totalDeleted(counts),
    ledgerCount,
    ledgerRef,
    contentHash: request.contentHash ?? recomputed,
    contentHashVerified: request.contentHash === null || request.contentHash === recomputed,
  };
}
