import { ImportParseError, type ImportObservationRow } from "./appleHealth";

/**
 * AirView-format nightly compliance CSV parser: one row per night with
 * usage hours, AHI, 95th-percentile leak and pressure. Maps to canonical
 * Observations (source "airview") on the same concepts the synthetic
 * generator emits, so imported nights land straight on the CPAP chart.
 * Pure module (no DB) — writes go through ./ingest.ts and the consent gate.
 */

export interface ParsedAirView {
  kind: "airview";
  source: "airview";
  observations: ImportObservationRow[];
  nights: number;
  firstDay: string | null;
  lastDay: string | null;
  recordCounts: Record<string, number>;
}

/** Fuzzy header → column mapping ("Usage Hours", "Usage (hours)", ...). */
const COLUMN_MATCHERS: Record<string, RegExp> = {
  date: /^date/i,
  usage: /usage/i,
  ahi: /^ahi\b|apnea.hypopnea/i,
  leak: /leak/i,
  pressure: /pressure/i,
};

interface NightRow {
  day: string;
  usageHours: number;
  ahi: number | null;
  leak: number | null;
  pressure: number | null;
}

function parseCsvDate(raw: string, line: number): string {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const usMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (usMatch) {
    const [, month, day, year] = usMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  throw new ImportParseError(`Row ${line}: unrecognized date "${trimmed}"`);
}

function parseNumberCell(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "-" || /^n\/?a$/i.test(trimmed)) return null;
  // "6:30" style usage durations → decimal hours
  const clock = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (clock) return +clock[1] + +clock[2] / 60;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export function parseAirViewCsv(text: string): ParsedAirView {
  const lines = text
    .split(/\r?\n/)
    .map((rawLine) => rawLine.trim())
    .filter((rawLine) => rawLine.length > 0);
  if (lines.length < 2) {
    throw new ImportParseError("CSV needs a header row and at least one nightly row");
  }

  const header = lines[0].split(",").map((cell) => cell.trim());
  const columnIndex: Partial<Record<keyof typeof COLUMN_MATCHERS, number>> = {};
  header.forEach((cell, index) => {
    for (const [key, matcher] of Object.entries(COLUMN_MATCHERS)) {
      if (columnIndex[key] === undefined && matcher.test(cell)) columnIndex[key] = index;
    }
  });
  if (columnIndex.date === undefined || columnIndex.usage === undefined) {
    throw new ImportParseError(
      'Could not find the "Date" and "Usage" columns — is this an AirView nightly compliance export?'
    );
  }

  const nights: NightRow[] = [];
  const seenDays = new Set<string>();
  for (let index = 1; index < lines.length; index++) {
    const cells = lines[index].split(",").map((cell) => cell.trim());
    const day = parseCsvDate(cells[columnIndex.date] ?? "", index + 1);
    if (seenDays.has(day)) {
      throw new ImportParseError(`Row ${index + 1}: duplicate night ${day}`);
    }
    seenDays.add(day);

    const usageHours = parseNumberCell(cells[columnIndex.usage]) ?? 0;
    if (usageHours < 0 || usageHours > 24) {
      throw new ImportParseError(`Row ${index + 1}: usage ${usageHours} h is out of range`);
    }
    const ahi = columnIndex.ahi !== undefined ? parseNumberCell(cells[columnIndex.ahi]) : null;
    if (ahi !== null && (ahi < 0 || ahi > 150)) {
      throw new ImportParseError(`Row ${index + 1}: AHI ${ahi} is out of range`);
    }
    const leak = columnIndex.leak !== undefined ? parseNumberCell(cells[columnIndex.leak]) : null;
    if (leak !== null && (leak < 0 || leak > 120)) {
      throw new ImportParseError(`Row ${index + 1}: leak ${leak} L/min is out of range`);
    }
    const pressure =
      columnIndex.pressure !== undefined ? parseNumberCell(cells[columnIndex.pressure]) : null;
    if (pressure !== null && (pressure < 3 || pressure > 30)) {
      throw new ImportParseError(`Row ${index + 1}: pressure ${pressure} cmH2O is out of range`);
    }
    nights.push({ day, usageHours, ahi, leak, pressure });
  }

  nights.sort((a, b) => a.day.localeCompare(b.day));

  const observations: ImportObservationRow[] = [];
  for (const night of nights) {
    observations.push({
      day: night.day,
      concept: "cpap_usage_minutes",
      value: Math.round(night.usageHours * 60),
      unit: "min",
    });
    // A zero-usage night carries only the usage row — the device reported
    // nothing else that night.
    if (night.usageHours === 0) continue;
    if (night.ahi !== null) {
      observations.push({
        day: night.day,
        concept: "residual_ahi",
        value: night.ahi,
        unit: "events/h",
      });
    }
    if (night.leak !== null) {
      observations.push({
        day: night.day,
        concept: "mask_leak_p95",
        value: night.leak,
        unit: "L/min",
      });
    }
    if (night.pressure !== null) {
      observations.push({
        day: night.day,
        concept: "pressure_p95",
        value: night.pressure,
        unit: "cmH2O",
      });
    }
  }

  return {
    kind: "airview",
    source: "airview",
    observations,
    nights: nights.length,
    firstDay: nights[0]?.day ?? null,
    lastDay: nights[nights.length - 1]?.day ?? null,
    recordCounts: { nightly_rows: nights.length },
  };
}
