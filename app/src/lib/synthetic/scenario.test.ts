import { afterEach, describe, expect, it } from "vitest";
import { nightlyRows } from "./generator";
import {
  addDays,
  buildProfile,
  MARCUS_REED_PARTICIPANT_ID,
  participantIdForIndex,
  seedScenario,
  type ParticipantProfile,
} from "./profiles";

/**
 * SCENARIO=null (the effect-size scenario switcher, DEMO.md §3): the same
 * cohort with the mattress supine effect ≈ 0. These tests prove the null
 * scenario changes ONLY the effect fields (and only for flagship buyers),
 * that it is deterministic, and that the flagship nightly signal actually
 * disappears from generated nights.
 */

const setScenario = (value?: string) => {
  if (value === undefined) delete process.env.SCENARIO;
  else process.env.SCENARIO = value;
};

afterEach(() => setScenario(undefined));

/** Profile minus the effect-linked fields the null scenario may change. */
function nonEffectFields(profile: ParticipantProfile): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...profile };
  delete clone.supineDropPoints;
  delete clone.essImprovement;
  delete clone.isiImprovement;
  return clone;
}

describe("seedScenario env switch", () => {
  it("resolves defaults and rejects unknown values", () => {
    expect(seedScenario(undefined)).toBe("default");
    expect(seedScenario("")).toBe("default");
    expect(seedScenario("default")).toBe("default");
    expect(seedScenario("null")).toBe("null");
    expect(() => seedScenario("mattresses-rule")).toThrow(/Unknown SCENARIO/);
  });
});

describe("SCENARIO=null cohort", () => {
  it("keeps the cohort identical except the mattress supine effect ≈ 0", () => {
    const SAMPLE = 300; // Marcus + 299 cohort members: hits every arm/phenotype combo
    const ids = Array.from({ length: SAMPLE }, (_, i) => participantIdForIndex(i));

    setScenario(undefined);
    const defaults = ids.map(buildProfile);
    setScenario("null");
    const nulls = ids.map(buildProfile);

    let flagshipCount = 0;
    for (let i = 0; i < SAMPLE; i++) {
      const base = defaults[i];
      const nulled = nulls[i];
      // Same person in both worlds: demographics, arm, adherence, devices,
      // wearables, PRO baselines — everything but the effect fields.
      expect(nonEffectFields(nulled)).toEqual(nonEffectFields(base));
      // The headline: no mattress moves supine time more than noise.
      expect(nulled.supineDropPoints).toBeLessThanOrEqual(3);

      const flagship =
        base.hasMattress && base.supinePredominant && base.mattressIsMediumFirmHybrid;
      if (flagship) {
        flagshipCount += 1;
        expect(base.supineDropPoints).toBeGreaterThanOrEqual(8); // default effect intact
      } else {
        // Non-flagship participants are completely untouched.
        expect(nulled.supineDropPoints).toBe(base.supineDropPoints);
        expect(nulled.essImprovement).toBe(base.essImprovement);
        expect(nulled.isiImprovement).toBe(base.isiImprovement);
      }
    }
    expect(flagshipCount).toBeGreaterThan(10); // the medium band is populated
  });

  it("is deterministic, and Marcus goes flat with everything else unchanged", () => {
    setScenario("null");
    const first = buildProfile(MARCUS_REED_PARTICIPANT_ID);
    const second = buildProfile(MARCUS_REED_PARTICIPANT_ID);
    expect(second).toEqual(first); // same scenario → byte-identical profile
    expect(first.supineDropPoints).toBe(0);

    setScenario(undefined);
    const scripted = buildProfile(MARCUS_REED_PARTICIPANT_ID);
    expect(scripted.supineDropPoints).toBe(14);
    expect(nonEffectFields(first)).toEqual(nonEffectFields(scripted));
  });

  it("removes the flagship signal from generated nights (medium band flat)", () => {
    // First flagship cohort member: supine-predominant on a medium-firm hybrid.
    setScenario(undefined);
    let flagshipId: string | null = null;
    for (let i = 1; i < 400 && flagshipId === null; i++) {
      const profile = buildProfile(participantIdForIndex(i));
      if (profile.hasMattress && profile.supinePredominant && profile.mattressIsMediumFirmHybrid) {
        flagshipId = profile.id;
      }
    }
    expect(flagshipId).not.toBeNull();

    const gate = () => true;
    const meanPostDeliverySupine = (profile: ParticipantProfile): number => {
      const delivery = addDays(profile.enrollmentDate, profile.mattressDeliveryOffsetDays);
      const values: number[] = [];
      for (let offset = 20; offset < 50; offset++) {
        // well past the 7-night ramp
        const night = nightlyRows(profile, addDays(delivery, offset), gate);
        for (const obs of night.observations) {
          if (obs.concept === "supine_time_pct" && typeof obs.valueNumeric === "number") {
            values.push(obs.valueNumeric);
          }
        }
      }
      expect(values.length).toBeGreaterThan(15);
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    };

    setScenario(undefined);
    const defaultProfile = buildProfile(flagshipId!);
    // Only run the night comparison for a mat-instrumented flagship member;
    // walk further if this one lacks a sleep mat.
    let candidate = defaultProfile;
    if (!candidate.hasSleepMat) {
      for (let i = 1; i < 800; i++) {
        const profile = buildProfile(participantIdForIndex(i));
        if (
          profile.hasMattress &&
          profile.supinePredominant &&
          profile.mattressIsMediumFirmHybrid &&
          profile.hasSleepMat
        ) {
          candidate = profile;
          break;
        }
      }
    }
    expect(candidate.hasSleepMat).toBe(true);
    const defaultMean = meanPostDeliverySupine(candidate);

    setScenario("null");
    const nullProfile = buildProfile(candidate.id);
    const nullMean = meanPostDeliverySupine(nullProfile);

    // Default: supine time sits well below baseline. Null: back at baseline.
    expect(candidate.baselineSupinePct - defaultMean).toBeGreaterThan(5);
    expect(Math.abs(nullProfile.baselineSupinePct - nullMean)).toBeLessThan(4);
  });
});
