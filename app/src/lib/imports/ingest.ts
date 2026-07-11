import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  assertIngestAllowed,
  collectAuthority,
  ConsentError,
  LifecycleError,
  type CollectAuthority,
  type DataClass,
} from "../consent";
import {
  getParticipant,
  guardedImportRowsWrite,
  guardedSubjectWrite,
  isWritableLifecycle,
} from "../consent/policyRepo";
import { getSimClock } from "../simclock";
import type { ImportObservationRow, ImportSessionRow } from "./appleHealth";
import {
  ImportValidationError,
  validateImportPayload,
  type ConnectorSchema,
  type ImportKind,
} from "./connectors";
import {
  consumePendingImport,
  createImportBatchInTx,
  createPendingImport,
  finalizeImportBatchCounts,
} from "./pendingStore";

export { IMPORT_DATA_CLASS, ImportValidationError } from "./connectors";

/**
 * Gated writes for real-file imports — SERVER-OWNED CONFIRMATION (audit v2
 * HIGH fix). The parsed payload never round-trips through the browser:
 *
 *   1. preview: the upload is parsed server-side, validated against the
 *      server-owned connector schema (exact kind→source pair, concept/unit
 *      allowlist, value bounds, session semantics — named refusal reasons),
 *      and staged as a PendingImport row keyed by a single-use token;
 *   2. confirm: the client sends ONLY (token, participantId, align) —
 *      confirmPendingImport loads the SERVER copy, verifies participant
 *      match + unexpired + unused (consumed atomically), and ingests it.
 *
 * EVERY imported chunk is admitted through guardedImportRowsWrite: the
 * consent class is DERIVED from the rows' own `source` lineage (never a
 * caller label), asserted equal to the connector's class, and lifecycle +
 * the class's collect grant are re-checked INSIDE each chunk's transaction
 * (audit F-04 — a revocation or deletion landing mid-import stops the
 * remaining chunks cold). Unknown-source or mixed-class batches are refused
 * whole before anything is persisted. Each admitted import carries an
 * ImportBatch provenance receipt (connector, parser version, file digest,
 * token id, admitting consent instrument + revision, row counts) linked
 * from the rows via batchId.
 */

export interface ParsedImportPayload {
  kind: ImportKind;
  source: string;
  observations: ImportObservationRow[];
  sessions?: ImportSessionRow[];
  firstDay: string | null;
  lastDay: string | null;
}

/** Provenance receipt fields returned on a successful (or partial) import. */
export interface ImportReceipt {
  batchId: string;
  kind: ImportKind;
  source: string;
  dataClass: DataClass;
  parserVersion: string;
  fileDigest: string;
  consentInstrument: string;
  consentRevision: number;
}

export type ImportResult =
  | ({
      blocked: false;
      observationsWritten: number;
      sessionsWritten: number;
      firstDayIso: string;
      lastDayIso: string;
      /** days the rows were shifted forward to land on the sim clock (0 = none) */
      shiftedDays: number;
    } & ImportReceipt)
  | { blocked: true; reason: string; observationsWritten: number; sessionsWritten: number };

const CHUNK_ROWS = 2000;
const DAY_MS = 86_400_000;

function utcMidnight(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

// ---------------------------------------------------------------------------
// Stage (preview → PendingImport)
// ---------------------------------------------------------------------------

export type StagedImport =
  | {
      ok: true;
      /** single-use opaque confirmation token — the ONLY payload handle the client holds */
      token: string;
      expiresAtIso: string;
      kind: ImportKind;
      /** canonical source from the connector schema */
      source: string;
      dataClass: DataClass;
      parserVersion: string;
      fileDigest: string;
      observationCount: number;
      sessionCount: number;
      /**
       * Consent-impact preview (audit v2 prioritized fix 11): the consent
       * event that would admit this write right now, or null (the gate will
       * refuse). Re-derived inside the confirm transaction — this is display
       * data, never authorization.
       */
      authority: CollectAuthority | null;
    }
  | { ok: false; reasons: string[] };

/**
 * Validates parser output against the server-owned connector schema and
 * stages it for confirmation. Refusals carry named reasons and leave NO
 * PendingImport row behind.
 */
export async function stagePendingImport(
  participantId: string,
  parsed: ParsedImportPayload,
  opts: { fileDigest?: string } = {}
): Promise<StagedImport> {
  const validation = validateImportPayload(parsed);
  if (!validation.ok) {
    return {
      ok: false,
      reasons: validation.violations.map((violation) => `${violation.code}: ${violation.detail}`),
    };
  }
  const schema = validation.schema;

  const participant = await getParticipant(participantId);
  if (!isWritableLifecycle(participant)) {
    return {
      ok: false,
      reasons: [
        `participant_not_writable: participant is ${participant?.lifecycleState ?? "unknown"} — imports are refused`,
      ],
    };
  }

  const payloadJson = JSON.stringify({
    kind: schema.kind,
    source: schema.canonicalSource,
    observations: parsed.observations,
    sessions: parsed.sessions ?? [],
    firstDay: parsed.firstDay,
    lastDay: parsed.lastDay,
  } satisfies ParsedImportPayload);
  const fileDigest = opts.fileDigest ?? sha256Hex(`payload:${payloadJson}`);

  const staged = await createPendingImport({
    participantId,
    kind: schema.kind,
    source: schema.canonicalSource,
    payloadJson,
    fileDigest,
    parserVersion: schema.parserVersion,
  });
  const authority = await collectAuthority(participantId, schema.dataClass);

  return {
    ok: true,
    token: staged.token,
    expiresAtIso: staged.expiresAt.toISOString(),
    kind: schema.kind,
    source: schema.canonicalSource,
    dataClass: schema.dataClass,
    parserVersion: schema.parserVersion,
    fileDigest,
    observationCount: parsed.observations.length,
    sessionCount: parsed.sessions?.length ?? 0,
    authority,
  };
}

// ---------------------------------------------------------------------------
// Confirm (token → ingest from the server copy)
// ---------------------------------------------------------------------------

const TOKEN_REFUSALS: Record<string, string> = {
  not_found: "no staged import matches this confirmation token — re-upload and preview the file",
  participant_mismatch:
    "this confirmation token was staged for a different participant — nothing was written",
  expired: "the staged import expired (15-minute window) — re-upload and preview the file",
  already_used: "this confirmation token was already used — each preview imports at most once",
};

/**
 * The confirmation half of the trust boundary: accepts ONLY the opaque
 * token, the participant id, and the align flag. The payload is loaded from
 * the server-side PendingImport record (single-use, participant-bound,
 * expiring) and re-validated against the connector schema before ingest.
 */
export async function confirmPendingImport(
  token: string,
  participantId: string,
  opts: { alignToSimClock?: boolean; onChunkWritten?: () => Promise<void> } = {}
): Promise<ImportResult> {
  const consumed = await consumePendingImport(token, participantId);
  if (!consumed.ok) {
    return {
      blocked: true,
      reason: `Import confirmation refused (${consumed.reason}): ${TOKEN_REFUSALS[consumed.reason]}.`,
      observationsWritten: 0,
      sessionsWritten: 0,
    };
  }
  const record = consumed.record;
  const payload = JSON.parse(record.payload) as ParsedImportPayload;
  return ingestParsedImport(participantId, payload, {
    alignToSimClock: opts.alignToSimClock,
    onChunkWritten: opts.onChunkWritten,
    provenance: { fileDigest: record.fileDigest, tokenId: record.id },
  });
}

// ---------------------------------------------------------------------------
// Ingest (server copy → guarded, lineage-authorized writes)
// ---------------------------------------------------------------------------

/**
 * Writes a validated import payload for a participant, through the
 * per-chunk lineage-authorized policy gate. Payloads that fail the
 * connector schema throw ImportValidationError (named reasons, zero rows);
 * consent/lifecycle refusals return a blocked result. `alignToSimClock`
 * shifts every row forward by whole days so the newest night lands on the
 * sim "today" (the shift is reported and the rows are flagged "imported").
 *
 * `onChunkWritten` is a test hook: it runs between chunk transactions so
 * race tests can revoke/delete mid-import and assert the remaining chunks
 * are refused.
 */
export async function ingestParsedImport(
  participantId: string,
  parsed: ParsedImportPayload,
  opts: {
    alignToSimClock?: boolean;
    onChunkWritten?: () => Promise<void>;
    /** set when confirming a staged upload; defaulted for direct (test) calls */
    provenance?: { fileDigest: string; tokenId: string | null };
  } = {}
): Promise<ImportResult> {
  const validation = validateImportPayload(parsed);
  if (!validation.ok) throw new ImportValidationError(validation.violations);
  const schema: ConnectorSchema = validation.schema;
  const dataClass = schema.dataClass;

  // Advisory pre-check for a friendly refusal before any work; the
  // authoritative checks run inside each chunk's write transaction below.
  try {
    await assertIngestAllowed(participantId, dataClass);
  } catch (error) {
    if (error instanceof ConsentError) {
      return {
        blocked: true,
        reason: `No current "${dataClass}" collect consent — the ingest gate refused this import.`,
        observationsWritten: 0,
        sessionsWritten: 0,
      };
    }
    throw error;
  }

  let shiftedDays = 0;
  if (opts.alignToSimClock && parsed.lastDay) {
    const clock = await getSimClock();
    const lastMs = utcMidnight(parsed.lastDay).getTime();
    shiftedDays = Math.round((clock.getTime() - lastMs) / DAY_MS);
  }
  const shiftMs = shiftedDays * DAY_MS;
  const shiftDay = (day: string) =>
    new Date(utcMidnight(day).getTime() + shiftMs).toISOString().slice(0, 10);

  const qualityFlags = JSON.stringify(shiftedDays !== 0 ? ["imported", "date_shifted"] : ["imported"]);

  // Rows persist the CONNECTOR SCHEMA's canonical source — validation
  // already proved parsed.source matches it, but the schema is the single
  // server-owned authority for what lineage leaves this function.
  const provenance = opts.provenance ?? {
    fileDigest: sha256Hex(`payload:${JSON.stringify(parsed)}`),
    tokenId: null,
  };

  const observationRows: Prisma.ObservationCreateManyInput[] = parsed.observations.map((row) => ({
    participantId,
    source: schema.canonicalSource,
    concept: row.concept,
    valueNumeric: row.value,
    unit: row.unit,
    effectiveDate: new Date(utcMidnight(row.day).getTime() + shiftMs),
    grain: "day",
    qualityFlags,
  }));

  const sessionRows: Prisma.SleepSessionCreateManyInput[] = (parsed.sessions ?? []).map(
    (session) => ({
      participantId,
      source: schema.canonicalSource,
      startTs: new Date(Date.parse(session.startIso) + shiftMs),
      endTs: new Date(Date.parse(session.endIso) + shiftMs),
      summary: JSON.stringify({ ...session.summary, imported: true }),
    })
  );

  let batchId: string | null = null;
  let receipt: ImportReceipt | null = null;
  let observationsWritten = 0;
  let sessionsWritten = 0;

  const finalize = async () => {
    if (batchId !== null) {
      await finalizeImportBatchCounts(batchId, {
        observationCount: observationsWritten,
        sessionCount: sessionsWritten,
      });
    }
  };

  try {
    // Provenance receipt first, through the SAME consent gate the rows will
    // clear — the admitting consent instrument + revision are captured
    // inside this transaction (audit v2 prioritized fix 6).
    await guardedSubjectWrite(participantId, [dataClass], async (tx) => {
      const authority = await collectAuthority(participantId, dataClass, tx);
      if (!authority) throw new ConsentError(participantId, dataClass, "collect");
      batchId = await createImportBatchInTx(tx, {
        participantId,
        kind: schema.kind,
        source: schema.canonicalSource,
        dataClass,
        parserVersion: schema.parserVersion,
        fileDigest: provenance.fileDigest,
        tokenId: provenance.tokenId,
        consentInstrument: authority.instrumentType,
        consentRevision: authority.revision,
      });
      receipt = {
        batchId,
        kind: schema.kind,
        source: schema.canonicalSource,
        dataClass,
        parserVersion: schema.parserVersion,
        fileDigest: provenance.fileDigest,
        consentInstrument: authority.instrumentType,
        consentRevision: authority.revision,
      };
    });

    for (const chunk of chunks(observationRows, CHUNK_ROWS)) {
      // Lineage-derived class + lifecycle + collect grant re-validated
      // inside THIS chunk's transaction.
      observationsWritten += await guardedImportRowsWrite(
        participantId,
        dataClass,
        chunk.map((row) => ({ ...row, batchId })),
        async (tx, rows) => (await tx.observation.createMany({ data: rows })).count
      );
      if (opts.onChunkWritten) await opts.onChunkWritten();
    }
    for (const chunk of chunks(sessionRows, CHUNK_ROWS)) {
      sessionsWritten += await guardedImportRowsWrite(
        participantId,
        dataClass,
        chunk.map((row) => ({ ...row, batchId })),
        async (tx, rows) => (await tx.sleepSession.createMany({ data: rows })).count
      );
      if (opts.onChunkWritten) await opts.onChunkWritten();
    }
  } catch (error) {
    if (error instanceof ConsentError || error instanceof LifecycleError) {
      await finalize();
      return {
        blocked: true,
        reason:
          `Consent or lifecycle changed mid-import — remaining rows refused ` +
          `(${observationsWritten} observation(s), ${sessionsWritten} session(s) were written before the change): ` +
          error.message,
        observationsWritten,
        sessionsWritten,
      };
    }
    throw error;
  }

  await finalize();
  if (receipt === null) throw new Error("Import receipt missing after admission"); // unreachable
  return {
    blocked: false,
    ...(receipt as ImportReceipt),
    observationsWritten,
    sessionsWritten,
    firstDayIso: parsed.firstDay ? shiftDay(parsed.firstDay) : "",
    lastDayIso: parsed.lastDay ? shiftDay(parsed.lastDay) : "",
    shiftedDays,
  };
}

/** Human label for the consent event on receipts ("Lane B grant, revision 1"). */
export function consentAuthorityLabel(instrumentType: string, revision: number): string {
  const lane = instrumentType.replace("LANE_", "Lane ");
  return `${lane} grant, revision ${revision}`;
}

/** connector schemas re-exported for UI copy (labels, class names) */
export { CONNECTOR_SCHEMAS } from "./connectors";
