import type { RecommendationInputs } from "../recommendations/rules";
import type { RecommendationDraft } from "../recommendations/schema";
import { formatDay } from "../format";
import type { AssistantContext } from "./claims";
import type { ChatIntent, ClinicalTopic } from "./intents";
import {
  ASSISTANT_CHAT_MODEL_ID,
  ASSISTANT_OUTREACH_MODEL_ID,
  ASSISTANT_MODEL_VERSION,
  ASSISTANT_RULES,
} from "./registry";

/**
 * Scripted reply builders (Addendum A) — the offline rule-based engine.
 *
 * Pure functions: consent-scoped inputs in, RecommendationDraft-shaped
 * candidates out. Every number in every reply comes from the participant's
 * consent-gated data (RecommendationInputs / AssistantContext) — nothing is
 * free-typed at answer time, and nothing is invented. Each candidate then
 * runs the EXISTING zod schema + SafetyCheck chain before anything renders
 * (chat.ts / queue.ts), exactly like a recommendation card.
 *
 * Wording discipline is the platform's: no diagnosis language, no
 * therapy-change directives, no pressure/medication advice — the denylist
 * check enforces it at runtime and the tests sweep every builder.
 */

const round0 = (n: number): number => Math.round(n);
const hoursText = (min: number): string => `${(min / 60).toFixed(1)} h`;

/**
 * Sleeptopia's published CPAP resupply cadence (sleeptopia.com cpap-care
 * schedule, mirrored on the new site's /supplies page): disposable filters
 * every 2 weeks; nasal cushions/pillows twice a month; full-face cushions
 * monthly; mask frame + tubing every 3 months; headgear, chin straps, and
 * water chamber every 6 months. Typical replacement guidance only — what a
 * specific plan covers is the care team's call, never asserted here.
 */
export const RESUPPLY_CADENCE = [
  { item: "Disposable filters", everyDays: 14, cadence: "every 2 weeks" },
  { item: "Nasal cushions / pillows", everyDays: 15, cadence: "twice a month" },
  { item: "Full-face mask cushion", everyDays: 30, cadence: "monthly" },
  { item: "Mask frame & tubing", everyDays: 90, cadence: "every 3 months" },
  { item: "Headgear, chin strap & water chamber", everyDays: 180, cadence: "every 6 months" },
] as const;

/** Items whose typical replacement interval has fully elapsed since setup. */
export function dueResupplyItems(daysSinceSetup: number): string[] {
  return RESUPPLY_CADENCE.filter((entry) => daysSinceSetup >= entry.everyDays).map(
    (entry) => entry.item
  );
}

type Chip = { label: string; value: string };

function candidate(
  model: string,
  ruleId: keyof typeof ASSISTANT_RULES,
  title: string,
  body: string,
  narrative: string,
  whyChips: Chip[],
  evidenceClaimIds: string[],
  sparkline: RecommendationDraft["sparkline"] = null
): RecommendationDraft {
  return {
    model,
    modelVersion: ASSISTANT_MODEL_VERSION,
    ruleId,
    guardrail: ASSISTANT_RULES[ruleId].guardrail,
    title,
    body,
    narrative,
    whyChips,
    evidenceClaimIds,
    sparkline,
  };
}

export interface ChatDraftInput {
  inputs: RecommendationInputs;
  ctx: AssistantContext;
}

/**
 * Picks the registered rule and builds the candidate reply for one chat
 * turn. Data variants require their backing inputs; when the inputs are
 * null (class revoked, or simply no data), the no-data variant answers
 * honestly instead — it never guesses and never fabricates a number.
 */
export function buildChatDraft(
  intent: ChatIntent,
  clinicalTopic: ClinicalTopic | null,
  { inputs, ctx }: ChatDraftInput
): RecommendationDraft {
  switch (intent) {
    case "clinical":
      return buildEscalation(clinicalTopic ?? "starting or stopping therapy");
    case "adherence":
      return inputs.hasCpap && inputs.adherencePct30 !== null
        ? buildStatus(inputs)
        : buildStatusNoData(ctx);
    case "resupply":
      return ctx.cpapSetupIso !== null && ctx.daysSinceSetup !== null
        ? buildResupply(ctx)
        : buildResupplyNoData(ctx);
    case "leak":
      return inputs.hasCpap ? buildLeak(inputs) : buildTroubleshootNoData(ctx);
    case "dryness":
      return inputs.hasCpap ? buildDryness(ctx) : buildTroubleshootNoData(ctx);
    case "comfort":
      return inputs.hasCpap ? buildComfort(ctx) : buildTroubleshootNoData(ctx);
    case "greeting":
      return buildGreeting(ctx);
    case "unknown":
      return buildFallback(ctx);
  }
}

/**
 * The consent-refusal notice: generic text, zero participant data. Its
 * registered rule requires the assistant.enrollment claim, which cannot
 * exist without a current grant — so the chain withholds it and logs the
 * refusal. See ASSISTANT_RULES["chat.consent_refused"].
 */
export function buildConsentRefusalNotice(): RecommendationDraft {
  return candidate(
    ASSISTANT_CHAT_MODEL_ID,
    "chat.consent_refused",
    "The assistant is paused for this record",
    "There is no current consent on file that lets the assistant read this record, so it " +
      "cannot answer from it. The care team can help with consent questions at any time.",
    "The assistant answers only from consent-granted data. With no current grant on file, " +
      "it stays silent — this notice carries no personal data and is itself withheld from " +
      "rendering by the safety chain, with the refusal recorded in the decision log.",
    [{ label: "Assistant consent gate", value: "no current grant — silenced" }],
    ["assistant.enrollment"]
  );
}

// --- chat builders -----------------------------------------------------------

function buildStatus(inputs: RecommendationInputs): RecommendationDraft {
  const pct = round0(inputs.adherencePct30 as number);
  const nights = inputs.cpapNights30;
  const usage = inputs.usageLast14Mean;
  const gap = inputs.gapStreak;

  const chips: Chip[] = [
    { label: "Nights at 4+ hours, last 30", value: `${pct}% of ${nights} nights` },
  ];
  if (usage !== null) {
    chips.push({ label: "Average use, last 2 weeks", value: `${hoursText(usage)}/night` });
  }
  if (gap > 0) {
    chips.push({ label: "Nights since the last session", value: `${gap} in a row` });
  }

  const claimIds = ["cpap.device", "cpap.adherence_30"];
  if (usage !== null) claimIds.push("cpap.usage_trend");

  const usageLine =
    usage !== null ? ` Over the last two weeks you averaged ${hoursText(usage)} a night.` : "";
  const gapLine =
    gap > 0
      ? ` The machine hasn't recorded a session in ${gap} night${gap === 1 ? "" : "s"} — ` +
        `when you're ready, your sleep coach is glad to help with a fresh start.`
      : ` Keeping the routine steady is what makes therapy feel better week over week.`;

  return candidate(
    ASSISTANT_CHAT_MODEL_ID,
    "chat.status",
    "Here's your CPAP check-in",
    `Over the last 30 nights with data, you reached 4 or more hours on ${pct}% of ` +
      `${nights} nights.${usageLine}${gapLine}`,
    `An adherence check-in from your registry data: 4+ hours on ${pct}% of the last ` +
      `${nights} data nights.${usageLine} These numbers come straight from your consented ` +
      `CPAP telemetry — nothing here is estimated or filled in.`,
    chips,
    claimIds,
    "usage"
  );
}

function buildStatusNoData(ctx: AssistantContext): RecommendationDraft {
  return candidate(
    ASSISTANT_CHAT_MODEL_ID,
    "chat.status.nodata",
    "No CPAP usage numbers on file to report",
    "There is no readable CPAP telemetry for this record right now — either none is on " +
      "file, or its consent scope is not currently granted — so there are no usage numbers " +
      "to report. Your sleep coach can help sort out data or consent questions.",
    "The assistant only reports numbers the consent gate admits. With no readable CPAP " +
      `telemetry as of ${formatDay(ctx.clockIso)}, an adherence check-in has nothing to ` +
      "stand on, so none is given.",
    [{ label: "Readable CPAP telemetry", value: "none available" }],
    ["assistant.enrollment"]
  );
}

function buildResupply(ctx: AssistantContext): RecommendationDraft {
  const days = ctx.daysSinceSetup as number;
  const setup = formatDay(ctx.cpapSetupIso as string);
  const due = dueResupplyItems(days);
  const schedule = RESUPPLY_CADENCE.map((entry) => `${entry.item.toLowerCase()} ${entry.cadence}`).join(
    "; "
  );
  const dueLine =
    due.length > 0
      ? `At ${days} days, these are typically due: ${due.map((item) => item.toLowerCase()).join(", ")}.`
      : `At ${days} days, nothing on the schedule is due yet.`;

  const chips: Chip[] = [
    { label: "CPAP setup on file", value: setup },
    { label: "Supply age", value: `${days} days (no resupply order on file)` },
    { label: "Typically due now", value: due.length > 0 ? `${due.length} item group(s)` : "none yet" },
  ];

  return candidate(
    ASSISTANT_CHAT_MODEL_ID,
    "chat.resupply",
    "Your supply schedule, counted from setup",
    `Your CPAP setup on file is ${setup} — ${days} days ago. No resupply order is in the ` +
      `registry, so supply age is counted from setup. Sleeptopia's published replacement ` +
      `schedule: ${schedule}. ${dueLine} Your care team confirms what your plan covers and ` +
      `can start an order by phone.`,
    `Resupply guidance grounded in the registry: setup ${setup}, ${days} days ago, with no ` +
      `later resupply order on file. Against Sleeptopia's published schedule (${schedule}), ` +
      `${dueLine.toLowerCase()} Coverage is a care-team question; the assistant never ` +
      `asserts what a plan pays for.`,
    chips,
    ["assistant.enrollment", "cpap.setup"]
  );
}

function buildResupplyNoData(ctx: AssistantContext): RecommendationDraft {
  return candidate(
    ASSISTANT_CHAT_MODEL_ID,
    "chat.resupply.nodata",
    "No CPAP setup on file to schedule from",
    "There is no readable CPAP setup date for this record right now — either none is on " +
      "file, or its consent scope is not currently granted — so a supply schedule can't be " +
      "counted. Your care team can check equipment and supplies directly.",
    "Supply timing is counted from the CPAP setup date in the registry. With no readable " +
      `setup event as of ${formatDay(ctx.clockIso)}, the assistant gives no schedule rather ` +
      "than guessing one.",
    [{ label: "Readable CPAP setup event", value: "none available" }],
    ["assistant.enrollment"]
  );
}

function buildLeak(inputs: RecommendationInputs): RecommendationDraft {
  const leak = inputs.leakLast14Mean;
  const chips: Chip[] =
    leak !== null
      ? [{ label: "p95 mask leak, last 2 weeks", value: `${Math.round(leak * 10) / 10} L/min` }]
      : [{ label: "Registered equipment", value: "CPAP on file" }];
  const claimIds = ["cpap.device"];
  if (leak !== null) claimIds.push("cpap.leak_trend");

  const leakLine =
    leak !== null
      ? `Your telemetry shows mask leak around ${Math.round(leak * 10) / 10} L/min over the ` +
        `last two weeks. `
      : "";

  return candidate(
    ASSISTANT_CHAT_MODEL_ID,
    "chat.leak",
    "Mask leaks are usually a fit thing — here's where to start",
    `${leakLine}Leaks are usually a fit thing, not a you thing: cushions age, straps ` +
      `stretch. Three things worth trying tonight — wash the cushion so it seals on clean ` +
      `skin; even out the headgear straps (snug, not tight); and reseat the mask while ` +
      `lying down in your sleeping position. If it keeps up, a refit or cushion swap with ` +
      `your supplier usually settles it.`,
    `${leakLine}A leaky seal is one of the most common CPAP snags and almost always ` +
      `fixable with fit, not force: clean cushion, even straps, reseat lying down. ` +
      `Persistent leaks are a good reason to book a mask refit with the supply team — ` +
      `cushions are wear items and are meant to be replaced on schedule.`,
    chips,
    claimIds,
    leak !== null ? "leak" : null
  );
}

function buildDryness(ctx: AssistantContext): RecommendationDraft {
  return candidate(
    ASSISTANT_CHAT_MODEL_ID,
    "chat.dryness",
    "Dryness has a few easy levers to try",
    `Dryness is common and usually easable: raise the humidifier level a step at a time, ` +
      `keep the water chamber topped up with distilled water, and keep the hose off the ` +
      `floor so condensation drains back. A heated hose helps in cooler rooms. If your ` +
      `nose or mouth still feels dry after a week of small steps, your sleep coach can ` +
      `look at the setup with you.`,
    `Comfort guidance for dryness as of ${formatDay(ctx.clockIso)}: humidification level, ` +
      `distilled water, hose position, and room temperature are the usual levers, changed ` +
      `one at a time so you can tell what helped. Humidity is a comfort setting you're ` +
      `free to explore; therapy settings stay with your care team.`,
    [{ label: "Registered equipment", value: "CPAP on file" }],
    ["cpap.device"]
  );
}

function buildComfort(ctx: AssistantContext): RecommendationDraft {
  return candidate(
    ASSISTANT_CHAT_MODEL_ID,
    "chat.comfort",
    "Getting comfortable takes reps — here's what helps most",
    `Most people need a few weeks for the mask to feel normal, and there are honest ` +
      `shortcuts: wear it 15 minutes before lights-out so it stops feeling like an event; ` +
      `keep a consistent bedtime; and loosen straps to snug-not-tight — marks on your face ` +
      `mean too tight, not wrong mask. If it still fights you after a couple of weeks, a ` +
      `different cushion size or style with your supplier often changes everything.`,
    `Habituation guidance as of ${formatDay(ctx.clockIso)}: short daytime wear, a steady ` +
      `routine, and strap tension are where comfort usually comes from. None of this ` +
      `touches therapy settings — that stays with your care team; this is about making ` +
      `the routine livable.`,
    [{ label: "Registered equipment", value: "CPAP on file" }],
    ["cpap.device"]
  );
}

function buildTroubleshootNoData(ctx: AssistantContext): RecommendationDraft {
  return candidate(
    ASSISTANT_CHAT_MODEL_ID,
    "chat.troubleshoot.nodata",
    "No CPAP on file — equipment help needs the care team",
    "There is no readable CPAP registration for this record right now — either none is on " +
      "file, or its consent scope is not currently granted — so equipment-specific " +
      "troubleshooting isn't something the assistant can ground. The care team can help " +
      "directly with any equipment question.",
    "Troubleshooting replies are grounded in the registered equipment record. With no " +
      `readable CPAP registration as of ${formatDay(ctx.clockIso)}, the assistant points ` +
      "to the care team instead of guessing at hardware it can't see.",
    [{ label: "Readable CPAP registration", value: "none available" }],
    ["assistant.enrollment"]
  );
}

function buildGreeting(ctx: AssistantContext): RecommendationDraft {
  return candidate(
    ASSISTANT_CHAT_MODEL_ID,
    "chat.greeting",
    "Hi — I'm your Sleeptopia care assistant",
    `I can help with three things: a CPAP adherence check-in ("how am I doing?"), your ` +
      `supply and replacement schedule, and everyday troubleshooting like mask leaks, ` +
      `dryness, or getting comfortable. Every answer comes only from your consented ` +
      `registry data. Clinical questions — pressure settings, results, medicines — go ` +
      `straight to your care team.`,
    `The assistant's welcome as of ${formatDay(ctx.clockIso)}: three scripted abilities ` +
      `(adherence check-ins, resupply schedule, comfort troubleshooting), all grounded in ` +
      `consent-gated data, with clinical topics routed to the care team by design.`,
    [{ label: "Assistant consent gate", value: "granted" }],
    ["assistant.enrollment"]
  );
}

function buildFallback(ctx: AssistantContext): RecommendationDraft {
  return candidate(
    ASSISTANT_CHAT_MODEL_ID,
    "chat.fallback",
    "I didn't catch that — here's what I can help with",
    `I'm a scripted assistant, so I stick to what I can answer well: your CPAP check-in ` +
      `("how am I doing?"), your supply and replacement schedule ("when are my supplies ` +
      `due?"), and comfort troubleshooting ("my mask leaks"). For anything clinical, your ` +
      `care team is the right door — and I'll say so rather than guess.`,
    `Unrecognized message as of ${formatDay(ctx.clockIso)}: the scripted engine offers ` +
      `its capability menu instead of guessing. No data was read for this reply beyond ` +
      `the consent gate itself.`,
    [{ label: "Recognized intent", value: "none — capability menu offered" }],
    ["assistant.enrollment"]
  );
}

function buildEscalation(topic: ClinicalTopic): RecommendationDraft {
  return candidate(
    ASSISTANT_CHAT_MODEL_ID,
    "chat.escalation",
    "That's one for your care team",
    `Questions about ${topic} are clinical calls the assistant is not allowed to make — ` +
      `it never gives medical advice. Please bring this to your provider or sleep coach; ` +
      `this conversation has been flagged in the care team's review queue so they know ` +
      `you asked.`,
    `A clinical topic (${topic}) reached the assistant and was declined by policy: the ` +
      `platform's non-device-CDS boundary reserves those decisions for the provider. The ` +
      `escalation is on the record — the decision log entry for this turn is queued for ` +
      `clinician review.`,
    [{ label: "Clinical topic detected", value: topic }],
    ["assistant.enrollment"]
  );
}

// --- coach outreach builders --------------------------------------------------

export type OutreachSignal =
  | "therapy_gap"
  | "adherence_low"
  | "resupply_due"
  | "checkin_missed";

export const OUTREACH_SIGNAL_LABELS: Record<OutreachSignal, string> = {
  therapy_gap: "Therapy gap",
  adherence_low: "Low adherence",
  resupply_due: "Resupply due",
  checkin_missed: "Check-in missed",
};

export interface OutreachSignalData {
  signal: OutreachSignal;
  /** therapy_gap */
  gapNights?: number;
  /** adherence_low */
  adherencePct?: number;
  nights30?: number;
}

/** Drafts the coach's outreach message for one queue item. */
export function buildOutreachDraft(
  data: OutreachSignalData,
  ctx: AssistantContext
): RecommendationDraft {
  switch (data.signal) {
    case "therapy_gap": {
      const nights = data.gapNights ?? 0;
      return candidate(
        ASSISTANT_OUTREACH_MODEL_ID,
        "outreach.therapy_gap",
        "Want to restart together? Your coach is checking in",
        `Hi — this is your Sleeptopia sleep coach checking in. The machine hasn't recorded ` +
          `a session in ${nights} nights. Breaks happen — travel, colds, a mask that got ` +
          `annoying. When you're ready, let's take a fresh start together: fit check, ` +
          `humidity settings, one comfortable night at a time. Reply here or give me a call.`,
        `Coach outreach drafted from a ${nights}-night therapy gap ending at the current ` +
          `sim date. Re-engagement wording mirrors the platform's reviewed ` +
          `adherence-support language: warm, no blame, one small next step.`,
        [{ label: "Nights without a session", value: `${nights} in a row` }],
        ["cpap.device", "cpap.gap_streak"]
      );
    }
    case "adherence_low": {
      const pct = round0(data.adherencePct ?? 0);
      const nights = data.nights30 ?? 0;
      return candidate(
        ASSISTANT_OUTREACH_MODEL_ID,
        "outreach.adherence_low",
        "A quick check-in from your sleep coach",
        `Hi — your Sleeptopia sleep coach here. Your machine reached 4+ hours on ${pct}% ` +
          `of the last ${nights} data nights, and most of what gets in the way is small ` +
          `and fixable: dryness, a noisy leak, strap marks. Want to look at it together? ` +
          `Reply here or call and we'll find the snag.`,
        `Coach outreach drafted from a low adherence signal: 4+ hours on ${pct}% of the ` +
          `last ${nights} CPAP data nights, under the 70% coaching threshold. The message ` +
          `offers help with common fixable snags and one easy reply path.`,
        [{ label: "Nights at 4+ hours, last 30", value: `${pct}% of ${nights} nights` }],
        ["cpap.device", "cpap.adherence_30"]
      );
    }
    case "resupply_due": {
      const days = ctx.daysSinceSetup ?? 0;
      const setup = ctx.cpapSetupIso ? formatDay(ctx.cpapSetupIso) : "your setup date";
      return candidate(
        ASSISTANT_OUTREACH_MODEL_ID,
        "outreach.resupply_due",
        "Your CPAP supplies are due for a refresh",
        `Hi — your Sleeptopia sleep coach here. It's been ${days} days since your CPAP ` +
          `setup on ${setup}, and by the standard replacement schedule some supplies are ` +
          `due — cushions and filters sooner, mask frame and tubing at the three-month ` +
          `mark. Fresh supplies seal better and feel better. Reply here or call and we'll ` +
          `line up a resupply order.`,
        `Coach outreach drafted from supply age: ${days} days since the setup event on ` +
          `file, with no later resupply order in the registry. Cadence referenced is ` +
          `Sleeptopia's published replacement schedule; coverage questions stay with the ` +
          `care team.`,
        [
          { label: "CPAP setup on file", value: setup },
          { label: "Supply age", value: `${days} days` },
        ],
        ["assistant.enrollment", "cpap.setup"]
      );
    }
    case "checkin_missed": {
      const due = ctx.checkinDueIso ? formatDay(ctx.checkinDueIso) : "recently";
      const offset = ctx.checkinOffsetDays ?? 0;
      return candidate(
        ASSISTANT_OUTREACH_MODEL_ID,
        "outreach.checkin_missed",
        "Your two-minute sleep questionnaire is still open",
        `Hi — your Sleeptopia sleep coach here. Your day-${offset} sleep questionnaire ` +
          `(due ${due}) hasn't come in yet. It takes about two minutes and it's how we ` +
          `keep your care picture current between visits. Want a link, or would you ` +
          `rather run through it together by phone?`,
        `Coach outreach drafted from a missed scheduled questionnaire: the day-${offset} ` +
          `instrument window (due ${due}) closed with no response on file. The message ` +
          `offers both a self-serve and an assisted path.`,
        [{ label: `Day-${offset} questionnaire due`, value: due }],
        ["assistant.enrollment", "pro.checkin_due"]
      );
    }
  }
}
