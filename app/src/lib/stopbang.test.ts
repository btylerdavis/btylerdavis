import { describe, expect, it } from "vitest";
import {
  isCompleteAnswers,
  scoreStopBang,
  STOP_BANG_ITEM_KEYS,
  STOP_BANG_ITEMS,
  stopBangItemScores,
  stopBangRiskBand,
  type StopBangAnswers,
} from "./stopbang";

function answersWithYesCount(yesCount: number): StopBangAnswers {
  const answers = {} as Record<(typeof STOP_BANG_ITEM_KEYS)[number], boolean>;
  STOP_BANG_ITEM_KEYS.forEach((key, i) => {
    answers[key] = i < yesCount;
  });
  return answers;
}

describe("STOP-BANG scoring", () => {
  it("has exactly the 8 published items, spelling out STOP-BANG", () => {
    expect(STOP_BANG_ITEMS).toHaveLength(8);
    expect(STOP_BANG_ITEMS.map((i) => i.letter).join("")).toBe("STOPBANG");
    expect(new Set(STOP_BANG_ITEMS.map((i) => i.key)).size).toBe(8);
  });

  it("scores one point per yes", () => {
    for (let yes = 0; yes <= 8; yes++) {
      expect(scoreStopBang(answersWithYesCount(yes))).toBe(yes);
    }
  });

  it("rejects incomplete answer sets", () => {
    const partial = { snoring: true } as Partial<Record<string, boolean>>;
    expect(isCompleteAnswers(partial)).toBe(false);
    expect(() => scoreStopBang(partial as StopBangAnswers)).toThrow(/all 8 items/);
  });

  it("bands: 0-2 low", () => {
    expect(stopBangRiskBand(0)).toBe("low");
    expect(stopBangRiskBand(1)).toBe("low");
    expect(stopBangRiskBand(2)).toBe("low");
  });

  it("bands: 3-4 intermediate", () => {
    expect(stopBangRiskBand(3)).toBe("intermediate");
    expect(stopBangRiskBand(4)).toBe("intermediate");
  });

  it("bands: 5-8 high", () => {
    for (const score of [5, 6, 7, 8]) {
      expect(stopBangRiskBand(score)).toBe("high");
    }
  });

  it("rejects out-of-range or fractional scores", () => {
    expect(() => stopBangRiskBand(-1)).toThrow(/out of range/);
    expect(() => stopBangRiskBand(9)).toThrow(/out of range/);
    expect(() => stopBangRiskBand(3.5)).toThrow(/out of range/);
  });

  it("itemScores serializes 0/1 per item in canonical order (seed-compatible)", () => {
    const answers = answersWithYesCount(3);
    expect(stopBangItemScores(answers)).toEqual([1, 1, 1, 0, 0, 0, 0, 0]);
    expect(stopBangItemScores(answers).reduce((a, b) => a + b, 0)).toBe(
      scoreStopBang(answers)
    );
  });
});
