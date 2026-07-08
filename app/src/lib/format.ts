/** Shared display formatting for sim-clock dates (UTC days). */

const DAY_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** "2026-06-30" or a Date → "June 30, 2026". */
export function formatDay(day: string | Date): string {
  const date = typeof day === "string" ? new Date(`${day.slice(0, 10)}T00:00:00Z`) : day;
  return DAY_FORMAT.format(date);
}

export function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function shortId(id: string): string {
  return `${id.slice(0, 8)}…`;
}
