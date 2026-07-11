import { randomBytes } from "node:crypto";
import type { PendingImport, Prisma } from "@prisma/client";
import { prisma } from "../db";

/**
 * Server-owned import staging store (audit v2 HIGH fix — the import trust
 * boundary). This is the ONLY file in src/lib/imports that touches prisma
 * directly (mirrors disclosure/ledger.ts, recommendations/decisionLog.ts);
 * subject-data rows themselves still land exclusively through the policy
 * repository's guarded writes.
 *
 * - PendingImport rows hold the server-parsed, schema-validated payload
 *   between preview and confirmation, keyed by a single-use opaque token
 *   with a ~15-minute WALL-CLOCK expiry (staging is operator session state,
 *   deliberately sim-clock-agnostic — advancing the time machine must not
 *   resurrect or expire a preview).
 * - ImportBatch rows are the provenance receipts: created inside the same
 *   consent-guarded transaction that admits the batch, finalized with the
 *   actually-written row counts afterwards.
 */

export const PENDING_IMPORT_TTL_MS = 15 * 60 * 1000;

/** long-expired staging rows are swept opportunistically on the next stage */
const SWEEP_AFTER_MS = 24 * 60 * 60 * 1000;

export interface CreatePendingImportInput {
  participantId: string;
  kind: string;
  source: string;
  /** JSON string of the normalized payload (the authoritative server copy) */
  payloadJson: string;
  /** SHA-256 hex digest of the uploaded file bytes */
  fileDigest: string;
  parserVersion: string;
}

export async function createPendingImport(
  input: CreatePendingImportInput
): Promise<{ id: string; token: string; expiresAt: Date }> {
  // Opportunistic sweep: staging rows are worthless a day after expiry.
  await prisma.pendingImport.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - SWEEP_AFTER_MS) } },
  });
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + PENDING_IMPORT_TTL_MS);
  const row = await prisma.pendingImport.create({
    data: {
      token,
      participantId: input.participantId,
      kind: input.kind,
      source: input.source,
      payload: input.payloadJson,
      fileDigest: input.fileDigest,
      parserVersion: input.parserVersion,
      expiresAt,
    },
  });
  return { id: row.id, token, expiresAt };
}

export type PendingImportRefusal =
  | "not_found"
  | "participant_mismatch"
  | "expired"
  | "already_used";

export type ConsumePendingImportResult =
  | { ok: true; record: PendingImport }
  | { ok: false; reason: PendingImportRefusal };

/**
 * Loads and consumes a pending import in one step. The consume is atomic —
 * `updateMany where consumedAt: null` — so two concurrent confirmations of
 * the same token can never both ingest (the loser sees "already_used").
 * A participant mismatch refuses WITHOUT consuming: the rightful owner's
 * preview stays valid.
 */
export async function consumePendingImport(
  token: string,
  participantId: string
): Promise<ConsumePendingImportResult> {
  const record = await prisma.pendingImport.findUnique({ where: { token } });
  if (!record) return { ok: false, reason: "not_found" };
  if (record.participantId !== participantId) return { ok: false, reason: "participant_mismatch" };
  if (record.consumedAt !== null) return { ok: false, reason: "already_used" };
  if (record.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
  const claimed = await prisma.pendingImport.updateMany({
    where: { id: record.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (claimed.count === 0) return { ok: false, reason: "already_used" };
  return { ok: true, record };
}

// ---------------------------------------------------------------------------
// ImportBatch provenance receipts
// ---------------------------------------------------------------------------

export interface CreateImportBatchInput {
  participantId: string;
  kind: string;
  source: string;
  dataClass: string;
  parserVersion: string;
  fileDigest: string;
  tokenId: string | null;
  consentInstrument: string;
  consentRevision: number;
}

/**
 * Creates the provenance receipt INSIDE the caller's consent-guarded
 * transaction (the receipt itself clears the same gate as the rows it
 * documents). Counts start at 0 and are finalized after the chunk loop.
 */
export async function createImportBatchInTx(
  tx: Prisma.TransactionClient,
  input: CreateImportBatchInput
): Promise<string> {
  const row = await tx.importBatch.create({ data: input });
  return row.id;
}

/**
 * Records the row counts actually written under the batch. updateMany:
 * a batch hard-deleted by a mid-import participant deletion (terminal
 * lifecycle) simply no-ops instead of throwing.
 */
export async function finalizeImportBatchCounts(
  batchId: string,
  counts: { observationCount: number; sessionCount: number }
): Promise<void> {
  await prisma.importBatch.updateMany({ where: { id: batchId }, data: counts });
}
