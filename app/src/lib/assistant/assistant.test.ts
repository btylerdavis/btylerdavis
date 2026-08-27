import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { revokeDataClass } from "../compliance/revocation";
import { grantConsent, revokeConsent } from "../consent";
import { prisma } from "../db";
import { listModelDecisions } from "../recommendations/decisionLog";
import { buildEvidenceBundle } from "../recommendations/evidence";
import { emptyInputs, type RecommendationInputs } from "../recommendations/rules";
import { validateRecommendationDraft } from "../recommendations/schema";
import { denylistCheck } from "../recommendations/safety";
import { setSimClock } from "../simclock";
import { addDays } from "../synthetic/profiles";
import { assistantMode, loadAssistantView, runChatTurn } from "./chat";
import { emptyAssistantContext, extendBundle, type AssistantContext } from "./claims";
import { classifyIntent } from "./intents";
import {
  ASSISTANT_CHAT_MODEL_ID,
  ASSISTANT_OUTREACH_MODEL_ID,
  ASSISTANT_RULES,
} from "./registry";
import {
  buildChatDraft,
  buildConsentRefusalNotice,
  buildOutreachDraft,
  dueResupplyItems,
  type OutreachSignal,
} from "./replies";
import { decideOutreach, loadOutreachQueue, overdueCheckin } from "./queue";

/**
 * AI Care Assistant governance tests (Addendum A): consent gating,
 * revocation silencing, decision-log writes, clinical-topic escalation,
 * and queue approval — all through the platform's EXISTING schema +
 * SafetyCheck chain + ModelDecisionLog, never a parallel path.
 */

const SIM_TODAY = new Date(Date.UTC(2026, 5, 30));

// ---------------------------------------------------------------------------
// Intent classification (pure)
// ---------------------------------------------------------------------------

describe("intent classification", () => {
  it("clinical topics match first and escalate", () => {
    const cases: [string, string][] = [
      ["Should I turn my pressure up a bit?", "pressure settings"],
      ["can you change my pressure to 12", "pressure settings"],
      ["do I have severe sleep apnea?", "test results or severity"],
      ["what does my AHI mean", "test results or severity"],
      ["should I take melatonin with this?", "medications"],
      ["I want to quit cpap", "starting or stopping therapy"],
      ["thinking about stopping the machine for a while", "starting or stopping therapy"],
    ];
    for (const [message, topic] of cases) {
      const match = classifyIntent(message);
      expect(match.intent, message).toBe("clinical");
      expect(match.clinicalTopic, message).toBe(topic);
    }
  });

  it("clinical beats troubleshooting when both appear", () => {
    // A leak complaint that asks for a pressure change must escalate.
    const match = classifyIntent("my mask leaks — should I lower the pressure?");
    expect(match.intent).toBe("clinical");
  });

  it("routes the everyday intents", () => {
    expect(classifyIntent("my mask keeps leaking air into my eyes").intent).toBe("leak");
    expect(classifyIntent("my nose is so dry in the morning").intent).toBe("dryness");
    expect(classifyIntent("when should I replace my cushion?").intent).toBe("resupply");
    expect(classifyIntent("how am I doing this month?").intent).toBe("adherence");
    expect(classifyIntent("I can't get used to the mask").intent).toBe("comfort");
    expect(classifyIntent("hello").intent).toBe("greeting");
    expect(classifyIntent("tell me about the weather").intent).toBe("unknown");
  });

  it("only a bare/short 'help' greets — help plus a real problem routes on the problem", () => {
    expect(classifyIntent("help").intent).toBe("greeting");
    expect(classifyIntent("Help!").intent).toBe("greeting");
    expect(classifyIntent("help me please").intent).toBe("greeting");
    expect(classifyIntent("help I keep taking off the mask at 2am").intent).toBe("comfort");
    expect(classifyIntent("help my nose is so dry every morning").intent).toBe("dryness");
    expect(classifyIntent("help my mask leaks all night").intent).toBe("leak");
  });

  it("pressure/strength paraphrases escalate as clinical", () => {
    const cases = [
      "my machine feels too strong",
      "turn down my machine strength",
      "the air is too strong at night",
      "can you turn the pressure down",
      "it blows too hard when I lie down",
    ];
    for (const message of cases) {
      const match = classifyIntent(message);
      expect(match.intent, message).toBe("clinical");
      expect(match.clinicalTopic, message).toBe("pressure settings");
    }
  });
});

// ---------------------------------------------------------------------------
// Wording discipline: every builder output passes schema + denylist
// ---------------------------------------------------------------------------

function richInputs(): RecommendationInputs {
  return {
    ...emptyInputs(),
    hasCpap: true,
    cpapNights30: 28,
    adherencePct30: 61.2,
    usageLast14Mean: 265,
    leakLast14Mean: 24.6,
    gapStreak: 6,
  };
}

function richContext(): AssistantContext {
  return {
    clockIso: "2026-06-30",
    consented: true,
    cpapSetupIso: "2026-03-20",
    daysSinceSetup: 102,
    cpapLabel: "ResMed AirSense 11",
    checkinDueIso: "2026-06-15",
    checkinOffsetDays: 30,
  };
}

describe("reply wording discipline (pure)", () => {
  const intents = [
    "clinical",
    "leak",
    "dryness",
    "resupply",
    "adherence",
    "comfort",
    "greeting",
    "unknown",
  ] as const;

  it("every chat variant validates against the zod schema and clears the denylist", () => {
    const combos = [
      { inputs: richInputs(), ctx: richContext() },
      { inputs: emptyInputs(), ctx: { ...emptyAssistantContext("2026-06-30"), consented: true } },
    ];
    for (const combo of combos) {
      for (const intent of intents) {
        const draft = buildChatDraft(intent, intent === "clinical" ? "pressure settings" : null, combo);
        expect(validateRecommendationDraft(draft).ok, `${intent} schema`).toBe(true);
        expect(denylistCheck(draft).passed, `${intent} denylist: ${denylistCheck(draft).detail}`).toBe(true);
        expect(ASSISTANT_RULES[draft.ruleId], `${draft.ruleId} registered`).toBeDefined();
      }
    }
  });

  it("every outreach draft validates and clears the denylist", () => {
    const ctx = richContext();
    const signals: OutreachSignal[] = [
      "therapy_gap",
      "adherence_low",
      "resupply_due",
      "checkin_missed",
    ];
    for (const signal of signals) {
      const draft = buildOutreachDraft(
        { signal, gapNights: 9, adherencePct: 44.4, nights30: 27 },
        ctx
      );
      expect(validateRecommendationDraft(draft).ok, `${signal} schema`).toBe(true);
      expect(denylistCheck(draft).passed, `${signal} denylist`).toBe(true);
    }
  });

  it("the consent-refusal notice is withheld by the chain by construction", () => {
    const draft = buildConsentRefusalNotice();
    expect(validateRecommendationDraft(draft).ok).toBe(true);
    // With no consent there is no enrollment claim — linkage must fail.
    const bundle = extendBundle(
      buildEvidenceBundle("p", "2026-06-30", emptyInputs()),
      emptyAssistantContext("2026-06-30")
    );
    expect(bundle.claims).toHaveLength(0);
    expect(draft.evidenceClaimIds).toContain("assistant.enrollment");
  });

  it("resupply due items follow the published cadence", () => {
    expect(dueResupplyItems(10)).toEqual([]);
    expect(dueResupplyItems(20)).toEqual(["Disposable filters", "Mask cushions & pillows"]);
    expect(dueResupplyItems(95)).toContain("Mask frame & tubing");
    expect(dueResupplyItems(95)).not.toContain("Headgear, chin strap & water chamber");
  });

  it("overdueCheckin honors grace and response windows", () => {
    const enrolled = addDays(SIM_TODAY, -40);
    // Day-30 window closed 10 days ago, unanswered.
    expect(overdueCheckin(enrolled, [], SIM_TODAY)?.offsetDays).toBe(30);
    // A response near the due date clears it.
    expect(
      overdueCheckin(enrolled, [addDays(enrolled, 32)], SIM_TODAY)
    ).toBeNull();
    // Inside the 5-day grace window nothing is overdue.
    expect(overdueCheckin(addDays(SIM_TODAY, -31), [], SIM_TODAY)).toBeNull();
  });

  it("ASSISTANT_MODE resolution: scripted is the engine and the permanent fallback", () => {
    expect(assistantMode(undefined)).toEqual({ mode: "scripted", requested: null, fellBack: false });
    expect(assistantMode("scripted")).toEqual({ mode: "scripted", requested: "scripted", fellBack: false });
    expect(assistantMode("live")).toEqual({ mode: "scripted", requested: "live", fellBack: true });
  });
});

// ---------------------------------------------------------------------------
// Database fixtures
// ---------------------------------------------------------------------------

async function wipe() {
  await prisma.outreachDecision.deleteMany();
  await prisma.seedInfo.deleteMany();
  await prisma.modelDecisionLog.deleteMany();
  await prisma.deletionRequest.deleteMany();
  await prisma.observation.deleteMany();
  await prisma.sleepSession.deleteMany();
  await prisma.proResponse.deleteMany();
  await prisma.mattressPurchase.deleteMany();
  await prisma.mattressCatalog.deleteMany();
  await prisma.device.deleteMany();
  await prisma.treatmentEvent.deleteMany();
  await prisma.episode.deleteMany();
  await prisma.consentRecord.deleteMany();
  await prisma.demoIdentity.deleteMany();
  await prisma.participant.deleteMany();
  await prisma.simClock.deleteMany();
}

interface FixtureOptions {
  enrolledDaysAgo?: number;
  /** create the cpap device + setup event this many days before today */
  cpapSetupDaysAgo?: number | null;
  /** answer the day-30 (and elapsed day-90) questionnaire windows */
  answerCheckins?: boolean;
}

async function makeParticipant(opts: FixtureOptions = {}): Promise<string> {
  const id = randomUUID();
  const enrolledDaysAgo = opts.enrolledDaysAgo ?? 90;
  const enrolledAt = addDays(SIM_TODAY, -enrolledDaysAgo);
  await prisma.participant.create({
    data: {
      id,
      yearOfBirth: 1974,
      sex: "female",
      enrollmentTouchpoint: "clinic",
      createdAt: enrolledAt,
    },
  });
  await grantConsent(id, "LANE_A", { grantedAt: enrolledAt });
  await grantConsent(id, "LANE_B", { grantedAt: enrolledAt });

  const setupDaysAgo = opts.cpapSetupDaysAgo;
  if (setupDaysAgo !== null && setupDaysAgo !== undefined) {
    const setupAt = addDays(SIM_TODAY, -setupDaysAgo);
    await prisma.device.create({
      data: {
        id: randomUUID(),
        participantId: id,
        deviceClass: "cpap",
        make: "ResMed",
        model: "AirSense 11",
        assignedAt: setupAt,
        dataClass: "cpap_telemetry",
      },
    });
    await prisma.treatmentEvent.create({
      data: {
        participantId: id,
        type: "cpap_setup",
        eventDate: setupAt,
        detail: "{}",
        dataClass: "cpap_telemetry",
      },
    });
  }

  if (opts.answerCheckins ?? true) {
    const answers = [30, 90].filter((offset) => enrolledDaysAgo >= offset + 6);
    for (const offset of answers) {
      await prisma.proResponse.create({
        data: {
          participantId: id,
          instrument: "ESS",
          instrumentVersion: "1.0",
          administeredAt: addDays(enrolledAt, offset),
          itemScores: "[]",
          totalScore: 9,
        },
      });
    }
  }
  return id;
}

/** Nightly CPAP usage rows at the given minutes for day offsets [from, to]. */
async function addUsageNights(
  id: string,
  fromOffset: number,
  toOffset: number,
  minutes: number
): Promise<void> {
  const rows = [];
  for (let offset = fromOffset; offset <= toOffset; offset++) {
    rows.push({
      participantId: id,
      source: "airview",
      concept: "cpap_usage_minutes",
      valueNumeric: minutes,
      unit: "min",
      effectiveDate: addDays(SIM_TODAY, -offset),
      grain: "day",
      qualityFlags: "[]",
    });
  }
  await prisma.observation.createMany({ data: rows });
}

async function addGapNights(id: string, fromOffset: number, toOffset: number): Promise<void> {
  const rows = [];
  for (let offset = fromOffset; offset <= toOffset; offset++) {
    rows.push({
      participantId: id,
      source: "airview",
      concept: "therapy_gap",
      valueNumeric: 1,
      unit: "night",
      effectiveDate: addDays(SIM_TODAY, -offset),
      grain: "day",
      qualityFlags: "[]",
    });
  }
  await prisma.observation.createMany({ data: rows });
}

// ---------------------------------------------------------------------------
// Chat governance (database)
// ---------------------------------------------------------------------------

describe("chat: consent gating + decision log (database)", () => {
  beforeEach(async () => {
    await wipe();
    await setSimClock(SIM_TODAY);
  });

  it("answers an adherence check-in from consented data and logs the turn", async () => {
    const id = await makeParticipant({ cpapSetupDaysAgo: 80 });
    await addUsageNights(id, 0, 29, 360); // 30 nights, all ≥ 4 h

    const turn = await runChatTurn(id, "How am I doing?", { turnId: "t1" });
    expect(turn.silenced).toBe(false);
    expect(turn.intent).toBe("adherence");
    expect(turn.passed).toBe(true);
    expect(turn.reply?.ruleId).toBe("chat.status");
    expect(turn.reply?.body).toContain("100% of 30 nights");

    const { entries } = await listModelDecisions();
    const row = entries.find((entry) => entry.id === turn.logId);
    expect(row?.model).toBe(ASSISTANT_CHAT_MODEL_ID);
    expect(row?.ruleId).toBe("chat.status#t1");
    expect(row?.passed).toBe(true);
    expect(row?.checks.map((check) => check.id)).toEqual([
      "denylist",
      "evidence_linkage",
      "guardrail_class",
    ]);
  });

  it("grounds resupply answers in the on-file setup date", async () => {
    const id = await makeParticipant({ cpapSetupDaysAgo: 100 });
    const turn = await runChatTurn(id, "When are my supplies due?", { turnId: "t2" });
    expect(turn.reply?.ruleId).toBe("chat.resupply");
    expect(turn.reply?.body).toContain("100 days ago");
    expect(turn.reply?.body).toContain("March 22, 2026");
    expect(turn.passed).toBe(true);
  });

  it("logs every turn distinctly (two turns, two audit rows)", async () => {
    const id = await makeParticipant({ cpapSetupDaysAgo: 80 });
    await addUsageNights(id, 0, 29, 360);
    await runChatTurn(id, "how am i doing", { turnId: "a1" });
    await runChatTurn(id, "how am i doing", { turnId: "a2" });
    const { entries } = await listModelDecisions();
    const turns = entries.filter((entry) => entry.ruleId.startsWith("chat.status#"));
    expect(turns).toHaveLength(2);
  });

  it("escalates clinical topics, logs them, and queues clinician review", async () => {
    const id = await makeParticipant({ cpapSetupDaysAgo: 80 });
    const turn = await runChatTurn(id, "Should I change my pressure to 12?", {
      turnId: "t3",
    });
    expect(turn.intent).toBe("clinical");
    expect(turn.escalated).toBe(true);
    expect(turn.reply?.guardrail).toBe("discuss-with-provider");
    expect(turn.reply?.body).toContain("care team");
    expect(turn.reply?.body).toContain("provider");
    // No banned phrasing leaks back out of the escalation reply.
    expect(turn.checks.find((check) => check.id === "denylist")?.passed).toBe(true);

    const { entries, queuedForReview } = await listModelDecisions();
    const row = entries.find((entry) => entry.id === turn.logId);
    expect(row?.guardrail).toBe("discuss-with-provider");
    expect(row?.reviewQueued).toBe(true);
    expect(queuedForReview).toBeGreaterThan(0);
  });

  it("full revocation silences the assistant immediately — refusal on the record", async () => {
    const id = await makeParticipant({ cpapSetupDaysAgo: 80 });
    await addUsageNights(id, 0, 29, 360);
    await revokeConsent(id, "LANE_A");
    await revokeConsent(id, "LANE_B");

    const turn = await runChatTurn(id, "How am I doing?", { turnId: "t4" });
    expect(turn.silenced).toBe(true);
    expect(turn.reply).toBeNull();
    expect(turn.passed).toBe(false);
    // The refusal is logged through the same chain: linkage fails because
    // no consent claim can exist.
    const { entries } = await listModelDecisions();
    const row = entries.find((entry) => entry.id === turn.logId);
    expect(row?.ruleId).toBe("chat.consent_refused#t4");
    expect(row?.passed).toBe(false);
    expect(row?.checks.find((check) => check.id === "evidence_linkage")?.passed).toBe(false);

    const view = await loadAssistantView(id);
    expect(view.consented).toBe(false);
    expect(view.adherencePct30).toBeNull();
  });

  it("partial revocation of cpap_telemetry drops to the honest no-data reply", async () => {
    const id = await makeParticipant({ cpapSetupDaysAgo: 80 });
    await addUsageNights(id, 0, 29, 360);

    const before = await runChatTurn(id, "how am I doing", { turnId: "p1" });
    expect(before.reply?.ruleId).toBe("chat.status");

    await revokeDataClass(id, "cpap_telemetry");

    const after = await runChatTurn(id, "how am I doing", { turnId: "p2" });
    expect(after.silenced).toBe(false); // assistant still speaks…
    expect(after.reply?.ruleId).toBe("chat.status.nodata"); // …but without the data
    expect(after.reply?.body).not.toContain("%");
    expect(after.passed).toBe(true);

    const resupply = await runChatTurn(id, "when are my supplies due", { turnId: "p3" });
    expect(resupply.reply?.ruleId).toBe("chat.resupply.nodata");
  });
});

// ---------------------------------------------------------------------------
// Outreach queue governance (database)
// ---------------------------------------------------------------------------

describe("outreach queue: signals, consent, approvals (database)", () => {
  beforeEach(async () => {
    await wipe();
    await setSimClock(SIM_TODAY);
  });

  async function seedQueueCohort() {
    // P1: 9-night therapy gap (usage stopped 9 nights ago).
    const p1 = await makeParticipant({ cpapSetupDaysAgo: 80 });
    await addUsageNights(p1, 9, 29, 360);
    await addGapNights(p1, 0, 8);
    // P2: low adherence — 4+ h on 10 of 30 nights (33%).
    const p2 = await makeParticipant({ cpapSetupDaysAgo: 80 });
    await addUsageNights(p2, 0, 9, 300);
    await addUsageNights(p2, 10, 29, 120);
    // P3: resupply due — setup 100 days ago, steady recent use.
    const p3 = await makeParticipant({ cpapSetupDaysAgo: 100 });
    await addUsageNights(p3, 0, 29, 380);
    // P4: missed day-30 check-in, no CPAP at all.
    const p4 = await makeParticipant({
      enrolledDaysAgo: 40,
      cpapSetupDaysAgo: null,
      answerCheckins: false,
    });
    return { p1, p2, p3, p4 };
  }

  it("generates one consent-gated item per signal, drafted and logged", async () => {
    const { p1, p2, p3, p4 } = await seedQueueCohort();
    const queue = await loadOutreachQueue();

    expect(queue.totals.therapy_gap).toBe(1);
    expect(queue.totals.adherence_low).toBe(1);
    expect(queue.totals.resupply_due).toBe(1);
    expect(queue.totals.checkin_missed).toBe(1);

    const bySignal = new Map(queue.items.map((item) => [item.signal, item]));
    expect(bySignal.get("therapy_gap")?.participantId).toBe(p1);
    expect(bySignal.get("therapy_gap")?.draft.body).toContain("9 nights");
    expect(bySignal.get("adherence_low")?.participantId).toBe(p2);
    expect(bySignal.get("adherence_low")?.draft.body).toContain("33%");
    expect(bySignal.get("resupply_due")?.participantId).toBe(p3);
    expect(bySignal.get("resupply_due")?.draft.body).toContain("100 days");
    expect(bySignal.get("checkin_missed")?.participantId).toBe(p4);
    expect(bySignal.get("checkin_missed")?.draft.body).toContain("day-30");

    for (const item of queue.items) {
      expect(item.schemaValid).toBe(true);
      expect(item.passed).toBe(true);
      expect(item.checks).toHaveLength(3);
    }

    // Every generated item is on the model decision log.
    const { entries } = await listModelDecisions();
    const outreachRows = entries.filter((entry) => entry.ruleId.startsWith("outreach."));
    expect(outreachRows).toHaveLength(4);
    for (const row of outreachRows) {
      expect(row.model).toBe(ASSISTANT_OUTREACH_MODEL_ID);
      expect(row.passed).toBe(true);
    }
  });

  it("a revoked participant vanishes from the queue on the next render", async () => {
    const { p1 } = await seedQueueCohort();
    expect((await loadOutreachQueue()).totals.therapy_gap).toBe(1);

    await revokeConsent(p1, "LANE_A");
    await revokeConsent(p1, "LANE_B");

    const queue = await loadOutreachQueue();
    expect(queue.totals.therapy_gap).toBe(0);
    expect(queue.items.some((item) => item.participantId === p1)).toBe(false);
  });

  it("partial revocation seals exactly that class's signals", async () => {
    const { p3 } = await seedQueueCohort();
    await revokeDataClass(p3, "cpap_telemetry");
    const queue = await loadOutreachQueue();
    // P3's resupply signal (cpap_telemetry-gated) is gone…
    expect(queue.totals.resupply_due).toBe(0);
    // …while the pro_responses-gated signal of P4 keeps flowing.
    expect(queue.totals.checkin_missed).toBe(1);
  });

  it("approve records the decision, logs it, and retires the item", async () => {
    const { p2 } = await seedQueueCohort();
    await loadOutreachQueue();

    const outcome = await decideOutreach(p2, "adherence_low", "approved");
    expect(outcome.ok).toBe(true);

    const decisions = await prisma.outreachDecision.findMany();
    expect(decisions).toHaveLength(1);
    expect(decisions[0].participantId).toBe(p2);
    expect(decisions[0].status).toBe("approved");
    expect(decisions[0].draftBody).toContain("33%");

    const { entries } = await listModelDecisions();
    const approvalRow = entries.find(
      (entry) => entry.ruleId === "outreach.adherence_low#approved"
    );
    expect(approvalRow?.participantId).toBe(p2);
    expect(approvalRow?.passed).toBe(true);

    const queue = await loadOutreachQueue();
    expect(queue.totals.adherence_low).toBe(0);
    expect(queue.decidedToday).toHaveLength(1);
    expect(queue.decidedToday[0].status).toBe("approved");
  });

  it("skip records without sending, and double decisions are refused", async () => {
    const { p3 } = await seedQueueCohort();
    const skipped = await decideOutreach(p3, "resupply_due", "skipped");
    expect(skipped.ok).toBe(true);

    const again = await decideOutreach(p3, "resupply_due", "approved");
    expect(again.ok).toBe(false);
    expect(again.reason).toContain("Already decided");

    const { entries } = await listModelDecisions();
    expect(entries.some((entry) => entry.ruleId === "outreach.resupply_due#skipped")).toBe(true);
  });

  it("approval after revocation is refused — the send never happens, and the refusal is logged", async () => {
    const { p4 } = await seedQueueCohort();
    expect((await loadOutreachQueue()).totals.checkin_missed).toBe(1);

    await revokeConsent(p4, "LANE_A");
    await revokeConsent(p4, "LANE_B");

    const outcome = await decideOutreach(p4, "checkin_missed", "approved");
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain("Consent revoked");
    expect(await prisma.outreachDecision.count()).toBe(0);

    // The blocked send is itself on the model decision log, through the
    // same chain chat's consent refusals take: no grant → no enrollment
    // claim → evidence linkage fails → passed=false.
    const { entries } = await listModelDecisions();
    const row = entries.find(
      (entry) => entry.ruleId === "outreach.consent_refused#checkin_missed#approved"
    );
    expect(row?.participantId).toBe(p4);
    expect(row?.model).toBe(ASSISTANT_OUTREACH_MODEL_ID);
    expect(row?.passed).toBe(false);
    expect(row?.checks.find((check) => check.id === "evidence_linkage")?.passed).toBe(false);
  });

  it("approving a signal that no longer re-derives is refused and logged", async () => {
    const { p3 } = await seedQueueCohort();
    // p3 has steady recent use — no therapy_gap signal exists for it, so a
    // stale Approve on that signal must be refused at revalidation.
    const outcome = await decideOutreach(p3, "therapy_gap", "approved");
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain("Signal no longer present");
    expect(await prisma.outreachDecision.count()).toBe(0);

    const { entries } = await listModelDecisions();
    const row = entries.find(
      (entry) => entry.ruleId === "outreach.signal_gone#therapy_gap#approved"
    );
    expect(row?.participantId).toBe(p3);
    expect(row?.passed).toBe(false);
    // Consent is still current (enrollment claim exists); the missing
    // outreach.live_signal claim is what fails the chain by construction.
    expect(row?.checks.find((check) => check.id === "evidence_linkage")?.passed).toBe(false);
    expect(row?.checks.find((check) => check.id === "denylist")?.passed).toBe(true);
  });
});
