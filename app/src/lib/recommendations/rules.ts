/**
 * Rules-based recommendation engine (DEMO.md Act 7, SPEC §10).
 *
 * Deterministic and defensible: every rule is a pure predicate over
 * pre-computed aggregates (RecommendationInputs), and every card it emits is
 * labeled with its FDA non-device-CDS guardrail class (SPEC §10.3):
 *
 * - "comfort"               — mattress/positional comfort suggestions
 * - "adherence-support"     — therapy-routine nudges (refit, re-engagement)
 * - "discuss-with-provider" — prompts to bring a signal to the clinician;
 *                             NEVER a diagnosis or a therapy-change directive
 *
 * Wording discipline: no rule output may diagnose, direct a therapy change,
 * or interpret physiology a clinician hasn't seen. The unit tests assert a
 * banned-phrase list against every emitted string.
 *
 * This module never touches the database; inputs are computed by
 * queries.ts through the consent-gated identified-tier readers (§10.2).
 */

export type GuardrailClass = "comfort" | "adherence-support" | "discuss-with-provider";

export const GUARDRAIL_LABELS: Record<GuardrailClass, string> = {
  comfort: "Comfort",
  "adherence-support": "Adherence support",
  "discuss-with-provider": "Discuss with your provider",
};

/** The one-line footer every card carries (SPEC §10.3 boundary, on-screen). */
export const GUARDRAIL_FOOTER =
  "Wellness guidance, not medical advice — reviewed boundary: non-device CDS";

// --- thresholds (exported so tests and the UI cite the same numbers) --------

/** Comfort: still supine-heavy when ≥ this % of recent nights is on the back. */
export const SUPINE_HEAVY_PCT = 30;
/** A mattress with normalized firmness ≤ this counts as "soft". */
export const SOFT_FIRMNESS_MAX = 4;
/** Adherence streak: ≥ this % of the last 30 CPAP nights at ≥ 4 h. */
export const STREAK_ADHERENCE_PCT = 85;
/** …with at least this many CPAP data nights in the window. */
export const STREAK_MIN_NIGHTS = 20;
/** Mask refit: last-2-week mean p95 leak at/above this (L/min)… */
export const LEAK_HIGH = 20;
/** …or risen by ≥ this vs the prior 2 weeks while at/above LEAK_ELEVATED. */
export const LEAK_RISE = 5;
export const LEAK_ELEVATED = 15;
/** Usage decline: last-2-week mean down ≥ this many minutes vs prior 4 weeks… */
export const USAGE_DROP_MIN = 60;
/** …and now under this many minutes/night. */
export const USAGE_LOW_MIN = 300;
/** Re-engagement: this many consecutive therapy-gap nights ending today. */
export const GAP_STREAK_NIGHTS = 5;
/** Provider: last-2-week mean residual event index at/above this (events/h)… */
export const RESIDUAL_HIGH = 5;
/** …and risen by ≥ this vs the prior 2 weeks. */
export const RESIDUAL_RISE = 1.5;
/** Provider: nights with mean SpO2 below 92% — at/above this count… */
export const LOW_SPO2_NIGHTS = 4;
/** …and up by ≥ this many nights vs the prior 2 weeks. */
export const LOW_SPO2_RISE = 2;

/**
 * Aggregates the rules run on. Fields are null when the participant has no
 * data (or no current view_identified grant) for the backing data class —
 * a rule whose inputs are null simply cannot fire.
 */
export interface RecommendationInputs {
  // hst_clinical-scoped
  supinePredominant: boolean | null;
  supineAhi: number | null;
  nonsupineAhi: number | null;
  // sleep_mat-scoped
  /** mean nightly supine % over the last 14 nights (≥ 5 nights required) */
  recentSupinePct: number | null;
  // mattress_purchase-scoped
  mattressFirmness: number | null;
  mattressLabel: string | null;
  // cpap_telemetry-scoped
  hasCpap: boolean;
  /** CPAP data nights (usage or gap) in the last 30 days */
  cpapNights30: number;
  /** % of those nights with ≥ 4 h usage */
  adherencePct30: number | null;
  usageLast14Mean: number | null;
  usagePrior28Mean: number | null;
  leakLast14Mean: number | null;
  leakPrior14Mean: number | null;
  /** consecutive therapy-gap nights ending at the sim clock */
  gapStreak: number;
  residualLast14Mean: number | null;
  residualPrior14Mean: number | null;
  // wearable_sleep-scoped
  lowSpo2NightsLast14: number | null;
  lowSpo2NightsPrior14: number | null;
}

/** A stat chip in the card's "why" section — the actual data behind it. */
export interface WhyChip {
  label: string;
  value: string;
}

export interface Recommendation {
  ruleId: string;
  guardrail: GuardrailClass;
  title: string;
  /** warm plain language; must survive the banned-phrase test */
  body: string;
  whyChips: WhyChip[];
  /** which sparkline the UI should attach (from the loader's series) */
  sparkline: "supine" | "usage" | "leak" | "residual" | null;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const hours = (min: number): string => `${(min / 60).toFixed(1)} h`;

interface Rule {
  ruleId: string;
  guardrail: GuardrailClass;
  fires: (inputs: RecommendationInputs) => boolean;
  build: (inputs: RecommendationInputs) => Omit<Recommendation, "ruleId" | "guardrail">;
}

const RULES: Rule[] = [
  // --- comfort ---------------------------------------------------------------
  {
    ruleId: "comfort.positional",
    guardrail: "comfort",
    fires: (i) =>
      i.supinePredominant === true &&
      i.recentSupinePct !== null &&
      i.recentSupinePct >= SUPINE_HEAVY_PCT,
    build: (i) => {
      const supinePct = round1(i.recentSupinePct as number);
      const softMattress =
        i.mattressFirmness !== null && i.mattressFirmness <= SOFT_FIRMNESS_MAX;
      const chips: WhyChip[] = [
        { label: "Back-sleeping, last 2 weeks", value: `${supinePct}% of the night` },
      ];
      if (i.supineAhi !== null && i.nonsupineAhi !== null) {
        chips.push({
          label: "Sleep-study events, back vs side",
          value: `${round1(i.supineAhi)} vs ${round1(i.nonsupineAhi)} events/h`,
        });
      }
      if (i.mattressLabel !== null && i.mattressFirmness !== null) {
        chips.push({
          label: "Current mattress",
          value: `${i.mattressLabel} · firmness ${i.mattressFirmness}/10`,
        });
      }
      return {
        title: "Side sleeping seems to suit you — make it the comfortable default",
        body:
          `Your sleep study recorded far fewer breathing interruptions off your back, ` +
          `and your under-mattress sensor still sees about ${supinePct}% of the night ` +
          `spent back-sleeping. Small comfort changes help many people settle on their ` +
          `side: a full-length body pillow to lean into, a slightly firmer pillow to keep ` +
          `your shoulder comfortable, or starting the night on your side.` +
          (softMattress
            ? ` A softer mattress like yours can make rolling onto the back easy — a firmer ` +
              `comfort layer or topper is another option worth exploring at the store.`
            : ""),
        whyChips: chips,
        sparkline: "supine",
      };
    },
  },

  // --- adherence support -------------------------------------------------------
  {
    ruleId: "adherence.streak",
    guardrail: "adherence-support",
    fires: (i) =>
      i.hasCpap &&
      i.cpapNights30 >= STREAK_MIN_NIGHTS &&
      i.adherencePct30 !== null &&
      i.adherencePct30 >= STREAK_ADHERENCE_PCT,
    build: (i) => ({
      title: "Your CPAP routine is working — keep it going",
      body:
        `You reached 4+ hours on ${Math.round(i.adherencePct30 as number)}% of the last ` +
        `${i.cpapNights30} nights` +
        (i.usageLast14Mean !== null
          ? `, averaging ${hours(i.usageLast14Mean)} a night over the last two weeks`
          : "") +
        `. Consistency is what makes therapy feel better week over week — whatever ` +
        `bedtime routine you've built, it's earning its keep.`,
      whyChips: [
        {
          label: "Nights at 4+ hours, last 30",
          value: `${Math.round(i.adherencePct30 as number)}% of ${i.cpapNights30} nights`,
        },
        ...(i.usageLast14Mean !== null
          ? [{ label: "Average use, last 2 weeks", value: `${hours(i.usageLast14Mean)}/night` }]
          : []),
      ],
      sparkline: "usage" as const,
    }),
  },
  {
    ruleId: "adherence.refit",
    guardrail: "adherence-support",
    fires: (i) =>
      i.hasCpap &&
      i.leakLast14Mean !== null &&
      (i.leakLast14Mean >= LEAK_HIGH ||
        (i.leakPrior14Mean !== null &&
          i.leakLast14Mean - i.leakPrior14Mean >= LEAK_RISE &&
          i.leakLast14Mean >= LEAK_ELEVATED)),
    build: (i) => ({
      title: "Your mask leak crept up — a refit may help",
      body:
        `Mask leak has been running around ${round1(i.leakLast14Mean as number)} L/min ` +
        `over the last two weeks` +
        (i.leakPrior14Mean !== null
          ? `, up from ${round1(i.leakPrior14Mean)} L/min the two weeks before`
          : "") +
        `. Leaks are usually a fit thing, not a you thing: cushions age, straps stretch. ` +
        `A quick refit or cushion swap with your supplier often settles it.`,
      whyChips: [
        {
          label: "p95 leak, last 2 weeks",
          value: `${round1(i.leakLast14Mean as number)} L/min`,
        },
        ...(i.leakPrior14Mean !== null
          ? [{ label: "Prior 2 weeks", value: `${round1(i.leakPrior14Mean)} L/min` }]
          : []),
      ],
      sparkline: "leak" as const,
    }),
  },
  {
    ruleId: "adherence.decline",
    guardrail: "adherence-support",
    fires: (i) =>
      i.hasCpap &&
      i.usageLast14Mean !== null &&
      i.usagePrior28Mean !== null &&
      i.usagePrior28Mean - i.usageLast14Mean >= USAGE_DROP_MIN &&
      i.usageLast14Mean < USAGE_LOW_MIN,
    build: (i) => ({
      title: "Nightly use has been slipping — small tweaks can turn it around",
      body:
        `Average use over the last two weeks is ${hours(i.usageLast14Mean as number)} a ` +
        `night, down from ${hours(i.usagePrior28Mean as number)} before that. Most dips ` +
        `trace to something fixable — dryness, a noisy leak, mask pressure marks. Your ` +
        `sleep coach can help find the snag; even putting the mask on 15 minutes before ` +
        `lights-out helps it feel routine again.`,
      whyChips: [
        { label: "Average use, last 2 weeks", value: `${hours(i.usageLast14Mean as number)}/night` },
        { label: "Prior 4 weeks", value: `${hours(i.usagePrior28Mean as number)}/night` },
      ],
      sparkline: "usage" as const,
    }),
  },
  {
    ruleId: "adherence.reengage",
    guardrail: "adherence-support",
    fires: (i) => i.hasCpap && i.gapStreak >= GAP_STREAK_NIGHTS,
    build: (i) => ({
      title: "It's been a while since your last CPAP night — want to restart together?",
      body:
        `The machine hasn't recorded a session in ${i.gapStreak} nights. Breaks happen — ` +
        `travel, colds, a mask that got annoying. When you're ready, a fresh start with ` +
        `your sleep coach (fit check, humidity settings, one comfortable night at a time) ` +
        `is the easiest way back in.`,
      whyChips: [{ label: "Nights without a session", value: `${i.gapStreak} in a row` }],
      sparkline: "usage" as const,
    }),
  },

  // --- discuss with provider ----------------------------------------------------
  {
    ruleId: "provider.residual",
    guardrail: "discuss-with-provider",
    fires: (i) =>
      i.hasCpap &&
      i.residualLast14Mean !== null &&
      i.residualPrior14Mean !== null &&
      i.residualLast14Mean >= RESIDUAL_HIGH &&
      i.residualLast14Mean - i.residualPrior14Mean >= RESIDUAL_RISE,
    build: (i) => ({
      title: "A machine reading is drifting — worth mentioning to your provider",
      body:
        `Your CPAP's nightly event index has averaged ` +
        `${round1(i.residualLast14Mean as number)} events/h over the last two weeks, up ` +
        `from ${round1(i.residualPrior14Mean as number)} before that. This is a number ` +
        `only your care team can interpret — please bring it up at your next visit and ` +
        `let them take a look.`,
      whyChips: [
        {
          label: "Machine event index, last 2 weeks",
          value: `${round1(i.residualLast14Mean as number)} events/h`,
        },
        {
          label: "Prior 2 weeks",
          value: `${round1(i.residualPrior14Mean as number)} events/h`,
        },
      ],
      sparkline: "residual" as const,
    }),
  },
  {
    ruleId: "provider.spo2",
    guardrail: "discuss-with-provider",
    fires: (i) =>
      i.lowSpo2NightsLast14 !== null &&
      i.lowSpo2NightsPrior14 !== null &&
      i.lowSpo2NightsLast14 >= LOW_SPO2_NIGHTS &&
      i.lowSpo2NightsLast14 - i.lowSpo2NightsPrior14 >= LOW_SPO2_RISE,
    build: (i) => ({
      title: "More low-oxygen nights than usual — one to share with your provider",
      body:
        `Your wearable logged ${i.lowSpo2NightsLast14} nights in the last two weeks with ` +
        `average overnight oxygen below 92%, up from ${i.lowSpo2NightsPrior14} the two ` +
        `weeks before. Wearable oxygen readings are rough estimates and only your care ` +
        `team can say what they mean — please share this trend with your provider.`,
      whyChips: [
        {
          label: "Nights under 92% SpO2, last 2 weeks",
          value: `${i.lowSpo2NightsLast14} nights`,
        },
        { label: "Prior 2 weeks", value: `${i.lowSpo2NightsPrior14} nights` },
      ],
      sparkline: null,
    }),
  },
];

export const RULE_IDS = RULES.map((rule) => rule.ruleId);

/**
 * Registered rule → guardrail class (the source of truth the safety chain's
 * guardrail-class validator checks drafts against — level-up 12).
 */
export const RULE_GUARDRAILS: Readonly<Record<string, GuardrailClass>> = Object.fromEntries(
  RULES.map((rule) => [rule.ruleId, rule.guardrail])
);

/**
 * Evaluates every rule against the inputs. Deterministic: same inputs, same
 * cards, in fixed rule order (comfort → adherence → provider).
 */
export function evaluateRules(inputs: RecommendationInputs): Recommendation[] {
  return RULES.filter((rule) => rule.fires(inputs)).map((rule) => ({
    ruleId: rule.ruleId,
    guardrail: rule.guardrail,
    ...rule.build(inputs),
  }));
}

/** Inputs shell for tests and blocked states: nothing readable, nothing fires. */
export function emptyInputs(): RecommendationInputs {
  return {
    supinePredominant: null,
    supineAhi: null,
    nonsupineAhi: null,
    recentSupinePct: null,
    mattressFirmness: null,
    mattressLabel: null,
    hasCpap: false,
    cpapNights30: 0,
    adherencePct30: null,
    usageLast14Mean: null,
    usagePrior28Mean: null,
    leakLast14Mean: null,
    leakPrior14Mean: null,
    gapStreak: 0,
    residualLast14Mean: null,
    residualPrior14Mean: null,
    lowSpo2NightsLast14: null,
    lowSpo2NightsPrior14: null,
  };
}
