import sax from "sax";

/**
 * Apple Health export.xml parser (DEMO.md Act 3-4 "real import" beat —
 * "this chart is my actual sleep").
 *
 * Stream-parsed with sax: a real export can exceed 500 MB, so the file is
 * never held in memory — <Record> attributes are folded into nightly
 * aggregates as they stream past. Pure module (no DB): the ingest step in
 * ./ingest.ts writes the result through the consent gate.
 *
 * Record types mapped (canonical concepts match the synthetic generator, so
 * imported nights land on the same charts):
 * - HKCategoryTypeIdentifierSleepAnalysis (incl. stage values) →
 *   SleepSession + sleep_duration_min / sleep_efficiency per night
 * - HKQuantityTypeIdentifierRestingHeartRate → resting_hr per day
 * - HKQuantityTypeIdentifierHeartRate → resting_hr fallback (daily minimum)
 *   for days without a RestingHeartRate summary
 * - HKQuantityTypeIdentifierHeartRateVariabilitySDNN → hrv_sdnn (daily mean)
 * - HKQuantityTypeIdentifierOxygenSaturation → spo2_mean (daily mean, %)
 */

export const APPLE_SLEEP_TYPE = "HKCategoryTypeIdentifierSleepAnalysis";

const QUANTITY_TYPES = {
  heartRate: "HKQuantityTypeIdentifierHeartRate",
  restingHeartRate: "HKQuantityTypeIdentifierRestingHeartRate",
  hrvSdnn: "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
  oxygenSaturation: "HKQuantityTypeIdentifierOxygenSaturation",
} as const;

export class ImportParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportParseError";
  }
}

export interface ImportObservationRow {
  /** ISO day the value belongs to (nightly/daily grain) */
  day: string;
  concept: string;
  value: number;
  unit: string;
}

export interface ImportSessionRow {
  day: string;
  startIso: string;
  endIso: string;
  summary: {
    efficiency: number;
    durationMin: number;
    stages: { deep: number; rem: number; core: number };
  };
}

export interface ParsedAppleHealth {
  kind: "apple_health";
  source: "healthkit";
  observations: ImportObservationRow[];
  sessions: ImportSessionRow[];
  nights: number;
  firstDay: string | null;
  lastDay: string | null;
  /** raw <Record> counts per mapped type, for the preview card */
  recordCounts: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Date handling — Apple writes "2026-06-29 22:41:12 -0500"
// ---------------------------------------------------------------------------

const APPLE_DATE =
  /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?: ([+-])(\d{2}):?(\d{2}))?$/;

export function parseAppleDate(raw: string): Date | null {
  const match = APPLE_DATE.exec(raw.trim());
  if (!match) {
    const fallback = new Date(raw);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
  const [, y, mo, d, h, mi, s, sign, oh, om] = match;
  let ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  if (sign) {
    const offsetMin = +oh * 60 + +om;
    ms -= (sign === "+" ? 1 : -1) * offsetMin * 60_000;
  }
  return new Date(ms);
}

/**
 * The night a sleep segment belongs to: the morning-after date. Shifting the
 * end time forward 6 h folds pre-midnight segments into the same night as
 * the morning they precede (matches the generator's effectiveDate grain).
 */
export function nightOf(end: Date): string {
  return new Date(end.getTime() + 6 * 3_600_000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Streaming aggregation state
// ---------------------------------------------------------------------------

interface NightAccumulator {
  asleepMin: number;
  inBedMin: number;
  deepMin: number;
  remMin: number;
  coreMin: number;
  startMs: number;
  endMs: number;
}

interface DailyStat {
  sum: number;
  count: number;
  min: number;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function addDaily(map: Map<string, DailyStat>, day: string, value: number): void {
  const entry = map.get(day) ?? { sum: 0, count: 0, min: Number.POSITIVE_INFINITY };
  entry.sum += value;
  entry.count += 1;
  entry.min = Math.min(entry.min, value);
  map.set(day, entry);
}

/**
 * Parse an export.xml from a string or an async chunk stream. Only
 * <Record> attributes are inspected; everything else streams past.
 */
export async function parseAppleHealthXml(
  input: string | AsyncIterable<string>
): Promise<ParsedAppleHealth> {
  const nights = new Map<string, NightAccumulator>();
  const restingHr = new Map<string, DailyStat>();
  const heartRate = new Map<string, DailyStat>();
  const hrv = new Map<string, DailyStat>();
  const spo2 = new Map<string, DailyStat>();
  const recordCounts: Record<string, number> = {};
  let sawHealthData = false;

  const parser = sax.parser(true, { trim: false });
  let parseError: ImportParseError | null = null;

  parser.onerror = (error) => {
    parseError ??= new ImportParseError(`Not a readable export.xml: ${error.message}`);
    // sax can continue after resume(); we stop at the first structural error.
  };

  parser.onopentag = (node) => {
    if (node.name === "HealthData") sawHealthData = true;
    if (node.name !== "Record") return;
    const attrs = node.attributes as Record<string, string>;
    const type = attrs.type;
    if (!type) return;

    if (type === APPLE_SLEEP_TYPE) {
      const start = attrs.startDate ? parseAppleDate(attrs.startDate) : null;
      const end = attrs.endDate ? parseAppleDate(attrs.endDate) : null;
      if (!start || !end || end <= start) return;
      recordCounts[type] = (recordCounts[type] ?? 0) + 1;

      const minutes = (end.getTime() - start.getTime()) / 60_000;
      const day = nightOf(end);
      const acc =
        nights.get(day) ??
        ({
          asleepMin: 0,
          inBedMin: 0,
          deepMin: 0,
          remMin: 0,
          coreMin: 0,
          startMs: Number.POSITIVE_INFINITY,
          endMs: 0,
        } satisfies NightAccumulator);

      const value = attrs.value ?? "";
      if (value.endsWith("InBed")) {
        acc.inBedMin += minutes;
      } else if (value.endsWith("Awake")) {
        acc.inBedMin += minutes; // awake-in-bed counts toward time in bed
      } else if (value.includes("Asleep")) {
        acc.asleepMin += minutes;
        if (value.endsWith("Deep")) acc.deepMin += minutes;
        else if (value.endsWith("REM")) acc.remMin += minutes;
        else acc.coreMin += minutes; // Core + Unspecified
      } else {
        return;
      }
      acc.startMs = Math.min(acc.startMs, start.getTime());
      acc.endMs = Math.max(acc.endMs, end.getTime());
      nights.set(day, acc);
      return;
    }

    const isQuantity = Object.values(QUANTITY_TYPES).includes(
      type as (typeof QUANTITY_TYPES)[keyof typeof QUANTITY_TYPES]
    );
    if (!isQuantity) return;
    const start = attrs.startDate ? parseAppleDate(attrs.startDate) : null;
    const value = Number(attrs.value);
    if (!start || !Number.isFinite(value)) return;
    recordCounts[type] = (recordCounts[type] ?? 0) + 1;
    const day = start.toISOString().slice(0, 10);

    if (type === QUANTITY_TYPES.restingHeartRate) addDaily(restingHr, day, value);
    else if (type === QUANTITY_TYPES.heartRate) addDaily(heartRate, day, value);
    else if (type === QUANTITY_TYPES.hrvSdnn) addDaily(hrv, day, value);
    else if (type === QUANTITY_TYPES.oxygenSaturation) {
      // Apple stores SpO2 as a fraction (0.96) with unit "%".
      addDaily(spo2, day, value <= 1 ? value * 100 : value);
    }
  };

  try {
    if (typeof input === "string") {
      parser.write(input);
    } else {
      for await (const chunk of input) {
        parser.write(chunk);
        if (parseError) break;
      }
    }
    parser.close();
  } catch (error) {
    // sax re-throws its stored error from write()/close() after onerror.
    if (!parseError) {
      parseError = new ImportParseError(
        `Not a readable export.xml: ${error instanceof Error ? error.message.split("\n")[0] : "unknown error"}`
      );
    }
  }

  if (parseError) throw parseError;
  if (!sawHealthData) {
    throw new ImportParseError(
      "No <HealthData> root found — is this the export.xml from an Apple Health export?"
    );
  }

  // --- fold aggregates into canonical rows ---------------------------------
  const observations: ImportObservationRow[] = [];
  const sessions: ImportSessionRow[] = [];

  for (const [day, acc] of [...nights.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (acc.asleepMin < 30) continue; // ignore fragments/naps under 30 min
    const spanMin = (acc.endMs - acc.startMs) / 60_000;
    const denominator = acc.inBedMin >= acc.asleepMin ? acc.inBedMin : Math.max(spanMin, acc.asleepMin);
    const efficiency = Math.min(100, round1((acc.asleepMin / denominator) * 100));
    sessions.push({
      day,
      startIso: new Date(acc.startMs).toISOString(),
      endIso: new Date(acc.endMs).toISOString(),
      summary: {
        efficiency,
        durationMin: Math.round(acc.asleepMin),
        stages: {
          deep: Math.round(acc.deepMin),
          rem: Math.round(acc.remMin),
          core: Math.round(acc.coreMin),
        },
      },
    });
    observations.push(
      { day, concept: "sleep_duration_min", value: Math.round(acc.asleepMin), unit: "min" },
      { day, concept: "sleep_efficiency", value: efficiency, unit: "%" }
    );
  }

  const restingDays = new Set(restingHr.keys());
  for (const [day, stat] of restingHr) {
    observations.push({
      day,
      concept: "resting_hr",
      value: round1(stat.sum / stat.count),
      unit: "bpm",
    });
  }
  for (const [day, stat] of heartRate) {
    if (restingDays.has(day)) continue; // daily-minimum fallback only
    observations.push({ day, concept: "resting_hr", value: round1(stat.min), unit: "bpm" });
  }
  for (const [day, stat] of hrv) {
    observations.push({
      day,
      concept: "hrv_sdnn",
      value: round1(stat.sum / stat.count),
      unit: "ms",
    });
  }
  for (const [day, stat] of spo2) {
    observations.push({
      day,
      concept: "spo2_mean",
      value: round1(stat.sum / stat.count),
      unit: "%",
    });
  }

  observations.sort((a, b) => a.day.localeCompare(b.day) || a.concept.localeCompare(b.concept));
  const allDays = [...new Set(observations.map((row) => row.day))].sort();

  return {
    kind: "apple_health",
    source: "healthkit",
    observations,
    sessions,
    nights: sessions.length,
    firstDay: allDays[0] ?? null,
    lastDay: allDays[allDays.length - 1] ?? null,
    recordCounts,
  };
}
