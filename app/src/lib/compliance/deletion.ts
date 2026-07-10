import type { DeletionRequest, Prisma } from "@prisma/client";
import { getConsentStates, revokeConsent, type InstrumentType } from "../consent";
import { prisma } from "../db";
import { getSimClock } from "../simclock";

/**
 * Deletion-request workflow (SPEC §9.4 withdrawal & deletion; DEMO.md Lane B
 * reserve → working). Deletion is STRONGER than revocation:
 *
 * - Revocation seals rows behind the read gates — the rows stay at rest.
 * - Executing a deletion request revokes every consent (so ingest stops the
 *   same instant) AND hard-deletes the identified-tier rows themselves:
 *   observations, sleep sessions, PROs, devices, purchases, treatment
 *   events, episodes and the DemoIdentity display record.
 *
 * What survives, by design:
 * - The consent ledger (append-only, legally required) — the revocations are
 *   recorded there like any other, and no ConsentRecord is ever deleted.
 * - The Participant row, tombstoned with `deletedAt`, so the ledger keeps a
 *   valid subject reference.
 * - Already-published de-identified mart releases: immutable — per SPEC §9.4
 *   participants are told up front, in plain language, that
 *   already-de-identified data in the research tier cannot be recalled.
 *
 * Everything here runs on the sim clock so the demo timeline stays coherent.
 */

export const DELETION_STATUSES = ["pending", "executed", "declined"] as const;
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

/**
 * Files a deletion request (the participant-page button). One pending
 * request per participant; a tombstoned participant cannot file another.
 */
export async function requestDeletion(
  participantId: string,
  note?: string
): Promise<RequestDeletionResult> {
  const participant = await prisma.participant.findUnique({
    where: { id: participantId },
    select: { id: true, deletedAt: true },
  });
  if (!participant) return { ok: false, error: "Unknown participant" };
  if (participant.deletedAt !== null) {
    return { ok: false, error: "This record has already been deleted" };
  }
  const existing = await prisma.deletionRequest.findFirst({
    where: { participantId, status: "pending" },
  });
  if (existing) return { ok: false, error: "A deletion request is already pending" };

  const clock = await getSimClock();
  const trimmed = note?.trim();
  const request = await prisma.deletionRequest.create({
    data: {
      participantId,
      requestedAt: clock,
      status: "pending" satisfies DeletionStatus,
      note: trimmed ? trimmed.slice(0, 500) : null,
    },
  });
  return { ok: true, request };
}

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
  /** consent records retained in the append-only ledger */
  ledgerRecords: number;
  ledgerRef: string;
}

export type ExecuteDeletionResult =
  | { ok: true; report: DeletionExecutionReport }
  | { ok: false; error: string };

/**
 * Executes a pending request, atomically:
 * 1. revokes every currently-granted instrument (append-only ledger records
 *    the revocation; nothing in the ledger is deleted);
 * 2. hard-deletes the identified-tier rows per table, capturing counts;
 * 3. tombstones the Participant row (deletedAt = sim clock);
 * 4. marks the request executed and stores the counts + ledger reference so
 *    the confirmation panel and certificate render from the record itself.
 */
export async function executeDeletion(requestId: string): Promise<ExecuteDeletionResult> {
  const request = await prisma.deletionRequest.findUnique({ where: { id: requestId } });
  if (!request) return { ok: false, error: "Unknown deletion request" };
  if (request.status !== "pending") {
    return { ok: false, error: `Request is already ${request.status}` };
  }

  const clock = await getSimClock();
  const participantId = request.participantId;

  const report = await prisma.$transaction(async (tx) => {
    // 1. Revoke every current grant — the ledger records it, append-only.
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

    // 2. Hard-delete identified-tier rows (FK-safe order: children of Device
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

    // 3. Tombstone the participant row — the ledger's subject reference.
    await tx.participant.update({
      where: { id: participantId },
      data: { deletedAt: clock },
    });

    // 4. Ledger reference: how many append-only records survive, anchored to
    //    the newest record id — the certificate's pointer into the ledger.
    const ledger = await tx.consentRecord.findMany({
      where: { participantId },
      orderBy: [{ grantedAt: "desc" }, { createdAt: "desc" }],
      select: { id: true },
    });
    const ledgerRef = `LEDGER/${ledger.length} records retained/head ${
      ledger[0]?.id.slice(0, 8) ?? "none"
    }`;

    await tx.deletionRequest.update({
      where: { id: requestId },
      data: {
        status: "executed" satisfies DeletionStatus,
        resolvedAt: clock,
        deletionCounts: JSON.stringify(counts),
        ledgerRef,
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
}

export type DeclineDeletionResult =
  | { ok: true; request: DeletionRequest }
  | { ok: false; error: string };

/** Declines a pending request (demo: e.g. filed against the wrong record). */
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
  const updated = await prisma.deletionRequest.update({
    where: { id: requestId },
    data: {
      status: "declined" satisfies DeletionStatus,
      resolvedAt: clock,
      ...(trimmed ? { note: trimmed.slice(0, 500) } : {}),
    },
  });
  return { ok: true, request: updated };
}

export interface DeletionRequestListItem {
  request: DeletionRequest;
  participant: {
    id: string;
    enrollmentTouchpoint: string;
    deletedAt: Date | null;
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
        select: { id: true, enrollmentTouchpoint: true, deletedAt: true },
      },
    },
  });
  return Promise.all(
    requests.map(async ({ participant, ...request }) => {
      const counts =
        request.status === "pending"
          ? await countIdentifiedRows(request.participantId)
          : parseDeletionCounts(request.deletionCounts);
      return { request, participant, counts, totalRows: totalDeleted(counts) };
    })
  );
}

/** Latest request per status for one participant (participant-page state). */
export async function getParticipantDeletionState(participantId: string): Promise<{
  pending: DeletionRequest | null;
  executed: DeletionRequest | null;
}> {
  const requests = await prisma.deletionRequest.findMany({
    where: { participantId },
    orderBy: [{ requestedAt: "desc" }, { createdAt: "desc" }],
  });
  return {
    pending: requests.find((request) => request.status === "pending") ?? null,
    executed: requests.find((request) => request.status === "executed") ?? null,
  };
}
