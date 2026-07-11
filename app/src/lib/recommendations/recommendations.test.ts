import { describe, expect, it } from "vitest";
import { buildEvidenceBundle, type EvidenceBundle } from "./evidence";
import { buildNarrative, NARRATIVE_DISCLAIMER } from "./narrative";
import {
  emptyInputs,
  evaluateRules,
  GUARDRAIL_FOOTER,
  RULE_IDS,
  type RecommendationInputs,
} from "./rules";
// The banned-phrase list is now a RUNTIME control (safety.ts, one layer of
// the SafetyCheck chain — level-up 12); these tests assert the same
// discipline against the same list, so test and pipeline can never drift.
import { BANNED_PHRASES } from "./safety";

/**
 * Rules-engine unit tests (SPEC §10.3 guardrails): every rule fires on a
 * crafted input, stays quiet below its threshold, and no emitted string ever
 * uses diagnosis/therapy-directive wording (the banned-phrase list) — a
 * discipline that extends to every drafted AI narrative the template
 * composer can produce (narrative.ts, sampled across many seeds below).
 */

const inputs = (overrides: Partial<RecommendationInputs>): RecommendationInputs => ({
  ...emptyInputs(),
  ...overrides,
});

/** Narrative composition consumes the typed EvidenceBundle (level-up 12). */
const bundleFor = (participantId: string, values: RecommendationInputs): EvidenceBundle =>
  buildEvidenceBundle(participantId, "2026-06-30", values);

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

describe("AI narrative preview (drafted narratives, SPEC §10.4)", () => {
  // Many seeds so every sentence-bank variant of every rule gets sampled —
  // the banned-phrase discipline must hold across the whole template space.
  const SEED_IDS = Array.from({ length: 40 }, (_, i) => `narrative-seed-${i}`);

  it("no narrative draft ever uses banned diagnosis/directive wording, across seeds", () => {
    const recs = evaluateRules(everythingFires());
    expect(recs.length).toBe(RULE_IDS.length); // every rule's narrative is checked
    for (const participantId of SEED_IDS) {
      for (const rec of recs) {
        const surface = `${buildNarrative(participantId, rec, bundleFor(participantId, everythingFires()))} ${NARRATIVE_DISCLAIMER}`.toLowerCase();
        for (const phrase of BANNED_PHRASES) {
          expect(
            surface,
            `narrative for ${rec.ruleId} (seed ${participantId}) must not contain "${phrase}"`
          ).not.toContain(phrase);
        }
      }
    }
  });

  it("narratives are multi-sentence, data-grounded, and deterministic per participant", () => {
    const inputs = everythingFires();
    const bundle = bundleFor("narrative-seed-0", inputs);
    for (const rec of evaluateRules(inputs)) {
      const narrative = buildNarrative("narrative-seed-0", rec, bundle);
      const sentences = narrative.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
      expect(sentences.length, `${rec.ruleId} narrative should read as prose`).toBeGreaterThanOrEqual(3);
      expect(narrative, `${rec.ruleId} narrative must cite the participant's data`).toMatch(/\d/);
      // Deterministic: same participant, same draft — every render.
      expect(buildNarrative("narrative-seed-0", rec, bundle)).toBe(narrative);
    }
  });

  it("different participants read different drafts (varied sentence banks)", () => {
    const inputs = everythingFires();
    for (const rec of evaluateRules(inputs)) {
      const variants = new Set(
        SEED_IDS.map((pid) => buildNarrative(pid, rec, bundleFor(pid, inputs)))
      );
      expect(variants.size, `${rec.ruleId} should vary across participants`).toBeGreaterThan(1);
    }
  });

  it("cites the actual numbers behind the card", () => {
    const inputs = everythingFires();
    const bundle = bundleFor("marcus-test", inputs);
    const byRule = new Map(
      evaluateRules(inputs).map((rec) => [rec.ruleId, buildNarrative("marcus-test", rec, bundle)])
    );
    expect(byRule.get("adherence.streak")).toContain("96%");
    expect(byRule.get("adherence.streak")).toContain("30 nights");
    expect(byRule.get("adherence.refit")).toContain("26");
    expect(byRule.get("adherence.reengage")).toContain("8 nights");
    expect(byRule.get("provider.residual")).toContain("7.2");
    expect(byRule.get("provider.spo2")).toContain("92%");
    expect(byRule.get("comfort.positional")).toContain("44%");
  });
});
