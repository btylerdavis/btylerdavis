/**
 * Shared chart styling — the one place axis/grid/series styling lives so
 * every chart in the demo reads as one system, in the NEW Sleeptopia
 * design language palette (sleeptopia-site design/DIRECTION.md).
 *
 * Series colors: brand blue + deep gold is a blue/yellow-family pair — the
 * axis color-vision deficiency preserves — and both clear the 3:1 mark
 * floor on white (brand #3f92ce ≈ 3.4:1, gold #b07c1f ≈ 3.7:1). Every
 * multi-series chart still carries a legend and tooltips list every series
 * (secondary encoding, never color alone). sky is reserved for de-emphasis
 * (reference bands, funnel mid-steps) and is below 3:1 — always labeled.
 * navy stays ink-only (headings/axis text), never a mark. success/warning/
 * danger are semantic states (goal met, flags, therapy gaps) — never
 * identity.
 */

export const SERIES = {
  /** slot 1 — brand blue */
  primary: "#3f92ce",
  /** slot 2 — deep gold (the sun family, darkened to clear the 3:1 mark floor) */
  secondary: "#b07c1f",
  /** de-emphasis / reference — sky (below 3:1 contrast: always labeled) */
  soft: "#5faedd",
} as const;

export const SEMANTIC = {
  success: "#2e7d4f",
  warning: "#d97706",
  danger: "#b3261e",
} as const;

export const CHROME = {
  /** hairline grid, one warm step off the white surface */
  grid: "#ece7dc",
  /** axis line + tick marks — warm neutral */
  axis: "#8f8879",
  /** tick label ink (graphite) */
  tick: "#47505e",
  /** heading ink (navy) — text only, never a mark */
  ink: "#16304e",
  surface: "#ffffff",
} as const;

/** Ordered blue ramp for the funnel's ordinal steps (light → dark). */
export const BLUE_RAMP = ["#a9d6f0", "#5faedd", "#3f92ce", "#2c6ba0"] as const;

/** Generous, projector-friendly type sizes. */
export const FONT = { tick: 12, label: 13 } as const;

const MONTH_DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** "2026-06-30" → "Jun 30" for axis ticks. */
export function shortDay(dayIso: string): string {
  return MONTH_DAY.format(new Date(`${dayIso.slice(0, 10)}T00:00:00Z`));
}

/** ~6 evenly spaced tick positions across a day-keyed series. */
export function sparseDayTicks(days: string[], count = 6): string[] {
  if (days.length <= count) return days;
  const step = (days.length - 1) / (count - 1);
  const ticks: string[] = [];
  for (let i = 0; i < count; i++) ticks.push(days[Math.round(i * step)]);
  return [...new Set(ticks)];
}
