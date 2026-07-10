import { cookies } from "next/headers";
import { DUA_COOKIE } from "@/app/partner/dua";
import { getAllGrantedDevices, grantSetHas, type DataClass } from "@/lib/consent";
import { prisma } from "@/lib/db";
import { toIsoDay } from "@/lib/format";
import { loadResearchCohort } from "@/lib/research/cohort";
import {
  buildDeviceExposureCsv,
  buildObservationPeriodCsv,
  buildPersonCsv,
  MEASUREMENT_HEADER,
  measurementCsvRows,
  omopBundleReadme,
} from "@/lib/research/omopExport";
import { zipStream } from "@/lib/research/zip";

/**
 * OMOP bundle export (DEMO.md §3 reserve → working; TECHNICAL.md §T2.5).
 * Streams a ZIP of PERSON / OBSERVATION_PERIOD / MEASUREMENT /
 * DEVICE_EXPOSURE CSVs mapped from the DE-IDENTIFIED research tier only:
 * pseudonym ids, per-participant constant date shifts, 5-year age bands,
 * per-row research_deid consent — a revoked participant is absent from
 * every table.
 *
 * Row-level microdata leaves only under the partner DUA: without the DUA
 * acknowledgement cookie the request redirects (307) to /partner to sign,
 * exactly like the row-level CSV extract next door.
 *
 * MEASUREMENT covers the full observation store (~784k rows on the seeded
 * cohort), so it is generated page-by-page and streamed through the
 * zero-dependency stored-ZIP writer — nothing is buffered whole.
 */
export const dynamic = "force-dynamic";

const MEASUREMENT_PAGE_ROWS = 20_000;

export async function GET(request: Request): Promise<Response> {
  const cookieStore = await cookies();
  if (!cookieStore.has(DUA_COOKIE)) {
    const signIn = new URL("/partner", request.url);
    signIn.searchParams.set("from", "/research/deid");
    return Response.redirect(signIn, 307);
  }

  const cohort = await loadResearchCohort();
  const clockIso = toIsoDay(cohort.clock);
  const memberIds = new Set(cohort.members.map((member) => member.id));

  // Per-row consent check: the member's evaluated grants, research tier.
  const isExportable = (participantId: string, dataClass: DataClass): boolean => {
    const member = cohort.byId.get(participantId);
    return member !== undefined && grantSetHas(member.grants, dataClass, "research_deid");
  };

  // Episodes are small (2/participant): fetch once, filter to members in JS.
  const [episodes, devices] = await Promise.all([
    prisma.episode.findMany({
      select: { participantId: true, protocolPhase: true, startDate: true, endDate: true },
    }),
    // Consent-gated device reader (research tier) — same gate the cohort uses.
    getAllGrantedDevices({ use: "research_deid" }),
  ]);

  // MEASUREMENT: cursor-paged over the observation store, mapped + consent-
  // filtered per page, streamed as CSV chunks.
  async function* measurementChunks(): AsyncIterable<string> {
    yield MEASUREMENT_HEADER + "\n";
    let cursor: string | undefined;
    let nextId = 1;
    for (;;) {
      const page = await prisma.observation.findMany({
        take: MEASUREMENT_PAGE_ROWS,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: "asc" },
        select: {
          id: true,
          participantId: true,
          source: true,
          concept: true,
          valueNumeric: true,
          unit: true,
          effectiveDate: true,
        },
      });
      if (page.length === 0) break;
      const mapped = measurementCsvRows(page, isExportable, nextId);
      nextId = mapped.nextId;
      if (mapped.lines.length > 0) yield mapped.lines.join("\n") + "\n";
      cursor = page[page.length - 1].id;
      if (page.length < MEASUREMENT_PAGE_ROWS) break;
    }
  }

  const archive = zipStream(
    [
      { name: "README.txt", data: omopBundleReadme(clockIso) },
      { name: "PERSON.csv", data: buildPersonCsv(cohort.members) },
      {
        name: "OBSERVATION_PERIOD.csv",
        data: buildObservationPeriodCsv(episodes, memberIds, cohort.clock),
      },
      { name: "MEASUREMENT.csv", data: () => measurementChunks() },
      { name: "DEVICE_EXPOSURE.csv", data: buildDeviceExposureCsv(devices, memberIds) },
    ],
    { modified: cohort.clock }
  );

  return new Response(archive, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="omop-bundle-${clockIso}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
