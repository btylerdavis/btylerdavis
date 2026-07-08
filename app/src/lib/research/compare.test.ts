import { describe, expect, it } from "vitest";
import { ARM_ORDER } from "./cohort";
import { computeArmComparisons, type ArmMemberInput } from "./compare";

/** Unit tests for the treatment-comparison precompute (pure, no DB). */

const member = (overrides: Partial<ArmMemberInput>): ArmMemberInput => ({
  arm: "cpap",
  age: 55,
  severity: "moderate",
  ahi: 20,
  essChange90: -3,
  seffChange: 2,
  ...overrides,
});

describe("computeArmComparisons", () => {
  it("returns every arm in stable order, including empty groups", () => {
    const result = computeArmComparisons([member({ arm: "cpap" })]);
    expect(result.map((group) => group.arm)).toEqual(ARM_ORDER);
    const appliance = result.find((group) => group.arm === "appliance");
    expect(appliance?.n).toBe(0);
    expect(appliance?.essChange).toEqual({ mean: null, n: 0 });
    expect(appliance?.covariates.meanAge).toBeNull();
  });

  it("computes outcome means per arm with per-outcome n", () => {
    const result = computeArmComparisons([
      member({ arm: "cpap", essChange90: -4, seffChange: 3 }),
      member({ arm: "cpap", essChange90: -2, seffChange: 1 }),
      member({ arm: "mattress_only", essChange90: -1, seffChange: 0.5 }),
    ]);
    const cpap = result.find((group) => group.arm === "cpap")!;
    expect(cpap.n).toBe(2);
    expect(cpap.essChange).toEqual({ mean: -3, n: 2 });
    expect(cpap.seffChange).toEqual({ mean: 2, n: 2 });
    const mattress = result.find((group) => group.arm === "mattress_only")!;
    expect(mattress.essChange).toEqual({ mean: -1, n: 1 });
  });

  it("drops null outcomes from means but keeps the member in n and covariates", () => {
    const result = computeArmComparisons([
      member({ arm: "appliance", essChange90: -2, age: 40 }),
      member({ arm: "appliance", essChange90: null, age: 60 }),
    ]);
    const appliance = result.find((group) => group.arm === "appliance")!;
    expect(appliance.n).toBe(2);
    expect(appliance.essChange).toEqual({ mean: -2, n: 1 });
    expect(appliance.covariates.meanAge).toBe(50);
  });

  it("summarizes covariates: mean age, mean baseline AHI, severity mix", () => {
    const result = computeArmComparisons([
      member({ arm: "cpap_mattress", age: 50, ahi: 35, severity: "severe" }),
      member({ arm: "cpap_mattress", age: 54, ahi: 25, severity: "moderate" }),
      member({ arm: "cpap_mattress", age: 58, ahi: null, severity: "moderate" }),
    ]);
    const group = result.find((candidate) => candidate.arm === "cpap_mattress")!;
    expect(group.covariates.meanAge).toBe(54);
    expect(group.covariates.meanAhi).toEqual({ mean: 30, n: 2 });
    expect(group.covariates.severityPct).toEqual({ mild: 0, moderate: 67, severe: 33 });
    expect(group.covariates.severityN).toBe(3);
  });

  it("excludes unknown-severity members from the severity mix denominator", () => {
    const result = computeArmComparisons([
      member({ arm: "appliance_mattress", severity: "mild" }),
      member({ arm: "appliance_mattress", severity: null }),
    ]);
    const group = result.find((candidate) => candidate.arm === "appliance_mattress")!;
    expect(group.covariates.severityN).toBe(1);
    expect(group.covariates.severityPct.mild).toBe(100);
  });
});
