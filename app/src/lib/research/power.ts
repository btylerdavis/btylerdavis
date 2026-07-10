/**
 * Two-sample power calculator (SPEC §6.3 power sketch, made interactive).
 * Normal-approximation sample size for detecting a difference in means:
 *
 *   n per group = 2 · ((z₁₋α/2 + z₁₋β) · SD / Δ)²
 *
 * With the SPEC sketch's inputs — Δ = 10 pp supine-time reduction, SD ≈ 20,
 * α = 0.05, power = 0.80 — this gives ≈ 63–64 participants per comparison
 * group, which is exactly the number §6.3 sizes the instrumented cohort in
 * multiples of (§13 Phase 2 exit: ≥ 2× the power target). Pure functions,
 * no network, unit-tested against the sketch.
 */

export const POWER_DEFAULTS = {
  effectPp: 10,
  sd: 20,
  alpha: 0.05,
  power: 0.8,
} as const;

export const ALPHA_OPTIONS = [0.01, 0.05, 0.1] as const;
export const POWER_OPTIONS = [0.8, 0.85, 0.9] as const;

/**
 * Inverse standard-normal CDF (quantile function), Acklam's rational
 * approximation — |relative error| < 1.15e-9 over (0, 1), far below what a
 * sample-size calculation can notice.
 */
export function zQuantile(p: number): number {
  if (!(p > 0 && p < 1)) throw new Error(`zQuantile: p must be in (0,1), got ${p}`);

  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const pLow = 0.02425;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > 1 - pLow) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

/**
 * n per group (two-sided two-sample normal approximation), rounded UP —
 * a fraction of a participant still has to be enrolled whole.
 */
export function nPerGroup(effectPp: number, sd: number, alpha: number, power: number): number {
  if (effectPp <= 0) throw new Error("nPerGroup: effect size must be > 0");
  if (sd <= 0) throw new Error("nPerGroup: SD must be > 0");
  const z = zQuantile(1 - alpha / 2) + zQuantile(power);
  return Math.ceil(2 * ((z * sd) / effectPp) ** 2);
}

export interface PowerInputs {
  effectPp: number;
  sd: number;
  alpha: number;
  power: number;
}

/** Parses ?effect=&sd=&alpha=&power= URL params (clamped, demo defaults). */
export function parsePowerParams(
  params: Record<string, string | string[] | undefined>
): PowerInputs {
  const num = (key: string): number | undefined => {
    const raw = params[key];
    const value = typeof raw === "string" ? Number(raw) : NaN;
    return Number.isFinite(value) ? value : undefined;
  };
  const clamp = (value: number | undefined, fallback: number, min: number, max: number) =>
    value === undefined ? fallback : Math.min(max, Math.max(min, value));
  const oneOf = (value: number | undefined, allowed: readonly number[], fallback: number) =>
    value !== undefined && allowed.includes(value) ? value : fallback;
  return {
    effectPp: clamp(num("effect"), POWER_DEFAULTS.effectPp, 1, 50),
    sd: clamp(num("sd"), POWER_DEFAULTS.sd, 1, 100),
    alpha: oneOf(num("alpha"), ALPHA_OPTIONS, POWER_DEFAULTS.alpha),
    power: oneOf(num("power"), POWER_OPTIONS, POWER_DEFAULTS.power),
  };
}
