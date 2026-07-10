import {
  ageBandFromYearOfBirth,
  buildSuppressedTable,
  pseudonym,
  shiftDate,
  SMALL_CELL_THRESHOLD,
} from "../deid";
import { toIsoDay } from "../format";
import type { ResearchMember } from "./cohort";

/**
 * Research-mart CSV builders (DEMO.md Act 6, the "mart moment").
 *
 * Two releases with different rules of engagement:
 *
 * 1. buildDeidExportCsv — DE-IDENTIFIED ROW-LEVEL MICRODATA: one row per
 *    research-consented participant (a revoked participant is simply
 *    absent), passed through the deid transforms (pseudonym, 5-year age
 *    band, per-participant constant date shift, identifiers dropped). Rows
 *    are ordered by pseudonym so ordering leaks nothing about enrollment
 *    sequence. Row-level microdata requires the partner DUA acknowledgement
 *    — the /research/deid/export route enforces that.
 *
 * 2. buildBrandSeverityCsv — the AGGREGATE published table (brand × severity
 *    counts) with k<SMALL_CELL_THRESHOLD small-cell suppression applied to
 *    every cell. Safe to release without the DUA gate: it is exactly the
 *    suppressed table the /research/deid page renders.
 */

export const DEID_EXPORT_HEADER = [
  "pseudonym",
  "age_band",
  "sex",
  "enrollment_door",
  "enrollment_date_shifted",
  "severity",
  "baseline_ahi",
  "supine_predominant",
  "treatment_arm",
  "mattress_brand",
  "firmness_band",
  "material_class",
  "delivery_date_shifted",
  "ess_baseline",
  "ess_day90",
  "ess_change_90d",
  "cpap_adherence_pct",
  "supine_pre_pct",
  "supine_post_pct",
  "supine_change_pp",
  "sleep_eff_baseline_pct",
  "sleep_eff_day90_pct",
  "sleep_eff_change_pp",
].join(",");

/** CSV-escapes one field (shared with the OMOP bundle builders). */
export function csvField(value: string | number | boolean | null): string {
  if (value === null) return "";
  if (typeof value === "number") return String(Math.round(value * 10) / 10);
  if (typeof value === "boolean") return value ? "true" : "false";
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function deidExportRow(member: ResearchMember): string {
  const shifted = (date: Date | null) => (date ? toIsoDay(shiftDate(member.id, date)) : null);
  return [
    pseudonym(member.id),
    ageBandFromYearOfBirth(member.yearOfBirth, member.enrollmentDate),
    member.sex,
    member.door,
    shifted(member.enrollmentDate),
    member.severity,
    member.ahi,
    member.supinePredominant,
    member.arm,
    member.brand,
    member.firmnessBand,
    member.materialClass,
    shifted(member.deliveryDate),
    member.essBaseline,
    member.essDay90,
    member.essChange90,
    member.cpapAdherencePct,
    member.supinePre,
    member.supinePost,
    member.supineChange,
    member.seffBaseline,
    member.seffDay90,
    member.seffChange,
  ]
    .map(csvField)
    .join(",");
}

/** One de-identified microdata row per member, ordered by pseudonym. */
export function deidExportRows(members: ResearchMember[]): string[] {
  return [...members]
    .sort((a, b) => pseudonym(a.id).localeCompare(pseudonym(b.id)))
    .map(deidExportRow);
}

/** Comment block prepended to the row-level extract — labels what it is. */
export function deidExportPreamble(clockIso: string): string {
  return [
    `# Sleeptopia registry research extract (demo) — DE-IDENTIFIED ROW-LEVEL MICRODATA, as of ${clockIso}`,
    "# Access requires a signed Data Use Agreement (DUA). Re-identification of, or contact with,",
    "# any individual is prohibited (SPEC §12.3).",
    "# One row per research-consented participant; dates carry a constant per-participant shift.",
    `# k<${SMALL_CELL_THRESHOLD} small-cell suppression applies to PUBLISHED tables; this row-level file is`,
    "# governed by the DUA instead — do not publish row-level values.",
    "# Synthetic demonstration cohort — no real patient data.",
  ].join("\n");
}

/** Full row-level CSV (preamble + header + rows). */
export function buildDeidExportCsv(members: ResearchMember[], clockIso: string): string {
  return [deidExportPreamble(clockIso), DEID_EXPORT_HEADER, ...deidExportRows(members)].join("\n") + "\n";
}

export const SEVERITY_ORDER = ["mild", "moderate", "severe"];

/**
 * The aggregate brand × severity count table with small-cell suppression —
 * the same table the /research/deid page renders, serialized as CSV.
 */
export function buildBrandSeverityCsv(members: ResearchMember[], clockIso: string): string {
  const table = buildSuppressedTable(
    members
      .filter((member) => member.brand !== null && member.severity !== null)
      .map((member) => ({ row: member.brand as string, col: member.severity as string })),
    { colKeys: SEVERITY_ORDER }
  );
  const lines = [
    `# Sleeptopia registry — aggregate cohort counts by mattress brand × OSA severity, as of ${clockIso}`,
    `# Published-table release: cells with 1–${SMALL_CELL_THRESHOLD - 1} participants are suppressed (k<${SMALL_CELL_THRESHOLD}).`,
    "# Synthetic demonstration cohort — no real patient data.",
    ["brand", ...table.colKeys].map(csvField).join(","),
    ...table.rowKeys.map((row) =>
      [row, ...table.colKeys.map((col) => table.cells[row][col].display)].map(csvField).join(",")
    ),
  ];
  return lines.join("\n") + "\n";
}
