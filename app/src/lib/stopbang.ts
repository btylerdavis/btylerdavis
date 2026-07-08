/**
 * STOP-BANG screener (DEMO.md Act 1) — the real published instrument: eight
 * yes/no items, one point each. Risk bands follow the standard cut points:
 * 0-2 low, 3-4 intermediate, 5-8 high.
 *
 * Pure module (no DB, no dates) so scoring is unit-testable and can run in a
 * server action.
 */

export const STOP_BANG_ITEM_KEYS = [
  "snoring",
  "tiredness",
  "observed_apnea",
  "pressure",
  "bmi",
  "age",
  "neck",
  "gender",
] as const;

export type StopBangItemKey = (typeof STOP_BANG_ITEM_KEYS)[number];

export interface StopBangItem {
  key: StopBangItemKey;
  /** The letter this item contributes to the STOP-BANG acronym. */
  letter: string;
  label: string;
  /** Friendly, plain-language question wording for the in-store screen. */
  question: string;
}

export const STOP_BANG_ITEMS: readonly StopBangItem[] = [
  {
    key: "snoring",
    letter: "S",
    label: "Snoring",
    question:
      "Do you snore loudly — louder than talking, or loud enough to be heard through a closed door?",
  },
  {
    key: "tiredness",
    letter: "T",
    label: "Tiredness",
    question:
      "Do you often feel tired, fatigued, or sleepy during the daytime?",
  },
  {
    key: "observed_apnea",
    letter: "O",
    label: "Observed apnea",
    question: "Has anyone noticed you stop breathing while you sleep?",
  },
  {
    key: "pressure",
    letter: "P",
    label: "Blood pressure",
    question:
      "Do you have high blood pressure, or are you being treated for it?",
  },
  {
    key: "bmi",
    letter: "B",
    label: "Body mass index",
    question: "Is your body mass index (BMI) higher than 35?",
  },
  {
    key: "age",
    letter: "A",
    label: "Age",
    question: "Are you older than 50?",
  },
  {
    key: "neck",
    letter: "N",
    label: "Neck size",
    question:
      "Is your neck circumference larger than 40 cm (about 15½ inches)?",
  },
  {
    key: "gender",
    letter: "G",
    label: "Gender",
    question: "Are you male?",
  },
];

/** One boolean answer per item; every item must be answered. */
export type StopBangAnswers = Record<StopBangItemKey, boolean>;

export type StopBangRiskBand = "low" | "intermediate" | "high";

export function isCompleteAnswers(
  answers: Partial<Record<StopBangItemKey, boolean>>
): answers is StopBangAnswers {
  return STOP_BANG_ITEM_KEYS.every((key) => typeof answers[key] === "boolean");
}

/** Total score: one point per "yes". */
export function scoreStopBang(answers: StopBangAnswers): number {
  if (!isCompleteAnswers(answers)) {
    throw new Error("STOP-BANG requires an answer for all 8 items");
  }
  return STOP_BANG_ITEM_KEYS.reduce(
    (total, key) => total + (answers[key] ? 1 : 0),
    0
  );
}

/** Risk bands: 0-2 low / 3-4 intermediate / 5-8 high. */
export function stopBangRiskBand(score: number): StopBangRiskBand {
  if (!Number.isInteger(score) || score < 0 || score > 8) {
    throw new Error(`STOP-BANG score out of range: ${score}`);
  }
  if (score <= 2) return "low";
  if (score <= 4) return "intermediate";
  return "high";
}

/**
 * Per-item 0/1 scores in STOP_BANG_ITEM_KEYS order — the same itemScores
 * shape the synthetic generator seeds, so live and synthetic rows match.
 */
export function stopBangItemScores(answers: StopBangAnswers): number[] {
  return STOP_BANG_ITEM_KEYS.map((key) => (answers[key] ? 1 : 0));
}
