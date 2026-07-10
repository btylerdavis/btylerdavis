import { describe, expect, it } from "vitest";
import { nPerGroup, parsePowerParams, POWER_DEFAULTS, zQuantile } from "./power";

/**
 * Power calculator vs the SPEC §6.3 sketch: "detecting a 10-percentage-point
 * reduction in supine sleep time (SD ≈ 20) with 80% power at α = 0.05 needs
 * ≈ 64 participants per comparison group". The normal approximation lands at
 * 63–64 depending on rounding — the calculator must land in that band.
 */

describe("zQuantile", () => {
  it("matches the standard normal quantiles used in power math", () => {
    expect(zQuantile(0.975)).toBeCloseTo(1.959964, 5);
    expect(zQuantile(0.8)).toBeCloseTo(0.841621, 5);
    expect(zQuantile(0.995)).toBeCloseTo(2.575829, 5);
    expect(zQuantile(0.5)).toBeCloseTo(0, 9);
    expect(zQuantile(0.025)).toBeCloseTo(-1.959964, 5);
    expect(() => zQuantile(0)).toThrow();
    expect(() => zQuantile(1)).toThrow();
  });
});

describe("nPerGroup", () => {
  it("reproduces the SPEC §6.3 sketch: 10 pp / SD 20 / α .05 / power .80 → ≈ 63–64 per group", () => {
    const n = nPerGroup(10, 20, 0.05, 0.8);
    expect(n).toBeGreaterThanOrEqual(63);
    expect(n).toBeLessThanOrEqual(64);
  });

  it("moves in the right direction with each input", () => {
    const base = nPerGroup(10, 20, 0.05, 0.8);
    expect(nPerGroup(5, 20, 0.05, 0.8)).toBeGreaterThan(base); // smaller effect → more n
    expect(nPerGroup(10, 30, 0.05, 0.8)).toBeGreaterThan(base); // noisier → more n
    expect(nPerGroup(10, 20, 0.01, 0.8)).toBeGreaterThan(base); // stricter α → more n
    expect(nPerGroup(10, 20, 0.05, 0.9)).toBeGreaterThan(base); // more power → more n
    expect(nPerGroup(20, 20, 0.05, 0.8)).toBeLessThan(base); // bigger effect → less n
    expect(() => nPerGroup(0, 20, 0.05, 0.8)).toThrow();
    expect(() => nPerGroup(10, 0, 0.05, 0.8)).toThrow();
  });
});

describe("parsePowerParams", () => {
  it("defaults to the SPEC sketch and clamps/validates everything else", () => {
    expect(parsePowerParams({})).toEqual(POWER_DEFAULTS);
    expect(
      parsePowerParams({ effect: "15", sd: "25", alpha: "0.01", power: "0.9" })
    ).toEqual({ effectPp: 15, sd: 25, alpha: 0.01, power: 0.9 });
    // Junk and out-of-range values fall back / clamp — the page never throws.
    expect(parsePowerParams({ effect: "nope", sd: "-4", alpha: "0.5", power: "2" })).toEqual({
      effectPp: POWER_DEFAULTS.effectPp,
      sd: 1,
      alpha: POWER_DEFAULTS.alpha,
      power: POWER_DEFAULTS.power,
    });
    expect(parsePowerParams({ effect: "999" }).effectPp).toBe(50);
  });
});
