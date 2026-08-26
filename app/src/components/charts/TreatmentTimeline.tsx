import { formatDay } from "@/lib/format";
import { eventColor } from "./eventStyles";

/**
 * The treatment timeline band — the before/after visual anchor for the
 * trends page. Spans enrollment → sim today; markers are TreatmentEvents,
 * labels alternate above/below the track so near-simultaneous events
 * (Marcus: mattress day 13, CPAP day 14) stay readable. Pure HTML/CSS — no
 * chart library needed for a band.
 */

export interface TimelineEvent {
  day: string; // ISO day
  type: string;
  label: string;
}

function pctBetween(startMs: number, endMs: number, dayIso: string): number {
  const t = new Date(`${dayIso.slice(0, 10)}T00:00:00Z`).getTime();
  if (endMs <= startMs) return 0;
  const pct = ((t - startMs) / (endMs - startMs)) * 100;
  return Math.min(97, Math.max(3, pct));
}

export function TreatmentTimeline({
  startIso,
  endIso,
  events,
}: {
  startIso: string;
  endIso: string;
  events: TimelineEvent[];
}) {
  const startMs = new Date(`${startIso.slice(0, 10)}T00:00:00Z`).getTime();
  const endMs = new Date(`${endIso.slice(0, 10)}T00:00:00Z`).getTime();
  const sorted = [...events].sort((a, b) => a.day.localeCompare(b.day));

  return (
    <div>
      <div className="relative h-24">
        {/* track */}
        <div className="absolute top-1/2 right-0 left-0 h-0.5 -translate-y-1/2 rounded-full bg-cream" />
        {/* enrollment + today endpoints */}
        <Endpoint side="left" title="Enrolled" dayIso={startIso} />
        <Endpoint side="right" title="Today (sim)" dayIso={endIso} />
        {sorted.map((event, index) => {
          const left = `${pctBetween(startMs, endMs, event.day)}%`;
          const above = index % 2 === 0;
          const color = eventColor(event.type);
          return (
            <div
              key={`${event.type}-${event.day}`}
              className="absolute top-1/2 -translate-x-1/2"
              style={{ left }}
            >
              <span
                aria-hidden
                className="absolute top-0 left-1/2 block h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-sm"
                style={{ background: color }}
              />
              <div
                className={`absolute left-1/2 w-max max-w-28 -translate-x-1/2 text-center ${
                  above ? "bottom-3.5" : "top-3.5"
                }`}
              >
                <p className="text-xs leading-tight font-semibold text-navy">{event.label}</p>
                <p className="text-[11px] text-graphite">{formatDay(event.day)}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Endpoint({
  side,
  title,
  dayIso,
}: {
  side: "left" | "right";
  title: string;
  dayIso: string;
}) {
  return (
    <div
      className={`absolute top-1/2 ${side === "left" ? "left-0" : "right-0"}`}
    >
      <span
        aria-hidden
        className="absolute top-0 block h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-navy"
        style={side === "left" ? { left: 0 } : { right: 0 }}
      />
      <div
        className={`absolute top-3.5 w-max ${side === "left" ? "left-0 text-left" : "right-0 text-right"}`}
      >
        <p className="text-xs font-semibold text-navy">{title}</p>
        <p className="text-[11px] text-graphite">{formatDay(dayIso)}</p>
      </div>
    </div>
  );
}
