import type { ConsentRecord } from "@prisma/client";
import {
  evaluateGrants,
  getProResponses,
  getTreatmentEvents,
  grantSetHas,
  grantsFor,
  loadAllGrants,
  loadGrants,
  type GrantSet,
} from "../consent";
import { getParticipant } from "../consent/policyRepo";
import { prisma } from "../db";
import { toIsoDay } from "../format";
import { getLinkedDisplayNames } from "../identity";
import { recordModelDecision } from "../recommendations/decisionLog";
import { buildEvidenceBundle } from "../recommendations/evidence";
import { loadRecommendations } from "../recommendations/queries";
import { emptyInputs, type RecommendationInputs } from "../recommendations/rules";
import { validateRecommendationDraft } from "../recommendations/schema";
import {
  runSafetyChain,
  safetyChainPassed,
  type SafetyCheck,
} from "../recommendations/safety";
import { getSimClock } from "../simclock";
import { addDays } from "../synthetic/profiles";
import { extendBundle, type AssistantContext } from "./claims";
import { assistantConsentGranted } from "./chat";
import { CHAIN_REGISTRY, CHAIN_REQUIRED_CLAIMS } from "./registry";
import {
  buildOutreachDraft,
  dueResupplyItems,
  OUTREACH_SIGNAL_LABELS,
  type OutreachSignal,
} from "./replies";

/**
 * Coach-facing daily outreach queue (Addendum A) — the assistant's second
 * surface. Queue items are computed LIVE from consent-gated signals in the
 * registry (never stored), drafted through the same schema + SafetyCheck
 * chain + ModelDecisionLog as everything else, and retired by coach
 * decisions recorded in OutreachDecision.
 *
 * This module is one of the approved consent-aware query builders (ESLint
 * policy boundary, same standing as src/lib/coach/queries.ts): the raw
 * aggregates here are always filtered through the cohort grant map before a
 * number or name surfaces, so a revoked participant contributes NO items
 * and NO counts on the very next render.
 *
 * Signals (each gated on its own data class):
 * - therapy_gap:    ≥ 5 straight therapy-gap nights ending at the clock
 *                   (cpap_telemetry)
 * - adherence_low:  < 70% of the last 30 CPAP data nights at ≥ 4 h, with
 *                   ≥ 10 data nights (cpap_telemetry)
 * - resupply_due:   ≥ 90 days since the cpap_setup event with no resupply
 *                   order in the registry — the mask-frame/tubing cadence
 *                   from Sleeptopia's published schedule (cpap_telemetry)
 * - checkin_missed: a day-30/day-90 questionnaire window passed unanswered
 *                   (pro_responses, collect + view — nothing is "due" once
 *                   collection stops)
 *
 * Approving an item RE-RUNS the whole pipeline against CURRENT consent
 * before anything is recorded — a revocation between queue render and
 * click blocks the send and the block itself is logged.
 */

const ADHERENT_NIGHT_MIN = 240; // ≥ 4 h
const ADHERENCE_WINDOW_DAYS = 30;
export const LOW_ADHERENCE_PCT = 70;
export const LOW_ADHERENCE_MIN_NIGHTS = 10;
export const GAP_SIGNAL_NIGHTS = 5;
export const RESUPPLY_DUE_DAYS = 90;
/** Items drafted (and logged) per day — the workable queue size. */
export const QUEUE_CAP = 12;

const DAY_MS = 86_400_000;
const DEMO_COACH = "Sleep coach (demo)";

export const OUTREACH_SIGNALS: OutreachSignal[] = [
  "therapy_gap",
  "adherence_low",
  "resupply_due",
  "checkin_missed",
];

export interface OutreachQueueItem {
  participantId: string;
  /** present only with a current Lane C linkage grant */
  displayName: string | null;
  signal: OutreachSignal;
  signalLabel: string;
  /** the grounded signal statement, e.g. "9 straight therapy-gap nights" */
  signalDetail: string;
  draft: {
    ruleId: string;
    guardrail: string;
    title: string;
    body: string;
    chips: { label: string; value: string }[];
  };
  schemaValid: boolean;
  checks: SafetyCheck[];
  passed: boolean;
  logId: string;
}

export interface OutreachDecisionRow {
  participantId: string;
  displayName: string | null;
  signal: OutreachSignal;
  signalLabel: string;
  status: string;
  decidedBy: string;
  draftTitle: string;
}

export interface OutreachQueue {
  clockIso: string;
  items: OutreachQueueItem[];
  /** pending signal counts (undecided), including beyond the drafted cap */
  totals: Record<OutreachSignal, number>;
  pendingTotal: number;
  cap: number;
  decidedToday: OutreachDecisionRow[];
  queryMs: number;
}

interface SignalCandidate {
  participantId: string;
  signal: OutreachSignal;
  detail: string;
  /** deterministic within-signal ordering key (most urgent first) */
  order: number;
  gapNights?: number;
  adherencePct?: number;
  nights30?: number;
  setupDate?: Date;
  daysSinceSetup?: number;
  checkinDue?: Date;
  checkinOffset?: number;
}

/** Pure schedule math shared by the cohort scan and the per-participant
 *  revalidation: the earliest day-30/day-90 questionnaire window that
 *  closed (5-day grace) with no response within ±10 days. */
export function overdueCheckin(
  enrolledAt: Date,
  responseDates: Date[],
  clock: Date
): { due: Date; offsetDays: number } | null {
  for (const offset of [30, 90]) {
    const due = addDays(enrolledAt, offset);
    if (addDays(due, 5) > clock) continue; // still inside the grace window
    const answered = responseDates.some(
      (administeredAt) => Math.abs(administeredAt.getTime() - due.getTime()) <= 10 * DAY_MS
    );
    if (!answered) return { due, offsetDays: offset };
  }
  return null;
}

function contextFor(
  clockIso: string,
  candidate: SignalCandidate
): AssistantContext {
  return {
    clockIso,
    consented: true,
    cpapSetupIso: candidate.setupDate ? toIsoDay(candidate.setupDate) : null,
    daysSinceSetup: candidate.daysSinceSetup ?? null,
    cpapLabel: null,
    checkinDueIso: candidate.checkinDue ? toIsoDay(candidate.checkinDue) : null,
    checkinOffsetDays: candidate.checkinOffset ?? null,
  };
}

/** Consent-scoped inputs snapshot backing one item's evidence bundle. */
function inputsFor(candidate: SignalCandidate): RecommendationInputs {
  const inputs = emptyInputs();
  if (candidate.signal === "therapy_gap") {
    inputs.hasCpap = true;
    inputs.gapStreak = candidate.gapNights ?? 0;
  }
  if (candidate.signal === "adherence_low") {
    inputs.hasCpap = true;
    inputs.adherencePct30 = candidate.adherencePct ?? null;
    inputs.cpapNights30 = candidate.nights30 ?? 0;
  }
  return inputs;
}

/** Drafts, validates, chains, and logs one queue item. */
async function draftItem(
  clockIso: string,
  candidate: SignalCandidate,
  displayName: string | null,
  ruleSuffix = ""
): Promise<OutreachQueueItem> {
  const ctx = contextFor(clockIso, candidate);
  const bundle = extendBundle(
    buildEvidenceBundle(candidate.participantId, clockIso, inputsFor(candidate)),
    ctx
  );
  const draft = buildOutreachDraft(
    {
      signal: candidate.signal,
      gapNights: candidate.gapNights,
      adherencePct: candidate.adherencePct,
      nights30: candidate.nights30,
    },
    ctx
  );
  const validation = validateRecommendationDraft(draft);
  const checks = runSafetyChain(draft, bundle, {
    registry: CHAIN_REGISTRY,
    requiredClaims: CHAIN_REQUIRED_CLAIMS,
  });
  const passed = validation.ok && safetyChainPassed(checks);
  const row = await recordModelDecision({
    participantId: candidate.participantId,
    ruleId: `${draft.ruleId}${ruleSuffix}`,
    guardrail: draft.guardrail,
    model: draft.model,
    modelVersion: draft.modelVersion,
    schemaValid: validation.ok,
    checks,
    passed,
    simDate: new Date(`${clockIso}T00:00:00Z`),
  });
  return {
    participantId: candidate.participantId,
    displayName,
    signal: candidate.signal,
    signalLabel: OUTREACH_SIGNAL_LABELS[candidate.signal],
    signalDetail: candidate.detail,
    draft: {
      ruleId: draft.ruleId,
      guardrail: draft.guardrail,
      title: draft.title,
      body: draft.body,
      chips: draft.whyChips,
    },
    schemaValid: validation.ok,
    checks,
    passed,
    logId: row.id,
  };
}

/**
 * Builds today's queue. Every number and name passes the consent gate; a
 * decision recorded for (participant, signal) today retires the item.
 */
export async function loadOutreachQueue(): Promise<OutreachQueue> {
  const startedAt = performance.now();
  const clock = await getSimClock();
  const clockIso = toIsoDay(clock);
  const windowFrom = addDays(clock, -ADHERENCE_WINDOW_DAYS);

  const [allGrants, participants, laneARecords, decisions] = await Promise.all([
    loadAllGrants(),
    prisma.participant.findMany({
      where: { deletedAt: null, lifecycleState: { in: ["active", "deletion_pending"] } },
      select: { id: true, createdAt: true },
    }),
    prisma.consentRecord.findMany({ where: { instrumentType: "LANE_A" } }),
    prisma.outreachDecision.findMany({ where: { simDate: clock } }),
  ]);

  // Coach roster: a CURRENT granted Lane A (same rule as the coach portal)
  // plus the assistant's own gate. A revoked participant is on neither.
  const laneAByParticipant = new Map<string, ConsentRecord[]>();
  for (const record of laneARecords) {
    const list = laneAByParticipant.get(record.participantId) ?? [];
    list.push(record);
    laneAByParticipant.set(record.participantId, list);
  }
  const roster = participants.filter((participant) => {
    const records = laneAByParticipant.get(participant.id);
    if (!records || evaluateGrants(records).size === 0) return false;
    return assistantConsentGranted(grantsFor(allGrants, participant.id));
  });
  const rosterIds = new Set(roster.map((participant) => participant.id));
  const enrolledAt = new Map(roster.map((p) => [p.id, p.createdAt]));

  const canView = (participantId: string, dataClass: "cpap_telemetry" | "pro_responses") =>
    grantSetHas(grantsFor(allGrants, participantId), dataClass, "view_identified");

  const [gapGroups, denomGroups, numerGroups, cpapSetups, essResponses] = await Promise.all([
    prisma.observation.groupBy({
      by: ["participantId"],
      where: {
        concept: "therapy_gap",
        effectiveDate: { gt: addDays(clock, -GAP_SIGNAL_NIGHTS), lte: clock },
      },
      _count: { _all: true },
    }),
    prisma.observation.groupBy({
      by: ["participantId"],
      where: {
        concept: { in: ["cpap_usage_minutes", "therapy_gap"] },
        effectiveDate: { gt: windowFrom, lte: clock },
      },
      _count: { _all: true },
    }),
    prisma.observation.groupBy({
      by: ["participantId"],
      where: {
        concept: "cpap_usage_minutes",
        valueNumeric: { gte: ADHERENT_NIGHT_MIN },
        effectiveDate: { gt: windowFrom, lte: clock },
      },
      _count: { _all: true },
    }),
    prisma.treatmentEvent.findMany({
      where: { type: "cpap_setup", eventDate: { lte: clock } },
      select: { participantId: true, eventDate: true },
    }),
    prisma.proResponse.findMany({
      where: { instrument: "ESS" },
      select: { participantId: true, administeredAt: true },
    }),
  ]);

  // --- therapy_gap ------------------------------------------------------------
  const gapIds = gapGroups
    .filter(
      (group) =>
        group._count._all >= GAP_SIGNAL_NIGHTS &&
        rosterIds.has(group.participantId) &&
        canView(group.participantId, "cpap_telemetry")
    )
    .map((group) => group.participantId);
  const lastUsageGroups = gapIds.length
    ? await prisma.observation.groupBy({
        by: ["participantId"],
        where: { concept: "cpap_usage_minutes", participantId: { in: gapIds } },
        _max: { effectiveDate: true },
      })
    : [];
  const lastUsage = new Map(
    lastUsageGroups.map((group) => [group.participantId, group._max.effectiveDate as Date])
  );
  const setupByParticipant = new Map<string, Date>();
  for (const setup of cpapSetups) {
    const existing = setupByParticipant.get(setup.participantId);
    if (!existing || setup.eventDate < existing) {
      setupByParticipant.set(setup.participantId, setup.eventDate);
    }
  }
  const gapCandidates: SignalCandidate[] = gapIds.map((participantId) => {
    const since = addDays(
      lastUsage.get(participantId) ?? setupByParticipant.get(participantId) ?? clock,
      1
    );
    const nights = Math.max(
      GAP_SIGNAL_NIGHTS,
      Math.floor((clock.getTime() - since.getTime()) / DAY_MS) + 1
    );
    return {
      participantId,
      signal: "therapy_gap",
      detail: `${nights} straight therapy-gap nights`,
      order: -nights,
      gapNights: nights,
    };
  });
  const gapSet = new Set(gapIds);

  // --- adherence_low ----------------------------------------------------------
  const numerators = new Map(
    numerGroups.map((group) => [group.participantId, group._count._all])
  );
  const adherenceCandidates: SignalCandidate[] = [];
  for (const group of denomGroups) {
    const participantId = group.participantId;
    const nights = group._count._all;
    if (!rosterIds.has(participantId) || gapSet.has(participantId)) continue;
    if (!canView(participantId, "cpap_telemetry")) continue;
    if (nights < LOW_ADHERENCE_MIN_NIGHTS) continue;
    const pct = ((numerators.get(participantId) ?? 0) / nights) * 100;
    if (pct >= LOW_ADHERENCE_PCT) continue;
    adherenceCandidates.push({
      participantId,
      signal: "adherence_low",
      detail: `4+ hours on ${Math.round(pct)}% of the last ${nights} data nights`,
      order: pct,
      adherencePct: pct,
      nights30: nights,
    });
  }

  // --- resupply_due -----------------------------------------------------------
  const resupplyCandidates: SignalCandidate[] = [];
  for (const [participantId, setupDate] of setupByParticipant) {
    if (!rosterIds.has(participantId)) continue;
    if (!canView(participantId, "cpap_telemetry")) continue;
    const daysSince = Math.floor((clock.getTime() - setupDate.getTime()) / DAY_MS);
    if (daysSince < RESUPPLY_DUE_DAYS) continue;
    resupplyCandidates.push({
      participantId,
      signal: "resupply_due",
      detail: `${daysSince} days since setup — ${dueResupplyItems(daysSince).length} item groups due`,
      order: -daysSince,
      setupDate,
      daysSinceSetup: daysSince,
    });
  }

  // --- checkin_missed ---------------------------------------------------------
  const essByParticipant = new Map<string, Date[]>();
  for (const response of essResponses) {
    const list = essByParticipant.get(response.participantId) ?? [];
    list.push(response.administeredAt);
    essByParticipant.set(response.participantId, list);
  }
  const checkinCandidates: SignalCandidate[] = [];
  for (const participant of roster) {
    const participantGrants = grantsFor(allGrants, participant.id);
    // Once collection stops, nothing is "due" — same rule as the coach flags.
    if (
      !grantSetHas(participantGrants, "pro_responses", "collect") ||
      !grantSetHas(participantGrants, "pro_responses", "view_identified")
    ) {
      continue;
    }
    const overdue = overdueCheckin(
      enrolledAt.get(participant.id) as Date,
      essByParticipant.get(participant.id) ?? [],
      clock
    );
    if (!overdue) continue;
    checkinCandidates.push({
      participantId: participant.id,
      signal: "checkin_missed",
      detail: `Day-${overdue.offsetDays} questionnaire due ${toIsoDay(overdue.due)}, not received`,
      order: overdue.due.getTime(),
      checkinDue: overdue.due,
      checkinOffset: overdue.offsetDays,
    });
  }

  // --- assemble: filter decided, count totals, draft the cap -----------------
  const decidedKeys = new Set(
    decisions.map((decision) => `${decision.participantId}|${decision.signal}`)
  );
  const bySignal: Record<OutreachSignal, SignalCandidate[]> = {
    therapy_gap: gapCandidates,
    adherence_low: adherenceCandidates,
    resupply_due: resupplyCandidates,
    checkin_missed: checkinCandidates,
  };
  const totals = {} as Record<OutreachSignal, number>;
  const pending: SignalCandidate[] = [];
  for (const signal of OUTREACH_SIGNALS) {
    const open = bySignal[signal]
      .filter((candidate) => !decidedKeys.has(`${candidate.participantId}|${candidate.signal}`))
      .sort(
        (a, b) => a.order - b.order || a.participantId.localeCompare(b.participantId)
      );
    totals[signal] = open.length;
    pending.push(...open);
  }
  const drafted = pending.slice(0, QUEUE_CAP);

  const names = await getLinkedDisplayNames(
    [...new Set([...drafted.map((c) => c.participantId), ...decisions.map((d) => d.participantId)])],
    { grants: allGrants }
  );

  const items: OutreachQueueItem[] = [];
  for (const candidate of drafted) {
    items.push(
      await draftItem(clockIso, candidate, names.get(candidate.participantId) ?? null)
    );
  }

  const decidedToday: OutreachDecisionRow[] = decisions
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((decision) => ({
      participantId: decision.participantId,
      displayName: names.get(decision.participantId) ?? null,
      signal: decision.signal as OutreachSignal,
      signalLabel:
        OUTREACH_SIGNAL_LABELS[decision.signal as OutreachSignal] ?? decision.signal,
      status: decision.status,
      decidedBy: decision.decidedBy,
      draftTitle: decision.draftTitle,
    }));

  return {
    clockIso,
    items,
    totals,
    pendingTotal: pending.length,
    cap: QUEUE_CAP,
    decidedToday,
    queryMs: Math.round(performance.now() - startedAt),
  };
}

export interface DecisionOutcome {
  ok: boolean;
  reason?: string;
}

/**
 * Re-derives one participant's signal from CURRENT consent-gated data —
 * the revalidation approvals rest on. Returns null when the signal no
 * longer holds (data moved on, or consent was revoked).
 */
async function revalidateSignal(
  participantId: string,
  signal: OutreachSignal,
  clock: Date,
  grants: GrantSet
): Promise<SignalCandidate | null> {
  if (signal === "therapy_gap" || signal === "adherence_low") {
    const result = await loadRecommendations(participantId, { grants });
    const inputs = result.inputs;
    if (signal === "therapy_gap") {
      if (!inputs.hasCpap || inputs.gapStreak < GAP_SIGNAL_NIGHTS) return null;
      return {
        participantId,
        signal,
        detail: `${inputs.gapStreak} straight therapy-gap nights`,
        order: -inputs.gapStreak,
        gapNights: inputs.gapStreak,
      };
    }
    if (
      !inputs.hasCpap ||
      inputs.adherencePct30 === null ||
      inputs.cpapNights30 < LOW_ADHERENCE_MIN_NIGHTS ||
      inputs.adherencePct30 >= LOW_ADHERENCE_PCT
    ) {
      return null;
    }
    return {
      participantId,
      signal,
      detail: `4+ hours on ${Math.round(inputs.adherencePct30)}% of the last ${inputs.cpapNights30} data nights`,
      order: inputs.adherencePct30,
      adherencePct: inputs.adherencePct30,
      nights30: inputs.cpapNights30,
    };
  }

  if (signal === "resupply_due") {
    if (!grantSetHas(grants, "cpap_telemetry", "view_identified")) return null;
    const setupRead = await getTreatmentEvents(participantId, {
      use: "view_identified",
      types: ["cpap_setup"],
      grants,
    });
    const setup = setupRead.data
      .filter((event) => event.eventDate <= clock)
      .sort((a, b) => a.eventDate.getTime() - b.eventDate.getTime())[0];
    if (!setup) return null;
    const daysSince = Math.floor((clock.getTime() - setup.eventDate.getTime()) / DAY_MS);
    if (daysSince < RESUPPLY_DUE_DAYS) return null;
    return {
      participantId,
      signal,
      detail: `${daysSince} days since setup`,
      order: -daysSince,
      setupDate: setup.eventDate,
      daysSinceSetup: daysSince,
    };
  }

  // checkin_missed
  if (
    !grantSetHas(grants, "pro_responses", "collect") ||
    !grantSetHas(grants, "pro_responses", "view_identified")
  ) {
    return null;
  }
  const participant = await getParticipant(participantId);
  if (!participant) return null;
  const responses = await getProResponses(participantId, {
    use: "view_identified",
    instruments: ["ESS"],
    grants,
  });
  const overdue = overdueCheckin(
    participant.createdAt,
    responses.data.map((response) => response.administeredAt),
    clock
  );
  if (!overdue) return null;
  return {
    participantId,
    signal,
    detail: `Day-${overdue.offsetDays} questionnaire due ${toIsoDay(overdue.due)}, not received`,
    order: overdue.due.getTime(),
    checkinDue: overdue.due,
    checkinOffset: overdue.offsetDays,
  };
}

/**
 * Records a coach decision on one queue item. Approve re-runs the FULL
 * pipeline (fresh consent-gated signal + schema + safety chain) and
 * refuses when anything fails — the refusal is itself logged. Both
 * outcomes append a `…#approved` / `…#skipped` decision row to the model
 * log and an OutreachDecision row that retires the item for today.
 */
export async function decideOutreach(
  participantId: string,
  signal: OutreachSignal,
  status: "approved" | "skipped",
  opts: { decidedBy?: string } = {}
): Promise<DecisionOutcome> {
  if (!OUTREACH_SIGNALS.includes(signal)) {
    return { ok: false, reason: "Unknown signal" };
  }
  const decidedBy = opts.decidedBy ?? DEMO_COACH;
  const clock = await getSimClock();
  const clockIso = toIsoDay(clock);

  const participant = await getParticipant(participantId);
  const alive =
    participant !== null &&
    participant.deletedAt === null &&
    (participant.lifecycleState === "active" ||
      participant.lifecycleState === "deletion_pending");
  if (!alive) return { ok: false, reason: "Record lifecycle forbids outreach" };

  const grants = await loadGrants(participantId);
  if (!assistantConsentGranted(grants)) {
    return { ok: false, reason: "Consent revoked — the item has left the queue" };
  }

  const candidate = await revalidateSignal(participantId, signal, clock, grants);
  if (!candidate) {
    return {
      ok: false,
      reason: "Signal no longer present against current consent — item retired",
    };
  }

  const names = await getLinkedDisplayNames([participantId]);
  const item = await draftItem(
    clockIso,
    candidate,
    names.get(participantId) ?? null,
    `#${status}`
  );

  if (status === "approved" && !item.passed) {
    return {
      ok: false,
      reason: "Safety chain failed at approval — send blocked (and logged)",
    };
  }

  try {
    await prisma.outreachDecision.create({
      data: {
        participantId,
        signal,
        status,
        decidedBy,
        simDate: clock,
        draftTitle: item.draft.title,
        draftBody: item.draft.body,
        logId: item.logId,
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      return { ok: false, reason: "Already decided for this queue day" };
    }
    throw error;
  }
  return { ok: true };
}
