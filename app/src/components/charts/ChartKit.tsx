"use client";

import type { ReactNode } from "react";
import { CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";
import type { TooltipContentProps } from "recharts";
import { formatDay } from "@/lib/format";
import { eventColor, planEventReferenceLines } from "./eventStyles";
import { CHROME, FONT, shortDay, sparseDayTicks } from "./theme";

/**
 * The thin shared wrapper around Recharts: every chart draws its axes, grid,
 * tooltip and treatment-event reference lines from here, so the whole demo
 * charts as one system — hairline grid, muted ticks, generous fonts, brand
 * series colors, values-first tooltips.
 */

// ---------------------------------------------------------------------------
// Axes & grid (shared prop factories — Recharts needs these as direct
// children, so we share props rather than wrapper components)
// ---------------------------------------------------------------------------

export function BrandGrid() {
  return <CartesianGrid stroke={CHROME.grid} strokeWidth={1} vertical={false} />;
}

export function DayAxis({ days }: { days: string[] }) {
  return (
    <XAxis
      dataKey="day"
      ticks={sparseDayTicks(days)}
      tickFormatter={shortDay}
      tick={{ fill: CHROME.tick, fontSize: FONT.tick }}
      axisLine={{ stroke: CHROME.grid }}
      tickLine={false}
      tickMargin={8}
      interval="preserveStartEnd"
    />
  );
}

export function ValueAxis({
  domain,
  unit,
  width = 44,
  tickFormatter,
}: {
  domain?: [number | "auto" | "dataMin", number | "auto" | "dataMax"];
  unit?: string;
  width?: number;
  tickFormatter?: (value: number) => string;
}) {
  return (
    <YAxis
      domain={domain ?? [0, "auto"]}
      unit={unit}
      width={width}
      tick={{ fill: CHROME.tick, fontSize: FONT.tick }}
      axisLine={false}
      tickLine={false}
      tickFormatter={tickFormatter}
    />
  );
}

// ---------------------------------------------------------------------------
// Tooltip — values lead, series names follow, line keys carry identity
// ---------------------------------------------------------------------------

export function NightTooltip({
  active,
  payload,
  label,
  unitByKey = {},
  labelOnlyKeys = [],
}: Partial<TooltipContentProps<number, string>> & {
  unitByKey?: Record<string, string>;
  /** series rendered as their name alone (e.g. therapy-gap marker bars) */
  labelOnlyKeys?: string[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const rows = payload.filter((entry) => entry.value !== null && entry.value !== undefined);
  if (rows.length === 0) return null;
  return (
    <div className="rounded-card border border-hairline bg-white px-3.5 py-2.5 shadow-lift">
      <p className="text-xs font-semibold text-graphite">
        {typeof label === "string" && /^\d{4}-\d{2}-\d{2}/.test(label)
          ? formatDay(label)
          : String(label ?? "")}
      </p>
      <ul className="mt-1 space-y-0.5">
        {rows.map((entry) => {
          const key = String(entry.dataKey);
          if (labelOnlyKeys.includes(key)) {
            return (
              <li key={key} className="text-sm font-semibold text-danger">
                {entry.name}
              </li>
            );
          }
          return (
            <li key={key} className="flex items-baseline gap-2 text-sm">
              <span
                aria-hidden
                className="inline-block h-0.5 w-4 shrink-0 self-center rounded-full"
                style={{ background: entry.color ?? CHROME.ink }}
              />
              <span className="font-semibold text-navy">
                {typeof entry.value === "number" ? formatValue(entry.value) : entry.value}
                {unitByKey[key] ?? ""}
              </span>
              <span className="text-xs text-graphite">{entry.name}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString("en-US") : value.toFixed(1);
}

// ---------------------------------------------------------------------------
// Legend — plain HTML above the plot; present whenever ≥ 2 series
// ---------------------------------------------------------------------------

export type LegendKind = "line" | "rect" | "hollow" | "ref";

export interface LegendItem {
  label: string;
  color: string;
  kind: LegendKind;
}

export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5 text-xs font-medium text-ink">
          <LegendSwatch item={item} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function LegendSwatch({ item }: { item: LegendItem }) {
  if (item.kind === "line") {
    return (
      <span
        aria-hidden
        className="inline-block h-0.5 w-4 rounded-full"
        style={{ background: item.color }}
      />
    );
  }
  if (item.kind === "ref") {
    return (
      <span
        aria-hidden
        className="inline-block h-3.5 w-0 border-l-2 border-dashed"
        style={{ borderColor: item.color }}
      />
    );
  }
  if (item.kind === "hollow") {
    return (
      <span
        aria-hidden
        className="inline-block h-3 w-3 rounded-[3px] border-[1.5px] bg-transparent"
        style={{ borderColor: item.color }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 rounded-[3px]"
      style={{ background: item.color }}
    />
  );
}

// ---------------------------------------------------------------------------
// Treatment-event reference lines — the before/after anchor every trend
// chart shares (TreatmentTimeline carries the full labels)
// ---------------------------------------------------------------------------

export interface ChartEvent {
  /** ISO day, must exist in the chart's day series to draw */
  day: string;
  type: string;
  label: string;
}

/**
 * ReferenceLine elements for events inside the charted window, laid out by
 * planEventReferenceLines: events within 3 days share one combined label
 * (Marcus: mattress day 13 + CPAP day 14 → "Mattress + CPAP"), and label
 * anchors still near each other stagger vertically — no collisions.
 */
export function eventReferenceLines(events: ChartEvent[], days: string[]): ReactNode[] {
  const inWindow = events.filter((event) => days.includes(event.day));
  return planEventReferenceLines(inWindow).map((line) => (
    <ReferenceLine
      key={`${line.type}-${line.day}`}
      x={line.day}
      stroke={eventColor(line.type)}
      strokeWidth={1.5}
      strokeDasharray="4 3"
      label={
        line.label === null
          ? undefined
          : {
              value: line.label,
              position: "insideTop",
              dy: line.dy,
              fill: eventColor(line.type),
              fontSize: FONT.tick,
              fontWeight: 600,
            }
      }
    />
  ));
}
