import { Rng } from "../synthetic/prng";
import type { EvidenceBundle } from "./evidence";
import type { Recommendation, RecommendationInputs } from "./rules";

/**
 * AI narrative preview (DEMO.md §3 reserve → working; SPEC §10.4).
 *
 * EVIDENCE-FIRST (audit level-up 12): the composer consumes the typed
 * EvidenceBundle — the same consent-scoped snapshot whose claims the card
 * cites — so narrative numbers and the "View evidence" tables can never
 * diverge. Each slot (opener / evidence / context / closer) draws from a
 * sentence bank; the pick is keyed on the data (thresholds choose between
 * phrasings) and on a PRNG seeded per (participant, rule), so the same
 * participant always reads the same draft and different participants read
 * different ones. No network, no model call. Production swaps this composer
 * for a governed LLM behind the same interface (SPEC §10.4) — emitting
 * through the same RecommendationDraft schema and SafetyCheck chain
 * (schema.ts / safety.ts); the banned-phrase discipline runs at render time
 * AND in recommendations.test.ts over every narrative this module can emit.
 */

export const NARRATIVE_VERSION = "narrative-v1";

/** The label rendered under every drafted narrative (verbatim, on-screen). */
export const NARRATIVE_DISCLAIMER =
  "Drafted narrative — demo preview; production uses a governed LLM (SPEC §10.4)";

const round1 = (n: number): number => Math.round(n * 10) / 10;
const hoursText = (min: number): string => `${(min / 60).toFixed(1)} hours`;

type Bank = readonly string[];

/** Deterministic pick from a sentence bank. */
const pick = (rng: Rng, bank: Bank): string => bank[Math.floor(rng.random() * bank.length)];

type NarrativeBuilder = (rng: Rng, inputs: RecommendationInputs) => string[];

const BUILDERS: Record<string, NarrativeBuilder> = {
  "comfort.positional": (rng, i) => {
    const pct = round1(i.recentSupinePct ?? 0);
    const sentences: string[] = [];
    sentences.push(
      pick(rng, [
        "Here's a pattern from your recent nights that's worth knowing about.",
        "Your sleep position tells an interesting story lately.",
        "A gentle observation from the under-mattress sensor.",
      ])
    );
    if (i.supineAhi !== null && i.nonsupineAhi !== null) {
      sentences.push(
        `Your sleep study measured about ${round1(i.supineAhi)} breathing interruptions per hour on your back versus ${round1(i.nonsupineAhi)} on your side, and the sensor still sees roughly ${pct}% of a typical night spent back-sleeping.`
      );
    } else {
      sentences.push(
        `The sensor sees roughly ${pct}% of a typical night spent back-sleeping.`
      );
    }
    sentences.push(
      pct >= 45
        ? pick(rng, [
            "That's a big share of the night in the position that works least well for you, so nudging it down could matter more than any gadget.",
            "That's most of the night in the position your study found hardest, which makes position the single easiest lever to try.",
          ])
        : pick(rng, [
            "That's meaningful time in the position that suits you least, and small comfort changes are usually enough to shift it.",
            "It doesn't take much to shift a share like that — comfort, not willpower, is what keeps people on their side.",
          ])
    );
    if (i.mattressFirmness !== null && i.mattressFirmness <= 4) {
      sentences.push(
        pick(rng, [
          "A softer mattress like yours can make rolling onto the back easy — a firmer comfort layer or topper is worth exploring at the store, along with a full-length body pillow to lean into.",
          "Since your mattress sits on the softer side, a firmer topper plus a body pillow to lean into can make your side the path of least resistance.",
        ])
      );
    } else {
      sentences.push(
        pick(rng, [
          "A full-length body pillow to lean into, a slightly firmer pillow for shoulder comfort, or simply starting the night on your side are the usual favorites.",
          "Most people settle it with a body pillow to lean into or by starting the night on their side and letting comfort do the rest.",
        ])
      );
    }
    sentences.push(
      pick(rng, [
        "Small, comfortable changes tend to stick — worth a try this week.",
        "One comfortable adjustment at a time is plenty; your sleep coach is happy to talk through options.",
      ])
    );
    return sentences;
  },

  "adherence.streak": (rng, i) => {
    const pct = Math.round(i.adherencePct30 ?? 0);
    const sentences: string[] = [];
    sentences.push(
      pick(rng, [
        "This is the kind of consistency that pays off.",
        "Your therapy routine has earned a mention.",
        "Credit where it's due this month.",
      ])
    );
    sentences.push(
      `You reached four or more hours on ${pct}% of the last ${i.cpapNights30} nights` +
        (i.usageLast14Mean !== null
          ? `, averaging ${hoursText(i.usageLast14Mean)} a night over the past two weeks.`
          : ".")
    );
    sentences.push(
      pct >= 95
        ? pick(rng, [
            "That is about as steady as therapy gets.",
            "Night after night like that is as steady as it gets.",
          ])
        : pick(rng, [
            "That is a strong month by any measure.",
            "A month like that is exactly what steady progress looks like.",
          ])
    );
    sentences.push(
      pick(rng, [
        "Whatever bedtime routine you've built, it's working — keep it exactly as it is.",
        "Routines like this are what make therapy feel easier week over week — nothing to change here.",
      ])
    );
    return sentences;
  },

  "adherence.refit": (rng, i) => {
    const last = round1(i.leakLast14Mean ?? 0);
    const sentences: string[] = [];
    sentences.push(
      pick(rng, [
        "One of your machine's numbers has been drifting and it's a fixable one.",
        "A small maintenance flag from your CPAP this week.",
      ])
    );
    sentences.push(
      `Mask leak has averaged around ${last} liters per minute over the last two weeks` +
        (i.leakPrior14Mean !== null
          ? `, up from ${round1(i.leakPrior14Mean)} the two weeks before.`
          : ".")
    );
    sentences.push(
      pick(rng, [
        "Leaks are almost always about fit rather than effort — cushions age and straps stretch over time.",
        "This is usually the mask's doing, not yours: the parts wear out quietly and the seal follows.",
      ])
    );
    sentences.push(
      pick(rng, [
        "A quick refit or cushion swap with your supplier usually settles it.",
        "Ten minutes with your supplier for a refit is often all it takes to bring the number back down.",
      ])
    );
    return sentences;
  },

  "adherence.decline": (rng, i) => {
    const sentences: string[] = [];
    sentences.push(
      pick(rng, [
        "Your nightly use has drifted down lately.",
        "The last couple of weeks look a little different from your usual.",
      ])
    );
    sentences.push(
      `Average use is ${hoursText(i.usageLast14Mean ?? 0)} a night over the last two weeks, down from ${hoursText(i.usagePrior28Mean ?? 0)} across the month before.`
    );
    sentences.push(
      pick(rng, [
        "Dips like this almost always trace back to something fixable — dryness, a noisy leak, a mask that started leaving marks.",
        "In our experience there's usually one small snag behind a dip like this, and it's nearly always fixable.",
      ])
    );
    sentences.push(
      pick(rng, [
        "Your sleep coach can help find the snag; even wearing the mask for a few relaxed minutes before lights-out helps it feel routine again.",
        "A short call with your sleep coach usually finds it, and putting the mask on fifteen minutes before lights-out helps the routine come back.",
      ])
    );
    return sentences;
  },

  "adherence.reengage": (rng, i) => {
    const sentences: string[] = [];
    sentences.push(
      pick(rng, [
        `It's been ${i.gapStreak} nights since the machine last recorded a session.`,
        `The machine has been quiet for ${i.gapStreak} nights now.`,
      ])
    );
    sentences.push(
      pick(rng, [
        "Breaks happen — travel, a cold, a mask that got annoying — and there's no scorekeeping here.",
        "Pauses are normal; travel and head colds interrupt most people's routines at some point.",
      ])
    );
    sentences.push(
      pick(rng, [
        "When you're ready, a fresh start with your sleep coach — fit check, humidity settings, one comfortable night at a time — is the easiest way back in.",
        "Whenever it suits you, your sleep coach can reset things gently: a fit check, a humidity tweak, and one comfortable night to restart the habit.",
      ])
    );
    return sentences;
  },

  "provider.residual": (rng, i) => {
    const sentences: string[] = [];
    sentences.push(
      pick(rng, [
        "One machine reading is worth a conversation at your next visit.",
        "There's a machine number here your care team should see.",
      ])
    );
    sentences.push(
      `The nightly event index has averaged ${round1(i.residualLast14Mean ?? 0)} events per hour over the last two weeks, up from ${round1(i.residualPrior14Mean ?? 0)} before that.`
    );
    sentences.push(
      pick(rng, [
        "That's a number only your care team can interpret, so this card makes no guesses about it.",
        "Only your care team can say what it means, so this card simply passes the trend along.",
      ])
    );
    sentences.push(
      pick(rng, [
        "Please bring it up at your next appointment — a screenshot of this card is plenty.",
        "Mentioning it at your next visit is all that's needed; your provider can take it from there.",
      ])
    );
    return sentences;
  },

  "provider.spo2": (rng, i) => {
    const sentences: string[] = [];
    sentences.push(
      pick(rng, [
        "Your wearable noticed something your care team should hear about.",
        "A wearable trend worth sharing at your next visit.",
      ])
    );
    sentences.push(
      `${i.lowSpo2NightsLast14} nights in the last two weeks showed average overnight oxygen below 92%, compared with ${i.lowSpo2NightsPrior14} in the two weeks before.`
    );
    sentences.push(
      pick(rng, [
        "Wearable oxygen readings are rough estimates, and only your care team can say what they mean.",
        "These readings are estimates from a wrist sensor — interpreting them is your care team's call, not this app's.",
      ])
    );
    sentences.push(
      pick(rng, [
        "Please share the trend with your provider — pointing at this card is enough.",
        "Bringing this trend to your provider's attention is the one step this card suggests.",
      ])
    );
    return sentences;
  },
};

/**
 * The drafted narrative for one card, composed FROM the evidence bundle
 * (level-up 12: builders read bundle.inputs — the consent-scoped snapshot
 * the bundle's claims cite — so text and evidence tables share one source).
 * Deterministic: seeded on (NARRATIVE_VERSION, participantId, ruleId), so a
 * participant's draft is stable across renders while different participants
 * read different drafts.
 */
export function buildNarrative(
  participantId: string,
  recommendation: Recommendation,
  bundle: EvidenceBundle
): string {
  const builder = BUILDERS[recommendation.ruleId];
  if (!builder) {
    // Unknown rule: fall back to the card body — never invent unreviewed text.
    return recommendation.body;
  }
  const rng = new Rng(`${NARRATIVE_VERSION}:${participantId}:${recommendation.ruleId}`);
  return builder(rng, bundle.inputs).join(" ");
}
