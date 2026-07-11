import type { DataClass } from "../consent";
import type { RecommendationInputs } from "./rules";

/**
 * Evidence-first pipeline (audit level-up 12): every recommendation card is
 * generated FROM a typed EvidenceBundle — a set of claims, each linked to
 * the exact data points and the consent-gated query that produced them —
 * never from free-floating prose. The bundle is built from the
 * consent-scoped RecommendationInputs (loadRecommendations reads only
 * through the gated readers), so a revoked data class simply has no claims:
 * nothing citing it can pass the safety chain's claim-evidence-linkage
 * check, today for the template engine and identically for a future
 * governed LLM.
 *
 * Plain JSON-serializable shapes throughout — the bundle crosses to the
 * client for the "View evidence" expander (claim → data table).
 */

/** One row of the evidence table behind a claim. */
export interface EvidencePoint {
  metric: string;
  period: string;
  value: string;
}

export interface EvidenceClaim {
  /** stable claim id, e.g. "cpap.adherence_30" */
  id: string;
  /** the data class whose consent grant admitted this claim */
  dataClass: DataClass;
  /** plain-language statement of what the data supports */
  statement: string;
  /** the consent-gated query that produced the points (provenance) */
  query: string;
  points: EvidencePoint[];
}

export interface EvidenceBundle {
  participantId: string;
  clockIso: string;
  claims: EvidenceClaim[];
  /**
   * The consent-scoped inputs snapshot the claims were derived from — the
   * template builders read their numbers from here, so narrative text and
   * claim tables can never cite different values.
   */
  inputs: RecommendationInputs;
}

export function getClaim(bundle: EvidenceBundle, id: string): EvidenceClaim | undefined {
  return bundle.claims.find((claim) => claim.id === id);
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const hoursText = (min: number): string => `${(min / 60).toFixed(1)} h`;

const OBS_QUERY = (concepts: string[], window: string) =>
  `getObservations(use=view_identified, concepts=[${concepts.join(", ")}], ${window})`;

/**
 * Derives the participant's evidence claims from the consent-scoped inputs.
 * A claim appears ONLY when its backing values cleared the read gate (nulls
 * — revoked or absent — produce no claim), which is exactly the property the
 * evidence-linkage safety check enforces on every draft.
 */
export function buildEvidenceBundle(
  participantId: string,
  clockIso: string,
  inputs: RecommendationInputs
): EvidenceBundle {
  const claims: EvidenceClaim[] = [];

  // --- hst_clinical -----------------------------------------------------------
  if (inputs.supineAhi !== null && inputs.nonsupineAhi !== null) {
    claims.push({
      id: "hst.positional_split",
      dataClass: "hst_clinical",
      statement:
        "The sleep study recorded more breathing interruptions on the back than off it",
      query: OBS_QUERY(["supine_ahi", "nonsupine_ahi"], "baseline HST"),
      points: [
        {
          metric: "Events per hour, back-sleeping",
          period: "baseline sleep study",
          value: `${round1(inputs.supineAhi)} events/h`,
        },
        {
          metric: "Events per hour, off the back",
          period: "baseline sleep study",
          value: `${round1(inputs.nonsupineAhi)} events/h`,
        },
      ],
    });
  }

  // --- sleep_mat ---------------------------------------------------------------
  if (inputs.recentSupinePct !== null) {
    claims.push({
      id: "sleep_mat.recent_supine",
      dataClass: "sleep_mat",
      statement: "The under-mattress sensor still sees substantial back-sleeping time",
      query: OBS_QUERY(["supine_time_pct"], "last 14 nights"),
      points: [
        {
          metric: "Mean nightly back-sleeping share",
          period: "last 14 nights",
          value: `${round1(inputs.recentSupinePct)}%`,
        },
      ],
    });
  }

  // --- mattress_purchase ---------------------------------------------------------
  if (inputs.mattressLabel !== null && inputs.mattressFirmness !== null) {
    claims.push({
      id: "mattress.current",
      dataClass: "mattress_purchase",
      statement: "The current mattress and its firmness rating",
      query: "getMattressPurchases(use=view_identified) + catalog facts",
      points: [
        { metric: "Mattress", period: "current", value: inputs.mattressLabel },
        {
          metric: "Firmness (normalized 1–10)",
          period: "current",
          value: `${inputs.mattressFirmness}/10`,
        },
      ],
    });
  }

  // --- cpap_telemetry -------------------------------------------------------------
  if (inputs.hasCpap) {
    claims.push({
      id: "cpap.device",
      dataClass: "cpap_telemetry",
      statement: "A CPAP device is registered and consented for telemetry",
      query: "getDevices(use=view_identified, classes=[cpap])",
      points: [{ metric: "CPAP device registered", period: "current", value: "yes" }],
    });
  }
  if (inputs.adherencePct30 !== null) {
    claims.push({
      id: "cpap.adherence_30",
      dataClass: "cpap_telemetry",
      statement: "CPAP adherence over the last 30 therapy nights",
      query: OBS_QUERY(["cpap_usage_minutes", "therapy_gap"], "last 30 nights"),
      points: [
        {
          metric: "Nights at 4+ hours",
          period: "last 30 days",
          value: `${Math.round(inputs.adherencePct30)}% of ${inputs.cpapNights30} nights`,
        },
      ],
    });
  }
  if (inputs.usageLast14Mean !== null) {
    claims.push({
      id: "cpap.usage_trend",
      dataClass: "cpap_telemetry",
      statement: "Nightly CPAP usage, recent vs prior",
      query: OBS_QUERY(["cpap_usage_minutes"], "last 6 weeks"),
      points: [
        {
          metric: "Mean nightly use",
          period: "last 2 weeks",
          value: `${hoursText(inputs.usageLast14Mean)}/night`,
        },
        ...(inputs.usagePrior28Mean !== null
          ? [
              {
                metric: "Mean nightly use",
                period: "prior 4 weeks",
                value: `${hoursText(inputs.usagePrior28Mean)}/night`,
              },
            ]
          : []),
      ],
    });
  }
  if (inputs.leakLast14Mean !== null) {
    claims.push({
      id: "cpap.leak_trend",
      dataClass: "cpap_telemetry",
      statement: "Mask leak, recent vs prior",
      query: OBS_QUERY(["mask_leak_p95"], "last 4 weeks"),
      points: [
        {
          metric: "Mean p95 mask leak",
          period: "last 2 weeks",
          value: `${round1(inputs.leakLast14Mean)} L/min`,
        },
        ...(inputs.leakPrior14Mean !== null
          ? [
              {
                metric: "Mean p95 mask leak",
                period: "prior 2 weeks",
                value: `${round1(inputs.leakPrior14Mean)} L/min`,
              },
            ]
          : []),
      ],
    });
  }
  if (inputs.hasCpap && inputs.gapStreak > 0) {
    claims.push({
      id: "cpap.gap_streak",
      dataClass: "cpap_telemetry",
      statement: "Consecutive nights without a recorded CPAP session",
      query: OBS_QUERY(["therapy_gap"], "ending at the sim clock"),
      points: [
        {
          metric: "Nights without a session",
          period: "ending tonight",
          value: `${inputs.gapStreak} in a row`,
        },
      ],
    });
  }
  if (inputs.residualLast14Mean !== null && inputs.residualPrior14Mean !== null) {
    claims.push({
      id: "cpap.residual_trend",
      dataClass: "cpap_telemetry",
      statement: "The machine's nightly event index, recent vs prior",
      query: OBS_QUERY(["residual_ahi"], "last 4 weeks"),
      points: [
        {
          metric: "Mean event index",
          period: "last 2 weeks",
          value: `${round1(inputs.residualLast14Mean)} events/h`,
        },
        {
          metric: "Mean event index",
          period: "prior 2 weeks",
          value: `${round1(inputs.residualPrior14Mean)} events/h`,
        },
      ],
    });
  }

  // --- wearable_sleep --------------------------------------------------------------
  if (inputs.lowSpo2NightsLast14 !== null && inputs.lowSpo2NightsPrior14 !== null) {
    claims.push({
      id: "wearable.low_spo2",
      dataClass: "wearable_sleep",
      statement: "Nights with mean overnight SpO2 below 92%, recent vs prior",
      query: OBS_QUERY(["spo2_mean"], "last 4 weeks"),
      points: [
        {
          metric: "Nights under 92% SpO2",
          period: "last 2 weeks",
          value: `${inputs.lowSpo2NightsLast14} nights`,
        },
        {
          metric: "Nights under 92% SpO2",
          period: "prior 2 weeks",
          value: `${inputs.lowSpo2NightsPrior14} nights`,
        },
      ],
    });
  }

  return { participantId, clockIso, claims, inputs };
}

/**
 * The claims each rule's wording RESTS on — the evidence-linkage contract.
 * A rule can only have fired if these inputs were non-null, so these claims
 * must exist in the bundle; a draft that fired without them (e.g. built
 * against a stale bundle after a class revocation) fails the safety chain.
 */
export const REQUIRED_CLAIMS: Readonly<Record<string, readonly string[]>> = {
  "comfort.positional": ["hst.positional_split", "sleep_mat.recent_supine"],
  "adherence.streak": ["cpap.device", "cpap.adherence_30"],
  "adherence.refit": ["cpap.device", "cpap.leak_trend"],
  "adherence.decline": ["cpap.device", "cpap.usage_trend"],
  "adherence.reengage": ["cpap.device", "cpap.gap_streak"],
  "provider.residual": ["cpap.device", "cpap.residual_trend"],
  "provider.spo2": ["wearable.low_spo2"],
};

/** Optional claims that enrich a rule's evidence when present. */
const OPTIONAL_CLAIMS: Readonly<Record<string, readonly string[]>> = {
  "comfort.positional": ["mattress.current"],
  "adherence.streak": ["cpap.usage_trend"],
};

/** Claim ids a rendered card should cite: required + present optional. */
export function claimIdsForRule(ruleId: string, bundle: EvidenceBundle): string[] {
  const required = REQUIRED_CLAIMS[ruleId] ?? [];
  const optional = (OPTIONAL_CLAIMS[ruleId] ?? []).filter(
    (id) => getClaim(bundle, id) !== undefined
  );
  return [...required, ...optional];
}
