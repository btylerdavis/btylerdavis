"use client";

import {
  Bar,
  BarChart,
  ErrorBar,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import { BrandGrid, ChartLegend, NightTooltip, ValueAxis } from "./ChartKit";
import { BLUE_RAMP, CHROME, FONT, SEMANTIC, SERIES } from "./theme";

/**
 * Bias & robustness charts (audit level-up 11) on the shared ChartKit/theme
 * system: missingness-by-class lines, the attrition/consent-change timeline,
 * and the band-delta columns with 95% CI error bars used for both the
 * flagship effect and the resting-HR negative control.
 */

const LINE_PROPS = {
  type: "monotone" as const,
  strokeWidth: 2,
  dot: { r: 3, strokeWidth: 0 },
  activeDot: { r: 4.5, strokeWidth: 2, stroke: CHROME.surface },
  connectNulls: false,
  isAnimationActive: false,
};

const CURSOR = { stroke: CHROME.axis, strokeWidth: 1 };
const BAR_CURSOR = { fill: CHROME.grid, opacity: 0.5 };

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function shortMonth(month: string): string {
  return MONTH_LABEL.format(new Date(`${month}-01T00:00:00Z`));
}

// ---------------------------------------------------------------------------
// Missingness by data class (% of expected nights present, per month)
// ---------------------------------------------------------------------------

export interface MissingnessPoint {
  month: string;
  wearable_sleep: number | null;
  cpap_telemetry: number | null;
  sleep_mat: number | null;
}

const MISSINGNESS_COLORS = {
  wearable_sleep: SERIES.primary,
  cpap_telemetry: SERIES.secondary,
  sleep_mat: BLUE_RAMP[3],
} as const;

export function MissingnessChart({ points }: { points: MissingnessPoint[] }) {
  const data = points.map((point) => ({ ...point, label: shortMonth(point.month) }));
  const unitByKey = { wearable_sleep: " %", cpap_telemetry: " %", sleep_mat: " %" };
  return (
    <div className="space-y-3">
      <ChartLegend
        items={[
          { label: "Wearable sleep", color: MISSINGNESS_COLORS.wearable_sleep, kind: "line" },
          { label: "CPAP telemetry", color: MISSINGNESS_COLORS.cpap_telemetry, kind: "line" },
          { label: "Under-mattress sensor", color: MISSINGNESS_COLORS.sleep_mat, kind: "line" },
        ]}
      />
      <div className="h-60">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
            <BrandGrid />
            <XAxis
              dataKey="label"
              tick={{ fill: CHROME.tick, fontSize: FONT.tick }}
              axisLine={{ stroke: CHROME.grid }}
              tickLine={false}
              tickMargin={8}
            />
            <ValueAxis domain={[0, 100]} unit="%" width={48} />
            <Tooltip
              content={<NightTooltip unitByKey={unitByKey} />}
              cursor={CURSOR}
              isAnimationActive={false}
            />
            <Line
              dataKey="wearable_sleep"
              name="Wearable sleep"
              stroke={MISSINGNESS_COLORS.wearable_sleep}
              {...LINE_PROPS}
            />
            <Line
              dataKey="cpap_telemetry"
              name="CPAP telemetry"
              stroke={MISSINGNESS_COLORS.cpap_telemetry}
              {...LINE_PROPS}
            />
            <Line
              dataKey="sleep_mat"
              name="Under-mattress sensor"
              stroke={MISSINGNESS_COLORS.sleep_mat}
              {...LINE_PROPS}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attrition / consent-change timeline (per sim-month)
// ---------------------------------------------------------------------------

export interface TimelinePoint {
  month: string;
  enrollments: number;
  reconsents: number;
  fullRevocations: number;
  classRevocations: number;
  restores: number;
  deletions: number;
}

const EVENT_SERIES = [
  { key: "fullRevocations", name: "Full revocations", color: SEMANTIC.warning },
  { key: "classRevocations", name: "Per-class revocations", color: SERIES.secondary },
  { key: "restores", name: "Restores (admin, in-ceiling)", color: SERIES.soft },
  { key: "reconsents", name: "Re-consents (signed)", color: BLUE_RAMP[3] },
  { key: "deletions", name: "Deletions executed", color: SEMANTIC.danger },
] as const;

export function ConsentTimelineChart({ points }: { points: TimelinePoint[] }) {
  const data = points.map((point) => ({ ...point, label: shortMonth(point.month) }));
  const anyEvents = points.some(
    (point) =>
      point.fullRevocations +
        point.classRevocations +
        point.restores +
        point.reconsents +
        point.deletions >
      0
  );
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <p className="text-xs font-semibold tracking-wide text-graphite uppercase">
          Enrollments per month
        </p>
        <div className="mt-2 h-52">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
              <BrandGrid />
              <XAxis
                dataKey="label"
                tick={{ fill: CHROME.tick, fontSize: FONT.tick }}
                axisLine={{ stroke: CHROME.grid }}
                tickLine={false}
                tickMargin={8}
              />
              <ValueAxis width={48} />
              <Tooltip
                content={<NightTooltip />}
                cursor={BAR_CURSOR}
                isAnimationActive={false}
              />
              <Bar
                dataKey="enrollments"
                name="Enrollments"
                fill={SERIES.primary}
                radius={[3, 3, 0, 0]}
                maxBarSize={40}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold tracking-wide text-graphite uppercase">
          Consent-change events per month (stacked)
        </p>
        {anyEvents ? (
          <div className="mt-2 space-y-2">
            <ChartLegend
              items={EVENT_SERIES.map((series) => ({
                label: series.name,
                color: series.color,
                kind: "rect" as const,
              }))}
            />
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
                  <BrandGrid />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: CHROME.tick, fontSize: FONT.tick }}
                    axisLine={{ stroke: CHROME.grid }}
                    tickLine={false}
                    tickMargin={8}
                  />
                  <ValueAxis width={48} />
                  <Tooltip
                    content={<NightTooltip />}
                    cursor={BAR_CURSOR}
                    isAnimationActive={false}
                  />
                  {EVENT_SERIES.map((series) => (
                    <Bar
                      key={series.key}
                      dataKey={series.key}
                      name={series.name}
                      stackId="events"
                      fill={series.color}
                      maxBarSize={40}
                      isAnimationActive={false}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <p className="mt-2 rounded-card bg-cream/60 px-4 py-3 text-sm text-graphite">
            No consent-change events in the ledger yet — run the revocation console (full or
            per-class), the re-consent flow, or a deletion, and each event lands in its
            sim-month here.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Band deltas with 95% CI error bars (flagship effect + negative control)
// ---------------------------------------------------------------------------

export interface BandDeltaPoint {
  band: string;
  label: string;
  mean: number | null;
  /** 95% CI half-width (null → no error bar drawn) */
  ci95: number | null;
  n: number;
}

function BandTick({
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

export function BandDeltaChart({
  points,
  caption,
  color,
  unit,
  domain,
}: {
  points: BandDeltaPoint[];
  caption: string;
  color: string;
  unit: string;
  domain: [number, number];
}) {
  const nByLabel = Object.fromEntries(points.map((point) => [point.label, point.n]));
  const data = points.map((point) => ({ ...point, value: point.mean }));
  return (
    <div>
      <p className="text-xs font-semibold tracking-wide text-graphite uppercase">{caption}</p>
      <div className="mt-1 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 14, right: 8, bottom: 18, left: 0 }}>
            <BrandGrid />
            <XAxis
              dataKey="label"
              tick={(props) => <BandTick {...props} nByLabel={nByLabel} />}
              axisLine={{ stroke: CHROME.grid }}
              tickLine={false}
              interval={0}
            />
            <ValueAxis domain={domain} unit={unit} width={52} />
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
              maxBarSize={44}
              isAnimationActive={false}
            >
              <ErrorBar
                dataKey="ci95"
                width={6}
                strokeWidth={1.5}
                stroke={CHROME.ink}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-1 space-y-0.5 text-xs text-graphite">
        {points.map((point) => (
          <li key={point.band} className="tabular-nums">
            <span className="font-semibold text-navy">{point.label}</span>:{" "}
            {point.mean === null
              ? "no members with both windows"
              : `${point.mean >= 0 ? "+" : "−"}${Math.abs(point.mean).toFixed(1)}${unit}` +
                (point.ci95 !== null ? ` ± ${point.ci95.toFixed(1)}` : "") +
                ` · n=${point.n}`}
          </li>
        ))}
      </ul>
    </div>
  );
}
