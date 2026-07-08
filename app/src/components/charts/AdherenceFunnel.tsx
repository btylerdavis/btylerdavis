"use client";

import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { NightTooltip } from "./ChartKit";
import { BLUE_RAMP, CHROME, FONT } from "./theme";

/**
 * The coach portal's adherence funnel: enrolled → data flowing → adherent at
 * 30d → adherent at 90d. Ordered stages wear the ordinal blue ramp
 * (light → dark); counts are direct-labeled at each bar end, with the
 * conversion vs. stage 1 alongside.
 */

export interface FunnelStage {
  stage: string;
  count: number;
  /** e.g. "of 812 eligible" — denominator honesty for the 30/90d stages */
  note?: string;
}

export function AdherenceFunnel({ stages }: { stages: FunnelStage[] }) {
  const base = stages[0]?.count ?? 0;
  const data = stages.map((stage) => ({
    ...stage,
    endLabel:
      base > 0
        ? `${stage.count.toLocaleString("en-US")} · ${Math.round((stage.count / base) * 100)}%`
        : stage.count.toLocaleString("en-US"),
  }));

  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 96, bottom: 4, left: 8 }}
        >
          <XAxis type="number" hide domain={[0, "dataMax"]} />
          <YAxis
            type="category"
            dataKey="stage"
            width={158}
            tick={{ fill: CHROME.tick, fontSize: FONT.label }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            content={<NightTooltip />}
            cursor={{ fill: CHROME.grid, opacity: 0.5 }}
            isAnimationActive={false}
          />
          <Bar
            dataKey="count"
            name="Participants"
            radius={[0, 4, 4, 0]}
            maxBarSize={24}
            isAnimationActive={false}
          >
            {data.map((entry, index) => (
              <Cell key={entry.stage} fill={BLUE_RAMP[index % BLUE_RAMP.length]} />
            ))}
            <LabelList
              dataKey="endLabel"
              position="right"
              fill={CHROME.ink}
              fontSize={FONT.label}
              fontWeight={600}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
