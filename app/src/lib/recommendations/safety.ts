import { getClaim, REQUIRED_CLAIMS, type EvidenceBundle } from "./evidence";
import type { RecommendationDraft } from "./schema";
import { RULE_GUARDRAILS } from "./rules";

/**
 * SafetyCheck chain (audit level-up 12): the banned-phrase denylist —
 * previously a test-only discipline — is now ONE layer of a runtime chain
 * every draft passes through before rendering:
 *
 *   1. denylist          — no diagnosis language, no therapy-change
 *                          directives, no "quit" framing (SPEC §10.3);
 *   2. evidence_linkage  — every cited claim exists in the consent-scoped
 *                          EvidenceBundle AND the rule's required claims are
 *                          all cited: a card can never rest on data whose
 *                          class was revoked;
 *   3. guardrail_class   — the draft's guardrail matches the registered
 *                          rule's class, and provider-class drafts route to
 *                          the provider without interpreting for them.
 *
 * Every check's outcome is logged per rendered card into ModelDecisionLog
 * (decisionLog.ts) and displayed at /compliance/model-log. A failed check
 * withholds the card. The chain is engine-agnostic: a governed LLM's drafts
 * run through exactly these functions.
 */

/**
 * The non-device-CDS boundary as text (SPEC §10.3): no diagnosis language,
 * no therapy-change directives, no "quit" framing. Checked lowercased,
 * substring match, across every rendered string.
 */
export const BANNED_PHRASES = [
  "you have",
  "diagnos", // diagnosis, diagnose, diagnosed, diagnostic
  "increase your pressure",
  "decrease your pressure",
  "change your pressure",
  "adjust your pressure",
  "stop using",
  "stop your",
  "quit",
  "you suffer",
  "your condition",
  "prescri", // prescribe, prescription
] as const;

export type SafetyCheckId = "denylist" | "evidence_linkage" | "guardrail_class";

export interface SafetyCheck {
  id: SafetyCheckId;
  label: string;
  passed: boolean;
  detail: string;
}

/** Every string surface of a draft, joined and lowercased. */
function textSurface(draft: RecommendationDraft): string {
  return [
    draft.title,
    draft.body,
    draft.narrative,
    ...draft.whyChips.flatMap((chip) => [chip.label, chip.value]),
  ]
    .join(" ")
    .toLowerCase();
}

export function denylistCheck(draft: RecommendationDraft): SafetyCheck {
  const surface = textSurface(draft);
  const hits = BANNED_PHRASES.filter((phrase) => surface.includes(phrase));
  return {
    id: "denylist",
    label: "Banned-phrase denylist",
    passed: hits.length === 0,
    detail:
      hits.length === 0
        ? `${BANNED_PHRASES.length} phrases screened across title/body/narrative/chips`
        : `banned phrase(s) found: ${hits.join(", ")}`,
  };
}

export function evidenceLinkageCheck(
  draft: RecommendationDraft,
  bundle: EvidenceBundle
): SafetyCheck {
  const missing = draft.evidenceClaimIds.filter((id) => getClaim(bundle, id) === undefined);
  const required = REQUIRED_CLAIMS[draft.ruleId] ?? [];
  const uncited = required.filter((id) => !draft.evidenceClaimIds.includes(id));
  const passed = missing.length === 0 && uncited.length === 0;
  return {
    id: "evidence_linkage",
    label: "Claim–evidence linkage",
    passed,
    detail: passed
      ? `${draft.evidenceClaimIds.length} cited claim(s) present in the consent-scoped bundle`
      : [
          missing.length > 0
            ? `cited claim(s) absent from the consent-scoped bundle: ${missing.join(", ")}`
            : null,
          uncited.length > 0
            ? `required claim(s) not cited: ${uncited.join(", ")}`
            : null,
        ]
          .filter(Boolean)
          .join("; "),
  };
}

export function guardrailClassCheck(draft: RecommendationDraft): SafetyCheck {
  const registered = RULE_GUARDRAILS[draft.ruleId];
  if (registered === undefined) {
    return {
      id: "guardrail_class",
      label: "Guardrail-class validator",
      passed: false,
      detail: `unknown rule "${draft.ruleId}" — drafts may only render registered rules`,
    };
  }
  if (registered !== draft.guardrail) {
    return {
      id: "guardrail_class",
      label: "Guardrail-class validator",
      passed: false,
      detail: `guardrail "${draft.guardrail}" does not match the registered class "${registered}" for ${draft.ruleId}`,
    };
  }
  if (
    draft.guardrail === "discuss-with-provider" &&
    !`${draft.title} ${draft.body}`.toLowerCase().includes("provider")
  ) {
    return {
      id: "guardrail_class",
      label: "Guardrail-class validator",
      passed: false,
      detail: "provider-class card must route the signal to the provider explicitly",
    };
  }
  return {
    id: "guardrail_class",
    label: "Guardrail-class validator",
    passed: true,
    detail: `guardrail "${draft.guardrail}" matches the registered class for ${draft.ruleId}`,
  };
}

/** Runs the full chain in order; the card renders only if every check passes. */
export function runSafetyChain(
  draft: RecommendationDraft,
  bundle: EvidenceBundle
): SafetyCheck[] {
  return [denylistCheck(draft), evidenceLinkageCheck(draft, bundle), guardrailClassCheck(draft)];
}

export function safetyChainPassed(checks: SafetyCheck[]): boolean {
  return checks.every((check) => check.passed);
}
