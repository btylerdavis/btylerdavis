import { Card } from "@/components/Card";
import { TrendSparkline } from "@/components/charts/ResearchCharts";
import { SERIES } from "@/components/charts/theme";
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
 * non-device-CDS boundary line as a footer. Badge colors follow the theme:
 * comfort = skyBlue, adherence-support = brandBlue,
 * discuss-with-provider = accentPurple.
 *
 * With `showNarrative` + `narrative` set, the card also renders the drafted
 * AI-narrative preview (template-composed from the same inputs — see
 * lib/recommendations/narrative.ts) with its disclaimer line.
 */

const BADGE_CLASSES: Record<GuardrailClass, string> = {
  comfort: "bg-sky-blue text-white",
  "adherence-support": "bg-brand-blue text-white",
  "discuss-with-provider": "bg-accent-purple text-white",
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
      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${BADGE_CLASSES[guardrail]}`}
    >
      {GUARDRAIL_LABELS[guardrail]}
    </span>
  );
}

export function RecommendationCard({
  recommendation,
  series,
  narrative,
  showNarrative = false,
}: {
  recommendation: Recommendation;
  series: RecommendationsResult["series"];
  /** drafted AI-narrative preview text (lib/recommendations/narrative.ts) */
  narrative?: string;
  showNarrative?: boolean;
}) {
  const rec = recommendation;
  const spark = rec.sparkline ? SPARK_META[rec.sparkline] : null;
  const sparkPoints = rec.sparkline ? series[rec.sparkline] : [];
  const hasSpark = spark !== null && sparkPoints.some((point) => point.value !== null);

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold text-navy">{rec.title}</h2>
        <GuardrailBadge guardrail={rec.guardrail} />
      </div>
      <p className="mt-2 text-sm leading-relaxed text-body">{rec.body}</p>

      {showNarrative && narrative && (
        <div className="mt-4 rounded-card border border-accent-purple/30 bg-accent-purple/5 p-4">
          <p className="text-xs font-semibold tracking-[0.12em] text-accent-purple uppercase">
            AI narrative (preview)
          </p>
          <p className="mt-2 text-sm leading-relaxed text-body">{narrative}</p>
          <p className="mt-2 text-[11px] text-muted">{NARRATIVE_DISCLAIMER}</p>
        </div>
      )}

      {/* Why: the actual data behind the suggestion */}
      <div className="mt-4 rounded-card bg-pale-blue/60 p-4">
        <p className="text-xs font-semibold tracking-[0.12em] text-sky-blue uppercase">
          Why you&apos;re seeing this
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {rec.whyChips.map((chip) => (
            <span
              key={chip.label}
              className="rounded-full bg-white px-2.5 py-1 text-xs text-muted shadow-card"
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
            <p className="text-[11px] text-muted">{spark.name} · last 6 weeks</p>
          </div>
        )}
      </div>

      <p className="mt-3 border-t border-pale-blue pt-2.5 text-[11px] text-muted">
        {GUARDRAIL_FOOTER}
      </p>
    </Card>
  );
}
