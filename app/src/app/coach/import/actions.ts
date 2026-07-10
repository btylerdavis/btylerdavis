"use server";

import { createReadStream } from "node:fs";
import path from "node:path";
import { refresh } from "next/cache";
import {
  ImportParseError,
  parseAppleHealthXml,
  type ParsedAppleHealth,
} from "@/lib/imports/appleHealth";
import { parseAirViewCsv, type ParsedAirView } from "@/lib/imports/airview";
import {
  ingestParsedImport,
  type ImportResult,
  type ParsedImportPayload,
} from "@/lib/imports/ingest";
import { matchParticipantsByName, type IdentityMatchWithDoor } from "@/lib/identity";

/**
 * Import screen server actions (/coach/import). Files are STREAM-parsed —
 * a real Apple Health export can exceed 500 MB, so bytes flow through the
 * sax parser without ever being buffered whole. The parsed nightly-grain
 * payload (small) round-trips through the preview step; confirmImport
 * re-validates it and writes through the consent ingest gate.
 */

/** Streaming (XML) rail: bytes flow through the sax parser, never buffered whole. */
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024; // 1 GiB demo rail
/**
 * Buffered (CSV/TXT) rail: AirView CSVs parse via file.text(), which holds
 * the whole file in memory — so cap it well below the streaming rail and
 * check file.size BEFORE any .text() call.
 */
const MAX_TEXT_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB
const TEXT_TOO_LARGE_ERROR =
  "CSV/TXT file larger than 25 MB — export a shorter date range (only Apple Health XML streams at full size)";

export async function searchImportParticipants(
  query: string
): Promise<IdentityMatchWithDoor[]> {
  return matchParticipantsByName(query);
}

export type ParsedImportFile = ParsedAppleHealth | ParsedAirView;

export interface ImportPreview {
  ok: true;
  sourceName: string;
  parsed: ParsedImportFile;
  summary: {
    kind: ParsedImportFile["kind"];
    nights: number;
    firstDay: string | null;
    lastDay: string | null;
    observationCount: number;
    sessionCount: number;
    recordCounts: Record<string, number>;
  };
}

export interface ImportFailure {
  ok: false;
  error: string;
}

function toPreview(parsed: ParsedImportFile, sourceName: string): ImportPreview {
  return {
    ok: true,
    sourceName,
    parsed,
    summary: {
      kind: parsed.kind,
      nights: parsed.nights,
      firstDay: parsed.firstDay,
      lastDay: parsed.lastDay,
      observationCount: parsed.observations.length,
      sessionCount: "sessions" in parsed ? parsed.sessions.length : 0,
      recordCounts: parsed.recordCounts,
    },
  };
}

/** Async string chunks from a web File without buffering the whole file. */
async function* streamText(file: File): AsyncIterable<string> {
  const decoder = new TextDecoder("utf-8");
  const reader = file.stream().getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

export async function previewImportUpload(
  formData: FormData
): Promise<ImportPreview | ImportFailure> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a file to upload" };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "File larger than 1 GB — export a shorter date range" };
  }

  const name = file.name.toLowerCase();
  try {
    if (name.endsWith(".xml") || name.endsWith(".zip")) {
      if (name.endsWith(".zip")) {
        return {
          ok: false,
          error:
            "Unzip the Apple Health export first and upload the export.xml inside it.",
        };
      }
      return toPreview(await parseAppleHealthXml(streamText(file)), file.name);
    }
    if (name.endsWith(".csv") || name.endsWith(".txt")) {
      if (file.size > MAX_TEXT_UPLOAD_BYTES) return { ok: false, error: TEXT_TOO_LARGE_ERROR };
      return toPreview(parseAirViewCsv(await file.text()), file.name);
    }
    // Sniff: XML starts with "<" (the 256-byte slice never buffers the file)
    const head = await file.slice(0, 256).text();
    if (head.trimStart().startsWith("<")) {
      return toPreview(await parseAppleHealthXml(streamText(file)), file.name);
    }
    if (file.size > MAX_TEXT_UPLOAD_BYTES) return { ok: false, error: TEXT_TOO_LARGE_ERROR };
    return toPreview(parseAirViewCsv(await file.text()), file.name);
  } catch (error) {
    if (error instanceof ImportParseError) return { ok: false, error: error.message };
    throw error;
  }
}

const SAMPLE_FILES: Record<ParsedImportFile["kind"], string> = {
  apple_health: "apple-health-export.xml",
  airview: "airview-sample.csv",
};

/** One-click demo path: parse a bundled sample file, no file dance. */
export async function loadSampleImport(
  kind: ParsedImportFile["kind"]
): Promise<ImportPreview | ImportFailure> {
  const fileName = SAMPLE_FILES[kind];
  const filePath = path.join(process.cwd(), "public", "demo-fixtures", fileName);
  try {
    if (kind === "apple_health") {
      const stream = createReadStream(filePath, { encoding: "utf8" });
      return toPreview(await parseAppleHealthXml(stream), fileName);
    }
    const { readFile } = await import("node:fs/promises");
    return toPreview(parseAirViewCsv(await readFile(filePath, "utf8")), fileName);
  } catch (error) {
    if (error instanceof ImportParseError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function confirmImport(
  participantId: string,
  parsed: ParsedImportPayload,
  alignToSimClock: boolean
): Promise<ImportResult> {
  const result = await ingestParsedImport(participantId, parsed, { alignToSimClock });
  if (!result.blocked) refresh();
  return result;
}
