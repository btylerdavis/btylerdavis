/**
 * Revenue-model calculator (DEMO.md Act 7 reserve → working; SPEC §12.4
 * revenue model vs the §3.5 month-36 self-funding bar). Pure arithmetic on
 * URL-param assumptions — no cohort data involved, works fully offline. The
 * §12.4 bands are deliberately rough, and the card says so; the calculator's
 * one honest claim is the comparison against a configurable operating-cost
 * line: §3.5 calls the business engine successful when partner revenue
 * covers platform operating costs by month 36.
 */

export interface RevenueLineDef {
  key: "studies" | "subscriptions" | "validations";
  label: string;
  unit: string;
  /** SPEC §12.4 band for the per-unit price (display + input hint) */
  band: { min: number; max: number; basis: string };
  defaults: { count: number; price: number };
  maxCount: number;
}

export const REVENUE_LINES: RevenueLineDef[] = [
  {
    key: "studies",
    label: "Sponsored studies",
    unit: "per study",
    band: {
      min: 50_000,
      max: 250_000,
      basis: "mid five to six figures per study (SPEC §12.4)",
    },
    defaults: { count: 3, price: 150_000 },
    maxCount: 20,
  },
  {
    key: "subscriptions",
    label: "Analytics subscriptions",
    unit: "per partner · year",
    band: {
      min: 10_000,
      max: 50_000,
      basis: "low-to-mid five figures annually per partner (SPEC §12.4)",
    },
    defaults: { count: 4, price: 30_000 },
    maxCount: 50,
  },
  {
    key: "validations",
    label: "Validation studies",
    unit: "per study",
    band: {
      min: 40_000,
      max: 120_000,
      basis: "no numeric band in SPEC §12.4 — demo assumption",
    },
    defaults: { count: 1, price: 60_000 },
    maxCount: 20,
  },
];

/** Annual platform operating cost — a pure assumption, editable on the card. */
export const DEFAULT_OPERATING_COST = 600_000;
export const MAX_OPERATING_COST = 10_000_000;
export const MAX_UNIT_PRICE = 1_000_000;

export interface RevenueModelInputs {
  studies: { count: number; price: number };
  subscriptions: { count: number; price: number };
  validations: { count: number; price: number };
  operatingCost: number;
}

export const REVENUE_PARAM_KEYS = {
  studies: { count: "st", price: "stp" },
  subscriptions: { count: "sub", price: "subp" },
  validations: { count: "val", price: "valp" },
  operatingCost: "opex",
} as const;

/** Parses ?st=&stp=&sub=&subp=&val=&valp=&opex= (clamped, demo defaults). */
export function parseRevenueModelParams(
  params: Record<string, string | string[] | undefined>
): RevenueModelInputs {
  const parse = (key: string, fallback: number, max: number): number => {
    const raw = params[key];
    const value = typeof raw === "string" ? Number(raw) : NaN;
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(0, Math.round(value)));
  };
  const line = (def: RevenueLineDef) => ({
    count: parse(REVENUE_PARAM_KEYS[def.key].count, def.defaults.count, def.maxCount),
    price: parse(REVENUE_PARAM_KEYS[def.key].price, def.defaults.price, MAX_UNIT_PRICE),
  });
  const [studies, subscriptions, validations] = REVENUE_LINES.map(line);
  return {
    studies,
    subscriptions,
    validations,
    operatingCost: parse(
      REVENUE_PARAM_KEYS.operatingCost,
      DEFAULT_OPERATING_COST,
      MAX_OPERATING_COST
    ),
  };
}

export interface RevenueLineResult {
  key: RevenueLineDef["key"];
  label: string;
  count: number;
  price: number;
  total: number;
  band: RevenueLineDef["band"];
  unit: string;
}

export interface RevenueModelResult {
  lines: RevenueLineResult[];
  totalRevenue: number;
  operatingCost: number;
  /** revenue − operating cost (negative = gap to self-funding) */
  surplus: number;
  /** % of the operating-cost line covered (capped at 999 for display) */
  coveragePct: number;
  /** the §3.5 month-36 bar: partner revenue ≥ operating costs */
  selfFunding: boolean;
}

export function computeRevenueModel(inputs: RevenueModelInputs): RevenueModelResult {
  const lines: RevenueLineResult[] = REVENUE_LINES.map((def) => {
    const { count, price } = inputs[def.key];
    return {
      key: def.key,
      label: def.label,
      count,
      price,
      total: count * price,
      band: def.band,
      unit: def.unit,
    };
  });
  const totalRevenue = lines.reduce((sum, line) => sum + line.total, 0);
  const operatingCost = inputs.operatingCost;
  const coveragePct =
    operatingCost > 0 ? Math.min(999, Math.round((totalRevenue / operatingCost) * 100)) : 999;
  return {
    lines,
    totalRevenue,
    operatingCost,
    surplus: totalRevenue - operatingCost,
    coveragePct,
    selfFunding: totalRevenue >= operatingCost && operatingCost > 0,
  };
}
