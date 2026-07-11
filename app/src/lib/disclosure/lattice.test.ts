import { describe, expect, it } from "vitest";
import { firmnessBand } from "../research/cohort";
import {
  buildProfile,
  catalogBySku,
  COHORT_SIZE,
  participantIdForIndex,
} from "../synthetic/profiles";
import { bandCount } from "./bands";
import {
  allLatticeFilters,
  auditLatticeRelease,
  buildCountLattice,
  exactCountRelease,
  latticeKey,
  releaseLattice,
  type DisclosureMemberAttrs,
} from "./lattice";

/**
 * Complementary suppression + the differencing audit (audit F-12).
 *
 * The centrepiece reproduces the audit's exact attack — for
 * severity=moderate, supine=y, arm=appliance_mattress the pre-fix release
 * shipped parent 21 / medium 20 / firm 0 / soft "<11 (suppressed)", and
 * 21 − 20 − 0 = 1 reconstructed the suppressed cell exactly. The tests
 * prove:
 *
 * 1. the audit function CATCHES that attack against the pre-fix exact
 *    release shape;
 * 2. the complementary-suppression loop repairs even that hostile release
 *    policy until zero cells are inferable;
 * 3. the production banded release ships with zero inferable cells, and the
 *    repro cell in particular is no longer reconstructable;
 * 4. a full-lattice sweep over the real seeded 2,000-participant cohort
 *    (the same deterministic profiles `npm run seed` writes) finds zero
 *    inferable cells anywhere.
 */

/** The audit's repro cohort: 21 in the parent — 20 medium, 1 soft, 0 firm. */
function reproMembers(): DisclosureMemberAttrs[] {
  const base = { severity: "moderate", supine: "y" as const, arm: "appliance_mattress" };
  return [
    ...Array.from({ length: 20 }, () => ({ ...base, firmness: "medium" })),
    { ...base, firmness: "soft" },
    // Background members in other cells so the lattice is not degenerate.
    ...Array.from({ length: 40 }, () => ({
      severity: "mild",
      supine: "n" as const,
      arm: "cpap",
      firmness: null,
    })),
  ];
}

const REPRO_PARENT = latticeKey({
  severity: "moderate",
  supine: "y",
  arm: "appliance_mattress",
});
const REPRO_SOFT = latticeKey({
  severity: "moderate",
  supine: "y",
  arm: "appliance_mattress",
  firmness: "soft",
});

describe("buildCountLattice", () => {
  it("counts every cell, with null attributes feeding parents but no child", () => {
    const members: DisclosureMemberAttrs[] = [
      { severity: "mild", supine: "y", arm: "cpap", firmness: null },
      { severity: "mild", supine: null, arm: "cpap", firmness: null },
      { severity: "severe", supine: "n", arm: null, firmness: "firm" },
    ];
    const counts = buildCountLattice(members);
    expect(counts.get(latticeKey({}))).toBe(3); // root
    expect(counts.get(latticeKey({ severity: "mild" }))).toBe(2);
    expect(counts.get(latticeKey({ severity: "mild", supine: "y" }))).toBe(1);
    expect(counts.get(latticeKey({ firmness: "firm" }))).toBe(1);
    expect(counts.get(latticeKey({ severity: "moderate" }))).toBe(0);
    // Every cell of the (3+1)(2+1)(5+1)(3+1) lattice exists, zero-filled.
    expect(counts.size).toBe(allLatticeFilters().length);
    expect(counts.size).toBe(288);
  });

  it("enumerates exactly (3+1)(2+1)(5+1)(3+1) = 288 cells", () => {
    expect(allLatticeFilters()).toHaveLength(288);
  });
});

describe("the audit's exact differencing repro (F-12)", () => {
  it("the auditor CATCHES the subtraction attack against the pre-fix exact release", () => {
    const counts = buildCountLattice(reproMembers());
    expect(counts.get(REPRO_PARENT)).toBe(21);
    expect(counts.get(REPRO_SOFT)).toBe(1);

    // Pre-fix release shape: exact counts, per-cell k-suppression only.
    const released = new Map(
      [...counts].map(([key, count]) => [key, exactCountRelease(count)])
    );
    const audit = auditLatticeRelease(released, counts);
    expect(audit.sound).toBe(true);
    // The suppressed soft cell is pinned to exactly 1 — the audit's finding.
    const inferred = audit.inferable.find((cell) => cell.key === REPRO_SOFT);
    expect(inferred).toBeDefined();
    expect(inferred?.value).toBe(1);
  });

  it("complementary suppression repairs even the hostile exact-release policy", () => {
    const counts = buildCountLattice(reproMembers());
    const release = releaseLattice(counts, { release: exactCountRelease });
    // The loop had to withhold extra cells...
    expect(release.complementaryKeys.length).toBeGreaterThan(0);
    // ...and the final audit proves zero inferable cells.
    expect(release.audit.inferable).toHaveLength(0);
    expect(release.audit.sound).toBe(true);
  });

  it("the production banded release makes the repro cell non-reconstructable", () => {
    const counts = buildCountLattice(reproMembers());
    const { released, audit } = releaseLattice(counts);

    // What the partner sees now: bands and suppression — no exact numbers.
    expect(released.get(REPRO_PARENT)?.display).toBe("21–50");
    expect(
      released.get(latticeKey({ severity: "moderate", supine: "y", arm: "appliance_mattress", firmness: "medium" }))
        ?.display
    ).toBe("11–20");
    expect(
      released.get(latticeKey({ severity: "moderate", supine: "y", arm: "appliance_mattress", firmness: "firm" }))
        ?.display
    ).toBe("0");
    expect(released.get(REPRO_SOFT)?.display).toBe("<11 (suppressed)");

    // Zero inferable cells anywhere; specifically, the soft cell's feasible
    // interval is a RANGE that contains the truth — not the single value 1.
    expect(audit.inferable).toHaveLength(0);
    const interval = audit.intervals.get(REPRO_SOFT);
    expect(interval).toBeDefined();
    expect(interval!.lo).toBeLessThanOrEqual(1);
    expect(interval!.hi).toBeGreaterThan(interval!.lo);
    expect(audit.sound).toBe(true);
  });
});

describe("full-lattice differencing sweep on the seeded cohort", () => {
  it("releases the entire filter lattice of the real 2,000-participant cohort with ZERO inferable cells", () => {
    // The exact deterministic profiles `npm run seed` writes (buildProfile
    // is a pure function of the participant id).
    const members: DisclosureMemberAttrs[] = Array.from({ length: COHORT_SIZE }, (_, index) => {
      const profile = buildProfile(participantIdForIndex(index));
      return {
        severity: profile.severity,
        supine: profile.supinePredominant ? "y" : "n",
        arm: profile.arm,
        firmness:
          profile.mattressSku === null
            ? null
            : firmnessBand(catalogBySku(profile.mattressSku).firmnessRating),
      };
    });

    const counts = buildCountLattice(members);
    expect(counts.get(latticeKey({}))).toBe(COHORT_SIZE);

    const { released, audit } = releaseLattice(counts);

    // The differencing audit: zero inferable cells across all 288 cells and
    // every parent/children constraint, under a worst-case attacker who
    // knows the release rules and every null-attribute remainder.
    expect(audit.inferable).toHaveLength(0);
    expect(audit.sound).toBe(true);

    let suppressedCells = 0;
    for (const [key, release] of released) {
      const truth = counts.get(key) as number;
      // Released intervals always contain the truth...
      expect(release.min).toBeLessThanOrEqual(truth);
      if (release.max !== null) expect(release.max).toBeGreaterThanOrEqual(truth);
      // ...exact positive counts never ship...
      if (truth > 0) expect(release.display).not.toBe(String(truth));
      // ...and every suppressed cell keeps a multi-value feasible interval.
      if (release.suppressed) {
        suppressedCells += 1;
        const interval = audit.intervals.get(key);
        expect(interval!.hi).toBeGreaterThan(interval!.lo);
      }
    }
    // The seeded cohort genuinely exercises suppression (the audit found 36
    // inferable examples pre-fix, so small cells must exist).
    expect(suppressedCells).toBeGreaterThan(0);
  });

  it("banding is stateless: re-releasing the same lattice yields identical bands (no averaging attacks)", () => {
    const members = reproMembers();
    const counts = buildCountLattice(members);
    const first = releaseLattice(counts);
    const second = releaseLattice(counts);
    for (const [key, release] of first.released) {
      expect(second.released.get(key)).toEqual(release);
    }
  });
});

describe("bandCount ↔ lattice integration", () => {
  it("uses the shared band ladder for lattice cells", () => {
    const counts = buildCountLattice(reproMembers());
    const { released } = releaseLattice(counts);
    for (const [key, release] of released) {
      const truth = counts.get(key) as number;
      // A cell the complementary pass did not touch is exactly bandCount(truth).
      if (release.band !== "withheld") {
        expect(release).toEqual(bandCount(truth));
      }
    }
  });
});
