import type { GuardrailClass } from "../recommendations/rules";
import { RULE_GUARDRAILS } from "../recommendations/rules";
import { REQUIRED_CLAIMS } from "../recommendations/evidence";

/**
 * AI Care Assistant rule registry (Addendum A). Every assistant output —
 * chat reply or coach outreach draft — names a rule registered HERE, with
 * its SPEC §10.3 guardrail class and the evidence claims its wording rests
 * on. The registry feeds the EXISTING safety chain
 * (src/lib/recommendations/safety.ts) through its registry parameters:
 * the guardrail-class validator refuses drafts naming unregistered rules,
 * and the claim–evidence-linkage check refuses drafts whose required
 * claims are absent from the consent-scoped bundle — which is exactly what
 * happens the moment a data class is revoked.
 */

export const ASSISTANT_CHAT_MODEL_ID = "assistant-scripted-v1";
export const ASSISTANT_OUTREACH_MODEL_ID = "assistant-outreach-v1";
export const ASSISTANT_MODEL_VERSION = "1.0.0";

interface AssistantRule {
  guardrail: GuardrailClass;
  /** claims the reply's wording rests on — refused when any is absent */
  required: readonly string[];
}

export const ASSISTANT_RULES: Readonly<Record<string, AssistantRule>> = {
  // --- patient-facing chat ---------------------------------------------------
  "chat.greeting": { guardrail: "adherence-support", required: ["assistant.enrollment"] },
  "chat.fallback": { guardrail: "adherence-support", required: ["assistant.enrollment"] },
  "chat.status": {
    guardrail: "adherence-support",
    required: ["cpap.device", "cpap.adherence_30"],
  },
  "chat.status.nodata": { guardrail: "adherence-support", required: ["assistant.enrollment"] },
  "chat.resupply": {
    guardrail: "adherence-support",
    required: ["assistant.enrollment", "cpap.setup"],
  },
  "chat.resupply.nodata": { guardrail: "adherence-support", required: ["assistant.enrollment"] },
  "chat.leak": { guardrail: "adherence-support", required: ["cpap.device"] },
  "chat.dryness": { guardrail: "comfort", required: ["cpap.device"] },
  "chat.comfort": { guardrail: "comfort", required: ["cpap.device"] },
  "chat.troubleshoot.nodata": {
    guardrail: "adherence-support",
    required: ["assistant.enrollment"],
  },
  /** clinical topics: the decline-and-escalate reply, clinician-review queued */
  "chat.escalation": {
    guardrail: "discuss-with-provider",
    required: ["assistant.enrollment"],
  },
  /**
   * The consent-refusal notice. Deliberately registered with a required
   * claim that CANNOT exist for an unconsented participant — so the notice
   * always fails the evidence-linkage check, is withheld, and the refusal
   * lands in the decision log with passed=false. Silencing is enforced by
   * the same chain that governs everything else, not by an ad-hoc branch.
   */
  "chat.consent_refused": {
    guardrail: "adherence-support",
    required: ["assistant.enrollment"],
  },

  // --- coach outreach queue --------------------------------------------------
  "outreach.therapy_gap": {
    guardrail: "adherence-support",
    required: ["cpap.device", "cpap.gap_streak"],
  },
  "outreach.adherence_low": {
    guardrail: "adherence-support",
    required: ["cpap.device", "cpap.adherence_30"],
  },
  "outreach.resupply_due": {
    guardrail: "adherence-support",
    required: ["assistant.enrollment", "cpap.setup"],
  },
  "outreach.checkin_missed": {
    guardrail: "adherence-support",
    required: ["assistant.enrollment", "pro.checkin_due"],
  },
};

export const ASSISTANT_GUARDRAILS: Readonly<Record<string, GuardrailClass>> =
  Object.fromEntries(
    Object.entries(ASSISTANT_RULES).map(([ruleId, rule]) => [ruleId, rule.guardrail])
  );

export const ASSISTANT_REQUIRED_CLAIMS: Readonly<Record<string, readonly string[]>> =
  Object.fromEntries(
    Object.entries(ASSISTANT_RULES).map(([ruleId, rule]) => [ruleId, rule.required])
  );

/**
 * The merged registry the safety chain runs under for assistant drafts:
 * recommendation rules + assistant rules, one namespace. Rule ids are
 * disjoint by construction (chat.* / outreach.* vs the engine's
 * comfort./adherence./provider. families).
 */
export const CHAIN_REGISTRY: Readonly<Record<string, GuardrailClass>> = {
  ...RULE_GUARDRAILS,
  ...ASSISTANT_GUARDRAILS,
};

export const CHAIN_REQUIRED_CLAIMS: Readonly<Record<string, readonly string[]>> = {
  ...REQUIRED_CLAIMS,
  ...ASSISTANT_REQUIRED_CLAIMS,
};
