import type { Prisma } from "@prisma/client";
import {
  assertIngestAllowed,
  ConsentError,
  LifecycleError,
  type DataClass,
} from "../consent";
import { guardedSubjectWrite } from "../consent/policyRepo";
import { getSimClock } from "../simclock";
import type { ImportObservationRow, ImportSessionRow } from "./appleHealth";

/**
 * Gated writes for real-file imports. EVERY imported chunk is written
 * through the policy repository: lifecycle + the class's collect grant are
 * re-checked INSIDE each chunk's write transaction (audit F-04 — an import
 * spans many writes, so a revocation or deletion landing mid-import stops
 * the remaining chunks cold instead of racing them). A participant whose
 * consent doesn't cover the class gets a blocked result and zero rows, the
 * same behavior as every other write path.
 */

export interface ParsedImportPayload {
  kind: "apple_health" | "airview";
  source: string;
  observations: ImportObservationRow[];
  sessions?: ImportSessionRow[];
  firstDay: string | null;
  lastDay: string | null;
}

export const IMPORT_DATA_CLASS: Record<ParsedImportPayload["kind"], DataClass> = {
  apple_health: "wearable_sleep",
  airview: "cpap_telemetry",
};

export type ImportResult =
  | {
      blocked: false;
      observationsWritten: number;
      sessionsWritten: number;
      firstDayIso: string;
      lastDayIso: string;
      /** days the rows were shifted forward to land on the sim clock (0 = none) */
      shiftedDays: number;
    }
  | { blocked: true; reason: string; observationsWritten: number; sessionsWritten: number };

const MAX_ROWS = 100_000;
const CHUNK_ROWS = 2000;
const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function assertSanePayload(parsed: ParsedImportPayload): void {
  if (!IMPORT_DATA_CLASS[parsed.kind]) throw new Error(`Unknown import kind: ${parsed.kind}`);
  const rowCount = parsed.observations.length + (parsed.sessions?.length ?? 0);
  if (rowCount === 0) throw new Error("Nothing to import — the file held no usable nights");
  if (rowCount > MAX_ROWS) throw new Error("Import too large for the demo database");
  for (const row of parsed.observations) {
    if (!ISO_DAY.test(row.day) || !Number.isFinite(row.value)) {
      throw new Error("Import payload failed validation — re-upload the file");
    }
  }
  for (const session of parsed.sessions ?? []) {
    if (
      !ISO_DAY.test(session.day) ||
      Number.isNaN(Date.parse(session.startIso)) ||
      Number.isNaN(Date.parse(session.endIso))
    ) {
      throw new Error("Import payload failed validation — re-upload the file");
    }
  }
}

function utcMidnight(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * Writes a parsed import for a participant, through the per-chunk policy
 * gate. `alignToSimClock` shifts every row forward by whole days so the
 * newest night lands on the sim "today" — a real 2025 Apple Health export
 * then shows up immediately in the 90-day trend window (the shift is
 * reported and the rows are flagged "imported").
 *
 * `onChunkWritten` is a test hook: it runs between chunk transactions so
 * race tests can revoke/delete mid-import and assert the remaining chunks
 * are refused.
 */
export async function ingestParsedImport(
  participantId: string,
  parsed: ParsedImportPayload,
  opts: { alignToSimClock?: boolean; onChunkWritten?: () => Promise<void> } = {}
): Promise<ImportResult> {
  assertSanePayload(parsed);
  const dataClass = IMPORT_DATA_CLASS[parsed.kind];

  // Advisory pre-check for a friendly refusal before any work; the
  // authoritative checks run inside each chunk's transaction below.
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

  const observationRows: Prisma.ObservationCreateManyInput[] = parsed.observations.map((row) => ({
    participantId,
    source: parsed.source,
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
      source: parsed.source,
      startTs: new Date(Date.parse(session.startIso) + shiftMs),
      endTs: new Date(Date.parse(session.endIso) + shiftMs),
      summary: JSON.stringify({ ...session.summary, imported: true }),
    })
  );

  let observationsWritten = 0;
  let sessionsWritten = 0;
  try {
    for (const chunk of chunks(observationRows, CHUNK_ROWS)) {
      // Lifecycle + collect grant re-validated inside THIS chunk's tx.
      observationsWritten += await guardedSubjectWrite(
        participantId,
        [dataClass],
        async (tx) => (await tx.observation.createMany({ data: chunk })).count
      );
      if (opts.onChunkWritten) await opts.onChunkWritten();
    }
    for (const chunk of chunks(sessionRows, CHUNK_ROWS)) {
      sessionsWritten += await guardedSubjectWrite(
        participantId,
        [dataClass],
        async (tx) => (await tx.sleepSession.createMany({ data: chunk })).count
      );
      if (opts.onChunkWritten) await opts.onChunkWritten();
    }
  } catch (error) {
    if (error instanceof ConsentError || error instanceof LifecycleError) {
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

  return {
    blocked: false,
    observationsWritten,
    sessionsWritten,
    firstDayIso: parsed.firstDay ? shiftDay(parsed.firstDay) : "",
    lastDayIso: parsed.lastDay ? shiftDay(parsed.lastDay) : "",
    shiftedDays,
  };
}
