import type { SavedCohort } from "@prisma/client";
import { prisma } from "../db";
import { getSimClock } from "../simclock";
import { AGE_BANDS, FILTER_KEYS, loadExplorer, parseFilters, type CohortFilters } from "./explorer";
import { ARM_LABELS, FIRMNESS_BAND_LABELS } from "./cohort";

/**
 * Saved cohorts (DEMO.md Act 5 reserve → working): the explorer's URL-param
 * filters, given a name and stored as demo-prep bookmarks. A saved cohort is
 * just a validated query string plus a consent-filtered count SNAPSHOT taken
 * at save time — no participant ids are ever stored, and opening the link
 * re-runs the live consent-filtered query, so the count can legitimately
 * differ from the snapshot (revocations, deletions, time-machine advances).
 */

export const MAX_COHORT_NAME_LENGTH = 60;

/** Round-trips a raw query string through the explorer's validator. */
export function normalizeCohortQuery(rawQuery: string): {
  filters: CohortFilters;
  query: string;
} {
  const params = new URLSearchParams(rawQuery);
  const filters = parseFilters(Object.fromEntries(params.entries()));
  const normalized = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (value !== undefined) normalized.set(key, value);
  }
  return { filters, query: normalized.toString() };
}

/** Human summary of a filter set, e.g. "Moderate · supine-predominant". */
export function filterSummary(filters: CohortFilters): string {
  const parts: string[] = [];
  if (filters.severity) parts.push(`${filters.severity} OSA`);
  if (filters.supine) parts.push(filters.supine === "y" ? "supine-predominant" : "not supine-predominant");
  if (filters.arm) parts.push(ARM_LABELS[filters.arm]);
  if (filters.door) parts.push(`${filters.door} door`);
  if (filters.brand) parts.push(filters.brand);
  if (filters.firmness) parts.push(FIRMNESS_BAND_LABELS[filters.firmness]);
  if (filters.age) {
    const band = AGE_BANDS.find((candidate) => candidate.key === filters.age);
    if (band) parts.push(`age ${band.label}`);
  }
  if (filters.sex) parts.push(filters.sex);
  return parts.length > 0 ? parts.join(" · ") : "All research-consented participants";
}

export type SaveCohortResult =
  | { ok: true; cohort: SavedCohort }
  | { ok: false; error: string };

/**
 * Saves a named cohort. The query string is re-validated server-side and the
 * matched/total snapshot is recomputed from the live consent-filtered
 * explorer query — never trusted from the client.
 */
export async function saveCohort(name: string, rawQuery: string): Promise<SaveCohortResult> {
  const trimmed = name.trim();
  if (trimmed.length === 0) return { ok: false, error: "Give the cohort a name" };
  if (trimmed.length > MAX_COHORT_NAME_LENGTH) {
    return { ok: false, error: `Name must be ≤ ${MAX_COHORT_NAME_LENGTH} characters` };
  }
  const { filters, query } = normalizeCohortQuery(rawQuery);
  const [clock, explorer] = await Promise.all([getSimClock(), loadExplorer(filters)]);
  const cohort = await prisma.savedCohort.create({
    data: {
      name: trimmed,
      query,
      matched: explorer.matched,
      cohortTotal: explorer.cohortTotal,
      clockDate: clock,
    },
  });
  return { ok: true, cohort };
}

export interface SavedCohortListItem {
  id: string;
  name: string;
  query: string;
  href: string;
  summary: string;
  matched: number;
  cohortTotal: number;
  clockDate: Date;
}

/** Saved cohorts, newest first, with parsed display fields. */
export async function listSavedCohorts(): Promise<SavedCohortListItem[]> {
  const rows = await prisma.savedCohort.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map((row) => {
    const { filters, query } = normalizeCohortQuery(row.query);
    return {
      id: row.id,
      name: row.name,
      query,
      href: query ? `/research?${query}` : "/research",
      summary: filterSummary(filters),
      matched: row.matched,
      cohortTotal: row.cohortTotal,
      clockDate: row.clockDate,
    };
  });
}

export async function deleteSavedCohort(id: string): Promise<boolean> {
  const { count } = await prisma.savedCohort.deleteMany({ where: { id } });
  return count > 0;
}
