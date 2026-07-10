import { toIsoDay } from "@/lib/format";
import { loadResearchCohort } from "@/lib/research/cohort";
import { buildBrandSeverityCsv } from "@/lib/research/deidExport";

/**
 * Aggregate published-table export: the brand × severity count table the
 * /research/deid page renders, with k<11 small-cell suppression applied to
 * every cell. This is a suppressed AGGREGATE release, so unlike the
 * row-level microdata extract (../route.ts) it needs no DUA gate.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const cohort = await loadResearchCohort();
  const clockIso = toIsoDay(cohort.clock);
  const csv = buildBrandSeverityCsv(cohort.members, clockIso);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="research-aggregate-brand-severity-${clockIso}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
