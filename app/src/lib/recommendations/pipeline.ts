import type { GrantSet } from "../consent";
import { recordModelDecision } from "./decisionLog";
import {
  buildEvidenceBundle,
  claimIdsForRule,
  getClaim,
  type EvidenceBundle,
  type EvidenceClaim,
} from "./evidence";
import { buildNarrative, NARRATIVE_VERSION } from "./narrative";
import { loadRecommendations, type RecommendationsResult } from "./queries";
import { validateRecommendationDraft, type RecommendationDraft } from "./schema";
import type { Recommendation } from "./rules";
import { runSafetyChain, safetyChainPassed, type SafetyCheck } from "./safety";

/**
 * Governed generation pipeline (audit level-up 12) — the one path every
 * recommendation card takes to the screen:
 *
 *   consent-gated queries → RecommendationInputs → EvidenceBundle (typed,
 *   claim-linked) → engine draft (templates-v1) → zod schema validation →
 *   SafetyCheck chain → ModelDecisionLog row → render (or withhold).
 *
 * No real LLM is called anywhere — RECS_MODE=templates is the only
 * implemented mode and the documented PERMANENT FALLBACK: whatever model
 * governance decides later, this deterministic engine stays wired behind
 * the same schema, chain, and log, so switching back is an env var, not a
 * rollback. A failed schema or safety check WITHHOLDS the card (the page
 * shows a withheld notice, the log shows why); with the finite template
 * engine every check passes by construction, and the tests keep it that way.
 */

export const RECS_MODEL_ID = "templates-v1";
export const RECS_MODEL_VERSION = NARRATIVE_VERSION;

export interface RecsMode {
  /** the engine actually in use — always the template engine today */
  mode: "templates";
  /** raw RECS_MODE env value (null = unset) */
  requested: string | null;
  /** an unimplemented mode was requested; the pipeline fell back */
  fellBack: boolean;
}

/**
 * RECS_MODE resolution: "templates" (or unset) runs the deterministic
 * template engine. ANY other value falls back to templates — fail-safe by
 * design, surfaced on the page rather than erroring.
 */
export function recsMode(env: string | undefined = process.env.RECS_MODE): RecsMode {
  const requested = env === undefined || env === "" ? null : env;
  return {
    mode: "templates",
    requested,
    fellBack: requested !== null && requested !== "templates",
  };
}

export interface GovernedCard {
  draft: RecommendationDraft;
  /** the rule engine's card (chips + sparkline binding for the UI) */
  recommendation: Recommendation;
  /** the bundle claims this card cites (the "View evidence" tables) */
  claims: EvidenceClaim[];
  schemaValid: boolean;
  schemaErrors: string[];
  checks: SafetyCheck[];
  /** schema + every safety check passed — render only when true */
  passed: boolean;
  review: {
    queued: boolean;
    reviewedBy: string | null;
    /** ISO date string (serializable to client components) */
    reviewedAt: string | null;
  };
  logId: string;
}

export interface GovernedRecommendations {
  result: RecommendationsResult;
  bundle: EvidenceBundle;
  cards: GovernedCard[];
  mode: RecsMode;
}

/**
 * Runs the full governed pipeline for one participant and logs every
 * rendered (or withheld) card into ModelDecisionLog for the sim date.
 */
export async function renderGovernedRecommendations(
  participantId: string,
  opts: { grants?: GrantSet } = {}
): Promise<GovernedRecommendations> {
  const result = await loadRecommendations(participantId, opts);
  const bundle = buildEvidenceBundle(participantId, result.clockIso, result.inputs);
  const simDate = new Date(`${result.clockIso}T00:00:00Z`);
  const mode = recsMode();

  const cards: GovernedCard[] = [];
  for (const recommendation of result.recommendations) {
    const narrative = buildNarrative(participantId, recommendation, bundle);
    const evidenceClaimIds = claimIdsForRule(recommendation.ruleId, bundle);

    // The engine emits THROUGH the schema: the candidate is plain JSON and
    // must survive validation exactly as an LLM's output would.
    const candidate = {
      model: RECS_MODEL_ID,
      modelVersion: RECS_MODEL_VERSION,
      ruleId: recommendation.ruleId,
      guardrail: recommendation.guardrail,
      title: recommendation.title,
      body: recommendation.body,
      narrative,
      whyChips: recommendation.whyChips.map((chip) => ({
        label: chip.label,
        value: chip.value,
      })),
      evidenceClaimIds,
      sparkline: recommendation.sparkline,
    };
    const validation = validateRecommendationDraft(candidate);

    // A schema-invalid draft still runs the chain on the raw candidate shape
    // (best effort) so the log tells the whole story; it is withheld anyway.
    const draft: RecommendationDraft = validation.ok
      ? validation.draft
      : (candidate as RecommendationDraft);
    const checks = runSafetyChain(draft, bundle);
    const passed = validation.ok && safetyChainPassed(checks);

    const logRow = await recordModelDecision({
      participantId,
      ruleId: recommendation.ruleId,
      guardrail: recommendation.guardrail,
      model: RECS_MODEL_ID,
      modelVersion: RECS_MODEL_VERSION,
      schemaValid: validation.ok,
      checks,
      passed,
      simDate,
    });

    cards.push({
      draft,
      recommendation,
      claims: draft.evidenceClaimIds
        .map((id) => getClaim(bundle, id))
        .filter((claim): claim is EvidenceClaim => claim !== undefined),
      schemaValid: validation.ok,
      schemaErrors: validation.ok ? [] : validation.errors,
      checks,
      passed,
      review: {
        queued: logRow.reviewQueued,
        reviewedBy: logRow.reviewedBy,
        reviewedAt: logRow.reviewedAt?.toISOString() ?? null,
      },
      logId: logRow.id,
    });
  }

  return { result, bundle, cards, mode };
}
