import type { Prisma } from "@prisma/client";
import { assertIngestAllowed, ConsentError, type DataClass } from "../consent";
import { prisma } from "../db";
import { getSimClock } from "../simclock";
import { createManyChunked } from "../synthetic/generator";
import type { ImportObservationRow, ImportSessionRow } from "./appleHealth";

/**
 * Gated writes for real-file imports. EVERY imported row passes
 * assertIngestAllowed for its data class first — a participant whose
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
  | { blocked: true; reason: string };

const MAX_ROWS = 100_000;
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

/**
 * Writes a parsed import for a participant, through the ingest gate.
 * `alignToSimClock` shifts every row forward by whole days so the newest
 * night lands on the sim "today" — a real 2025 Apple Health export then
 * shows up immediately in the 90-day trend window (the shift is reported
 * and the rows are flagged "imported").
 */
export async function ingestParsedImport(
  participantId: string,
  parsed: ParsedImportPayload,
  opts: { alignToSimClock?: boolean } = {}
): Promise<ImportResult> {
  assertSanePayload(parsed);
  const dataClass = IMPORT_DATA_CLASS[parsed.kind];

  try {
    await assertIngestAllowed(participantId, dataClass);
  } catch (error) {
    if (error instanceof ConsentError) {
      return {
        blocked: true,
        reason: `No current "${dataClass}" collect consent — the ingest gate refused this import.`,
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

  const observationsWritten = await createManyChunked(observationRows, (chunk) =>
    prisma.observation.createMany({ data: chunk })
  );
  const sessionsWritten = await createManyChunked(sessionRows, (chunk) =>
    prisma.sleepSession.createMany({ data: chunk })
  );

  return {
    blocked: false,
    observationsWritten,
    sessionsWritten,
    firstDayIso: parsed.firstDay ? shiftDay(parsed.firstDay) : "",
    lastDayIso: parsed.lastDay ? shiftDay(parsed.lastDay) : "",
    shiftedDays,
  };
}
