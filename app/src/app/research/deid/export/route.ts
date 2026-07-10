import { cookies } from "next/headers";
import { DUA_COOKIE } from "@/app/partner/dua";
import { toIsoDay } from "@/lib/format";
import { loadResearchCohort } from "@/lib/research/cohort";
import { buildDeidExportCsv } from "@/lib/research/deidExport";

/**
 * Research-mart CSV extract (DEMO.md Act 6, the "mart moment") — one
 * DE-IDENTIFIED ROW-LEVEL MICRODATA row per research-consented participant
 * (a revoked participant is simply absent; see lib/research/deidExport.ts
 * for the transform details).
 *
 * Row-level microdata leaves only under the partner DUA: without the DUA
 * acknowledgement cookie (the same session cookie /partner/dashboard checks)
 * the request is redirected (307) to /partner to sign, carrying a return
 * path. The aggregate, small-cell-suppressed table has its own un-gated
 * endpoint at ./export/aggregate.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const cookieStore = await cookies();
  if (!cookieStore.has(DUA_COOKIE)) {
    const signIn = new URL("/partner", request.url);
    signIn.searchParams.set("from", "/research/deid");
    return Response.redirect(signIn, 307);
  }

  const cohort = await loadResearchCohort();
  const clockIso = toIsoDay(cohort.clock);
  const csv = buildDeidExportCsv(cohort.members, clockIso);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="research-extract-${clockIso}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
