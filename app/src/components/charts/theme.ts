/**
 * Shared chart styling — the one place axis/grid/series styling lives so
 * every chart in the demo reads as one system (dataviz skill applied to
 * branding/tokens.json).
 *
 * Series colors are validated (scripts/validate_palette.js, light surface):
 * brandBlue + accentPurple pass as a two-series pair in the CVD floor band,
 * which is legal ONLY with secondary encoding — so every multi-series chart
 * here carries a legend and tooltips list every series. skyBlue is reserved
 * for de-emphasis (reference bands, funnel mid-steps); primaryNavy failed
 * the chroma floor as a mark color and stays ink-only. success/warning/
 * danger are semantic states (goal met, flags, therapy gaps) — never
 * identity.
 */

export const SERIES = {
  /** slot 1 — brandBlue */
  primary: "#3f92ce",
  /** slot 2 — accentPurple */
  secondary: "#8a5ec1",
  /** de-emphasis / reference — skyBlue (below 3:1 contrast: always labeled) */
  soft: "#5faedd",
} as const;

export const SEMANTIC = {
  success: "#2e8b57",
  warning: "#d97706",
  danger: "#b91c1c",
} as const;

export const CHROME = {
  /** hairline grid, one step off the white surface */
  grid: "#e3eef7",
  /** axis line + tick ink */
  axis: "#94a3b8",
  /** tick label ink (textMuted) */
  tick: "#64748b",
  /** heading ink (primaryNavy) — text only, never a mark */
  ink: "#1b4a7a",
  surface: "#ffffff",
} as const;

/** Ordered blue ramp for the funnel's ordinal steps (light → dark). */
export const BLUE_RAMP = ["#a9d9ef", "#5faedd", "#3f92ce", "#2b6da0"] as const;

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
