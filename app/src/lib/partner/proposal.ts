import { SMALL_CELL_THRESHOLD } from "../deid";
import {
  buildCountLattice,
  latticeKey,
  releaseLattice,
  releaseRecord,
  recordCountReleases,
  type CountReleaseRecord,
  type DisclosureMemberAttrs,
  type LatticeFilters,
  type ReleasedCount,
} from "../disclosure";
import type { CohortFilters } from "../research/explorer";
import { nPerGroup, POWER_DEFAULTS } from "../research/power";
import {
  FIRMNESS_BAND_LABELS,
  loadResearchCohort,
  type ArmKey,
  type FirmnessBand,
  type ResearchMember,
  type SeverityBand,
} from "../research/cohort";

/**
 * Sponsored-study proposal generator (DEMO.md Act 7 reserve → working;
 * SPEC §12.4 revenue model, §12.3 rules of engagement). The partner picks a
 * research question from the SPEC §6.3–6.4 preset list, narrows the cohort
 * within that question's APPROVED QUERY FAMILY, and gets a one-page proposal
 * whose feasibility numbers are LIVE consent-filtered research-tier counts
 * released through the disclosure-control layer (audit F-12, level-up 10):
 *
 * - every released count is BANDED (<11 suppressed / 11–20 / 21–50 / 51–200
 *   / >200) — never exact;
 * - the whole filter lattice is released at once with complementary
 *   suppression, so no cell is derivable by subtraction from released
 *   parents/siblings (the differencing audit proves zero inferable cells
 *   before anything ships);
 * - every released count is logged to the release ledger
 *   (/partner/releases, DUA-gated) — the release manifest.
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

/** Cohort-filter subset the proposal form exposes (of the explorer's set). */
export const PROPOSAL_FILTER_KEYS = ["severity", "supine", "arm", "firmness"] as const;
export type ProposalFilterKey = (typeof PROPOSAL_FILTER_KEYS)[number];

/**
 * Approved query family (level-up 6): each research question exposes a FIXED
 * set of filter dimensions. Free combination is allowed only within the
 * family — filters outside it are dropped at parse time, so arbitrary
 * overlapping queries across families cannot be composed.
 */
export interface QueryFamily {
  label: string;
  filterKeys: readonly ProposalFilterKey[];
}

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
  /** the approved query family this question may filter within */
  family: QueryFamily;
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
    family: {
      label: "Positional cohorts — severity × supine × firmness",
      filterKeys: ["severity", "supine", "firmness"],
    },
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
    family: {
      label: "Category-comparison cohorts — severity × supine × firmness",
      filterKeys: ["severity", "supine", "firmness"],
    },
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
    family: {
      label: "Treatment-combination cohorts — severity × arm × firmness",
      filterKeys: ["severity", "arm", "firmness"],
    },
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
    family: {
      label: "Instrumented-validation cohorts — severity × supine × firmness",
      filterKeys: ["severity", "supine", "firmness"],
    },
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

const oneOf = <T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined =>
  allowed.includes(value as T) ? (value as T) : undefined;

/**
 * Parses ?q=&severity=&supine=&arm=&firmness=&dur= (unknown values drop).
 * Approved query families (level-up 6): filters outside the preset's family
 * are dropped, so free combination exists only WITHIN a family.
 */
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
  for (const key of PROPOSAL_FILTER_KEYS) {
    if (chosen[key] === undefined || !preset.family.filterKeys.includes(key)) {
      delete chosen[key];
    }
  }

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

export interface FirmnessBreakdownRow {
  band: FirmnessBand;
  label: string;
  released: ReleasedCount;
}

export interface StudyProposal {
  clockIso: string;
  inputs: ProposalInputs;
  /** consent-filtered live counts released as BANDS (never exact — F-12) */
  cohort: {
    matched: ReleasedCount;
    total: ReleasedCount;
    threshold: number;
  };
  /**
   * Firmness sub-counts from the SAME lattice release — banded with
   * complementary suppression, so the audit's subtraction attack (parent −
   * released siblings = suppressed cell) has nothing exact to subtract.
   * null when the firmness filter is already set.
   */
  firmnessBreakdown: FirmnessBreakdownRow[] | null;
  /** §6.3 power-sketch context for two-group presets */
  feasibility: {
    nPerGroup: number;
    required: number;
    /** true/false only when the released band decides it; null when the
     *  count is suppressed, single-group, or the band straddles `required` */
    met: boolean | null;
    /** set when the band straddles the requirement — the range is the answer */
    bandNote: string | null;
  };
  timeline: TimelinePhase[];
  priceBand: PriceBand;
  honestyLine: string;
  queryMs: number;
  /** release-ledger rows written for this proposal render (manifest linkage) */
  releasesLogged: number;
}

/** ResearchMember → the four disclosure-lattice attributes. */
export function memberDisclosureAttrs(member: ResearchMember): DisclosureMemberAttrs {
  return {
    severity: member.severity,
    supine:
      member.supinePredominant === null ? null : member.supinePredominant ? "y" : "n",
    arm: member.arm,
    firmness: member.firmnessBand,
  };
}

/** Proposal filters → lattice cell address (identical keys/values). */
export function proposalLatticeFilters(filters: CohortFilters): LatticeFilters {
  const cell: LatticeFilters = {};
  if (filters.severity) cell.severity = filters.severity;
  if (filters.supine) cell.supine = filters.supine;
  if (filters.arm) cell.arm = filters.arm;
  if (filters.firmness) cell.firmness = filters.firmness;
  return cell;
}

/** Canonical query descriptor logged to the release ledger. */
export function proposalQueryDescriptor(inputs: ProposalInputs): string {
  const parts = [`q=${inputs.preset.key}`];
  for (const key of PROPOSAL_FILTER_KEYS) {
    const value = inputs.filters[key];
    if (value !== undefined) parts.push(`${key}=${value}`);
  }
  parts.push(`dur=${inputs.durationMonths}`);
  return parts.join("&");
}

/**
 * Builds the proposal from live consent-filtered research queries. A revoked
 * (or deleted) participant is already gone from `matched` before this runs.
 * Counts are released via the disclosure lattice (banding + complementary
 * suppression, zero inferable cells) and every released count is logged to
 * the release ledger.
 */
export async function loadProposal(inputs: ProposalInputs): Promise<StudyProposal> {
  const startedAt = performance.now();
  const cohort = await loadResearchCohort();
  const clockIso = cohort.clock.toISOString().slice(0, 10);

  // One consistent, differencing-audited release of the whole filter lattice.
  const lattice = buildCountLattice(cohort.members.map(memberDisclosureAttrs));
  const { released } = releaseLattice(lattice);
  const lookup = (cell: LatticeFilters): ReleasedCount => {
    const release = released.get(latticeKey(cell));
    if (!release) throw new Error(`No lattice release for cell "${latticeKey(cell)}"`);
    return release;
  };

  const matchedCell = lookup(proposalLatticeFilters(inputs.filters));
  const totalCell = lookup({});

  // Firmness sub-counts (the audit's differencing surface) — released from
  // the same lattice, only when firmness is not already filtered.
  const firmnessBreakdown: FirmnessBreakdownRow[] | null = inputs.filters.firmness
    ? null
    : (["soft", "medium", "firm"] as const).map((band) => ({
        band,
        label: FIRMNESS_BAND_LABELS[band],
        released: lookup({ ...proposalLatticeFilters(inputs.filters), firmness: band }),
      }));

  // §6.3 power sketch, decided from the RELEASED band — never the raw count
  // (a boolean cut at `required` would leak a tighter interval than the band).
  const sketchN = nPerGroup(
    POWER_DEFAULTS.effectPp,
    POWER_DEFAULTS.sd,
    POWER_DEFAULTS.alpha,
    POWER_DEFAULTS.power
  );
  const required = sketchN * Math.max(1, inputs.preset.comparisonGroups);
  let met: boolean | null = null;
  let bandNote: string | null = null;
  if (inputs.preset.comparisonGroups >= 2 && !matchedCell.suppressed) {
    if (matchedCell.min >= required) met = true;
    else if (matchedCell.max !== null && matchedCell.max < required) met = false;
    else {
      bandNote =
        `the released band (${matchedCell.display}) straddles the ≈${required} required — ` +
        `feasibility is reported as a range under the disclosure-control release rules`;
    }
  }

  // Release-manifest linkage (level-up 6): every count released above is
  // logged to the ledger before the proposal returns.
  const query = proposalQueryDescriptor(inputs);
  const releases: CountReleaseRecord[] = [
    releaseRecord("partner_proposal", query, "matched", matchedCell, cohort.clock),
    releaseRecord("partner_proposal", query, "cohort_total", totalCell, cohort.clock),
    ...(firmnessBreakdown ?? []).map((row) =>
      releaseRecord("partner_proposal", query, `firmness:${row.band}`, row.released, cohort.clock)
    ),
  ];
  const releasesLogged = await recordCountReleases(releases);

  return {
    clockIso,
    inputs,
    cohort: {
      matched: matchedCell,
      total: totalCell,
      threshold: SMALL_CELL_THRESHOLD,
    },
    firmnessBreakdown,
    feasibility: { nPerGroup: sketchN, required, met, bandNote },
    timeline: proposalTimeline(inputs.durationMonths),
    priceBand: inputs.preset.priceBand,
    honestyLine: PRICE_HONESTY_LINE,
    queryMs: Math.round(performance.now() - startedAt),
    releasesLogged,
  };
}
