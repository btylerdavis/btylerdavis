"use client";

import {
  Bar,
  BarChart,
  ComposedChart,
  LabelList,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import {
  BrandGrid,
  ChartLegend,
  DayAxis,
  eventReferenceLines,
  NightTooltip,
  ValueAxis,
  type ChartEvent,
} from "./ChartKit";
import { CHROME, FONT, SEMANTIC, SERIES } from "./theme";

/**
 * The participant-trends charts (DEMO.md Act 4, "three views of Marcus").
 * All data arrives pre-aggregated and serializable from the server
 * component; every chart shares the treatment-event reference lines as its
 * before/after anchor. Measures with different units never share a y-axis —
 * paired measures render as stacked, captioned panels over the same nights.
 */

export interface NightValue {
  day: string;
  value: number | null;
}

const LINE_PROPS = {
  type: "monotone" as const,
  strokeWidth: 2,
  dot: false,
  activeDot: { r: 4.5, strokeWidth: 2, stroke: CHROME.surface },
  connectNulls: false,
  isAnimationActive: false,
};

const CURSOR = { stroke: CHROME.axis, strokeWidth: 1 };

function toSeries(points: NightValue[], key: string): Record<string, string | number | null>[] {
  return points.map((point) => ({ day: point.day, [key]: point.value }));
}

/** One captioned single-series line panel (its caption names the series). */
function LinePanel({
  points,
  caption,
  color,
  unit,
  domain,
  events,
  withEventLabels,
  refAreaBelow,
}: {
  points: NightValue[];
  caption: string;
  color: string;
  unit: string;
  domain: [number | "auto" | "dataMin", number | "auto" | "dataMax"];
  events: ChartEvent[];
  withEventLabels: boolean;
  refAreaBelow?: { y: number; label: string };
}) {
  const days = points.map((point) => point.day);
  const data = toSeries(points, "value");
  return (
    <div>
      <p className="text-xs font-semibold tracking-wide text-graphite uppercase">{caption}</p>
      <div className="mt-1 h-44">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 18, right: 8, bottom: 0, left: 0 }}>
            <BrandGrid />
            <DayAxis days={days} />
            <ValueAxis domain={domain} />
            {refAreaBelow && (
              <ReferenceArea
                y1={domain[0] === "auto" ? undefined : (domain[0] as number)}
                y2={refAreaBelow.y}
                fill={SEMANTIC.danger}
                fillOpacity={0.07}
                stroke="none"
                label={{
                  value: refAreaBelow.label,
                  position: "insideBottomRight",
                  fill: SEMANTIC.danger,
                  fontSize: FONT.tick,
                  fontWeight: 600,
                }}
              />
            )}
            {eventReferenceLines(withEventLabels ? events : stripLabels(events), days)}
            <Tooltip
              content={<NightTooltip unitByKey={{ value: unit }} />}
              cursor={CURSOR}
              isAnimationActive={false}
            />
            <Line dataKey="value" name={caption} stroke={color} {...LINE_PROPS} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Same events with empty labels — lower panels share the anchor quietly. */
function stripLabels(events: ChartEvent[]): ChartEvent[] {
  return events.map((event) => ({ ...event, label: "" }));
}

// ---------------------------------------------------------------------------
// Sleep: duration + efficiency (two units → two aligned panels)
// ---------------------------------------------------------------------------

export function SleepChart({
  duration,
  efficiency,
  events,
}: {
  duration: NightValue[];
  efficiency: NightValue[];
  events: ChartEvent[];
}) {
  return (
    <div className="space-y-4">
      <LinePanel
        points={duration}
        caption="Sleep duration (h)"
        color={SERIES.primary}
        unit=" h"
        domain={[0, 12]}
        events={events}
        withEventLabels
      />
      <LinePanel
        points={efficiency}
        caption="Sleep efficiency (%)"
        color={SERIES.secondary}
        unit="%"
        domain={[50, 100]}
        events={events}
        withEventLabels={false}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// CPAP adherence: nightly usage bars + 4 h goal + therapy-gap nights
// ---------------------------------------------------------------------------

const GAP_BAR_HEIGHT = 10; // full-height hollow column marks the gap night

export function CpapAdherenceChart({
  nights,
  events,
}: {
  nights: { day: string; usageH: number | null; gap: boolean }[];
  events: ChartEvent[];
}) {
  const days = nights.map((night) => night.day);
  const data = nights.map((night) => ({
    day: night.day,
    usageH: night.usageH,
    gapMark: night.gap ? GAP_BAR_HEIGHT : null,
  }));
  return (
    <div className="space-y-3">
      <ChartLegend
        items={[
          { label: "Nightly usage (h)", color: SERIES.primary, kind: "rect" },
          { label: "Therapy gap — no use", color: SEMANTIC.danger, kind: "hollow" },
          { label: "4 h adherence goal", color: CHROME.ink, kind: "ref" },
        ]}
      />
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 18, right: 8, bottom: 0, left: 0 }} barGap={0}>
            <BrandGrid />
            <DayAxis days={days} />
            <ValueAxis domain={[0, GAP_BAR_HEIGHT]} unit=" h" />
            {eventReferenceLines(events, days)}
            <Tooltip
              content={
                <NightTooltip unitByKey={{ usageH: " h" }} labelOnlyKeys={["gapMark"]} />
              }
              cursor={CURSOR}
              isAnimationActive={false}
            />
            <Bar
              dataKey="usageH"
              name="Nightly usage"
              fill={SERIES.primary}
              radius={[3, 3, 0, 0]}
              maxBarSize={14}
              isAnimationActive={false}
            />
            <Bar
              dataKey="gapMark"
              name="Therapy gap — no use"
              fill="transparent"
              stroke={SEMANTIC.danger}
              strokeWidth={1.25}
              radius={[3, 3, 0, 0]}
              maxBarSize={14}
              isAnimationActive={false}
            />
            <ReferenceLine
              y={4}
              stroke={CHROME.ink}
              strokeWidth={1.5}
              strokeDasharray="6 4"
              label={{
                value: "4 h goal",
                position: "insideBottomRight",
                fill: CHROME.ink,
                fontSize: FONT.tick,
                fontWeight: 600,
                dy: -4,
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Supine time % (sleep mat) — the flagship positional-OSA signal
// ---------------------------------------------------------------------------

export function SupineChart({
  points,
  events,
}: {
  points: NightValue[];
  events: ChartEvent[];
}) {
  return (
    <LinePanel
      points={points}
      caption="Time on back (%)"
      color={SERIES.primary}
      unit="%"
      domain={[0, 100]}
      events={events}
      withEventLabels
    />
  );
}

// ---------------------------------------------------------------------------
// Resting HR + HRV (two units → two aligned panels)
// ---------------------------------------------------------------------------

export function HrHrvChart({
  restingHr,
  hrv,
  events,
}: {
  restingHr: NightValue[];
  hrv: NightValue[];
  events: ChartEvent[];
}) {
  return (
    <div className="space-y-4">
      <LinePanel
        points={restingHr}
        caption="Resting heart rate (bpm)"
        color={SERIES.primary}
        unit=" bpm"
        domain={[40, 90]}
        events={events}
        withEventLabels
      />
      <LinePanel
        points={hrv}
        caption="HRV — SDNN (ms)"
        color={SERIES.secondary}
        unit=" ms"
        domain={[0, "auto"]}
        events={events}
        withEventLabels={false}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// SpO2 with the clinically-low band shaded
// ---------------------------------------------------------------------------

export function SpO2Chart({
  points,
  events,
}: {
  points: NightValue[];
  events: ChartEvent[];
}) {
  return (
    <LinePanel
      points={points}
      caption="Mean overnight SpO2 (%)"
      color={SERIES.primary}
      unit="%"
      domain={[85, 100]}
      events={events}
      withEventLabels
      refAreaBelow={{ y: 90, label: "below 90% — clinically low" }}
    />
  );
}

// ---------------------------------------------------------------------------
// PRO scores: ESS/ISI grouped columns at baseline / day 30 / day 90
// ---------------------------------------------------------------------------

export function ProScoresChart({
  points,
}: {
  points: { point: string; ess: number | null; isi: number | null }[];
}) {
  return (
    <div className="space-y-3">
      <ChartLegend
        items={[
          { label: "ESS — daytime sleepiness", color: SERIES.primary, kind: "rect" },
          { label: "ISI — insomnia severity", color: SERIES.secondary, kind: "rect" },
        ]}
      />
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 18, right: 8, bottom: 0, left: 0 }} barGap={4}>
            <BrandGrid />
            <XAxis
              dataKey="point"
              tick={{ fill: CHROME.tick, fontSize: FONT.label }}
              axisLine={{ stroke: CHROME.grid }}
              tickLine={false}
              tickMargin={8}
            />
            <ValueAxis domain={[0, 24]} width={32} />
            <Tooltip
              content={<NightTooltip />}
              cursor={{ fill: CHROME.grid, opacity: 0.5 }}
              isAnimationActive={false}
            />
            <Bar
              dataKey="ess"
              name="ESS"
              fill={SERIES.primary}
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="ess"
                position="top"
                fill={CHROME.ink}
                fontSize={FONT.label}
                fontWeight={600}
              />
            </Bar>
            <Bar
              dataKey="isi"
              name="ISI"
              fill={SERIES.secondary}
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="isi"
                position="top"
                fill={CHROME.ink}
                fontSize={FONT.label}
                fontWeight={600}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
