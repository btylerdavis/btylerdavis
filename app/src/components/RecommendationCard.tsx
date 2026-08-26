import { Card } from "@/components/Card";
import { TrendSparkline } from "@/components/charts/ResearchCharts";
import { SERIES } from "@/components/charts/theme";
import type { EvidenceClaim } from "@/lib/recommendations/evidence";
import { NARRATIVE_DISCLAIMER } from "@/lib/recommendations/narrative";
import {
  GUARDRAIL_FOOTER,
  GUARDRAIL_LABELS,
  type GuardrailClass,
  type Recommendation,
} from "@/lib/recommendations/rules";
import type { RecommendationsResult } from "@/lib/recommendations/queries";

/**
 * One AI-recommendation card (DEMO.md Act 7): the suggestion in warm plain
 * language, a "why" section showing the actual data behind it (stat chips +
 * a mini sparkline), the SPEC §10.3 guardrail-class badge, and the
 * non-device-CDS boundary line as a footer. Badge colors follow the new
 * palette as an escalating light→dark blue scale: comfort = skylight,
 * adherence-support = lake, discuss-with-provider = navy.
 *
 * With `showNarrative` + `narrative` set, the card also renders the drafted
 * AI-narrative preview (template-composed from the same evidence bundle —
 * see lib/recommendations/narrative.ts) with its disclaimer line.
 *
 * Governed-pipeline layers (audit level-up 12): `claims` renders the "View
 * evidence" expander — every claim the card cites, with the exact data
 * points and the consent-gated query behind it — and `review` renders the
 * clinician-review badge on provider-class cards (queued at first render;
 * marked reviewed from /compliance/model-log).
 */

/**
 * Single source for the guardrail-class badge treatment (light→dark blue
 * scale, every pairing ≥ WCAG AA at badge size). Everything that renders a
 * guardrail chip — cards here, the model decision log — imports this map so
 * the classes stay identical everywhere.
 */
export const GUARDRAIL_BADGE_CLASSES: Record<GuardrailClass, string> = {
  comfort: "bg-skylight text-navy",
  "adherence-support": "bg-lake text-white",
  "discuss-with-provider": "bg-navy text-white",
};

/** Sparkline stroke per guardrail class (same trio, chart-side). */
const SPARK_COLORS: Record<GuardrailClass, string> = {
  comfort: SERIES.soft,
  "adherence-support": SERIES.primary,
  "discuss-with-provider": SERIES.secondary,
};

const SPARK_META: Record<
  NonNullable<Recommendation["sparkline"]>,
  { name: string; unit: string }
> = {
  supine: { name: "Nightly back-sleeping", unit: " %" },
  usage: { name: "Nightly CPAP use", unit: " h" },
  leak: { name: "Nightly p95 mask leak", unit: " L/min" },
  residual: { name: "Nightly event index", unit: " events/h" },
};

export function GuardrailBadge({ guardrail }: { guardrail: GuardrailClass }) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${GUARDRAIL_BADGE_CLASSES[guardrail]}`}
    >
      {GUARDRAIL_LABELS[guardrail]}
    </span>
  );
}

export interface ReviewState {
  queued: boolean;
  reviewedBy: string | null;
  /** ISO timestamp */
  reviewedAt: string | null;
}

export function RecommendationCard({
  recommendation,
  series,
  narrative,
  showNarrative = false,
  claims,
  review,
}: {
  recommendation: Recommendation;
  series: RecommendationsResult["series"];
  /** drafted AI-narrative preview text (lib/recommendations/narrative.ts) */
  narrative?: string;
  showNarrative?: boolean;
  /** evidence claims the card cites (the "View evidence" expander) */
  claims?: EvidenceClaim[];
  /** clinician-review state for provider-class cards (level-up 12) */
  review?: ReviewState;
}) {
  const rec = recommendation;
  const spark = rec.sparkline ? SPARK_META[rec.sparkline] : null;
  const sparkPoints = rec.sparkline ? series[rec.sparkline] : [];
  const hasSpark = spark !== null && sparkPoints.some((point) => point.value !== null);

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold text-navy">{rec.title}</h2>
        <div className="flex flex-col items-end gap-1.5">
          <GuardrailBadge guardrail={rec.guardrail} />
          {review?.queued &&
            (review.reviewedAt === null ? (
              <span className="rounded-full border border-warning/40 bg-warning/10 px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-warning">
                Queued for clinician review
              </span>
            ) : (
              <span className="rounded-full border border-success/40 bg-success/10 px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-success">
                Clinician reviewed (demo)
              </span>
            ))}
        </div>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-ink">{rec.body}</p>

      {showNarrative && narrative && (
        <div className="mt-4 rounded-card border border-lake/30 bg-lake/5 p-4">
          <p className="text-xs font-semibold tracking-[0.12em] text-lake uppercase">
            AI narrative (preview)
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink">{narrative}</p>
          <p className="mt-2 text-[11px] text-graphite">{NARRATIVE_DISCLAIMER}</p>
        </div>
      )}

      {/* Why: the actual data behind the suggestion */}
      <div className="mt-4 rounded-card bg-cream/60 p-4">
        <p className="text-xs font-semibold tracking-[0.12em] text-brand uppercase">
          Why you’re seeing this
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {rec.whyChips.map((chip) => (
            <span
              key={chip.label}
              className="rounded-full border border-hairline bg-white px-2.5 py-1 text-xs text-graphite"
            >
              {chip.label}:{" "}
              <span className="font-semibold text-navy tabular-nums">{chip.value}</span>
            </span>
          ))}
        </div>
        {hasSpark && spark && rec.sparkline && (
          <div className="mt-2">
            <TrendSparkline
              points={sparkPoints}
              unit={spark.unit}
              name={spark.name}
              color={SPARK_COLORS[rec.guardrail]}
            />
            <p className="text-[11px] text-graphite">{spark.name} · last 6 weeks</p>
          </div>
        )}

        {/* View evidence: claim → data table (evidence-first pipeline) */}
        {claims && claims.length > 0 && (
          <details className="group mt-3">
            <summary className="cursor-pointer text-xs font-semibold text-brand underline-offset-4 select-none hover:underline">
              View evidence ({claims.length} claim{claims.length === 1 ? "" : "s"})
            </summary>
            <div className="mt-2 space-y-3">
              {claims.map((claim) => (
                <div key={claim.id} className="rounded-card border border-hairline bg-white p-3">
                  <p className="text-sm font-semibold text-navy">{claim.statement}</p>
                  <table className="mt-2 w-full text-xs">
                    <thead>
                      <tr className="border-b border-hairline text-left tracking-wide text-graphite uppercase">
                        <th className="py-1 pr-3 font-semibold">Metric</th>
                        <th className="py-1 pr-3 font-semibold">Period</th>
                        <th className="py-1 font-semibold">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {claim.points.map((point) => (
                        <tr
                          key={`${point.metric}|${point.period}`}
                          className="border-b border-hairline/60 last:border-0"
                        >
                          <td className="py-1.5 pr-3 text-ink">{point.metric}</td>
                          <td className="py-1.5 pr-3 text-graphite">{point.period}</td>
                          <td className="py-1.5 font-semibold text-navy tabular-nums">
                            {point.value}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-1.5 font-mono text-[10px] break-all text-graphite">
                    {claim.id} · {claim.dataClass} · {claim.query}
                  </p>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      <p className="mt-3 border-t border-hairline pt-2.5 text-[11px] text-graphite">
        {GUARDRAIL_FOOTER}
      </p>
    </Card>
  );
}
