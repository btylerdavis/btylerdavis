import {
  bandCount,
  recordCountReleases,
  releaseRecord,
  type CountReleaseRecord,
  type ReleasedCount,
} from "../disclosure";
import { SMALL_CELL_THRESHOLD } from "../deid";
import { loadResearchCohort, meanOf, type ResearchMember } from "../research/cohort";

/**
 * Partner portal aggregates (DEMO.md Act 7; SPEC §12.3 rules of engagement).
 * The Tempur-Sealy view consumes ONLY the research-tier cohort
 * (research_deid consent scope, via loadResearchCohort) and releases every
 * count through the DISCLOSURE-CONTROL layer (audit F-12, level-up 10):
 *
 * - no names, no participant ids;
 * - no cell under k=<SMALL_CELL_THRESHOLD> — small cells are shown AS
 *   suppressed (the DUA made visible);
 * - and no EXACT count at all: every released n is a band (11–20 / 21–50 /
 *   51–200 / >200), so differencing released cells against each other or
 *   against the proposal generator yields intervals, never values.
 *
 * Percentages are computed from band midpoints — approximate BY DESIGN, so
 * a share can never be inverted back into an exact count.
 *
 * Every count released here is logged to the release ledger
 * (loadPartnerDashboard → /partner/releases).
 */

export const PARTNER_BRAND = "Tempur-Pedic";
export const CATEGORY_LABEL = "All other brands";

/** Tempur-Pedic product lines surfaced in the model-level table (order matters:
 *  "ProAdapt"/"LuxeAdapt" must match before the bare "Adapt"). */
export const PARTNER_LINES = ["ProAdapt", "LuxeAdapt", "Adapt"] as const;
export type PartnerLine = (typeof PARTNER_LINES)[number];

export function partnerLineOf(model: string): PartnerLine | null {
  for (const line of PARTNER_LINES) {
    if (model.includes(line)) return line;
  }
  return null;
}

/** Supine-change (pp) distribution buckets, most-improved first. */
export const SUPINE_CHANGE_BUCKETS = [
  { key: "≤ −15 pp", test: (d: number) => d <= -15 },
  { key: "−15 to −10 pp", test: (d: number) => d > -15 && d <= -10 },
  { key: "−10 to −5 pp", test: (d: number) => d > -10 && d <= -5 },
  { key: "−5 to 0 pp", test: (d: number) => d > -5 && d <= 0 },
  { key: "> 0 pp", test: (d: number) => d > 0 },
] as const;

export interface SuppressedStat {
  /** released n — a band, never an exact count (suppressed when 1 ≤ n < k) */
  n: ReleasedCount;
  /** mean is withheld whenever n is suppressed */
  mean: number | null;
}

export interface OutcomeTile {
  group: string;
  supineChange: SuppressedStat;
  essChange: SuppressedStat;
}

export interface DistributionCell {
  bucket: string;
  partner: ReleasedCount;
  others: ReleasedCount;
  /** approximate shares from band midpoints (null when the cell is suppressed) */
  partnerPct: number | null;
  othersPct: number | null;
}

export interface ModelLineRow {
  line: PartnerLine;
  n: ReleasedCount;
  meanSupineChange: number | null;
  meanEssChange: number | null;
}

export interface PartnerDashboard {
  clockIso: string;
  /** purchasers visible to the research tier (consent-filtered, banded) */
  partnerPurchasers: ReleasedCount;
  otherPurchasers: ReleasedCount;
  tiles: OutcomeTile[];
  distribution: DistributionCell[];
  suppressedDistributionCells: number;
  modelRows: ModelLineRow[];
  suppressedModelRows: number;
  threshold: number;
  queryMs: number;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

function stat(values: (number | null)[]): SuppressedStat {
  const { mean, n } = meanOf(values);
  const cell = bandCount(n);
  return { n: cell, mean: cell.suppressed || mean === null ? null : round1(mean) };
}

/**
 * The magnitude a released band admits for share math: its midpoint.
 * Approximate by design — the share can never be inverted into a count.
 */
export function bandMidpoint(released: ReleasedCount): number | null {
  if (released.suppressed) return null;
  if (released.max === null) return released.min; // ">200": conservative anchor
  return (released.min + released.max) / 2;
}

/**
 * Pure aggregation over research-tier members (unit-testable). Members with
 * no readable purchase (no mattress_purchase research grant, or no purchase)
 * are invisible here by construction — `brand` is already null for them.
 */
export function buildPartnerDashboard(
  members: ResearchMember[],
  clock: Date,
  queryMs: number
): PartnerDashboard {
  const purchasers = members.filter((member) => member.brand !== null);
  const partner = purchasers.filter((member) => member.brand === PARTNER_BRAND);
  const others = purchasers.filter((member) => member.brand !== PARTNER_BRAND);

  // --- outcome tiles: partner vs category average ------------------------------
  const tiles: OutcomeTile[] = [
    {
      group: PARTNER_BRAND,
      supineChange: stat(partner.map((m) => m.supineChange)),
      essChange: stat(partner.map((m) => m.essChangeFollowup)),
    },
    {
      group: "Category average (all brands)",
      supineChange: stat(purchasers.map((m) => m.supineChange)),
      essChange: stat(purchasers.map((m) => m.essChangeFollowup)),
    },
  ];

  // --- supine-improvement distribution, partner vs all other brands ------------
  const bucketCounts = new Map<string, { partner: number; others: number }>();
  for (const bucket of SUPINE_CHANGE_BUCKETS) {
    bucketCounts.set(bucket.key, { partner: 0, others: 0 });
  }
  for (const member of purchasers) {
    if (member.supineChange === null) continue;
    const bucket = SUPINE_CHANGE_BUCKETS.find((b) => b.test(member.supineChange as number));
    if (!bucket) continue;
    const entry = bucketCounts.get(bucket.key) as { partner: number; others: number };
    if (member.brand === PARTNER_BRAND) entry.partner += 1;
    else entry.others += 1;
  }

  // Shares use band MIDPOINTS of released cells only: a suppressed cell
  // contributes nothing, and no share can be inverted into an exact count.
  let suppressedDistributionCells = 0;
  const releasedCells = new Map<string, { partner: ReleasedCount; others: ReleasedCount }>();
  let partnerMidpointTotal = 0;
  let othersMidpointTotal = 0;
  for (const bucket of SUPINE_CHANGE_BUCKETS) {
    const raw = bucketCounts.get(bucket.key) as { partner: number; others: number };
    const cell = { partner: bandCount(raw.partner), others: bandCount(raw.others) };
    releasedCells.set(bucket.key, cell);
    if (cell.partner.suppressed) suppressedDistributionCells += 1;
    else partnerMidpointTotal += bandMidpoint(cell.partner) ?? 0;
    if (cell.others.suppressed) suppressedDistributionCells += 1;
    else othersMidpointTotal += bandMidpoint(cell.others) ?? 0;
  }

  const distribution: DistributionCell[] = SUPINE_CHANGE_BUCKETS.map((bucket) => {
    const cell = releasedCells.get(bucket.key) as {
      partner: ReleasedCount;
      others: ReleasedCount;
    };
    const partnerMid = bandMidpoint(cell.partner);
    const othersMid = bandMidpoint(cell.others);
    return {
      bucket: bucket.key,
      partner: cell.partner,
      others: cell.others,
      partnerPct:
        partnerMid === null || partnerMidpointTotal === 0
          ? null
          : round1((partnerMid / partnerMidpointTotal) * 100),
      othersPct:
        othersMid === null || othersMidpointTotal === 0
          ? null
          : round1((othersMid / othersMidpointTotal) * 100),
    };
  });

  // --- model-line table (partner models only — other brands stay aggregate) ----
  const byLine = new Map<PartnerLine, ResearchMember[]>();
  for (const member of partner) {
    const line = member.model !== null ? partnerLineOf(member.model) : null;
    if (!line) continue;
    const list = byLine.get(line) ?? [];
    list.push(member);
    byLine.set(line, list);
  }
  const modelRows: ModelLineRow[] = PARTNER_LINES.map((line) => {
    const lineMembers = byLine.get(line) ?? [];
    const n = bandCount(lineMembers.length);
    return {
      line,
      n,
      meanSupineChange: n.suppressed
        ? null
        : roundedMean(lineMembers.map((m) => m.supineChange)),
      meanEssChange: n.suppressed
        ? null
        : roundedMean(lineMembers.map((m) => m.essChangeFollowup)),
    };
  });

  return {
    clockIso: clock.toISOString().slice(0, 10),
    partnerPurchasers: bandCount(partner.length),
    otherPurchasers: bandCount(others.length),
    tiles,
    distribution,
    suppressedDistributionCells,
    modelRows,
    suppressedModelRows: modelRows.filter((row) => row.n.suppressed).length,
    threshold: SMALL_CELL_THRESHOLD,
    queryMs,
  };
}

function roundedMean(values: (number | null)[]): number | null {
  const { mean } = meanOf(values);
  return mean === null ? null : round1(mean);
}

/**
 * Every count the dashboard releases, shaped for the release ledger — the
 * dashboard's release manifest (audit F-12: nothing leaves a partner surface
 * without a ledger row).
 */
export function dashboardReleaseRecords(
  dash: PartnerDashboard,
  clock: Date
): CountReleaseRecord[] {
  const query = "surface=partner_dashboard";
  const records: CountReleaseRecord[] = [
    releaseRecord("partner_dashboard", query, "partner_purchasers", dash.partnerPurchasers, clock),
    releaseRecord("partner_dashboard", query, "other_purchasers", dash.otherPurchasers, clock),
  ];
  for (const tile of dash.tiles) {
    records.push(
      releaseRecord("partner_dashboard", query, `tile:${tile.group}:supine_n`, tile.supineChange.n, clock),
      releaseRecord("partner_dashboard", query, `tile:${tile.group}:ess_n`, tile.essChange.n, clock)
    );
  }
  for (const cell of dash.distribution) {
    records.push(
      releaseRecord("partner_dashboard", query, `dist:${cell.bucket}:partner`, cell.partner, clock),
      releaseRecord("partner_dashboard", query, `dist:${cell.bucket}:others`, cell.others, clock)
    );
  }
  for (const row of dash.modelRows) {
    records.push(
      releaseRecord("partner_dashboard", query, `model:${row.line}:n`, row.n, clock)
    );
  }
  return records;
}

export async function loadPartnerDashboard(): Promise<PartnerDashboard> {
  const startedAt = performance.now();
  const cohort = await loadResearchCohort();
  const dash = buildPartnerDashboard(
    cohort.members,
    cohort.clock,
    Math.round(performance.now() - startedAt)
  );
  // Release-manifest linkage: every released count gets a ledger row.
  await recordCountReleases(dashboardReleaseRecords(dash, cohort.clock));
  return dash;
}
