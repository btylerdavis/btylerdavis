"use server";

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import { refresh } from "next/cache";
import {
  ImportParseError,
  parseAppleHealthXml,
  type ParsedAppleHealth,
} from "@/lib/imports/appleHealth";
import { parseAirViewCsv, type ParsedAirView } from "@/lib/imports/airview";
import { parseDentiTracCsv, type ParsedDentiTrac } from "@/lib/imports/dentitrac";
import type { ImportKind } from "@/lib/imports/connectors";
import {
  confirmPendingImport,
  stagePendingImport,
  type ImportResult,
  type StagedImport,
} from "@/lib/imports/ingest";
import { matchParticipantsByName, type IdentityMatchWithDoor } from "@/lib/identity";

/**
 * Import screen server actions (/coach/import) — SERVER-OWNED CONFIRMATION
 * (audit v2 HIGH fix). Files are STREAM-parsed — a real Apple Health export
 * can exceed 500 MB, so bytes flow through the sax parser without ever being
 * buffered whole (the SHA-256 file digest is folded over the same stream).
 * The parsed payload NEVER round-trips through the browser: preview
 * validates it against the server-owned connector schema and stages it as a
 * PendingImport row; the client gets back only a single-use token plus
 * display summaries, and confirmImport accepts ONLY
 * (token, participantId, alignToSimClock).
 */

/** Streaming (XML) rail: bytes flow through the sax parser, never buffered whole. */
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024; // 1 GiB demo rail
/**
 * Buffered (CSV/TXT) rail: AirView CSVs parse via an in-memory decode, which
 * holds the whole file in memory — so cap it well below the streaming rail
 * and check file.size BEFORE reading the body.
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
  /** single-use server confirmation token — the ONLY thing confirm sends back */
  token: string;
  expiresAtIso: string;
  summary: {
    kind: ImportKind;
    nights: number;
    firstDay: string | null;
    lastDay: string | null;
    observationCount: number;
    sessionCount: number;
    recordCounts: Record<string, number>;
  };
  /** consent-impact + provenance preview (audit v2 prioritized fixes 6 + 11) */
  impact: {
    dataClass: string;
    rowCount: number;
    /** consent event that currently authorizes the write (null: gate will refuse) */
    authority: { instrumentType: string; revision: number } | null;
    fileDigest: string;
    parserVersion: string;
  };
}

export interface ImportFailure {
  ok: false;
  error: string;
}

async function stageToPreview(
  participantId: string,
  parsed: ParsedImportFile,
  fileDigest: string,
  sourceName: string
): Promise<ImportPreview | ImportFailure> {
  const staged: StagedImport = await stagePendingImport(participantId, parsed, { fileDigest });
  if (!staged.ok) {
    return {
      ok: false,
      error: `The parsed file failed connector-schema validation: ${staged.reasons.join("; ")}`,
    };
  }
  return {
    ok: true,
    sourceName,
    token: staged.token,
    expiresAtIso: staged.expiresAtIso,
    summary: {
      kind: staged.kind,
      nights: parsed.nights,
      firstDay: parsed.firstDay,
      lastDay: parsed.lastDay,
      observationCount: staged.observationCount,
      sessionCount: staged.sessionCount,
      recordCounts: parsed.recordCounts,
    },
    impact: {
      dataClass: staged.dataClass,
      rowCount: staged.observationCount + staged.sessionCount,
      authority: staged.authority,
      fileDigest: staged.fileDigest,
      parserVersion: staged.parserVersion,
    },
  };
}

/**
 * Async string chunks from a web File without buffering the whole file;
 * the SHA-256 digest folds over the raw bytes of the same single pass.
 */
async function* streamText(file: File, digest: { hash: ReturnType<typeof createHash> }) {
  const decoder = new TextDecoder("utf-8");
  const reader = file.stream().getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      digest.hash.update(value);
      yield decoder.decode(value, { stream: true });
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

export async function previewImportUpload(
  participantId: string,
  formData: FormData
): Promise<ImportPreview | ImportFailure> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a file to upload" };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "File larger than 1 GB — export a shorter date range" };
  }

  const parseXml = async () => {
    const digest = { hash: createHash("sha256") };
    const parsed = await parseAppleHealthXml(streamText(file, digest));
    return stageToPreview(participantId, parsed, digest.hash.digest("hex"), file.name);
  };
  const parseCsv = async () => {
    if (file.size > MAX_TEXT_UPLOAD_BYTES) {
      return { ok: false, error: TEXT_TOO_LARGE_ERROR } satisfies ImportFailure;
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const parsed = parseAirViewCsv(bytes.toString("utf8"));
    return stageToPreview(
      participantId,
      parsed,
      createHash("sha256").update(bytes).digest("hex"),
      file.name
    );
  };

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
      return await parseXml();
    }
    if (name.endsWith(".csv") || name.endsWith(".txt")) {
      return await parseCsv();
    }
    // Sniff: XML starts with "<" (the 256-byte slice never buffers the file)
    const head = await file.slice(0, 256).text();
    if (head.trimStart().startsWith("<")) {
      return await parseXml();
    }
    return await parseCsv();
  } catch (error) {
    if (error instanceof ImportParseError) return { ok: false, error: error.message };
    throw error;
  }
}

const SAMPLE_FILES: Record<ImportKind, string> = {
  apple_health: "apple-health-export.xml",
  airview: "airview-sample.csv",
};

/** One-click demo path: parse a bundled sample file, no file dance. */
export async function loadSampleImport(
  participantId: string,
  kind: ImportKind
): Promise<ImportPreview | ImportFailure> {
  const fileName = SAMPLE_FILES[kind];
  const filePath = path.join(process.cwd(), "public", "demo-fixtures", fileName);
  try {
    if (kind === "apple_health") {
      const digest = { hash: createHash("sha256") };
      async function* hashedChunks() {
        for await (const chunk of createReadStream(filePath)) {
          const bytes = chunk as Buffer;
          digest.hash.update(bytes);
          yield bytes.toString("utf8");
        }
      }
      const parsed = await parseAppleHealthXml(hashedChunks());
      return await stageToPreview(participantId, parsed, digest.hash.digest("hex"), fileName);
    }
    const { readFile } = await import("node:fs/promises");
    const bytes = await readFile(filePath);
    const parsed = parseAirViewCsv(bytes.toString("utf8"));
    return await stageToPreview(
      participantId,
      parsed,
      createHash("sha256").update(bytes).digest("hex"),
      fileName
    );
  } catch (error) {
    if (error instanceof ImportParseError) return { ok: false, error: error.message };
    throw error;
  }
}

/**
 * Confirms a staged import. Accepts ONLY the single-use token, the
 * participant id, and the align flag — the payload is loaded from the
 * server-side PendingImport record and ingested through the lineage-
 * authorized consent gate (audit v2 HIGH fix: no client payload trust).
 */
export async function confirmImport(
  token: string,
  participantId: string,
  alignToSimClock: boolean
): Promise<ImportResult> {
  const result = await confirmPendingImport(token, participantId, { alignToSimClock });
  if (!result.blocked) refresh();
  return result;
}

// ---------------------------------------------------------------------------
// DentiTrac (pilot integration — PREVIEW ONLY, no ingest path, no DB writes;
// the connector schema deliberately has no entry for it, so even a forged
// "dentitrac" payload is refused before staging)
// ---------------------------------------------------------------------------

export interface DentiTracPreview {
  ok: true;
  sourceName: string;
  parsed: ParsedDentiTrac;
}

/** Parses the bundled DentiTrac fixture — preview only, nothing is written. */
export async function loadDentiTracSample(): Promise<DentiTracPreview | ImportFailure> {
  const fileName = "dentitrac-sample.csv";
  const filePath = path.join(process.cwd(), "public", "demo-fixtures", fileName);
  try {
    const { readFile } = await import("node:fs/promises");
    return { ok: true, sourceName: fileName, parsed: parseDentiTracCsv(await readFile(filePath, "utf8")) };
  } catch (error) {
    if (error instanceof ImportParseError) return { ok: false, error: error.message };
    throw error;
  }
}

/** Parses an uploaded DentiTrac CSV — preview only, nothing is written. */
export async function previewDentiTracUpload(
  formData: FormData
): Promise<DentiTracPreview | ImportFailure> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a file to upload" };
  }
  if (file.size > MAX_TEXT_UPLOAD_BYTES) return { ok: false, error: TEXT_TOO_LARGE_ERROR };
  try {
    return { ok: true, sourceName: file.name, parsed: parseDentiTracCsv(await file.text()) };
  } catch (error) {
    if (error instanceof ImportParseError) return { ok: false, error: error.message };
    throw error;
  }
}
