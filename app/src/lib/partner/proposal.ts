import { suppressCount, SMALL_CELL_THRESHOLD, type SuppressedCell } from "../deid";
import { loadExplorer, type CohortFilters } from "../research/explorer";
import { nPerGroup, POWER_DEFAULTS } from "../research/power";
import type { ArmKey, FirmnessBand, SeverityBand } from "../research/cohort";

/**
 * Sponsored-study proposal generator (DEMO.md Act 7 reserve → working;
 * SPEC §12.4 revenue model, §12.3 rules of engagement). The partner picks a
 * research question from the SPEC §6.3–6.4 preset list, narrows the cohort
 * with a filter subset, and gets a one-page proposal whose feasibility
 * numbers are LIVE consent-filtered research-tier counts released through
 * the same k-suppression as the rest of the partner portal.
 *
 * Price bands are SPEC §12.4's bands, which are deliberately rough — every
 * proposal carries the "rough band, not a quote" line verbatim.
 */

export interface PriceBand {
  min: number;
  max: number;
  /** which §12.4 line the band comes from */
  basis: string;
}

/** §12.4: "mid five to six figures per study, at market rates for RWE work". */
export const SPONSORED_STUDY_BAND: PriceBand = {
  min: 50_000,
  max: 250_000,
  basis: "Sponsored study — mid five to six figures per study (SPEC §12.4)",
};

/** §12.4 names validation services without a numeric band — demo assumption. */
export const VALIDATION_STUDY_BAND: PriceBand = {
  min: 40_000,
  max: 120_000,
  basis:
    "Validation services — SPEC §12.4 sets no numeric band; scoped here like a compact sponsored study (demo assumption)",
};

/** The §12.4 honesty line, shown verbatim on every proposal. */
export const PRICE_HONESTY_LINE =
  "Rough band, not a quote — SPEC §12.4's bands are deliberately rough; the point is that the no-selling pledge coexists with a real business, and the §12.3 rules of engagement apply to every line.";

export interface ProposalPreset {
  key: string;
  label: string;
  specRef: string;
  question: string;
  design: string;
  /** endpoints per SPEC §6.3 / §6.5 */
  primaryEndpoint: string;
  secondaryEndpoints: string[];
  /** filters the preset pre-applies when none are chosen */
  defaultFilters: CohortFilters;
  priceBand: PriceBand;
  /** two-group presets get the §6.3 power-sketch feasibility line */
  comparisonGroups: number;
}

export const PROPOSAL_PRESETS: ProposalPreset[] = [
  {
    key: "positional-firmness",
    label: "Positional OSA × mattress firmness (flagship, SPEC §6.3)",
    specRef: "SPEC §6.3",
    question:
      "Does mattress firmness band change supine sleep time in supine-predominant OSA after a delivered mattress change?",
    design:
      "Prospective observational sub-study on the registry cohort: pre/post windows around mattress delivery (7-night adjustment ramp excluded), firmness bands compared with covariate adjustment — association findings, not causal claims (SPEC §6.1).",
    primaryEndpoint: "% supine sleep time (under-mattress sensor), pre → post delivery",
    secondaryEndpoints: [
      "Positional-apnea proxies; SpO2 and resting HR trends",
      "ESS / ISI change from baseline (SPEC §6.5)",
    ],
    defaultFilters: { supine: "y" },
    priceBand: SPONSORED_STUDY_BAND,
    comparisonGroups: 2,
  },
  {
    key: "sponsor-lines-vs-category",
    label: "Sponsor model lines vs category average (SPEC §6.4 framing)",
    specRef: "SPEC §6.4, §12.3",
    question:
      "How do outcomes after a sponsor-brand mattress change compare with the de-identified category average?",
    design:
      "De-identified comparative report under DUA: sponsor lines vs all-other-brands aggregate (competitors never named), propensity-adjusted with the confounding-by-indication caveat displayed (SPEC §6.4).",
    primaryEndpoint: "% supine sleep time change, sponsor lines vs category",
    secondaryEndpoints: [
      "ESS change from baseline; sleep efficiency change (wearable)",
      "Adherence to the k-suppression release rules on every cell (SPEC §12.3)",
    ],
    defaultFilters: {},
    priceBand: SPONSORED_STUDY_BAND,
    comparisonGroups: 2,
  },
  {
    key: "combo-vs-cpap",
    label: "CPAP + mattress change vs CPAP alone (SPEC §6.4)",
    specRef: "SPEC §6.4",
    question:
      "Does adding a mattress change to CPAP therapy improve adherence or symptom outcomes over CPAP alone?",
    design:
      "Treatment-combination comparison with the pre-specified covariate set (age, sex, BMI, baseline severity) and propensity-score adjustment, framed as target-trial emulation — a real-world effectiveness signal and hypothesis generator (SPEC §6.4).",
    primaryEndpoint: "CPAP adherence (% nights ≥ 4 h) and residual AHI on therapy (SPEC §6.5)",
    secondaryEndpoints: [
      "ESS change from baseline",
      "Therapy-abandonment (telemetry silence as an outcome, not a gap — SPEC §6.5)",
    ],
    defaultFilters: { arm: "cpap_mattress" },
    priceBand: SPONSORED_STUDY_BAND,
    comparisonGroups: 2,
  },
  {
    key: "sensor-validation",
    label: "Under-mattress sensor validation vs HST position channel (SPEC §12.4)",
    specRef: "SPEC §12.4 validation services, §5.4",
    question:
      "How well does the under-mattress sensor's supine-time signal agree with the HST position channel (clinical ground truth)?",
    design:
      "Device-validation study on the instrumented sub-cohort: sensor-night supine % vs same-night HST position channel where both exist; agreement statistics pre-specified before unblinding.",
    primaryEndpoint: "Sensor vs HST supine-time agreement (bias and limits of agreement)",
    secondaryEndpoints: [
      "Night-level validity rules (≥ 3 h recorded sleep — SPEC §6.5)",
      "Restlessness / snore-signal exploratory concordance",
    ],
    defaultFilters: { supine: "y" },
    priceBand: VALIDATION_STUDY_BAND,
    comparisonGroups: 1,
  },
];

export const DURATION_OPTIONS = [3, 6, 9, 12] as const;
export type DurationMonths = (typeof DURATION_OPTIONS)[number];

export interface ProposalInputs {
  preset: ProposalPreset;
  filters: CohortFilters;
  durationMonths: DurationMonths;
}

/** Cohort-filter subset the proposal form exposes (of the explorer's set). */
export const PROPOSAL_FILTER_KEYS = ["severity", "supine", "arm", "firmness"] as const;

const oneOf = <T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined =>
  allowed.includes(value as T) ? (value as T) : undefined;

/** Parses ?q=&severity=&supine=&arm=&firmness=&dur= (unknown values drop). */
export function parseProposalParams(
  params: Record<string, string | string[] | undefined>
): ProposalInputs {
  const get = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === "string" ? value : undefined;
  };
  const preset =
    PROPOSAL_PRESETS.find((candidate) => candidate.key === get("q")) ?? PROPOSAL_PRESETS[0];

  const chosen: CohortFilters = {
    severity: oneOf<SeverityBand>(get("severity"), ["mild", "moderate", "severe"]),
    supine: oneOf(get("supine"), ["y", "n"]),
    arm: oneOf<ArmKey>(get("arm"), [
      "cpap",
      "appliance",
      "mattress_only",
      "cpap_mattress",
      "appliance_mattress",
    ]),
    firmness: oneOf<FirmnessBand>(get("firmness"), ["soft", "medium", "firm"]),
  };
  for (const key of PROPOSAL_FILTER_KEYS) if (chosen[key] === undefined) delete chosen[key];

  // Preset defaults apply only where the partner didn't choose.
  const filters: CohortFilters = { ...preset.defaultFilters, ...chosen };

  const dur = Number(get("dur"));
  const durationMonths = (DURATION_OPTIONS as readonly number[]).includes(dur)
    ? (dur as DurationMonths)
    : 6;

  return { preset, filters, durationMonths };
}

export interface TimelinePhase {
  phase: string;
  months: number;
  detail: string;
}

/** Enrollment ≈ ¼, collection ≈ ½, analysis ≈ ¼ of the duration (min 1 mo). */
export function proposalTimeline(durationMonths: number): TimelinePhase[] {
  const enroll = Math.max(1, Math.round(durationMonths / 4));
  const analyze = Math.max(1, Math.round(durationMonths / 4));
  const collect = Math.max(1, durationMonths - enroll - analyze);
  return [
    {
      phase: "Cohort confirmation & SAP",
      months: enroll,
      detail:
        "Statistical analysis plan pre-specified and signed before unblinding (SPEC §11.2); cohort re-counted at kickoff",
    },
    {
      phase: "Data collection window",
      months: collect,
      detail: "Registry data accrues under the existing consent scopes — no new instruments",
    },
    {
      phase: "Analysis & de-identified report",
      months: analyze,
      detail:
        "De-identified tier only, k-suppression on every released cell, DUA terms apply (SPEC §12.3)",
    },
  ];
}

export interface StudyProposal {
  clockIso: string;
  inputs: ProposalInputs;
  /** consent-filtered, k-suppressed live counts (the partner release rules) */
  cohort: {
    matched: SuppressedCell;
    total: SuppressedCell;
    threshold: number;
  };
  /** §6.3 power-sketch context for two-group presets */
  feasibility: {
    nPerGroup: number;
    required: number;
    met: boolean | null; // null when the count is suppressed or single-group
  };
  timeline: TimelinePhase[];
  priceBand: PriceBand;
  honestyLine: string;
  queryMs: number;
}

/**
 * Builds the proposal from live consent-filtered research queries. A revoked
 * (or deleted) participant is already gone from `matched` before this runs.
 */
export async function loadProposal(inputs: ProposalInputs): Promise<StudyProposal> {
  const explorer = await loadExplorer(inputs.filters);

  const sketchN = nPerGroup(
    POWER_DEFAULTS.effectPp,
    POWER_DEFAULTS.sd,
    POWER_DEFAULTS.alpha,
    POWER_DEFAULTS.power
  );
  const required = sketchN * Math.max(1, inputs.preset.comparisonGroups);
  const matchedCell = suppressCount(explorer.matched);
  const met =
    inputs.preset.comparisonGroups < 2 || matchedCell.suppressed
      ? null
      : explorer.matched >= required;

  return {
    clockIso: explorer.clockIso,
    inputs,
    cohort: {
      matched: matchedCell,
      total: suppressCount(explorer.cohortTotal),
      threshold: SMALL_CELL_THRESHOLD,
    },
    feasibility: { nPerGroup: sketchN, required, met },
    timeline: proposalTimeline(inputs.durationMonths),
    priceBand: inputs.preset.priceBand,
    honestyLine: PRICE_HONESTY_LINE,
    queryMs: explorer.queryMs,
  };
}
