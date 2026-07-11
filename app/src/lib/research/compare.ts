import {
  ARM_LABELS,
  ARM_ORDER,
  loadResearchCohort,
  meanOf,
  type ArmKey,
  type SeverityBand,
} from "./cohort";

/**
 * Treatment-comparison precompute (SPEC §6.4; DEMO.md Act 5). The arithmetic
 * lives in pure functions over already-loaded member records so it is
 * unit-testable without a database; the page calls loadTreatmentComparison.
 *
 * The registry is observational: these are unadjusted group means shown
 * together with the covariate table precisely so the confounding-by-
 * indication conversation happens on screen, not in a footnote.
 */

export interface ArmMemberInput {
  arm: ArmKey;
  /** null when registry_demographics is not research-granted (audit F-11) */
  age: number | null;
  severity: SeverityBand | null;
  ahi: number | null;
  /** ESS at day 90 − baseline (negative = improvement) */
  essChange90: number | null;
  /** sleep-efficiency percentage-point change, baseline → day 90 window */
  seffChange: number | null;
}

export interface ArmComparison {
  arm: ArmKey;
  label: string;
  /** members assigned to this arm (denominator for covariates) */
  n: number;
  essChange: { mean: number | null; n: number };
  seffChange: { mean: number | null; n: number };
  covariates: {
    meanAge: number | null;
    meanAhi: { mean: number | null; n: number };
    severityPct: Record<SeverityBand, number>;
    severityN: number;
  };
}

/**
 * Groups members by arm and computes outcome means + covariate summaries.
 * Every arm in ARM_ORDER is returned (n = 0 groups included) so charts and
 * tables keep a stable shape. Null outcomes drop out of their mean but the
 * member still counts toward the arm's n and covariates.
 */
export function computeArmComparisons(members: ArmMemberInput[]): ArmComparison[] {
  return ARM_ORDER.map((arm) => {
    const group = members.filter((member) => member.arm === arm);
    const severityKnown = group.filter((member) => member.severity !== null);
    const severityCount: Record<SeverityBand, number> = { mild: 0, moderate: 0, severe: 0 };
    for (const member of severityKnown) severityCount[member.severity as SeverityBand] += 1;
    const pct = (count: number) =>
      severityKnown.length ? Math.round((count / severityKnown.length) * 100) : 0;

    return {
      arm,
      label: ARM_LABELS[arm],
      n: group.length,
      essChange: meanOf(group.map((member) => member.essChange90)),
      seffChange: meanOf(group.map((member) => member.seffChange)),
      covariates: {
        meanAge: meanOf(group.map((member) => member.age)).mean,
        meanAhi: meanOf(group.map((member) => member.ahi)),
        severityPct: {
          mild: pct(severityCount.mild),
          moderate: pct(severityCount.moderate),
          severe: pct(severityCount.severe),
        },
        severityN: severityKnown.length,
      },
    };
  });
}

export interface TreatmentComparisonResult {
  clockIso: string;
  /** research-visible members with a determinable arm */
  totalWithArm: number;
  arms: ArmComparison[];
  queryMs: number;
}

export async function loadTreatmentComparison(): Promise<TreatmentComparisonResult> {
  const startedAt = performance.now();
  const cohort = await loadResearchCohort();
  const inputs: ArmMemberInput[] = cohort.members
    .filter((member) => member.arm !== null)
    .map((member) => ({
      arm: member.arm as ArmKey,
      age: member.age,
      severity: member.severity,
      ahi: member.ahi,
      essChange90: member.essChange90,
      seffChange: member.seffChange,
    }));
  return {
    clockIso: cohort.clock.toISOString().slice(0, 10),
    totalWithArm: inputs.length,
    arms: computeArmComparisons(inputs),
    queryMs: Math.round(performance.now() - startedAt),
  };
}
