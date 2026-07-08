import { ageBandFromYearOfBirth, pseudonym, shiftDate } from "@/lib/deid";
import { toIsoDay } from "@/lib/format";
import { loadResearchCohort, type ResearchMember } from "@/lib/research/cohort";

/**
 * Research-mart CSV extract (DEMO.md Act 6, the "mart moment"). Streams one
 * de-identified row per research-consented participant: every value comes
 * from the consent-filtered cohort loader (use "research_deid" — a revoked
 * participant is simply absent), then passes through the deid transforms:
 * pseudonym, 5-year age band, per-participant date shift. No name, email,
 * participant id, or exact year of birth ever enters this stream. Rows are
 * ordered by pseudonym so ordering leaks nothing about enrollment sequence.
 */
export const dynamic = "force-dynamic";

const HEADER = [
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

function csvField(value: string | number | boolean | null): string {
  if (value === null) return "";
  if (typeof value === "number") return String(Math.round(value * 10) / 10);
  if (typeof value === "boolean") return value ? "true" : "false";
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function memberRow(member: ResearchMember): string {
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

export async function GET(): Promise<Response> {
  const cohort = await loadResearchCohort();
  const members = [...cohort.members].sort((a, b) =>
    pseudonym(a.id).localeCompare(pseudonym(b.id))
  );
  const clockIso = toIsoDay(cohort.clock);

  const encoder = new TextEncoder();
  const CHUNK = 200;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `# Sleeptopia registry research extract (demo) — de-identified tier, as of ${clockIso}\n` +
            `# Synthetic demonstration cohort. Date-shifted per participant; small cohorts suppressed in released tables.\n` +
            HEADER +
            "\n"
        )
      );
      for (let i = 0; i < members.length; i += CHUNK) {
        controller.enqueue(
          encoder.encode(
            members
              .slice(i, i + CHUNK)
              .map(memberRow)
              .join("\n") + "\n"
          )
        );
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="research-extract-${clockIso}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
