import {
  getDevices,
  getTreatmentEvents,
  grantSetHas,
  loadGrants,
  type GrantSet,
} from "../consent";
import { getParticipant } from "../consent/policyRepo";
import { toIsoDay } from "../format";
import { buildEvidenceBundle } from "../recommendations/evidence";
import { recordModelDecision } from "../recommendations/decisionLog";
import { emptyInputs } from "../recommendations/rules";
import { loadRecommendations } from "../recommendations/queries";
import {
  validateRecommendationDraft,
  type RecommendationDraft,
} from "../recommendations/schema";
import {
  runSafetyChain,
  safetyChainPassed,
  type SafetyCheck,
} from "../recommendations/safety";
import { getSimClock } from "../simclock";
import { emptyAssistantContext, extendBundle, type AssistantContext } from "./claims";
import { classifyIntent, type ChatIntent } from "./intents";
import { CHAIN_REGISTRY, CHAIN_REQUIRED_CLAIMS } from "./registry";
import { buildChatDraft, buildConsentRefusalNotice } from "./replies";

/**
 * AI Care Assistant — chat orchestrator (Addendum A). One path for every
 * turn, the same governed pipeline recommendation cards take:
 *
 *   consent gate → consent-gated reads → scripted draft → zod schema →
 *   SafetyCheck chain (denylist + evidence linkage + guardrail class) →
 *   ModelDecisionLog row → render (or withhold).
 *
 * Governance rails, enforced here:
 * - READS: every data access goes through the consent-gated readers; a
 *   revoked class contributes nulls, and the reply builders answer "no
 *   readable data" instead of guessing.
 * - SILENCING: without a current (registry_demographics, view_identified)
 *   grant the assistant is silenced — no participant data is read at all,
 *   and the generic refusal notice is itself withheld by the chain (its
 *   required claim cannot exist), logging the refusal with passed=false.
 * - CLINICAL TOPICS: pressure changes, diagnosis questions, medications,
 *   and therapy stop/start classify as "clinical" and produce the
 *   decline-and-escalate reply (guardrail "discuss-with-provider"), which
 *   recordModelDecision queues for clinician review — the escalation is on
 *   the record by construction.
 * - LOGGING: every turn (answered, withheld, or refused) writes one
 *   ModelDecisionLog row; the turn id in the logged rule id keeps repeat
 *   turns distinct while page re-renders stay idempotent.
 *
 * ENGINE MODE: the scripted rule-based engine is the only implemented mode
 * and the documented permanent fallback (same posture as RECS_MODE in the
 * recommendation pipeline). ASSISTANT_MODE resolution below is the seam a
 * future governed live model would plug into — behind the SAME schema,
 * chain, and log — and any unrecognized value falls back to "scripted".
 * No network call exists anywhere in this module.
 */

export interface AssistantMode {
  mode: "scripted";
  requested: string | null;
  fellBack: boolean;
}

export function assistantMode(
  env: string | undefined = process.env.ASSISTANT_MODE
): AssistantMode {
  const requested = env === undefined || env === "" ? null : env;
  return {
    mode: "scripted",
    requested,
    fellBack: requested !== null && requested !== "scripted",
  };
}

/** The assistant consent gate: base-record grant for the identified tier. */
export function assistantConsentGranted(grants: GrantSet): boolean {
  return grantSetHas(grants, "registry_demographics", "view_identified");
}

export interface ChatReply {
  ruleId: string;
  guardrail: string;
  title: string;
  body: string;
  chips: { label: string; value: string }[];
}

export interface ChatTurnResult {
  clockIso: string;
  intent: ChatIntent;
  /** consent/lifecycle refused the turn — no data was read */
  silenced: boolean;
  silencedReason: string | null;
  /** the rendered reply; null when silenced or withheld by the chain */
  reply: ChatReply | null;
  escalated: boolean;
  schemaValid: boolean;
  checks: SafetyCheck[];
  passed: boolean;
  logId: string | null;
}

const TURN_ID_PATTERN = /[^a-z0-9-]/gi;

function sanitizeTurnId(turnId: string): string {
  const cleaned = turnId.replace(TURN_ID_PATTERN, "").slice(0, 24);
  return cleaned.length > 0 ? cleaned : `t${Date.now().toString(36)}`;
}

/** Consent-gated assistant context for one participant. */
async function loadAssistantContext(
  participantId: string,
  clockIso: string,
  grants: GrantSet
): Promise<AssistantContext> {
  const clock = new Date(`${clockIso}T00:00:00Z`);
  const [setupRead, deviceRead] = await Promise.all([
    getTreatmentEvents(participantId, {
      use: "view_identified",
      types: ["cpap_setup"],
      grants,
    }),
    getDevices(participantId, { use: "view_identified", grants, classes: ["cpap"] }),
  ]);
  const setup = setupRead.data
    .filter((event) => event.eventDate <= clock)
    .sort((a, b) => a.eventDate.getTime() - b.eventDate.getTime())[0];
  const device = deviceRead.data[0];
  return {
    clockIso,
    consented: assistantConsentGranted(grants),
    cpapSetupIso: setup ? toIsoDay(setup.eventDate) : null,
    daysSinceSetup: setup
      ? Math.floor((clock.getTime() - setup.eventDate.getTime()) / 86_400_000)
      : null,
    cpapLabel: device ? `${device.make} ${device.model}` : null,
    checkinDueIso: null,
    checkinOffsetDays: null,
  };
}

async function logTurn(
  participantId: string,
  draft: RecommendationDraft,
  turnId: string,
  schemaValid: boolean,
  checks: SafetyCheck[],
  passed: boolean,
  clockIso: string
): Promise<string> {
  const row = await recordModelDecision({
    participantId,
    ruleId: `${draft.ruleId}#${turnId}`,
    guardrail: draft.guardrail,
    model: draft.model,
    modelVersion: draft.modelVersion,
    schemaValid,
    checks,
    passed,
    simDate: new Date(`${clockIso}T00:00:00Z`),
  });
  return row.id;
}

/**
 * Runs one chat turn end to end. `turnId` distinguishes repeat turns in the
 * decision log (the client sends a fresh id per message).
 */
export async function runChatTurn(
  participantId: string,
  message: string,
  opts: { turnId: string; grants?: GrantSet }
): Promise<ChatTurnResult> {
  const turnId = sanitizeTurnId(opts.turnId);
  const { intent, clinicalTopic } = classifyIntent(message);

  const participant = await getParticipant(participantId);
  if (!participant) {
    return {
      clockIso: "",
      intent,
      silenced: true,
      silencedReason: "Unknown participant",
      reply: null,
      escalated: false,
      schemaValid: false,
      checks: [],
      passed: false,
      logId: null,
    };
  }

  const alive =
    participant.deletedAt === null &&
    (participant.lifecycleState === "active" ||
      participant.lifecycleState === "deletion_pending");
  if (!alive) {
    // Tombstoned / mid-deletion records get no assistant activity at all —
    // not even an audit row keyed to the deleted id.
    return {
      clockIso: "",
      intent,
      silenced: true,
      silencedReason: "Record lifecycle forbids assistant access",
      reply: null,
      escalated: false,
      schemaValid: false,
      checks: [],
      passed: false,
      logId: null,
    };
  }

  const grants = opts.grants ?? (await loadGrants(participantId));

  if (!assistantConsentGranted(grants)) {
    // SILENCED: no participant data is read. The generic refusal notice runs
    // the same schema + chain; its required claim cannot exist without a
    // grant, so the chain withholds it and the refusal is logged.
    const clockIso = toIsoDay(await getSimClock());
    const draft = buildConsentRefusalNotice();
    const validation = validateRecommendationDraft(draft);
    const bundle = extendBundle(
      buildEvidenceBundle(participantId, clockIso, emptyInputs()),
      emptyAssistantContext(clockIso)
    );
    const checks = runSafetyChain(draft, bundle, {
      registry: CHAIN_REGISTRY,
      requiredClaims: CHAIN_REQUIRED_CLAIMS,
    });
    const logId = await logTurn(
      participantId,
      draft,
      turnId,
      validation.ok,
      checks,
      false,
      clockIso
    );
    return {
      clockIso,
      intent,
      silenced: true,
      silencedReason: "No current consent grant admits the assistant",
      reply: null,
      escalated: false,
      schemaValid: validation.ok,
      checks,
      passed: false,
      logId,
    };
  }

  // Consent-gated reads: the recommendation loader (inputs + clock) plus the
  // assistant context (setup event, device label).
  const result = await loadRecommendations(participantId, { grants });
  const ctx = await loadAssistantContext(participantId, result.clockIso, grants);
  const bundle = extendBundle(
    buildEvidenceBundle(participantId, result.clockIso, result.inputs),
    ctx
  );

  const draft = buildChatDraft(intent, clinicalTopic, { inputs: result.inputs, ctx });
  const validation = validateRecommendationDraft(draft);
  const checks = runSafetyChain(draft, bundle, {
    registry: CHAIN_REGISTRY,
    requiredClaims: CHAIN_REQUIRED_CLAIMS,
  });
  const passed = validation.ok && safetyChainPassed(checks);
  const logId = await logTurn(
    participantId,
    draft,
    turnId,
    validation.ok,
    checks,
    passed,
    result.clockIso
  );

  return {
    clockIso: result.clockIso,
    intent,
    silenced: false,
    silencedReason: null,
    reply: passed
      ? {
          ruleId: draft.ruleId,
          guardrail: draft.guardrail,
          title: draft.title,
          body: draft.body,
          chips: draft.whyChips,
        }
      : null,
    escalated: intent === "clinical" && passed,
    schemaValid: validation.ok,
    checks,
    passed,
    logId,
  };
}

export interface AssistantView {
  clockIso: string;
  consented: boolean;
  /** engine data classes without a current view_identified grant */
  blockedDataClasses: string[];
  cpapLabel: string | null;
  cpapSetupIso: string | null;
  daysSinceSetup: number | null;
  adherencePct30: number | null;
  cpapNights30: number;
  usageLast14Mean: number | null;
  gapStreak: number;
  mode: AssistantMode;
}

/**
 * Page-shell data for the chat screen: consent state + a small snapshot of
 * the same consent-gated numbers the assistant answers from. When the gate
 * refuses, nothing is read and the snapshot is empty.
 */
export async function loadAssistantView(participantId: string): Promise<AssistantView> {
  const grants = await loadGrants(participantId);
  const mode = assistantMode();
  if (!assistantConsentGranted(grants)) {
    return {
      clockIso: toIsoDay(await getSimClock()),
      consented: false,
      blockedDataClasses: [],
      cpapLabel: null,
      cpapSetupIso: null,
      daysSinceSetup: null,
      adherencePct30: null,
      cpapNights30: 0,
      usageLast14Mean: null,
      gapStreak: 0,
      mode,
    };
  }
  const result = await loadRecommendations(participantId, { grants });
  const ctx = await loadAssistantContext(participantId, result.clockIso, grants);
  return {
    clockIso: result.clockIso,
    consented: true,
    blockedDataClasses: result.blockedDataClasses,
    cpapLabel: ctx.cpapLabel,
    cpapSetupIso: ctx.cpapSetupIso,
    daysSinceSetup: ctx.daysSinceSetup,
    adherencePct30: result.inputs.adherencePct30,
    cpapNights30: result.inputs.cpapNights30,
    usageLast14Mean: result.inputs.usageLast14Mean,
    gapStreak: result.inputs.gapStreak,
    mode,
  };
}
