import { describe, expect, it } from "vitest";
import {
  approxRrFromStandardizedDifference,
  eValueForStandardizedDifference,
  eValueFromRr,
  meanCi95,
  pooledSd,
  standardizedDifference,
  Z_95,
} from "./stats";

/**
 * CI + E-value math (audit level-up 11): the numbers behind the flagship
 * error bars and the sensitivity note, checked against hand-computed values.
 */

describe("meanCi95 (normal-approximation confidence intervals)", () => {
  it("computes mean, sample SD, and the 95% half-width for a known sample", () => {
    const result = meanCi95([1, 2, 3, 4, 5]);
    expect(result.n).toBe(5);
    expect(result.mean).toBeCloseTo(3, 10);
    expect(result.sd).toBeCloseTo(Math.sqrt(2.5), 10); // (n−1) denominator
    // 1.959964 · 1.581139 / √5 = 1.38590…
    expect(result.ci95).toBeCloseTo((Z_95 * Math.sqrt(2.5)) / Math.sqrt(5), 10);
    expect(result.ci95).toBeCloseTo(1.3859, 4);
  });

  it("ignores nulls; n counts only contributors", () => {
    const result = meanCi95([null, 10, null, 20]);
    expect(result.n).toBe(2);
    expect(result.mean).toBe(15);
    expect(result.sd).toBeCloseTo(Math.sqrt(50), 10);
  });

  it("degenerate samples: empty → all null; single value → mean only", () => {
    expect(meanCi95([])).toEqual({ mean: null, sd: null, ci95: null, n: 0 });
    expect(meanCi95([null, null])).toEqual({ mean: null, sd: null, ci95: null, n: 0 });
    const single = meanCi95([7]);
    expect(single).toEqual({ mean: 7, sd: null, ci95: null, n: 1 });
  });

  it("CI shrinks with n (√n law)", () => {
    const small = meanCi95([0, 10, 0, 10]);
    const large = meanCi95(Array.from({ length: 100 }, (_, i) => (i % 2) * 10));
    expect(large.ci95 as number).toBeLessThan(small.ci95 as number);
    // Identical alternating spread at 25× the n → ~5× tighter interval.
    expect((small.ci95 as number) / (large.ci95 as number)).toBeGreaterThan(4);
    expect((small.ci95 as number) / (large.ci95 as number)).toBeLessThan(6.5);
  });
});

describe("pooled SD and standardized difference", () => {
  it("pooling two equal-SD groups returns that SD", () => {
    const a = meanCi95([0, 2, 4]); // sd = 2
    const b = meanCi95([10, 12, 14]); // sd = 2
    expect(pooledSd(a, b)).toBeCloseTo(2, 10);
    // d = (2 − 12) / 2 = −5
    expect(standardizedDifference(a, b)).toBeCloseTo(-5, 10);
    expect(standardizedDifference(b, a)).toBeCloseTo(5, 10);
  });

  it("returns null when a group has no spread information", () => {
    expect(standardizedDifference(meanCi95([1]), meanCi95([2, 3, 4]))).toBeNull();
    expect(pooledSd(meanCi95([]), meanCi95([2, 3]))).toBeNull();
  });
});

describe("E-value (VanderWeele & Ding 2017)", () => {
  it("RR = 1 → E = 1 (no association to explain)", () => {
    expect(eValueFromRr(1)).toBe(1);
  });

  it("matches the textbook formula RR + √(RR·(RR−1))", () => {
    expect(eValueFromRr(2)).toBeCloseTo(2 + Math.sqrt(2), 10); // ≈ 3.414
    expect(eValueFromRr(4)).toBeCloseTo(4 + Math.sqrt(12), 10); // ≈ 7.464
  });

  it("protective ratios are inverted first (symmetry)", () => {
    expect(eValueFromRr(0.5)).toBeCloseTo(eValueFromRr(2), 10);
    expect(eValueFromRr(0.25)).toBeCloseTo(eValueFromRr(4), 10);
  });

  it("is monotone in the ratio and rejects non-positive input", () => {
    expect(eValueFromRr(3)).toBeGreaterThan(eValueFromRr(2));
    expect(() => eValueFromRr(0)).toThrow(/positive/);
    expect(() => eValueFromRr(-1)).toThrow(/positive/);
    expect(() => eValueFromRr(Number.NaN)).toThrow(/positive/);
  });

  it("standardized-difference conversion: RR ≈ e^(0.91·|d|), sign-symmetric", () => {
    expect(approxRrFromStandardizedDifference(0)).toBe(1);
    expect(approxRrFromStandardizedDifference(1)).toBeCloseTo(Math.exp(0.91), 10);
    expect(approxRrFromStandardizedDifference(-1)).toBeCloseTo(Math.exp(0.91), 10);
  });

  it("composes end to end: a null effect explains itself; a large flagship-scale effect needs an implausible confounder", () => {
    const nullEffect = eValueForStandardizedDifference(0);
    expect(nullEffect.approxRr).toBe(1);
    expect(nullEffect.eValue).toBe(1);

    // The flagship delta is d ≈ 1.9 on the seeded cohort.
    const flagship = eValueForStandardizedDifference(1.9);
    expect(flagship.approxRr).toBeCloseTo(Math.exp(0.91 * 1.9), 10);
    expect(flagship.eValue).toBeGreaterThan(10);
  });
});
