import {
  ARM_LABELS,
  ARM_ORDER,
  FIRMNESS_BAND_LABELS,
  loadResearchCohort,
  meanOf,
  type ArmKey,
  type FirmnessBand,
  type ResearchMember,
  type SeverityBand,
} from "./cohort";

/**
 * Cohort explorer (DEMO.md Act 5): URL-param filters over the research-tier
 * cohort. Filters are pure data (parse/serialize round-trips through the
 * query string), so every cohort is a shareable link and the page needs no
 * client state store.
 */

export const AGE_BANDS = [
  { key: "30-44", label: "30–44", min: 30, max: 44 },
  { key: "45-54", label: "45–54", min: 45, max: 54 },
  { key: "55-64", label: "55–64", min: 55, max: 64 },
  { key: "65plus", label: "65+", min: 65, max: 200 },
] as const;
export type AgeBandKey = (typeof AGE_BANDS)[number]["key"];

export interface CohortFilters {
  severity?: SeverityBand;
  supine?: "y" | "n";
  arm?: ArmKey;
  door?: "clinic" | "retail";
  brand?: string;
  firmness?: FirmnessBand;
  age?: AgeBandKey;
  sex?: "male" | "female";
}

export const FILTER_KEYS = [
  "severity",
  "supine",
  "arm",
  "door",
  "brand",
  "firmness",
  "age",
  "sex",
] as const satisfies readonly (keyof CohortFilters)[];

const oneOf = <T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined =>
  allowed.includes(value as T) ? (value as T) : undefined;

/** Parses raw searchParams into validated filters; unknown values drop. */
export function parseFilters(params: Record<string, string | string[] | undefined>): CohortFilters {
  const get = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === "string" ? value : undefined;
  };
  const filters: CohortFilters = {
    severity: oneOf(get("severity"), ["mild", "moderate", "severe"]),
    supine: oneOf(get("supine"), ["y", "n"]),
    arm: oneOf(get("arm"), ARM_ORDER),
    door: oneOf(get("door"), ["clinic", "retail"]),
    brand: get("brand"),
    firmness: oneOf(get("firmness"), ["soft", "medium", "firm"]),
    age: oneOf(
      get("age"),
      AGE_BANDS.map((band) => band.key)
    ),
    sex: oneOf(get("sex"), ["male", "female"]),
  };
  for (const key of FILTER_KEYS) if (filters[key] === undefined) delete filters[key];
  return filters;
}

/** /research href for the given filters (empty object → bare /research). */
export function filtersHref(filters: CohortFilters): string {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (value !== undefined) params.set(key, value);
  }
  const query = params.toString();
  return query ? `/research?${query}` : "/research";
}

/** href with one filter set (or cleared with undefined), others preserved. */
export function patchedHref(
  filters: CohortFilters,
  key: keyof CohortFilters,
  value: string | undefined
): string {
  const next = { ...filters };
  if (value === undefined) delete next[key];
  else (next as Record<string, string>)[key] = value;
  return filtersHref(next);
}

/**
 * Does a member match the filters? A filter on an attribute the member's
 * consent scope leaves null EXCLUDES them — an unreadable attribute can
 * never satisfy a criterion.
 */
export function memberMatches(member: ResearchMember, filters: CohortFilters): boolean {
  if (filters.severity && member.severity !== filters.severity) return false;
  if (filters.supine) {
    if (member.supinePredominant === null) return false;
    if (member.supinePredominant !== (filters.supine === "y")) return false;
  }
  if (filters.arm && member.arm !== filters.arm) return false;
  if (filters.door && member.door !== filters.door) return false;
  if (filters.brand && member.brand !== filters.brand) return false;
  if (filters.firmness && member.firmnessBand !== filters.firmness) return false;
  if (filters.age) {
    const band = AGE_BANDS.find((candidate) => candidate.key === filters.age);
    // Demographics are registry_demographics-scoped: a member without that
    // research grant has age === null and never matches an age filter.
    if (!band || member.age === null || member.age < band.min || member.age > band.max) {
      return false;
    }
  }
  if (filters.sex && member.sex !== filters.sex) return false;
  return true;
}

export interface OutcomeSummary {
  mean: number | null;
  n: number;
}

export interface ExplorerResult {
  clockIso: string;
  filters: CohortFilters;
  /** research-visible cohort size (consent-filtered, unfiltered) */
  cohortTotal: number;
  /** participants matching the filters */
  matched: number;
  outcomes: {
    essChange90: OutcomeSummary;
    cpapAdherencePct: OutcomeSummary;
    supineChange: OutcomeSummary;
    seffChange: OutcomeSummary;
  };
  queryMs: number;
}

/** Pure aggregation over already-loaded members (unit-testable). */
export function summarizeMembers(
  members: ResearchMember[],
  filters: CohortFilters
): Omit<ExplorerResult, "clockIso" | "queryMs" | "filters" | "cohortTotal"> {
  const matchedMembers = members.filter((member) => memberMatches(member, filters));
  return {
    matched: matchedMembers.length,
    outcomes: {
      essChange90: meanOf(matchedMembers.map((m) => m.essChange90)),
      cpapAdherencePct: meanOf(matchedMembers.map((m) => m.cpapAdherencePct)),
      supineChange: meanOf(matchedMembers.map((m) => m.supineChange)),
      seffChange: meanOf(matchedMembers.map((m) => m.seffChange)),
    },
  };
}

export async function loadExplorer(filters: CohortFilters): Promise<ExplorerResult> {
  const cohort = await loadResearchCohort();
  const summary = summarizeMembers(cohort.members, filters);
  return {
    clockIso: cohort.clock.toISOString().slice(0, 10),
    filters,
    cohortTotal: cohort.members.length,
    ...summary,
    queryMs: cohort.queryMs,
  };
}

/** Filter-pill groups for the explorer UI (label + value per option). */
export interface FilterOption {
  label: string;
  value: string | undefined;
}

export function filterGroups(brands: string[]): {
  key: keyof CohortFilters;
  label: string;
  options: FilterOption[];
}[] {
  const all: FilterOption = { label: "All", value: undefined };
  return [
    {
      key: "severity",
      label: "OSA severity",
      options: [
        all,
        { label: "Mild", value: "mild" },
        { label: "Moderate", value: "moderate" },
        { label: "Severe", value: "severe" },
      ],
    },
    {
      key: "supine",
      label: "Supine-predominant",
      options: [all, { label: "Yes", value: "y" }, { label: "No", value: "n" }],
    },
    {
      key: "arm",
      label: "Treatment arm",
      options: [all, ...ARM_ORDER.map((arm) => ({ label: ARM_LABELS[arm], value: arm }))],
    },
    {
      key: "door",
      label: "Enrollment door",
      options: [
        all,
        { label: "Clinic", value: "clinic" },
        { label: "Retail", value: "retail" },
      ],
    },
    {
      key: "brand",
      label: "Mattress brand",
      options: [all, ...brands.map((brand) => ({ label: brand, value: brand }))],
    },
    {
      key: "firmness",
      label: "Firmness band",
      options: [
        all,
        ...(["soft", "medium", "firm"] as const).map((band) => ({
          label: FIRMNESS_BAND_LABELS[band],
          value: band,
        })),
      ],
    },
    {
      key: "age",
      label: "Age band",
      options: [all, ...AGE_BANDS.map((band) => ({ label: band.label, value: band.key }))],
    },
    {
      key: "sex",
      label: "Sex",
      options: [
        all,
        { label: "Female", value: "female" },
        { label: "Male", value: "male" },
      ],
    },
  ];
}
