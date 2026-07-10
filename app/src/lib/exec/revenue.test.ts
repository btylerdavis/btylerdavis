import { describe, expect, it } from "vitest";
import {
  computeRevenueModel,
  DEFAULT_OPERATING_COST,
  parseRevenueModelParams,
  REVENUE_LINES,
} from "./revenue";

/**
 * Revenue-model calculator (SPEC §12.4 vs the §3.5 month-36 bar): pure
 * arithmetic, URL-param parsing with clamps, and the self-funding verdict
 * defined exactly as §3.5 defines it — partner revenue ≥ operating costs.
 */

describe("parseRevenueModelParams", () => {
  it("uses the demo defaults when params are absent or junk", () => {
    const defaults = parseRevenueModelParams({});
    expect(defaults.studies).toEqual({ count: 3, price: 150_000 });
    expect(defaults.subscriptions).toEqual({ count: 4, price: 30_000 });
    expect(defaults.validations).toEqual({ count: 1, price: 60_000 });
    expect(defaults.operatingCost).toBe(DEFAULT_OPERATING_COST);
    expect(parseRevenueModelParams({ st: "junk", opex: "nope" })).toEqual(defaults);
  });

  it("clamps counts, prices and opex into sane demo ranges", () => {
    const parsed = parseRevenueModelParams({
      st: "999",
      stp: "99999999",
      sub: "-5",
      subp: "12500.7",
      opex: "-1",
    });
    expect(parsed.studies.count).toBe(20); // max studies/yr
    expect(parsed.studies.price).toBe(1_000_000); // max unit price
    expect(parsed.subscriptions.count).toBe(0); // floor
    expect(parsed.subscriptions.price).toBe(12_501); // rounded
    expect(parsed.operatingCost).toBe(0);
  });
});

describe("computeRevenueModel", () => {
  it("defaults land just over the §3.5 month-36 bar (630k revenue vs 600k opex)", () => {
    const model = computeRevenueModel(parseRevenueModelParams({}));
    expect(model.totalRevenue).toBe(3 * 150_000 + 4 * 30_000 + 1 * 60_000); // 630,000
    expect(model.operatingCost).toBe(600_000);
    expect(model.surplus).toBe(30_000);
    expect(model.selfFunding).toBe(true);
    expect(model.coveragePct).toBe(105);
    expect(model.lines.map((line) => line.total)).toEqual([450_000, 120_000, 60_000]);
  });

  it("flags the gap when revenue falls short, and never divides by zero", () => {
    const short = computeRevenueModel(
      parseRevenueModelParams({ st: "1", sub: "1", val: "0", opex: "600000" })
    );
    expect(short.totalRevenue).toBe(180_000);
    expect(short.selfFunding).toBe(false);
    expect(short.surplus).toBe(-420_000);
    expect(short.coveragePct).toBe(30);

    const zeroOpex = computeRevenueModel(parseRevenueModelParams({ opex: "0" }));
    expect(zeroOpex.selfFunding).toBe(false); // no bar to clear ≠ cleared
    expect(zeroOpex.coveragePct).toBe(999); // display cap, no Infinity
  });

  it("every §12.4 line carries its band so the card can show honest ranges", () => {
    for (const line of REVENUE_LINES) {
      expect(line.band.min).toBeGreaterThan(0);
      expect(line.band.max).toBeGreaterThan(line.band.min);
      expect(line.band.basis.length).toBeGreaterThan(0);
      expect(line.defaults.price).toBeGreaterThanOrEqual(line.band.min);
      expect(line.defaults.price).toBeLessThanOrEqual(line.band.max);
    }
  });
});
