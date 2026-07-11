import {
  getDevices,
  getMattressPurchases,
  getObservations,
  grantSetHas,
  loadGrants,
  sourceToDataClass,
  type DataClass,
  type GrantSet,
} from "../consent";
import { toIsoDay } from "../format";
import { getSimClock } from "../simclock";
import { addDays } from "../synthetic/profiles";
import {
  evaluateRules,
  emptyInputs,
  type Recommendation,
  type RecommendationInputs,
} from "./rules";

/**
 * Identified-tier loader for the recommendation engine (SPEC §10.2: a
 * recommendation is delivered *to a person*, so it runs on the identified
 * tier under the participant's view_identified grants — never on the
 * research mart). Every read goes through the consent-gated readers; a data
 * class without a current grant contributes nulls, and a rule with null
 * inputs cannot fire.
 */

/** Data classes the engine can draw on (linkage identity is NOT one of them). */
export const RECOMMENDATION_DATA_CLASSES: DataClass[] = [
  "hst_clinical",
  "cpap_telemetry",
  "sleep_mat",
  "wearable_sleep",
  "mattress_purchase",
];

const WINDOW_DAYS = 42; // sparklines + trend windows all fit in 6 weeks
const MIN_SUPINE_NIGHTS = 5;
const ADHERENT_NIGHT_MIN = 240; // ≥ 4 h
const LOW_SPO2_PCT = 92;

export interface SparkPoint {
  day: string;
  value: number | null;
}

export interface RecommendationsResult {
  clockIso: string;
  /** true when NO engine data class has a current view_identified grant */
  blocked: boolean;
  /** engine data classes without a current view_identified grant */
  blockedDataClasses: DataClass[];
  recommendations: Recommendation[];
  inputs: RecommendationInputs;
  /** nightly series for the cards' "why" sparklines (last 6 weeks) */
  series: {
    supine: SparkPoint[];
    usage: SparkPoint[];
    leak: SparkPoint[];
    residual: SparkPoint[];
  };
  queryMs: number;
}

function meanIn(
  rows: { day: number; value: number }[],
  fromExclusive: number,
  toInclusive: number
): number | null {
  const values = rows
    .filter((row) => row.day > fromExclusive && row.day <= toInclusive)
    .map((row) => row.value);
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export async function loadRecommendations(
  participantId: string,
  opts: { grants?: GrantSet } = {}
): Promise<RecommendationsResult> {
  const startedAt = performance.now();
  const [clock, grants] = await Promise.all([
    getSimClock(),
    opts.grants ?? loadGrants(participantId),
  ]);

  const canView = (dataClass: DataClass) => grantSetHas(grants, dataClass, "view_identified");
  const blockedDataClasses = RECOMMENDATION_DATA_CLASSES.filter((dc) => !canView(dc));
  const blocked = blockedDataClasses.length === RECOMMENDATION_DATA_CLASSES.length;

  const windowFrom = addDays(clock, -(WINDOW_DAYS - 1));

  // Consent-gated reads: nightly window + baseline HST + device/purchase facts.
  const [windowObs, hstObs, cpapDevices, purchaseRead] = await Promise.all([
    getObservations(participantId, {
      use: "view_identified",
      grants,
      from: windowFrom,
      to: clock,
      concepts: [
        "supine_time_pct",
        "cpap_usage_minutes",
        "therapy_gap",
        "mask_leak_p95",
        "residual_ahi",
        "spo2_mean",
      ],
    }),
    getObservations(participantId, {
      use: "view_identified",
      grants,
      dataClasses: ["hst_clinical"],
      concepts: ["supine_ahi", "nonsupine_ahi"],
    }),
    // Consent-gated device read: without a current cpap_telemetry view grant
    // this returns data: [] (blocked), so hasCpap can never leak a device.
    getDevices(participantId, { use: "view_identified", grants, classes: ["cpap"] }),
    // Consent-gated purchase reader: facts only with a current
    // mattress_purchase view grant.
    getMattressPurchases(participantId, { use: "view_identified", grants }),
  ]);
  const purchases = purchaseRead.data;

  // --- bucket nightly values by day offset from the clock ---------------------
  // day 0 = tonight (the clock date), day 13 = 14 nights ago, etc.
  const byConcept = new Map<string, { day: number; value: number }[]>();
  const gapDays = new Set<number>();
  const dayOffset = (date: Date) =>
    Math.round((clock.getTime() - date.getTime()) / 86_400_000);
  for (const obs of windowObs.data) {
    const offset = dayOffset(obs.effectiveDate);
    if (obs.concept === "therapy_gap") {
      gapDays.add(offset);
      continue;
    }
    if (obs.valueNumeric === null) continue;
    // sleep-mat and HST both emit supine_time_pct; only nightly mat rows count
    if (obs.concept === "supine_time_pct" && sourceToDataClass(obs.source) !== "sleep_mat") {
      continue;
    }
    const list = byConcept.get(obs.concept) ?? [];
    list.push({ day: offset, value: obs.valueNumeric });
    byConcept.set(obs.concept, list);
  }

  const supineRows = byConcept.get("supine_time_pct") ?? [];
  const usageRows = byConcept.get("cpap_usage_minutes") ?? [];
  const leakRows = byConcept.get("mask_leak_p95") ?? [];
  const residualRows = byConcept.get("residual_ahi") ?? [];
  const spo2Rows = byConcept.get("spo2_mean") ?? [];

  // --- HST supine split --------------------------------------------------------
  let supineAhi: number | null = null;
  let nonsupineAhi: number | null = null;
  for (const obs of hstObs.data) {
    if (obs.valueNumeric === null) continue;
    if (obs.concept === "supine_ahi") supineAhi = obs.valueNumeric;
    if (obs.concept === "nonsupine_ahi") nonsupineAhi = obs.valueNumeric;
  }
  const supinePredominant =
    supineAhi !== null && nonsupineAhi !== null ? supineAhi >= 2 * nonsupineAhi : null;

  // --- CPAP aggregates -----------------------------------------------------------
  const hasCpap = cpapDevices.data.length > 0;
  const usage30 = usageRows.filter((row) => row.day < 30);
  const gaps30 = [...gapDays].filter((day) => day < 30);
  const cpapNights30 = usage30.length + gaps30.length;
  const adherentNights30 = usage30.filter((row) => row.value >= ADHERENT_NIGHT_MIN).length;
  const adherencePct30 =
    cpapNights30 > 0 ? (adherentNights30 / cpapNights30) * 100 : null;

  // consecutive therapy-gap nights ending at the clock (day 0, 1, 2, …)
  let gapStreak = 0;
  while (gapDays.has(gapStreak)) gapStreak += 1;

  // --- low-SpO2 night counts (day offsets 0..13 = last 14, 14..27 = prior 14) ---
  const lowSpo2 = (fromDay: number, toDay: number) =>
    spo2Rows.filter(
      (row) => row.day >= fromDay && row.day <= toDay && row.value < LOW_SPO2_PCT
    ).length;
  const canSpo2 = canView("wearable_sleep");

  const recentSupine = meanIn(supineRows, -1, 13);
  const recentSupineNights = supineRows.filter((row) => row.day <= 13).length;

  const inputs: RecommendationInputs = {
    ...emptyInputs(),
    supinePredominant,
    supineAhi,
    nonsupineAhi,
    recentSupinePct: recentSupineNights >= MIN_SUPINE_NIGHTS ? recentSupine : null,
    mattressFirmness: purchases[0]?.catalogItem.firmnessRating ?? null,
    mattressLabel: purchases[0]
      ? `${purchases[0].catalogItem.brand} ${purchases[0].catalogItem.model}`
      : null,
    hasCpap,
    cpapNights30,
    adherencePct30,
    usageLast14Mean: meanIn(usageRows, -1, 13),
    usagePrior28Mean: meanIn(usageRows, 13, 41),
    leakLast14Mean: meanIn(leakRows, -1, 13),
    leakPrior14Mean: meanIn(leakRows, 13, 27),
    gapStreak,
    residualLast14Mean: meanIn(residualRows, -1, 13),
    residualPrior14Mean: meanIn(residualRows, 13, 27),
    lowSpo2NightsLast14: canSpo2 ? lowSpo2(0, 13) : null,
    lowSpo2NightsPrior14: canSpo2 ? lowSpo2(14, 27) : null,
  };

  // --- sparkline series (chronological, every night in the window) --------------
  const toSeries = (rows: { day: number; value: number }[]): SparkPoint[] => {
    const byDay = new Map(rows.map((row) => [row.day, row.value]));
    const points: SparkPoint[] = [];
    for (let offset = WINDOW_DAYS - 1; offset >= 0; offset--) {
      points.push({
        day: toIsoDay(addDays(clock, -offset)),
        value: byDay.get(offset) ?? null,
      });
    }
    return points;
  };
  const toHoursSeries = (points: SparkPoint[]): SparkPoint[] =>
    points.map((point) => ({
      day: point.day,
      value: point.value === null ? null : Math.round((point.value / 60) * 10) / 10,
    }));

  return {
    clockIso: toIsoDay(clock),
    blocked,
    blockedDataClasses,
    recommendations: evaluateRules(inputs),
    inputs,
    series: {
      supine: toSeries(supineRows),
      usage: toHoursSeries(toSeries(usageRows)),
      leak: toSeries(leakRows),
      residual: toSeries(residualRows),
    },
    queryMs: Math.round(performance.now() - startedAt),
  };
}
