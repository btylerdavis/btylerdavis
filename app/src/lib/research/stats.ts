/**
 * Small-sample statistics for the research bias & robustness views (audit
 * level-up 11): normal-approximation 95% confidence intervals for the
 * flagship comparisons, and the VanderWeele–Ding E-value for the sensitivity
 * note. Pure functions, no database, unit-tested in stats.test.ts.
 */

/** z for a two-sided 95% interval (normal approximation). */
export const Z_95 = 1.959963985;

export interface MeanCi {
  mean: number | null;
  /** sample standard deviation (n−1 denominator); null when n < 2 */
  sd: number | null;
  /** 95% CI half-width, Z_95 · sd / √n; null when n < 2 */
  ci95: number | null;
  n: number;
}

/**
 * Mean, sample SD, and 95% CI half-width over the non-null values.
 * n = 0 → all-null result; n = 1 → mean only (no spread to estimate).
 */
export function meanCi95(values: (number | null)[]): MeanCi {
  const present = values.filter((value): value is number => value !== null);
  const n = present.length;
  if (n === 0) return { mean: null, sd: null, ci95: null, n: 0 };
  const mean = present.reduce((sum, value) => sum + value, 0) / n;
  if (n < 2) return { mean, sd: null, ci95: null, n };
  const sd = Math.sqrt(
    present.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1)
  );
  return { mean, sd, ci95: (Z_95 * sd) / Math.sqrt(n), n };
}

/** Pooled (two-group) sample SD; null unless both groups have spread. */
export function pooledSd(a: MeanCi, b: MeanCi): number | null {
  if (a.sd === null || b.sd === null || a.n + b.n < 3) return null;
  return Math.sqrt(
    ((a.n - 1) * a.sd ** 2 + (b.n - 1) * b.sd ** 2) / (a.n + b.n - 2)
  );
}

/**
 * Standardized mean difference (Cohen's d, pooled SD): (a − b) / SDpooled.
 */
export function standardizedDifference(a: MeanCi, b: MeanCi): number | null {
  const sd = pooledSd(a, b);
  if (sd === null || sd === 0 || a.mean === null || b.mean === null) return null;
  return (a.mean - b.mean) / sd;
}

/**
 * Approximate risk-ratio for a standardized mean difference d
 * (VanderWeele & Ding 2017: RR ≈ exp(0.91 · d)). Sign is dropped — the
 * E-value is symmetric in the effect's direction.
 */
export function approxRrFromStandardizedDifference(d: number): number {
  return Math.exp(0.91 * Math.abs(d));
}

/**
 * E-value for a risk ratio (VanderWeele & Ding 2017): the minimum strength
 * of association, on the risk-ratio scale, that an unmeasured confounder
 * would need with BOTH the exposure and the outcome to fully explain the
 * observed association. RR = 1 → E = 1 (nothing to explain); protective
 * ratios are inverted first.
 */
export function eValueFromRr(rr: number): number {
  if (!Number.isFinite(rr) || rr <= 0) {
    throw new Error(`eValueFromRr: risk ratio must be a positive number, got ${rr}`);
  }
  const ratio = rr >= 1 ? rr : 1 / rr;
  return ratio + Math.sqrt(ratio * (ratio - 1));
}

export interface EValueResult {
  /** standardized difference the E-value was derived from */
  d: number;
  /** approximate risk ratio, exp(0.91·|d|) */
  approxRr: number;
  eValue: number;
}

/**
 * E-value for a standardized mean difference — the one-call form the
 * sensitivity note uses: d → approximate RR → E-value.
 */
export function eValueForStandardizedDifference(d: number): EValueResult {
  const approxRr = approxRrFromStandardizedDifference(d);
  return { d, approxRr, eValue: eValueFromRr(approxRr) };
}
