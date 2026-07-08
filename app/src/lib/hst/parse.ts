/**
 * HST intake parsers (DEMO.md Act 2). Two supported formats, matching the
 * fixtures in public/demo-fixtures/:
 *
 * 1. Structured CSV export — header columns study_date, ahi, supine_ahi,
 *    nonsupine_ahi, odi, spo2_mean, spo2_nadir, supine_time_pct.
 * 2. Plain-text interpretation report — labeled lines extracted with
 *    per-metric regexes.
 *
 * Pure module (no DB): parse → preview → coach confirms → the server action
 * writes hst Observations through the ingest gate.
 */

export const HST_CONCEPTS = [
  "ahi",
  "supine_ahi",
  "nonsupine_ahi",
  "odi",
  "spo2_mean",
  "spo2_nadir",
  "supine_time_pct",
] as const;

export type HstConcept = (typeof HST_CONCEPTS)[number];

/** Units per concept — mirrors the synthetic generator's HST rows. */
export const HST_UNITS: Record<HstConcept, string> = {
  ahi: "events/h",
  supine_ahi: "events/h",
  nonsupine_ahi: "events/h",
  odi: "events/h",
  spo2_mean: "%",
  spo2_nadir: "%",
  supine_time_pct: "%",
};

export const HST_LABELS: Record<HstConcept, string> = {
  ahi: "Overall AHI",
  supine_ahi: "Supine AHI",
  nonsupine_ahi: "Non-supine AHI",
  odi: "ODI",
  spo2_mean: "Mean SpO2",
  spo2_nadir: "SpO2 nadir",
  supine_time_pct: "Time supine",
};

export interface ParsedHst {
  format: "csv" | "report";
  /** ISO day, e.g. "2026-04-08" */
  studyDate: string;
  values: Record<HstConcept, number>;
}

export class HstParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HstParseError";
  }
}

/** Sanity ranges — reject junk before it reaches the record. */
const RANGES: Record<HstConcept, [number, number]> = {
  ahi: [0, 150],
  supine_ahi: [0, 150],
  nonsupine_ahi: [0, 150],
  odi: [0, 150],
  spo2_mean: [50, 100],
  spo2_nadir: [40, 100],
  supine_time_pct: [0, 100],
};

function validateValues(partial: Partial<Record<HstConcept, number>>): Record<HstConcept, number> {
  const missing = HST_CONCEPTS.filter(
    (c) => partial[c] === undefined || !Number.isFinite(partial[c])
  );
  if (missing.length > 0) {
    throw new HstParseError(
      `Could not extract: ${missing.map((c) => HST_LABELS[c]).join(", ")}`
    );
  }
  const values = partial as Record<HstConcept, number>;
  for (const concept of HST_CONCEPTS) {
    const [min, max] = RANGES[concept];
    if (values[concept] < min || values[concept] > max) {
      throw new HstParseError(
        `${HST_LABELS[concept]} out of plausible range: ${values[concept]}`
      );
    }
  }
  return values;
}

function validateStudyDate(raw: string | undefined): string {
  if (!raw) throw new HstParseError("Could not extract: study date");
  const date = new Date(`${raw.trim()}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new HstParseError(`Unrecognized study date: "${raw.trim()}"`);
  }
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Format 1: structured CSV
// ---------------------------------------------------------------------------

export function parseHstCsv(text: string): ParsedHst {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) {
    throw new HstParseError("CSV needs a header row and at least one data row");
  }

  const header = lines[0].split(",").map((c) => c.trim().toLowerCase());
  const row = lines[1].split(",").map((c) => c.trim());
  const col = (name: string) => {
    const idx = header.indexOf(name);
    return idx === -1 ? undefined : row[idx];
  };

  const values: Partial<Record<HstConcept, number>> = {};
  for (const concept of HST_CONCEPTS) {
    const cell = col(concept);
    if (cell !== undefined && cell !== "") values[concept] = Number(cell);
  }

  return {
    format: "csv",
    studyDate: validateStudyDate(col("study_date")),
    values: validateValues(values),
  };
}

// ---------------------------------------------------------------------------
// Format 2: plain-text interpretation report
// ---------------------------------------------------------------------------

const REPORT_PATTERNS: Record<HstConcept, RegExp> = {
  // "Overall AHI: 24.0" — or a bare "AHI: 24.0" line (not Supine/Non-supine).
  ahi: /(?:overall\s+AHI|^\s*AHI)\s*[:=]?\s*(\d+(?:\.\d+)?)/im,
  // "Supine AHI: 41.0" — [^-\w] blocks the "-supine" inside "Non-supine".
  supine_ahi: /(?:^|[^-\w])supine\s+AHI\s*[:=]?\s*(\d+(?:\.\d+)?)/im,
  nonsupine_ahi: /non[-\s]?supine\s+AHI\s*[:=]?\s*(\d+(?:\.\d+)?)/i,
  // "ODI (4%): 19.2"
  odi: /ODI\s*(?:\([^)]*\))?\s*[:=]?\s*(\d+(?:\.\d+)?)/i,
  spo2_mean: /mean\s+SpO2\s*[:=]?\s*(\d+(?:\.\d+)?)/i,
  spo2_nadir: /(?:SpO2\s+nadir|nadir\s+SpO2|lowest\s+SpO2|minimum\s+SpO2)\s*[:=]?\s*(\d+(?:\.\d+)?)/i,
  supine_time_pct: /(?:time\s+supine|supine\s+time)\s*[:=]?\s*(\d+(?:\.\d+)?)/i,
};

const REPORT_DATE_PATTERN = /study\s+date\s*[:=]?\s*(\d{4}-\d{2}-\d{2}|[A-Za-z]+\s+\d{1,2},\s*\d{4})/i;

export function parseHstReport(text: string): ParsedHst {
  const values: Partial<Record<HstConcept, number>> = {};
  for (const concept of HST_CONCEPTS) {
    const match = REPORT_PATTERNS[concept].exec(text);
    if (match) values[concept] = Number(match[1]);
  }

  const dateMatch = REPORT_DATE_PATTERN.exec(text);
  let isoDate: string | undefined;
  if (dateMatch) {
    const raw = dateMatch[1];
    isoDate = /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? raw
      : toIsoDay(new Date(`${raw} UTC`));
  }

  return {
    format: "report",
    studyDate: validateStudyDate(isoDate),
    values: validateValues(values),
  };
}

function toIsoDay(date: Date): string | undefined {
  return Number.isNaN(date.getTime())
    ? undefined
    : date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Auto-detect + the positional-OSA flag
// ---------------------------------------------------------------------------

/** Detects the format from content and parses accordingly. */
export function parseHst(text: string): ParsedHst {
  const firstLine =
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";
  const looksCsv = firstLine.includes(",") && /study_date/i.test(firstLine);
  return looksCsv ? parseHstCsv(text) : parseHstReport(text);
}

/**
 * Supine-predominance flag (the positional-OSA moment): supine AHI at least
 * twice the non-supine AHI.
 */
export function isSupinePredominant(values: {
  supine_ahi: number;
  nonsupine_ahi: number;
}): boolean {
  return values.supine_ahi >= 2 * values.nonsupine_ahi;
}

/**
 * Re-validates a ParsedHst that round-tripped through the client (preview →
 * coach confirm). Server actions call this before writing observations.
 */
export function assertValidParsedHst(parsed: ParsedHst): ParsedHst {
  return {
    format: parsed.format,
    studyDate: validateStudyDate(parsed.studyDate),
    values: validateValues(parsed.values ?? {}),
  };
}
