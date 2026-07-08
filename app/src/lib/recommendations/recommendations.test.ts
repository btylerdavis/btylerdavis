import { describe, expect, it } from "vitest";
import {
  emptyInputs,
  evaluateRules,
  GUARDRAIL_FOOTER,
  RULE_IDS,
  type RecommendationInputs,
} from "./rules";

/**
 * Rules-engine unit tests (SPEC §10.3 guardrails): every rule fires on a
 * crafted input, stays quiet below its threshold, and no emitted string ever
 * uses diagnosis/therapy-directive wording (the banned-phrase list).
 */

const inputs = (overrides: Partial<RecommendationInputs>): RecommendationInputs => ({
  ...emptyInputs(),
  ...overrides,
});

/** Inputs crafted so every rule fires at once (worst-case wording surface). */
function everythingFires(): RecommendationInputs {
  return inputs({
    supinePredominant: true,
    supineAhi: 41,
    nonsupineAhi: 9.8,
    recentSupinePct: 44,
    mattressFirmness: 3,
    mattressLabel: "Tempur-Pedic TEMPUR-ProAdapt Soft",
    hasCpap: true,
    cpapNights30: 30,
    adherencePct30: 96,
    usageLast14Mean: 210,
    usagePrior28Mean: 380,
    leakLast14Mean: 26,
    leakPrior14Mean: 12,
    gapStreak: 8,
    residualLast14Mean: 7.2,
    residualPrior14Mean: 3.1,
    lowSpo2NightsLast14: 6,
    lowSpo2NightsPrior14: 1,
  });
}

describe("rule firing", () => {
  it("comfort.positional fires for a supine-heavy supine-predominant sleeper", () => {
    const recs = evaluateRules(
      inputs({ supinePredominant: true, recentSupinePct: 36, supineAhi: 40, nonsupineAhi: 10 })
    );
    expect(recs.map((r) => r.ruleId)).toEqual(["comfort.positional"]);
    expect(recs[0].guardrail).toBe("comfort");
    expect(recs[0].sparkline).toBe("supine");
    expect(recs[0].whyChips.length).toBeGreaterThanOrEqual(2);
  });

  it("comfort.positional adds the soft-mattress angle only for soft mattresses", () => {
    const base = { supinePredominant: true as const, recentSupinePct: 36 };
    const soft = evaluateRules(inputs({ ...base, mattressFirmness: 3, mattressLabel: "X Soft" }));
    const firm = evaluateRules(inputs({ ...base, mattressFirmness: 8, mattressLabel: "X Firm" }));
    expect(soft[0].body).toContain("softer mattress");
    expect(firm[0].body).not.toContain("softer mattress");
  });

  it("comfort.positional stays quiet below the supine-share threshold or off-phenotype", () => {
    expect(evaluateRules(inputs({ supinePredominant: true, recentSupinePct: 22 }))).toEqual([]);
    expect(evaluateRules(inputs({ supinePredominant: false, recentSupinePct: 50 }))).toEqual([]);
    expect(evaluateRules(inputs({ supinePredominant: null, recentSupinePct: 50 }))).toEqual([]);
  });

  it("adherence.streak fires on a strong month and respects the night minimum", () => {
    const fired = evaluateRules(
      inputs({ hasCpap: true, cpapNights30: 28, adherencePct30: 93, usageLast14Mean: 405 })
    );
    expect(fired.map((r) => r.ruleId)).toEqual(["adherence.streak"]);
    expect(fired[0].guardrail).toBe("adherence-support");
    // too few data nights → no card, even at 100%
    expect(
      evaluateRules(inputs({ hasCpap: true, cpapNights30: 10, adherencePct30: 100 }))
    ).toEqual([]);
    // below the percentage bar → no card
    expect(
      evaluateRules(inputs({ hasCpap: true, cpapNights30: 30, adherencePct30: 70 }))
    ).toEqual([]);
  });

  it("adherence.refit fires on high leak, and on a rise from an elevated base", () => {
    const high = evaluateRules(inputs({ hasCpap: true, leakLast14Mean: 24 }));
    expect(high.map((r) => r.ruleId)).toEqual(["adherence.refit"]);

    const risen = evaluateRules(
      inputs({ hasCpap: true, leakLast14Mean: 16, leakPrior14Mean: 9 })
    );
    expect(risen.map((r) => r.ruleId)).toEqual(["adherence.refit"]);

    // stable, normal leak → quiet (Marcus's real numbers live here)
    expect(
      evaluateRules(inputs({ hasCpap: true, leakLast14Mean: 12.5, leakPrior14Mean: 10.5 }))
    ).toEqual([]);
  });

  it("adherence.decline fires on a real drop to a low level, not on noise", () => {
    const fired = evaluateRules(
      inputs({ hasCpap: true, usageLast14Mean: 220, usagePrior28Mean: 390 })
    );
    expect(fired.map((r) => r.ruleId)).toEqual(["adherence.decline"]);
    // still-healthy usage after a drop → quiet
    expect(
      evaluateRules(inputs({ hasCpap: true, usageLast14Mean: 330, usagePrior28Mean: 400 }))
    ).toEqual([]);
    // low but not declining → quiet
    expect(
      evaluateRules(inputs({ hasCpap: true, usageLast14Mean: 250, usagePrior28Mean: 280 }))
    ).toEqual([]);
  });

  it("adherence.reengage fires on a therapy-gap streak", () => {
    const fired = evaluateRules(inputs({ hasCpap: true, gapStreak: 6 }));
    expect(fired.map((r) => r.ruleId)).toEqual(["adherence.reengage"]);
    expect(evaluateRules(inputs({ hasCpap: true, gapStreak: 3 }))).toEqual([]);
  });

  it("provider.residual fires only on an elevated AND rising event index", () => {
    const fired = evaluateRules(
      inputs({ hasCpap: true, residualLast14Mean: 6.1, residualPrior14Mean: 3.4 })
    );
    expect(fired.map((r) => r.ruleId)).toEqual(["provider.residual"]);
    expect(fired[0].guardrail).toBe("discuss-with-provider");
    // elevated but flat → quiet
    expect(
      evaluateRules(inputs({ hasCpap: true, residualLast14Mean: 6.0, residualPrior14Mean: 5.5 }))
    ).toEqual([]);
    // rising but still low → quiet
    expect(
      evaluateRules(inputs({ hasCpap: true, residualLast14Mean: 4.0, residualPrior14Mean: 1.0 }))
    ).toEqual([]);
  });

  it("provider.spo2 fires on rising low-oxygen nights", () => {
    const fired = evaluateRules(inputs({ lowSpo2NightsLast14: 5, lowSpo2NightsPrior14: 1 }));
    expect(fired.map((r) => r.ruleId)).toEqual(["provider.spo2"]);
    expect(
      evaluateRules(inputs({ lowSpo2NightsLast14: 5, lowSpo2NightsPrior14: 4 }))
    ).toEqual([]);
    expect(
      evaluateRules(inputs({ lowSpo2NightsLast14: 2, lowSpo2NightsPrior14: 0 }))
    ).toEqual([]);
  });

  it("null inputs fire nothing (blocked/no-consent participants get no cards)", () => {
    expect(evaluateRules(emptyInputs())).toEqual([]);
  });

  it("is deterministic and covers every registered rule", () => {
    const first = evaluateRules(everythingFires());
    const second = evaluateRules(everythingFires());
    expect(second).toEqual(first);
    expect(first.map((r) => r.ruleId).sort()).toEqual([...RULE_IDS].sort());
  });

  it("Marcus-shaped inputs produce exactly comfort + adherence-streak", () => {
    // Marcus at the seeded clock (day 90): supine-predominant, ~37% recent
    // supine, medium-firm hybrid, ~100% adherent, leak/residual/SpO2 healthy.
    const recs = evaluateRules(
      inputs({
        supinePredominant: true,
        supineAhi: 41,
        nonsupineAhi: 9.8,
        recentSupinePct: 36.5,
        mattressFirmness: 6,
        mattressLabel: "Tempur-Pedic TEMPUR-ProAdapt Medium Hybrid",
        hasCpap: true,
        cpapNights30: 30,
        adherencePct30: 100,
        usageLast14Mean: 411.8,
        usagePrior28Mean: 383.1,
        leakLast14Mean: 10.3,
        leakPrior14Mean: 11.7,
        residualLast14Mean: 2.5,
        residualPrior14Mean: 2.7,
        lowSpo2NightsLast14: 0,
        lowSpo2NightsPrior14: 0,
      })
    );
    expect(recs.map((r) => r.ruleId)).toEqual(["comfort.positional", "adherence.streak"]);
    expect(recs.map((r) => r.guardrail)).toEqual(["comfort", "adherence-support"]);
  });
});

describe("guardrail wording (SPEC §10.3)", () => {
  // The non-device-CDS boundary, asserted as text: no diagnosis language, no
  // therapy-change directives, no "quit" framing.
  const BANNED_PHRASES = [
    "you have",
    "diagnos", // diagnosis, diagnose, diagnosed, diagnostic
    "increase your pressure",
    "decrease your pressure",
    "change your pressure",
    "adjust your pressure",
    "stop using",
    "stop your",
    "quit",
    "you suffer",
    "your condition",
    "prescri", // prescribe, prescription
  ];

  it("no rule output ever uses banned diagnosis/directive wording", () => {
    const recs = evaluateRules(everythingFires());
    expect(recs.length).toBe(RULE_IDS.length); // wording of EVERY rule is checked
    for (const rec of recs) {
      const surface = [
        rec.title,
        rec.body,
        ...rec.whyChips.flatMap((chip) => [chip.label, chip.value]),
        GUARDRAIL_FOOTER,
      ]
        .join(" ")
        .toLowerCase();
      for (const phrase of BANNED_PHRASES) {
        expect(surface, `rule ${rec.ruleId} must not contain "${phrase}"`).not.toContain(phrase);
      }
    }
  });

  it("provider-class cards point to the provider without interpreting for them", () => {
    const recs = evaluateRules(everythingFires()).filter(
      (rec) => rec.guardrail === "discuss-with-provider"
    );
    expect(recs.length).toBeGreaterThanOrEqual(2);
    for (const rec of recs) {
      expect(`${rec.title} ${rec.body}`.toLowerCase()).toContain("provider");
    }
  });
});
