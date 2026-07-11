import {
  getAllGrantedDevices,
  grantSetHas,
  monthlyGrantedClassNights,
  loadConsentTimeline,
  sourceToDataClass,
  type ConsentTimelineMonth,
  type DataClass,
  type MonthlyClassNightsRow,
} from "../consent";
import { getSeedInfo, type SeedInfoRecord } from "../consent/policyRepo";
import { seedScenario, type SeedScenario } from "../synthetic/profiles";
import {
  loadDeliveryWindowNights,
  loadResearchCohort,
  MIN_WINDOW_NIGHTS,
  SUPINE_POST_END,
  SUPINE_POST_START,
  SUPINE_PRE_DAYS,
  type DeliveryWindowNightRow,
  type FirmnessBand,
  type ResearchCohort,
} from "./cohort";
import { isFlagshipMember } from "./positional";
import {
  eValueForStandardizedDifference,
  meanCi95,
  standardizedDifference,
  type EValueResult,
  type MeanCi,
} from "./stats";

/**
 * Research bias & robustness views (audit level-up 11): missingness by data
 * class, the attrition/consent-change timeline, the resting-HR negative
 * control, and the E-value sensitivity note — everything computed from the
 * consent-filtered research tier through the approved aggregate modules.
 * The arithmetic lives in pure functions over plain rows so it is
 * unit-testable without a database; loadRobustness orchestrates the loaders.
 */

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Missingness by data class (% of expected nights present, by month)
// ---------------------------------------------------------------------------

/** The nightly-cadence classes missingness is defined for. HST / PRO /
 *  purchase classes are event- or schedule-cadence and have no "expected
 *  night" denominator — stated on the page rather than faked. */
export const NIGHTLY_CLASSES = ["wearable_sleep", "cpap_telemetry", "sleep_mat"] as const;
export type NightlyClass = (typeof NIGHTLY_CLASSES)[number];

export const NIGHTLY_CLASS_LABELS: Record<NightlyClass, string> = {
  wearable_sleep: "Wearable sleep",
  cpap_telemetry: "CPAP telemetry",
  sleep_mat: "Under-mattress sensor",
};

export interface MissingnessInputMember {
  id: string;
  /** registry enrollment date (nights start the morning after) */
  enrollmentDate: Date;
}

export interface InstrumentWindow {
  participantId: string;
  dataClass: NightlyClass;
  /** first EXPECTED night for this class (inclusive) */
  firstNight: Date;
}

export interface MissingnessCell {
  month: string;
  dataClass: NightlyClass;
  /** consent-granted participants instrumented for the class this month */
  participants: number;
  expectedNights: number;
  presentNights: number;
  /** present / expected, % (null when nothing was expected) */
  pctPresent: number | null;
}

/** First day of a "YYYY-MM" month (UTC). */
function monthStart(month: string): Date {
  return new Date(`${month}-01T00:00:00Z`);
}

/** Exclusive end of a "YYYY-MM" month (UTC). */
function monthEnd(month: string): Date {
  const start = monthStart(month);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
}

function monthKeyOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function nextMonthKey(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, "0")}`;
}

/** Whole nights in [from, to] ∩ the month (inclusive day counts, UTC). */
function nightsInMonth(month: string, from: Date, to: Date): number {
  const lo = Math.max(from.getTime(), monthStart(month).getTime());
  const hi = Math.min(to.getTime() + DAY_MS, monthEnd(month).getTime());
  return Math.max(0, Math.round((hi - lo) / DAY_MS));
}

/**
 * Missingness by class and month: expected nights come from each
 * consent-granted instrument window (device registration ∩ enrollment ∩ the
 * sim clock); present nights come from the consent-aware per-class monthly
 * aggregate. Both sides classify BEFORE aggregating, so a revoked class
 * disappears from numerator AND denominator, and a tombstone contributes
 * nothing anywhere.
 */
export function computeMissingness(input: {
  windows: InstrumentWindow[];
  presentRows: MonthlyClassNightsRow[];
  clock: Date;
}): MissingnessCell[] {
  const { windows, presentRows, clock } = input;
  if (windows.length === 0) return [];

  const firstMonth = monthKeyOf(
    new Date(Math.min(...windows.map((window) => window.firstNight.getTime())))
  );
  const lastMonth = monthKeyOf(clock);

  const presentByKey = new Map<string, number>();
  for (const row of presentRows) {
    presentByKey.set(
      `${row.participantId}|${row.dataClass}|${row.month}`,
      row.nights
    );
  }

  const cells: MissingnessCell[] = [];
  for (let month = firstMonth; month <= lastMonth; month = nextMonthKey(month)) {
    for (const dataClass of NIGHTLY_CLASSES) {
      let participants = 0;
      let expectedNights = 0;
      let presentNights = 0;
      for (const window of windows) {
        if (window.dataClass !== dataClass) continue;
        const expected = nightsInMonth(month, window.firstNight, clock);
        if (expected === 0) continue;
        participants += 1;
        expectedNights += expected;
        // Cap at expected: two sources mapping to one class can only ever
        // over-count presence, never invent missingness.
        presentNights += Math.min(
          expected,
          presentByKey.get(`${window.participantId}|${dataClass}|${month}`) ?? 0
        );
      }
      cells.push({
        month,
        dataClass,
        participants,
        expectedNights,
        presentNights,
        pctPresent:
          expectedNights > 0
            ? Math.round((presentNights / expectedNights) * 1000) / 10
            : null,
      });
    }
  }
  return cells;
}

// ---------------------------------------------------------------------------
// Negative control (resting HR) + flagship band deltas with 95% CIs
// ---------------------------------------------------------------------------

export interface BandDelta {
  band: FirmnessBand;
  stats: MeanCi;
}

export interface MemberChange {
  participantId: string;
  band: FirmnessBand;
  change: number;
}

/** Per-band mean change with 95% CI (normal approximation). */
export function bandDeltas(changes: MemberChange[]): BandDelta[] {
  return (["soft", "medium", "firm"] as const).map((band) => ({
    band,
    stats: meanCi95(
      changes.filter((change) => change.band === band).map((change) => change.change)
    ),
  }));
}

/**
 * Pre→post change per participant from nightly delivery-window rows —
 * the exact windows the flagship analysis uses (pre −4w..−1, post +8..+35,
 * ≥ MIN_WINDOW_NIGHTS valid nights on both sides).
 */
export function deliveryWindowChanges(
  rows: { pid: string; dayOffset: number; value: number }[]
): Map<string, number> {
  const agg = new Map<
    string,
    { preSum: number; preN: number; postSum: number; postN: number }
  >();
  for (const row of rows) {
    const entry =
      agg.get(row.pid) ?? { preSum: 0, preN: 0, postSum: 0, postN: 0 };
    if (row.dayOffset >= -SUPINE_PRE_DAYS && row.dayOffset < 0) {
      entry.preSum += row.value;
      entry.preN += 1;
    } else if (row.dayOffset >= SUPINE_POST_START && row.dayOffset <= SUPINE_POST_END) {
      entry.postSum += row.value;
      entry.postN += 1;
    }
    agg.set(row.pid, entry);
  }
  const changes = new Map<string, number>();
  for (const [pid, entry] of agg) {
    if (entry.preN < MIN_WINDOW_NIGHTS || entry.postN < MIN_WINDOW_NIGHTS) continue;
    changes.set(pid, entry.postSum / entry.postN - entry.preSum / entry.preN);
  }
  return changes;
}

export interface SensitivityNote {
  /** medium-band supine change stats (the flagship delta) */
  medium: MeanCi;
  /** pooled soft+firm supine change stats (the comparison bands) */
  others: MeanCi;
  /** medium − others, percentage points */
  contrastPp: number | null;
  eValue: EValueResult | null;
}

/** E-value sensitivity note for the flagship medium-vs-other-bands delta. */
export function sensitivityNote(changes: MemberChange[]): SensitivityNote {
  const medium = meanCi95(
    changes.filter((change) => change.band === "medium").map((change) => change.change)
  );
  const others = meanCi95(
    changes.filter((change) => change.band !== "medium").map((change) => change.change)
  );
  const d = standardizedDifference(medium, others);
  return {
    medium,
    others,
    contrastPp:
      medium.mean !== null && others.mean !== null ? medium.mean - others.mean : null,
    eValue: d === null ? null : eValueForStandardizedDifference(d),
  };
}

// ---------------------------------------------------------------------------
// Page loader
// ---------------------------------------------------------------------------

export interface ScenarioStatus {
  /** the marker `npm run seed` stamped; null on pre-marker databases */
  seeded: SeedInfoRecord | null;
  /** the running server's SCENARIO env (validated), or null when unset */
  env: SeedScenario | null;
  /** env is set and disagrees with the seeded marker */
  mismatch: boolean;
}

export interface RobustnessDashboard {
  clockIso: string;
  scenario: ScenarioStatus;
  missingness: MissingnessCell[];
  timeline: ConsentTimelineMonth[];
  /** flagship supine change by firmness band, 95% CI (the effect) */
  supineDeltas: BandDelta[];
  /** flagship resting-HR change by firmness band, 95% CI (negative control) */
  negativeControl: BandDelta[];
  sensitivity: SensitivityNote;
  /** flagship members (supine-predominant + delivered mattress) */
  flagshipCount: number;
  queryMs: number;
}

/** Members' firmness bands, restricted to the flagship cohort. */
function flagshipBands(cohort: ResearchCohort): Map<string, FirmnessBand> {
  const bands = new Map<string, FirmnessBand>();
  for (const member of cohort.members) {
    if (isFlagshipMember(member) && member.firmnessBand !== null) {
      bands.set(member.id, member.firmnessBand);
    }
  }
  return bands;
}

/** Consent-gates + windows the raw resting-HR night rows (fail closed). */
function negativeControlChanges(
  cohort: ResearchCohort,
  bands: Map<string, FirmnessBand>,
  rows: DeliveryWindowNightRow[]
): MemberChange[] {
  const gated = rows.filter((row) => {
    const dataClass: DataClass | null = sourceToDataClass(row.src);
    if (dataClass === null) return false; // unknown source: quarantined (F-10)
    const member = cohort.byId.get(row.pid);
    if (!member) return false; // not a research member (revoked/tombstoned)
    return grantSetHas(member.grants, dataClass, "research_deid");
  });
  const changes = deliveryWindowChanges(
    gated.map((row) => ({
      pid: row.pid,
      dayOffset: Math.round(Number(row.offsetMs) / DAY_MS),
      value: row.value,
    }))
  );
  const result: MemberChange[] = [];
  for (const [pid, change] of changes) {
    const band = bands.get(pid);
    if (band) result.push({ participantId: pid, band, change });
  }
  return result;
}

export async function loadRobustness(): Promise<RobustnessDashboard> {
  const startedAt = performance.now();
  const cohort = await loadResearchCohort();

  const [presentRows, devices, restingHrRows, timeline, seeded] = await Promise.all([
    monthlyGrantedClassNights({ use: "research_deid" }),
    getAllGrantedDevices({
      use: "research_deid",
      classes: ["wearable", "cpap", "sleep_mat"],
    }),
    loadDeliveryWindowNights("resting_hr"),
    loadConsentTimeline(),
    getSeedInfo(),
  ]);

  // Instrument windows for cohort members only (tombstones and fully revoked
  // participants are already absent from the member list). Expected nights
  // start the morning after enrollment for continuously-worn instruments and
  // the morning after registration for CPAP (therapy nights begin at setup).
  const windows: InstrumentWindow[] = [];
  for (const device of devices) {
    const member = cohort.byId.get(device.participantId);
    if (!member) continue;
    const dataClass: NightlyClass | null =
      device.deviceClass === "wearable"
        ? "wearable_sleep"
        : device.deviceClass === "cpap"
          ? "cpap_telemetry"
          : device.deviceClass === "sleep_mat"
            ? "sleep_mat"
            : null;
    if (dataClass === null) continue;
    const anchor =
      dataClass === "cpap_telemetry" ? device.assignedAt : member.enrollmentAnchor;
    windows.push({
      participantId: device.participantId,
      dataClass,
      firstNight: new Date(anchor.getTime() + DAY_MS),
    });
  }

  const bands = flagshipBands(cohort);
  const supineChanges: MemberChange[] = [];
  for (const member of cohort.members) {
    const band = bands.get(member.id);
    if (band && member.supineChange !== null) {
      supineChanges.push({ participantId: member.id, band, change: member.supineChange });
    }
  }

  const envScenario = process.env.SCENARIO;
  const scenario: ScenarioStatus = (() => {
    let env: SeedScenario | null = null;
    if (envScenario !== undefined && envScenario !== "") {
      try {
        env = seedScenario(envScenario);
      } catch {
        env = null; // unknown value: surfaced as a mismatch below
      }
    }
    const seededScenario = seeded?.scenario ?? null;
    const mismatch =
      envScenario !== undefined &&
      envScenario !== "" &&
      (env === null || (seededScenario !== null && env !== seededScenario));
    return { seeded, env, mismatch };
  })();

  return {
    clockIso: cohort.clock.toISOString().slice(0, 10),
    scenario,
    missingness: computeMissingness({
      windows,
      presentRows,
      clock: cohort.clock,
    }),
    timeline,
    supineDeltas: bandDeltas(supineChanges),
    negativeControl: bandDeltas(negativeControlChanges(cohort, bands, restingHrRows)),
    sensitivity: sensitivityNote(supineChanges),
    flagshipCount: bands.size,
    queryMs: Math.round(performance.now() - startedAt),
  };
}
