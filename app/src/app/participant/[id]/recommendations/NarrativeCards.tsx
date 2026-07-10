"use client";

import { useState } from "react";
import { RecommendationCard } from "@/components/RecommendationCard";
import type { RecommendationsResult } from "@/lib/recommendations/queries";
import type { Recommendation } from "@/lib/recommendations/rules";

/**
 * The recommendation list with the "AI narrative (preview)" toggle (DEMO.md
 * §3 reserve → working). Narratives are composed server-side from the
 * participant's real inputs (deterministic templates, no network — see
 * lib/recommendations/narrative.ts) and arrive here as plain strings; the
 * toggle only reveals them. accentPurple per the reserve-layer convention.
 */

export interface NarrativeCardData {
  recommendation: Recommendation;
  narrative: string;
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

      {cards.map((card) => (
        <RecommendationCard
          key={card.recommendation.ruleId}
          recommendation={card.recommendation}
          series={series}
          narrative={card.narrative}
          showNarrative={showNarrative}
        />
      ))}
    </>
  );
}
