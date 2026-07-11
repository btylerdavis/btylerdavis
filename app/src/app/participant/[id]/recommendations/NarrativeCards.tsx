"use client";

import { useState } from "react";
import { Card } from "@/components/Card";
import { RecommendationCard, type ReviewState } from "@/components/RecommendationCard";
import type { EvidenceClaim } from "@/lib/recommendations/evidence";
import type { RecommendationsResult } from "@/lib/recommendations/queries";
import type { Recommendation } from "@/lib/recommendations/rules";

/**
 * The recommendation list with the "AI narrative (preview)" toggle (DEMO.md
 * §3 reserve → working). Narratives are composed server-side by the governed
 * pipeline (evidence bundle → template draft → zod schema → SafetyCheck
 * chain → ModelDecisionLog — lib/recommendations/pipeline.ts) and arrive
 * here as plain data; the toggle only reveals them. A card whose draft
 * failed the schema or a safety check arrives with passed=false and renders
 * as a WITHHELD notice — the pipeline's refusal is itself demo material.
 * accentPurple per the reserve-layer convention.
 */

export interface NarrativeCardData {
  recommendation: Recommendation;
  narrative: string;
  claims: EvidenceClaim[];
  review: ReviewState;
  /** schema + full safety chain passed — render only when true */
  passed: boolean;
}

export function NarrativeCards({
  cards,
  series,
}: {
  cards: NarrativeCardData[];
  series: RecommendationsResult["series"];
}) {
  const [showNarrative, setShowNarrative] = useState(false);

  return (
    <>
      <div className="flex items-center justify-end gap-2.5">
        <span
          className={`text-sm font-semibold ${
            showNarrative ? "text-accent-purple" : "text-muted"
          }`}
        >
          AI narrative (preview)
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={showNarrative}
          aria-label="AI narrative (preview)"
          onClick={() => setShowNarrative((value) => !value)}
          className={`relative h-6 w-11 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-purple ${
            showNarrative ? "bg-accent-purple" : "bg-pale-blue"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-card transition-all ${
              showNarrative ? "left-[22px]" : "left-0.5"
            }`}
          />
        </button>
      </div>

      {cards.map((card) =>
        card.passed ? (
          <RecommendationCard
            key={card.recommendation.ruleId}
            recommendation={card.recommendation}
            series={series}
            narrative={card.narrative}
            showNarrative={showNarrative}
            claims={card.claims}
            review={card.review}
          />
        ) : (
          <Card key={card.recommendation.ruleId} className="p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-danger/40 bg-danger/5 px-2.5 py-0.5 text-xs font-semibold text-danger">
                Withheld by safety pipeline
              </span>
              <h2 className="text-lg font-semibold text-navy">
                A drafted card did not clear the checks
              </h2>
            </div>
            <p className="mt-2 text-sm text-body">
              The draft for rule <span className="font-mono">{card.recommendation.ruleId}</span>{" "}
              failed schema validation or a safety check and was not rendered. The full check
              trail is in the model decision log.
            </p>
          </Card>
        )
      )}
    </>
  );
}
