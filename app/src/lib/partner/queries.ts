import {
  buildSuppressedTable,
  suppressCount,
  SMALL_CELL_THRESHOLD,
  type SuppressedCell,
} from "../deid";
import { loadResearchCohort, meanOf, type ResearchMember } from "../research/cohort";

/**
 * Partner portal aggregates (DEMO.md Act 7; SPEC §12.3 rules of engagement).
 * The Tempur-Sealy view consumes ONLY the research-tier cohort
 * (research_deid consent scope, via loadResearchCohort) and releases every
 * count through the de-identification suppression helpers: no names, no
 * participant ids, no cell under k=<SMALL_CELL_THRESHOLD>. Rows and cells
 * under the threshold are shown AS suppressed — the DUA made visible.
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
  /** released n (suppressed display when 1 ≤ n < k) */
  n: SuppressedCell;
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
  partner: SuppressedCell;
  others: SuppressedCell;
  /** shares of each group's released total (null when the cell is suppressed) */
  partnerPct: number | null;
  othersPct: number | null;
}

export interface ModelLineRow {
  line: PartnerLine;
  n: SuppressedCell;
  meanSupineChange: number | null;
  meanEssChange: number | null;
}

export interface PartnerDashboard {
  clockIso: string;
  /** purchasers visible to the research tier (consent-filtered) */
  partnerPurchasers: SuppressedCell;
  otherPurchasers: SuppressedCell;
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
  const cell = suppressCount(n);
  return { n: cell, mean: cell.suppressed || mean === null ? null : round1(mean) };
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
  const entries: { row: string; col: string }[] = [];
  for (const member of purchasers) {
    if (member.supineChange === null) continue;
    const bucket = SUPINE_CHANGE_BUCKETS.find((b) => b.test(member.supineChange as number));
    if (!bucket) continue;
    entries.push({
      row: bucket.key,
      col: member.brand === PARTNER_BRAND ? PARTNER_BRAND : CATEGORY_LABEL,
    });
  }
  const table = buildSuppressedTable(entries, {
    rowKeys: SUPINE_CHANGE_BUCKETS.map((b) => b.key),
    colKeys: [PARTNER_BRAND, CATEGORY_LABEL],
  });

  // Percentages use only RELEASED counts, so a suppressed cell leaks nothing
  // through the other cells' shares.
  const releasedTotal = (col: string) =>
    table.rowKeys.reduce((sum, row) => {
      const cell = table.cells[row][col];
      return cell.suppressed ? sum : sum + parseReleased(cell);
    }, 0);
  const partnerTotal = releasedTotal(PARTNER_BRAND);
  const othersTotal = releasedTotal(CATEGORY_LABEL);

  const distribution: DistributionCell[] = table.rowKeys.map((bucket) => {
    const partnerCell = table.cells[bucket][PARTNER_BRAND];
    const othersCell = table.cells[bucket][CATEGORY_LABEL];
    return {
      bucket,
      partner: partnerCell,
      others: othersCell,
      partnerPct:
        partnerCell.suppressed || partnerTotal === 0
          ? null
          : round1((parseReleased(partnerCell) / partnerTotal) * 100),
      othersPct:
        othersCell.suppressed || othersTotal === 0
          ? null
          : round1((parseReleased(othersCell) / othersTotal) * 100),
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
    const n = suppressCount(lineMembers.length);
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
    partnerPurchasers: suppressCount(partner.length),
    otherPurchasers: suppressCount(others.length),
    tiles,
    distribution,
    suppressedDistributionCells: table.suppressedCellCount,
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

/** Numeric value of a NON-suppressed cell ("1,234" → 1234). */
function parseReleased(cell: SuppressedCell): number {
  return Number(cell.display.replace(/,/g, ""));
}

export async function loadPartnerDashboard(): Promise<PartnerDashboard> {
  const startedAt = performance.now();
  const cohort = await loadResearchCohort();
  return buildPartnerDashboard(
    cohort.members,
    cohort.clock,
    Math.round(performance.now() - startedAt)
  );
}
