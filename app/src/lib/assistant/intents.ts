/**
 * AI Care Assistant — scripted intent classifier (Addendum A).
 *
 * OFFLINE-CAPABLE BY CONTRACT: the assistant is a rule-based scripted
 * engine — deterministic pattern matching over the participant's message,
 * no network, no external model. Intents map to reply builders whose text
 * is grounded exclusively in that participant's consent-gated data.
 *
 * ORDER MATTERS AND IS A SAFETY PROPERTY: clinical topics (pressure
 * changes, diagnosis, medication, stopping therapy) are checked FIRST, so
 * a message like "should I turn my pressure up because of the leak?"
 * escalates rather than troubleshoots. The non-device-CDS boundary
 * (SPEC §10.3) applies to the assistant exactly as it does to the
 * recommendation engine: the assistant never diagnoses, never directs a
 * therapy change, never advises on medication — those turn into an
 * escalation reply routed to the care team and logged for clinician
 * review.
 */

export type ChatIntent =
  | "clinical" // pressure/diagnosis/medication/therapy-change → escalate
  | "leak" // mask-leak troubleshooting
  | "dryness" // dryness / humidification troubleshooting
  | "resupply" // supply schedule / reorder
  | "adherence" // adherence check-in ("how am I doing")
  | "comfort" // habituation / general comfort troubleshooting
  | "greeting"
  | "unknown";

/** Which clinical lane a message escalated under (for the reply wording). */
export type ClinicalTopic =
  | "pressure settings"
  | "test results or severity"
  | "medications"
  | "starting or stopping therapy";

export interface IntentMatch {
  intent: ChatIntent;
  /** the pattern that decided the intent (audit display) */
  matched: string;
  clinicalTopic: ClinicalTopic | null;
}

interface ClinicalRule {
  topic: ClinicalTopic;
  patterns: RegExp[];
}

/**
 * Clinical escalation triggers. Deliberately broad: a false-positive
 * escalation is a safe outcome (the reply routes to the care team); a
 * false negative is not. Uncertainty routes UP.
 */
const CLINICAL_RULES: ClinicalRule[] = [
  {
    topic: "pressure settings",
    patterns: [
      /pressure.*\b(change|chang|adjust|increase|decrease|raise|lower|higher|lower|up|down|setting|set to|too high|too low|wrong)\b/,
      /\b(change|adjust|increase|decrease|raise|lower|turn)\b.*pressure/,
      /\bcmh2o\b/,
      /\bpressure setting/,
      // Paraphrases that never say "pressure": machine/air strength and
      // force complaints, and turn-it-up/-down asks, are pressure asks.
      /\b(machine|cpap|air ?flow|air|pressure)\b.*\b(too strong|too powerful|too forceful|too much air)\b/,
      /\b(turn|dial|crank)\w*\b.*\b(up|down)\b.*\b(machine|strength|power|air ?flow|air|pressure)\b/,
      /\b(machine|cpap|air ?flow) strength\b/,
      /\bblow(s|ing)? too hard\b/,
    ],
  },
  {
    topic: "test results or severity",
    patterns: [
      /\bdiagnos/,
      /do i (have|really have|still have)\b/,
      /is (it|this) (sleep )?apnea/,
      /how (bad|severe) is/,
      /\bseverity\b/,
      /what (does|do) my (ahi|results?|numbers?|score) (mean|say)/,
      /\bmy (test|study|hst) results?\b/,
      /am i (getting )?(better|worse|cured)/,
    ],
  },
  {
    topic: "medications",
    patterns: [
      /\bmedicat/,
      /\bmedicine\b/,
      /\bmeds?\b/,
      /\bpills?\b/,
      /\bdrugs?\b/,
      /\bmelatonin\b/,
      /\bambien\b/,
      /\bsedative/,
      /\bdosage\b|\bdose\b/,
    ],
  },
  {
    topic: "starting or stopping therapy",
    patterns: [
      /\b(stop|stopping|pause|discontinue)\b.*\b(cpap|therapy|treatment|machine|using)\b/,
      /\bquit(ting)?\b/,
      /do i (still )?need (the|my|this)/,
      /\b(come|coming) off\b/,
      /take a break from/,
      /switch(ing)? to (an? )?(oral|dental|appliance|mouth)/,
    ],
  },
];

interface IntentRule {
  intent: ChatIntent;
  patterns: RegExp[];
}

const INTENT_RULES: IntentRule[] = [
  {
    intent: "leak",
    patterns: [
      /\bleak/,
      /air (escap|blow|hiss)/,
      /\bwhistl/,
      /\bnoisy\b|\bnoise\b/,
      /air (in|into) my eyes/,
      /mask (blows|hisses|farts)/,
    ],
  },
  {
    intent: "dryness",
    patterns: [
      /\bdry\b|\bdryness\b|\bdries\b/,
      /\bhumidif/,
      /\brainout\b|\brain-out\b/,
      /\bcongest/,
      /\bstuffy\b/,
      /nose (burns|hurts|is sore)/,
      /water in (the|my) (hose|tube)/,
    ],
  },
  {
    intent: "resupply",
    patterns: [
      /\bresuppl/,
      /\bsuppl(y|ies)\b/,
      /\bcushion/,
      /\bfilter/,
      /\btubing\b|\bhose\b/,
      /\bheadgear\b/,
      /\bwater chamber\b/,
      /\b(replace|replacement|new|reorder|order)\b.*\b(mask|cushion|filter|tube|tubing|hose|headgear|supplies)\b/,
      /when (do|should) i (get|replace|swap)/,
    ],
  },
  {
    intent: "adherence",
    patterns: [
      /how am i doing/,
      /how('s| is| have) (it|my|i)\b/,
      /\badheren/,
      /\busage\b/,
      /\bhours\b.*\b(night|used|using|sleep)\b/,
      /\bstreak\b/,
      /\bprogress\b/,
      /\bcheck[- ]?in\b/,
      /am i on track/,
      /\bmy numbers\b/,
    ],
  },
  {
    intent: "comfort",
    patterns: [
      /\buncomfortab|\bcomfort/,
      /\bclaustrophob/,
      /get(ting)? used to/,
      /\bmarks?\b.*\bface\b|\bface\b.*\bmarks?\b/,
      /\bsore\b/,
      /\bstraps?\b/,
      /hard to (sleep|fall asleep)/,
      /\bstruggl/,
      /\bannoying\b/,
      /\bhate\b/,
      /keeps? (me|waking)/,
      // Taking the mask off mid-sleep is a habituation complaint.
      /\b(take|takes|taking|took|taken|rip|rips|ripping|ripped|pull|pulls|pulling|pulled|tear|tearing|tore|yank|yanks|yanking|yanked)\b.*\bmask\b/,
      /\bmask\b.*\b(comes?|came|falls?|fell|keeps? coming) off\b/,
    ],
  },
  {
    intent: "greeting",
    patterns: [
      /^(hi|hey|hello|howdy|good (morning|afternoon|evening)|yo)\b/,
      // Only a BARE/short "help" is the greeting menu — "help I keep taking
      // off the mask at 2am" must route on the problem, not the menu, so a
      // help that carries content falls through to the substantive rules.
      /^(please )?help( me)?( please)?[\s.!?]*$/,
      /what can you (do|help)/,
      /^\?+$/,
    ],
  },
];

/**
 * Classifies one participant message. Clinical rules run first; then the
 * troubleshooting/data intents in a fixed priority order; anything
 * unmatched is "unknown" and gets the capability menu (never a guess).
 */
export function classifyIntent(message: string): IntentMatch {
  const text = message.toLowerCase().trim();

  for (const rule of CLINICAL_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        return { intent: "clinical", matched: String(pattern), clinicalTopic: rule.topic };
      }
    }
  }
  for (const rule of INTENT_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        return { intent: rule.intent, matched: String(pattern), clinicalTopic: null };
      }
    }
  }
  return { intent: "unknown", matched: "(no pattern matched)", clinicalTopic: null };
}
