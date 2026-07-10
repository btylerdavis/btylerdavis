import { ImportParseError } from "./appleHealth";

/**
 * DentiTrac wear-time export parser (DEMO.md §3 — pilot integration,
 * reserve → working PREVIEW). DentiTrac is the Braebon micro-recorder
 * embedded in oral appliances: its clinician export is one row per night
 * with a wear-time duration and a temperature-verification flag (the sensor
 * proves the appliance was in a mouth, not on a nightstand — objective
 * adherence for the appliance arm).
 *
 * PREVIEW ONLY: this module parses and summarizes (nights, mean wear hours).
 * There is deliberately NO ingest path — nothing here touches the database
 * or the consent gates. Turning the preview into real rows is the vendor-
 * agreement milestone (one more importer through lib/imports/ingest.ts).
 */

export interface DentiTracNight {
  day: string; // ISO YYYY-MM-DD
  wearMinutes: number;
  /** temperature verification (null when the export lacks the column) */
  verified: boolean | null;
}

export interface ParsedDentiTrac {
  kind: "dentitrac";
  nights: number;
  /** nights with any recorded wear (> 0 minutes) */
  wornNights: number;
  firstDay: string | null;
  lastDay: string | null;
  /** mean nightly wear over ALL nights, zeros included (adherence semantics), in hours */
  meanWearHoursAllNights: number | null;
  /** mean nightly wear over worn nights only, in hours */
  meanWearHoursWornNights: number | null;
  deviceSerial: string | null;
  rows: DentiTracNight[];
}

/** Fuzzy header → column mapping ("Wear Time", "Wear (hours)", ...). */
const COLUMN_MATCHERS: Record<string, RegExp> = {
  date: /^date/i,
  wear: /wear/i,
  serial: /serial/i,
  verified: /temp|verif/i,
};

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

/** "7:24" → minutes; decimal values are read as hours. */
function parseWearMinutes(raw: string | undefined, line: number): number {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "" || trimmed === "-" || /^n\/?a$/i.test(trimmed)) return 0;
  const clock = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  const hoursValue = clock ? +clock[1] + +clock[2] / 60 : Number(trimmed);
  if (!Number.isFinite(hoursValue)) {
    throw new ImportParseError(`Row ${line}: unrecognized wear time "${trimmed}"`);
  }
  if (hoursValue < 0 || hoursValue > 24) {
    throw new ImportParseError(`Row ${line}: wear time ${hoursValue} h is out of range`);
  }
  return Math.round(hoursValue * 60);
}

function parseVerified(raw: string | undefined): boolean | null {
  const trimmed = (raw ?? "").trim().toLowerCase();
  if (trimmed === "") return null;
  return trimmed === "yes" || trimmed === "y" || trimmed === "true" || trimmed === "1";
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function parseDentiTracCsv(text: string): ParsedDentiTrac {
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
  if (columnIndex.date === undefined || columnIndex.wear === undefined) {
    throw new ImportParseError(
      'Could not find the "Date" and "Wear Time" columns — is this a DentiTrac wear-time export?'
    );
  }

  const rows: DentiTracNight[] = [];
  const seenDays = new Set<string>();
  let deviceSerial: string | null = null;
  for (let index = 1; index < lines.length; index++) {
    const cells = lines[index].split(",").map((cell) => cell.trim());
    const day = parseCsvDate(cells[columnIndex.date] ?? "", index + 1);
    if (seenDays.has(day)) {
      throw new ImportParseError(`Row ${index + 1}: duplicate night ${day}`);
    }
    seenDays.add(day);
    if (deviceSerial === null && columnIndex.serial !== undefined && cells[columnIndex.serial]) {
      deviceSerial = cells[columnIndex.serial];
    }
    rows.push({
      day,
      wearMinutes: parseWearMinutes(cells[columnIndex.wear], index + 1),
      verified:
        columnIndex.verified !== undefined ? parseVerified(cells[columnIndex.verified]) : null,
    });
  }

  rows.sort((a, b) => a.day.localeCompare(b.day));

  const worn = rows.filter((row) => row.wearMinutes > 0);
  const totalMinutes = rows.reduce((sum, row) => sum + row.wearMinutes, 0);
  const wornMinutes = worn.reduce((sum, row) => sum + row.wearMinutes, 0);

  return {
    kind: "dentitrac",
    nights: rows.length,
    wornNights: worn.length,
    firstDay: rows[0]?.day ?? null,
    lastDay: rows[rows.length - 1]?.day ?? null,
    meanWearHoursAllNights: rows.length > 0 ? round1(totalMinutes / rows.length / 60) : null,
    meanWearHoursWornNights: worn.length > 0 ? round1(wornMinutes / worn.length / 60) : null,
    deviceSerial,
    rows,
  };
}
