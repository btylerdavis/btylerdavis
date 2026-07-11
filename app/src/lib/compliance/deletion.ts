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
    demoIdentity,
  ] = await Promise.all([
    db.observation.count(where),
    db.sleepSession.count(where),
    db.proResponse.count(where),
    db.device.count(where),
    db.mattressPurchase.count(where),
    db.treatmentEvent.count(where),
    db.episode.count(where),
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
 */
export async function executeDeletion(requestId: string): Promise<ExecuteDeletionResult> {
  const request = await prisma.deletionRequest.findUnique({ where: { id: requestId } });
  if (!request) return { ok: false, error: "Unknown deletion request" };
  if (request.status !== "pending") {
    return { ok: false, error: `Request is already ${request.status}` };
  }

  const clock = await getSimClock();
  const participantId = request.participantId;

  try {
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

      await tx.deletionRequest.update({
        where: { id: requestId },
        data: {
          status: "executed" satisfies DeletionStatus,
          activeKey: null,
          resolvedAt: clock,
          deletionCounts: JSON.stringify(counts),
          ledgerRef,
          ledgerCount: ledger.length,
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
      } satisfies DeletionExecutionReport;
    }, { timeout: 30_000 }); // headroom for participants with many nightly rows

    return { ok: true, report };
  } catch (error) {
    if (error instanceof ExecutionRefused) return { ok: false, error: error.message };
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
 * `executing` is surfaced too (audit F-08): with the single-transaction
 * design it never persists, but if it is ever observed the UI must say so
 * rather than showing neither pending nor executed.
 */
export async function getParticipantDeletionState(participantId: string): Promise<{
  pending: DeletionRequest | null;
  executing: DeletionRequest | null;
  executed: DeletionRequest | null;
}> {
  const requests = await prisma.deletionRequest.findMany({
    where: { participantId },
    orderBy: [{ requestedAt: "desc" }, { createdAt: "desc" }],
  });
  return {
    pending: requests.find((request) => request.status === "pending") ?? null,
    executing: requests.find((request) => request.status === "executing") ?? null,
    executed: requests.find((request) => request.status === "executed") ?? null,
  };
}

export interface DeletionCertificate {
  request: DeletionRequest;
  counts: DeletionCounts;
  totalRows: number;
  /** stored at execution — NEVER recomputed live (audit F-01) */
  ledgerCount: number;
  ledgerRef: string;
}

/**
 * Certificate data for an executed request — rendered ONLY from the stored
 * execution snapshot (counts, ledger count, ledger reference captured
 * atomically inside the execution transaction). Returns null unless the
 * request is executed.
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
  return {
    request,
    counts,
    totalRows: totalDeleted(counts),
    ledgerCount,
    ledgerRef: request.ledgerRef ?? `LEDGER/${ledgerCount} records retained`,
  };
}
