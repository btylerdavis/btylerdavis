import type { ConsentCoverage } from "@/lib/consent";
import { Card } from "./Card";

/**
 * Consent-coverage denominators (level-up 9): the eligible → consented →
 * contributing → fresh-last-7-days funnel rendered above dashboard metrics,
 * so partial revocation is legible instead of a silent shrink. Every
 * dashboard reads only the "contributing" set — this strip shows the
 * denominators that set is drawn from.
 */

const STAGES = [
  {
    key: "eligible",
    label: "Eligible",
    note: "registry participants (tombstones excluded)",
  },
  {
    key: "consented",
    label: "Consented",
    note: "hold a current grant for this tier",
  },
  {
    key: "contributing",
    label: "Contributing",
    note: "≥ 1 observation clears the consent gate",
  },
  {
    key: "freshLast7",
    label: "Fresh · last 7 days",
    note: "gate-clearing data this week",
  },
] as const;

export function CoverageStrip({
  coverage,
  tierLabel,
  context,
}: {
  coverage: ConsentCoverage;
  /** e.g. "identified tier (view_identified)" */
  tierLabel: string;
  /** e.g. "every coach metric below reads only the Contributing set" */
  context: string;
}) {
  return (
    <Card tone="wash" className="border border-hairline p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold tracking-[0.12em] text-navy uppercase">
          Consent coverage · {tierLabel}
        </p>
        <p className="text-xs text-graphite">{context}</p>
      </div>
      <dl className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {STAGES.map((stage, index) => (
          <div key={stage.key} className="relative rounded-card border border-hairline bg-white px-3 py-2.5">
            <dt className="flex items-center gap-1 text-xs font-medium text-graphite">
              {index > 0 && <span aria-hidden>→</span>}
              {stage.label}
            </dt>
            <dd className="mt-0.5 text-xl font-semibold text-navy tabular-nums">
              {coverage[stage.key].toLocaleString("en-US")}
            </dd>
            <dd className="mt-0.5 text-[11px] leading-tight text-graphite">{stage.note}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
