import type { EvidenceBundle, EvidenceClaim } from "../recommendations/evidence";
import { formatDay } from "../format";

/**
 * Assistant-scoped evidence claims (Addendum A). The assistant extends the
 * recommendation engine's consent-scoped EvidenceBundle with a small set of
 * additional claims, built under the SAME discipline: a claim exists ONLY
 * when the consent-gated read that backs it admitted the data, and each
 * claim names the data class whose grant admitted it. The merged bundle is
 * what the existing evidence-linkage safety check runs against — so an
 * assistant reply citing a claim whose class was revoked fails the chain
 * and is withheld, identically to a recommendation card.
 */

export interface AssistantContext {
  clockIso: string;
  /**
   * The assistant consent gate: a current (registry_demographics,
   * view_identified) grant. Without it the assistant is silenced — no
   * enrollment claim exists, so every generic reply fails linkage.
   */
  consented: boolean;
  /** cpap_setup event date (consent-gated read), null when absent/blocked */
  cpapSetupIso: string | null;
  daysSinceSetup: number | null;
  /** registered CPAP make/model (consent-gated device read) */
  cpapLabel: string | null;
  /** overdue scheduled questionnaire (pro_responses-gated), when present */
  checkinDueIso: string | null;
  checkinOffsetDays: number | null;
}

export function emptyAssistantContext(clockIso: string): AssistantContext {
  return {
    clockIso,
    consented: false,
    cpapSetupIso: null,
    daysSinceSetup: null,
    cpapLabel: null,
    checkinDueIso: null,
    checkinOffsetDays: null,
  };
}

/** Builds the assistant's additional claims from the consent-gated context. */
export function assistantClaims(ctx: AssistantContext): EvidenceClaim[] {
  const claims: EvidenceClaim[] = [];

  if (ctx.consented) {
    claims.push({
      id: "assistant.enrollment",
      dataClass: "registry_demographics",
      statement:
        "A current consent grant covers the base registry record — the assistant may speak",
      query: "loadGrants + policy repository (lifecycle + registry_demographics gate)",
      points: [
        {
          metric: "Assistant consent gate",
          period: `as of ${ctx.clockIso}`,
          value: "granted",
        },
      ],
    });
  }

  if (ctx.cpapSetupIso !== null && ctx.daysSinceSetup !== null) {
    claims.push({
      id: "cpap.setup",
      dataClass: "cpap_telemetry",
      statement: "CPAP setup date on file — supply age is counted from here",
      query: "getTreatmentEvents(use=view_identified, types=[cpap_setup])",
      points: [
        { metric: "CPAP setup", period: "on file", value: formatDay(ctx.cpapSetupIso) },
        {
          metric: "Days since setup",
          period: `as of ${ctx.clockIso}`,
          value: `${ctx.daysSinceSetup} days`,
        },
        ...(ctx.cpapLabel !== null
          ? [{ metric: "Registered machine", period: "current", value: ctx.cpapLabel }]
          : []),
      ],
    });
  }

  if (ctx.checkinDueIso !== null && ctx.checkinOffsetDays !== null) {
    claims.push({
      id: "pro.checkin_due",
      dataClass: "pro_responses",
      statement: "A scheduled questionnaire window passed without a response",
      query: "getProResponses(use=view_identified, instruments=[ESS]) vs enrollment schedule",
      points: [
        {
          metric: `Day-${ctx.checkinOffsetDays} questionnaire due`,
          period: "schedule",
          value: formatDay(ctx.checkinDueIso),
        },
        { metric: "Response received", period: `as of ${ctx.clockIso}`, value: "none" },
      ],
    });
  }

  return claims;
}

/** The recommendation bundle extended with the assistant's claims. */
export function extendBundle(bundle: EvidenceBundle, ctx: AssistantContext): EvidenceBundle {
  return { ...bundle, claims: [...bundle.claims, ...assistantClaims(ctx)] };
}
