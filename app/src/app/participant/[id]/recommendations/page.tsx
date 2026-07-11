import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/Card";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { TimeMachineWidget } from "@/components/TimeMachineWidget";
import { getLinkedProfile, loadGrants, type DataClass } from "@/lib/consent";
import { getParticipant } from "@/lib/consent/policyRepo";
import { formatDay, shortId } from "@/lib/format";
import {
  RECS_MODEL_ID,
  RECS_MODEL_VERSION,
  renderGovernedRecommendations,
} from "@/lib/recommendations/pipeline";
import { MAX_SIM_DAYS, simDayNumber } from "@/lib/simclock";
import { NarrativeCards } from "./NarrativeCards";

/**
 * AI recommendations (DEMO.md Act 7; SPEC §10). Rules-based, deterministic,
 * and identified-tier by architecture (§10.2): a recommendation is delivered
 * to a person, so this page reads ONLY under the participant's
 * view_identified grants — revoke them and the page shows the blocked state
 * instead of cards. Every card carries its §10.3 guardrail-class badge and
 * the non-device-CDS boundary line.
 *
 * Governed pipeline (audit level-up 12): every card on this page came
 * through evidence bundle → template draft → zod schema → SafetyCheck chain
 * → ModelDecisionLog (see /compliance/model-log). No LLM is called;
 * RECS_MODE=templates is the permanent fallback engine.
 */
export const metadata: Metadata = { title: "Recommendations" };

export const dynamic = "force-dynamic";

const CLASS_LABELS: Record<string, string> = {
  wearable_sleep: "Wearable sleep",
  cpap_telemetry: "CPAP telemetry",
  hst_clinical: "Clinical records",
  mattress_purchase: "Mattress purchase",
  sleep_mat: "Under-mattress sensor",
};

export default async function RecommendationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const participant = await getParticipant(id);
  if (!participant) notFound();

  const grants = await loadGrants(id);
  const [{ result, cards, mode }, linked] = await Promise.all([
    renderGovernedRecommendations(id, { grants }),
    getLinkedProfile(id, { use: "view_identified", grants }),
  ]);
  const displayName = !linked.blocked ? (linked.identity?.displayName ?? null) : null;
  const clockDate = new Date(`${result.clockIso}T00:00:00Z`);
  const dayNumber = simDayNumber(clockDate);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader variant="site" />
      <main className="flex-1 bg-pale-blue">
        <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-8 sm:px-6 sm:py-10">
          {/* Header */}
          <Card className="p-6 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold tracking-[0.14em] text-sky-blue uppercase">
                  Your recommendations · rules-based, deterministic
                </p>
                <h1 className="mt-2 text-2xl font-semibold text-navy sm:text-3xl">
                  {displayName ?? `Participant ${shortId(id)}`}
                </h1>
                <p className="mt-2 max-w-2xl text-sm text-muted">
                  Recommendations require your consent to use your identified data — they run
                  on the <span className="font-semibold text-navy">identified tier</span> under
                  your <span className="font-semibold text-navy">view_identified</span> grants
                  (SPEC §10.2), never on the research mart. Each card names its guardrail class
                  (SPEC §10.3) and shows the data behind it.
                </p>
              </div>
              <div className="flex flex-col items-start gap-2 sm:items-end">
                <TimeMachineWidget
                  simDateIso={result.clockIso}
                  dayNumber={dayNumber}
                  daysRemaining={Math.max(0, MAX_SIM_DAYS - dayNumber)}
                />
                <Link
                  href={`/participant/${id}/trends`}
                  className="text-sm font-semibold text-brand-blue underline-offset-4 hover:underline"
                >
                  View trends →
                </Link>
              </div>
            </div>
          </Card>

          {/* Blocked state: no identified-tier grants at all */}
          {result.blocked ? (
            <Card className="p-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-danger/40 bg-danger/5 px-2.5 py-0.5 text-xs font-semibold text-danger">
                  Blocked
                </span>
                <h2 className="text-lg font-semibold text-navy">
                  No current consent covers identified-tier use
                </h2>
              </div>
              <p className="mt-2 max-w-2xl text-sm text-body">
                Per-participant recommendations cannot run on de-identified data (SPEC §10.2) —
                and without a current <span className="font-semibold">view_identified</span>{" "}
                grant they cannot run at all. Re-consent restores this page on the next visit;
                nothing is computed in the meantime.
              </p>
            </Card>
          ) : (
            <>
              {/* Partial consent notice */}
              {result.blockedDataClasses.length > 0 && (
                <Card tone="wash" className="border border-warning/30 p-4">
                  <p className="text-sm text-body">
                    <span className="font-semibold text-navy">Partial consent:</span> rules that
                    need{" "}
                    {result.blockedDataClasses
                      .map((dc: DataClass) => CLASS_LABELS[dc] ?? dc)
                      .join(", ")}{" "}
                    are switched off — a rule whose data class lacks a grant cannot fire.
                  </p>
                </Card>
              )}

              {cards.length === 0 ? (
                <Card className="p-6">
                  <h2 className="text-lg font-semibold text-navy">
                    Nothing to suggest right now
                  </h2>
                  <p className="mt-2 text-sm text-muted">
                    Every rule looked at the latest data and stayed quiet — sleep position,
                    therapy routine, and device signals all look steady. Cards appear here the
                    night the data says otherwise.
                  </p>
                </Card>
              ) : (
                <NarrativeCards
                  cards={cards.map((card) => ({
                    recommendation: card.recommendation,
                    narrative: card.draft.narrative,
                    claims: card.claims,
                    review: card.review,
                    passed: card.passed,
                  }))}
                  series={result.series}
                />
              )}
            </>
          )}

          <p className="pb-2 text-center text-xs text-muted">
            As of {formatDay(result.clockIso)} · queries ran in{" "}
            {result.queryMs.toLocaleString("en-US")} ms · engine {RECS_MODEL_ID} (
            {RECS_MODEL_VERSION}), deterministic — RECS_MODE=templates is the permanent
            fallback{mode.fellBack && ` (requested mode "${mode.requested}" not implemented — fell back)`}
            · every card schema-validated + safety-checked, logged to the{" "}
            <Link href="/compliance/model-log" className="underline underline-offset-4">
              model decision log
            </Link>{" "}
            (SPEC §10.3–10.4)
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
