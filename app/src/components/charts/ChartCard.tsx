import type { ReactNode } from "react";
import { Card } from "@/components/Card";

/**
 * Card shell for a chart section. When the backing data class lacks a
 * current consent grant, the card renders the same red-chip pattern as the
 * participant snapshot — consent visibility is a feature, not a failure
 * state.
 */
export function ChartCard({
  title,
  subtitle,
  blockedLabel,
  emptyMessage,
  isEmpty = false,
  children,
}: {
  title: string;
  subtitle?: string;
  /** when set, the card shows the consent-blocked state instead of a chart */
  blockedLabel?: string | null;
  /** friendly copy when granted but no rows yet */
  emptyMessage?: string;
  isEmpty?: boolean;
  children: ReactNode;
}) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-lg font-semibold text-navy">{title}</h2>
        {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
      </div>
      <div className="mt-4">
        {blockedLabel ? (
          <div className="flex flex-wrap items-center gap-2 rounded-card bg-danger/5 px-4 py-3">
            <span className="rounded-full border border-danger/40 bg-danger/5 px-2.5 py-0.5 text-xs font-semibold text-danger">
              Blocked: {blockedLabel}
            </span>
            <p className="text-sm text-body">
              No current consent covers viewing this data — the read gate refused it.
            </p>
          </div>
        ) : isEmpty ? (
          <p className="rounded-card bg-pale-blue/60 px-4 py-3 text-sm text-muted">
            {emptyMessage ?? "No data yet — nights accrue as the time machine advances."}
          </p>
        ) : (
          children
        )}
      </div>
    </Card>
  );
}
