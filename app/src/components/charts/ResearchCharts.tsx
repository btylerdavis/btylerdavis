"use client";

import {
  Bar,
  BarChart,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BrandGrid, ChartLegend, NightTooltip, ValueAxis } from "./ChartKit";
import { BLUE_RAMP, CHROME, FONT, SERIES } from "./theme";

/**
 * Research-layer charts (DEMO.md Act 5) built on the same ChartKit/theme
 * system as the participant and coach views: hairline grid, muted ticks,
 * legends whenever ≥ 2 series, values-first tooltips. Firmness bands are
 * ordinal, so they wear the ordered blue ramp; treatment-delivery reference
 * lines stay accentPurple like every other before/after anchor.
 */

const LINE_PROPS = {
  type: "monotone" as const,
  strokeWidth: 2,
  dot: false,
  activeDot: { r: 4.5, strokeWidth: 2, stroke: CHROME.surface },
  connectNulls: false,
  isAnimationActive: false,
};

const CURSOR = { stroke: CHROME.axis, strokeWidth: 1 };
const BAR_CURSOR = { fill: CHROME.grid, opacity: 0.5 };

/** Ordinal band colors (light → dark blue ramp; skyBlue is legend-labeled). */
const BAND_COLORS = { soft: BLUE_RAMP[1], medium: BLUE_RAMP[2], firm: BLUE_RAMP[3] } as const;
const DELIVERY_COLOR = SERIES.secondary;

// ---------------------------------------------------------------------------
// Flagship: mean supine % by week relative to mattress delivery
// ---------------------------------------------------------------------------

export interface WeeklyBandPointView {
  week: number;
  soft: number | null;
  medium: number | null;
  firm: number | null;
}

export function WeeklySupineByBandChart({
  points,
  bandN,
}: {
  points: WeeklyBandPointView[];
  bandN: { soft: number; medium: number; firm: number };
}) {
  const data = points.map((point) => ({
    ...point,
    wk: point.week > 0 ? `+${point.week}` : String(point.week),
  }));
  const unitByKey = { soft: " %", medium: " %", firm: " %" };
  return (
    <div className="space-y-3">
      <ChartLegend
        items={[
          { label: `Soft 1–4 · n=${bandN.soft}`, color: BAND_COLORS.soft, kind: "line" },
          { label: `Medium 5–7 · n=${bandN.medium}`, color: BAND_COLORS.medium, kind: "line" },
          { label: `Firm 8–10 · n=${bandN.firm}`, color: BAND_COLORS.firm, kind: "line" },
          { label: "Mattress delivery (week 0)", color: DELIVERY_COLOR, kind: "ref" },
        ]}
      />
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 18, right: 8, bottom: 0, left: 0 }}>
            <BrandGrid />
            <XAxis
              dataKey="wk"
              tick={{ fill: CHROME.tick, fontSize: FONT.tick }}
              axisLine={{ stroke: CHROME.grid }}
              tickLine={false}
              tickMargin={8}
            />
            <ValueAxis domain={[25, 65]} unit="%" width={48} />
            <ReferenceLine
              x="0"
              stroke={DELIVERY_COLOR}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              label={{
                value: "Delivery",
                position: "insideTop",
                fill: DELIVERY_COLOR,
                fontSize: FONT.tick,
                fontWeight: 600,
              }}
            />
            <Tooltip
              content={<NightTooltip unitByKey={unitByKey} />}
              cursor={CURSOR}
              isAnimationActive={false}
            />
            <Line dataKey="soft" name="Soft 1–4" stroke={BAND_COLORS.soft} {...LINE_PROPS} />
            <Line dataKey="medium" name="Medium 5–7" stroke={BAND_COLORS.medium} {...LINE_PROPS} />
            <Line dataKey="firm" name="Firm 8–10" stroke={BAND_COLORS.firm} {...LINE_PROPS} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-muted">
        Weeks relative to mattress delivery · nightly under-mattress supine %, averaged per
        participant-week, then across participants.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Brand dumbbells: mean supine % before → after delivery, per brand
// ---------------------------------------------------------------------------

export interface BrandPairView {
  brand: string;
  pre: number;
  post: number;
  n: number;
  insufficient: boolean;
}

interface DumbbellShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: BrandPairView & { range: [number, number] };
}

function DumbbellShape({ x = 0, y = 0, width = 0, height = 0, payload }: DumbbellShapeProps) {
  if (!payload) return <g />;
  const { pre, post, insufficient } = payload;
  const [lo, hi] = payload.range;
  const span = hi - lo || 1;
  const xPre = x + ((pre - lo) / span) * width;
  const xPost = x + ((post - lo) / span) * width;
  const cy = y + height / 2;
  const color = insufficient ? CHROME.axis : SERIES.primary;
  const delta = post - pre;
  const label = insufficient
    ? "insufficient n"
    : `${delta <= 0 ? "−" : "+"}${Math.abs(delta).toFixed(1)} pp`;
  return (
    <g>
      <line x1={xPre} x2={xPost} y1={cy} y2={cy} stroke={color} strokeWidth={2.5} />
      <circle cx={xPre} cy={cy} r={5} fill={CHROME.surface} stroke={color} strokeWidth={2} />
      <circle cx={xPost} cy={cy} r={5.5} fill={color} />
      <text
        x={Math.max(xPre, xPost) + 12}
        y={cy + 4}
        fill={insufficient ? CHROME.tick : CHROME.ink}
        fontSize={FONT.tick}
        fontWeight={600}
      >
        {label}
      </text>
    </g>
  );
}

export function BrandDumbbellChart({ pairs }: { pairs: BrandPairView[] }) {
  const data = pairs.map((pair) => ({
    ...pair,
    label: `${pair.brand} · n=${pair.n}`,
    range: [Math.min(pair.pre, pair.post), Math.max(pair.pre, pair.post)] as [number, number],
  }));
  return (
    <div className="space-y-3">
      <ChartLegend
        items={[
          { label: "Before delivery (4-wk mean)", color: SERIES.primary, kind: "hollow" },
          { label: "After delivery (days +8 to +35)", color: SERIES.primary, kind: "rect" },
          { label: "Greyed: n < 15 — insufficient n", color: CHROME.axis, kind: "line" },
        ]}
      />
      <div style={{ height: 44 * data.length + 40 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 108, bottom: 4, left: 8 }}
          >
            <BrandGrid />
            <XAxis
              type="number"
              domain={[30, 62]}
              unit="%"
              tick={{ fill: CHROME.tick, fontSize: FONT.tick }}
              axisLine={{ stroke: CHROME.grid }}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={150}
              tick={{ fill: CHROME.tick, fontSize: FONT.tick }}
              axisLine={false}
              tickLine={false}
            />
            <Bar
              dataKey="range"
              name="Supine % before → after"
              isAnimationActive={false}
              shape={(props: unknown) => <DumbbellShape {...(props as DumbbellShapeProps)} />}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-muted">
        Mean supine % per participant: 4 weeks pre-delivery vs days +8 to +35 (the first week
        post-delivery is an adjustment ramp and is excluded). Hollow dot = before, filled = after.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ESS-change distribution: responders vs non-responders
// ---------------------------------------------------------------------------

export interface EssDistBucketView {
  bucket: string;
  respondersPct: number;
  nonRespondersPct: number;
}

export function EssChangeDistributionChart({
  buckets,
  respondersN,
  nonRespondersN,
}: {
  buckets: EssDistBucketView[];
  respondersN: number;
  nonRespondersN: number;
}) {
  return (
    <div className="space-y-3">
      <ChartLegend
        items={[
          {
            label: `Responders (supine drop ≥ 8 pp) · n=${respondersN}`,
            color: SERIES.secondary,
            kind: "rect",
          },
          {
            label: `Non-responders · n=${nonRespondersN}`,
            color: SERIES.primary,
            kind: "rect",
          },
        ]}
      />
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={buckets} margin={{ top: 18, right: 8, bottom: 0, left: 0 }} barGap={3}>
            <BrandGrid />
            <XAxis
              dataKey="bucket"
              tick={{ fill: CHROME.tick, fontSize: FONT.tick }}
              axisLine={{ stroke: CHROME.grid }}
              tickLine={false}
              tickMargin={8}
            />
            <ValueAxis domain={[0, 60]} unit="%" width={44} />
            <Tooltip
              content={
                <NightTooltip unitByKey={{ respondersPct: "%", nonRespondersPct: "%" }} />
              }
              cursor={BAR_CURSOR}
              isAnimationActive={false}
            />
            <Bar
              dataKey="respondersPct"
              name="Responders"
              fill={SERIES.secondary}
              radius={[3, 3, 0, 0]}
              maxBarSize={28}
              isAnimationActive={false}
            />
            <Bar
              dataKey="nonRespondersPct"
              name="Non-responders"
              fill={SERIES.primary}
              radius={[3, 3, 0, 0]}
              maxBarSize={28}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-muted">
        ESS change, baseline → latest follow-up (day 90 where reached, else day 30), as % of each
        group. Negative = less daytime sleepiness.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Treatment comparisons: mean change by arm (one panel per unit)
// ---------------------------------------------------------------------------

export interface ArmColumnPoint {
  arm: string;
  label: string;
  value: number | null;
  n: number;
}

function ArmTick({
  x = 0,
  y = 0,
  payload,
  nByLabel,
}: {
  x?: number | string;
  y?: number | string;
  payload?: { value: string | number };
  nByLabel: Record<string, number>;
}) {
  const px = Number(x);
  const py = Number(y);
  const label = String(payload?.value ?? "");
  return (
    <g>
      <text x={px} y={py + 12} textAnchor="middle" fill={CHROME.tick} fontSize={FONT.tick}>
        {label}
      </text>
      <text x={px} y={py + 26} textAnchor="middle" fill={CHROME.axis} fontSize={11}>
        n={nByLabel[label] ?? 0}
      </text>
    </g>
  );
}

interface ChangeLabelProps {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
  value?: number | string | null;
}

function ChangeLabel({ x = 0, y = 0, width = 0, height = 0, value }: ChangeLabelProps) {
  if (value === undefined || value === null || value === "") return <g />;
  const px = Number(x);
  const py = Number(y);
  const pw = Number(width);
  const ph = Number(height);
  const numeric = Number(value);
  const below = numeric < 0;
  return (
    <text
      x={px + pw / 2}
      y={below ? py + ph + 14 : py - 6}
      textAnchor="middle"
      fill={CHROME.ink}
      fontSize={FONT.label}
      fontWeight={600}
    >
      {numeric > 0 ? `+${numeric.toFixed(1)}` : numeric.toFixed(1)}
    </text>
  );
}

export function ArmChangeColumns({
  points,
  caption,
  color,
  unit,
  domain,
}: {
  points: ArmColumnPoint[];
  caption: string;
  color: string;
  unit: string;
  domain: [number, number];
}) {
  const nByLabel = Object.fromEntries(points.map((point) => [point.label, point.n]));
  return (
    <div>
      <p className="text-xs font-semibold tracking-wide text-muted uppercase">{caption}</p>
      <div className="mt-1 h-60">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 18, right: 8, bottom: 18, left: 0 }}>
            <BrandGrid />
            <XAxis
              dataKey="label"
              tick={(props) => <ArmTick {...props} nByLabel={nByLabel} />}
              axisLine={{ stroke: CHROME.grid }}
              tickLine={false}
              interval={0}
            />
            <ValueAxis domain={domain} unit={unit} width={48} />
            <ReferenceLine y={0} stroke={CHROME.axis} strokeWidth={1} />
            <Tooltip
              content={<NightTooltip unitByKey={{ value: unit }} />}
              cursor={BAR_CURSOR}
              isAnimationActive={false}
            />
            <Bar
              dataKey="value"
              name={caption}
              fill={color}
              radius={[4, 4, 0, 0]}
              maxBarSize={40}
              isAnimationActive={false}
              label={(props: unknown) => <ChangeLabel {...(props as ChangeLabelProps)} />}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact sparkline (revocation control room)
// ---------------------------------------------------------------------------

export function TrendSparkline({
  points,
  unit,
  color = SERIES.primary,
}: {
  points: { day: string; value: number | null }[];
  unit: string;
  color?: string;
}) {
  return (
    <div className="h-20">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 6, right: 4, bottom: 2, left: 4 }}>
          <XAxis dataKey="day" hide />
          <YAxis hide domain={["auto", "auto"]} />
          <Tooltip
            content={<NightTooltip unitByKey={{ value: unit }} />}
            cursor={CURSOR}
            isAnimationActive={false}
          />
          <Line dataKey="value" name="Sleep efficiency" stroke={color} {...LINE_PROPS} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
