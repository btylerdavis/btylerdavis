import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/Card";
import { CoverageStrip } from "@/components/CoverageStrip";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { TimeMachineWidget } from "@/components/TimeMachineWidget";
import { ChartCard } from "@/components/charts/ChartCard";
import {
  BrandDumbbellChart,
  EssChangeDistributionChart,
  WeeklySupineByBandChart,
} from "@/components/charts/ResearchCharts";
import { consentCoverage } from "@/lib/consent";
import { formatDay } from "@/lib/format";
import { loadPositionalDashboard, MIN_GROUP_N, RESPONDER_DROP_PP } from "@/lib/research/positional";
import { MAX_SIM_DAYS, simDayNumber } from "@/lib/simclock";

/**
 * Positional-OSA flagship dashboard (DEMO.md Act 5's money screen) — SPEC
 * §6.3 visualized on the synthetic cohort. Everything is computed from
 * consent-filtered research-tier reads; the methods card is the honesty
 * layer, styled as a proper card rather than fine print.
 */
export const metadata: Metadata = { title: "Positional study" };

export const dynamic = "force-dynamic";

export default async function PositionalDashboardPage() {
  const dash = await loadPositionalDashboard();
  const clockDate = new Date(`${dash.clockIso}T00:00:00Z`);
  const dayNumber = simDayNumber(clockDate);
  // Coverage denominators scoped to the classes this study reads (level-up 9).
  const coverage = await consentCoverage({
    use: "research_deid",
    clock: clockDate,
    dataClasses: ["hst_clinical", "sleep_mat", "mattress_purchase", "pro_responses"],
  });

  const fmtEss = (mean: number | null) =>
    mean === null ? "—" : `${mean < 0 ? "−" : "+"}${Math.abs(mean).toFixed(1)} pts`;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader variant="research" />
      <main className="flex-1 bg-pale-blue">
        <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-8 sm:px-6 sm:py-10">
          {/* Cohort definition banner */}
          <Card className="p-6 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold tracking-[0.14em] text-sky-blue uppercase">
                  Research · flagship sub-study (SPEC §6.3)
                </p>
                <h1 className="mt-2 text-2xl font-semibold text-navy sm:text-3xl">
                  Positional OSA × mattress
                </h1>
                <p className="mt-2 max-w-2xl text-sm text-muted">
                  Cohort: <span className="font-semibold text-navy">supine-predominant OSA</span>{" "}
                  (supine AHI ≥ 2× non-supine, per the HST position channel) with a{" "}
                  <span className="font-semibold text-navy">delivered mattress change</span> —{" "}
                  <span className="font-semibold text-navy tabular-nums">
                    {dash.cohortCount.toLocaleString("en-US")}
                  </span>{" "}
                  participants,{" "}
                  <span className="font-semibold text-navy tabular-nums">
                    {dash.instrumentedCount.toLocaleString("en-US")}
                  </span>{" "}
                  instrumented with under-mattress sensors. As of {formatDay(dash.clockIso)},
                  consent-filtered (research_deid).
                </p>
              </div>
              <div className="flex flex-col items-start gap-2 sm:items-end">
                <TimeMachineWidget
                  simDateIso={dash.clockIso}
                  dayNumber={dayNumber}
                  daysRemaining={Math.max(0, MAX_SIM_DAYS - dayNumber)}
                />
                {dash.mediumBandDropPp !== null && (
                  <span className="rounded-full bg-success/10 px-3 py-1 text-xs font-semibold text-success">
                    Medium-firm band: −{dash.mediumBandDropPp.toFixed(1)} pp supine time vs
                    pre-delivery
                  </span>
                )}
              </div>
            </div>
          </Card>

          {/* Consent-coverage denominators (level-up 9) — study classes only */}
          <CoverageStrip
            coverage={coverage}
            tierLabel="research tier (research_deid) · HST / sensor / mattress / PRO classes"
            context="the flagship cohort is drawn from the Contributing set"
          />

          {/* Primary chart: weekly supine % by firmness band */}
          <ChartCard
            title="Supine sleep time by week from mattress delivery"
            subtitle="one line per firmness band · week 0 = delivery"
            isEmpty={dash.instrumentedCount === 0}
            emptyMessage="No instrumented supine-predominant participants are readable under current consents."
          >
            <WeeklySupineByBandChart points={dash.weekly} bandN={dash.bandN} />
          </ChartCard>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Secondary: paired before/after per brand */}
            <ChartCard
              title="Before / after by mattress brand"
              subtitle={`4-week windows around delivery · groups under n=${MIN_GROUP_N} greyed`}
              isEmpty={dash.brandPairs.length === 0}
            >
              <BrandDumbbellChart pairs={dash.brandPairs} />
            </ChartCard>

            {/* Outcome panel: ESS change, responders vs non-responders */}
            <ChartCard
              title="Does less supine time feel better?"
              subtitle={`ESS change distribution · responder = supine drop ≥ ${RESPONDER_DROP_PP} pp`}
              isEmpty={dash.respondersN + dash.nonRespondersN === 0}
              emptyMessage="Not enough participants have both supine windows and ESS follow-up yet — advance the clock."
            >
              <EssChangeDistributionChart
                buckets={dash.essDist}
                respondersN={dash.respondersN}
                nonRespondersN={dash.nonRespondersN}
              />
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-pale-blue px-2.5 py-1 font-semibold text-navy">
                  Responders: mean ESS {fmtEss(dash.respondersEssMean)}
                </span>
                <span className="rounded-full bg-pale-blue px-2.5 py-1 font-semibold text-navy">
                  Non-responders: mean ESS {fmtEss(dash.nonRespondersEssMean)}
                </span>
              </div>
            </ChartCard>
          </div>

          {/* Methods & limitations — the honesty layer, as a proper card */}
          <Card tone="wash" className="border border-sky-blue/40 p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-navy">Methods &amp; limitations</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-body">
              <li>
                <span className="font-semibold">
                  Observational, synthetic demonstration cohort. Effects are illustrative.
                </span>{" "}
                Production analyses follow the pre-specified SAP (SPEC §6.3).
              </li>
              <li>
                Supine % comes from the under-mattress sensor sub-cohort (
                {dash.instrumentedCount.toLocaleString("en-US")} of{" "}
                {dash.cohortCount.toLocaleString("en-US")}); the first post-delivery week is
                excluded from before/after windows as an adjustment ramp.
              </li>
              <li>
                Mattress choice is not randomized — firmness-band comparisons carry
                confounding-by-preference; see{" "}
                <Link href="/research/compare" className="font-semibold underline underline-offset-4">
                  treatment comparisons
                </Link>{" "}
                for the covariate view (SPEC §6.4).
              </li>
              <li>
                Groups under n={MIN_GROUP_N} are shown greyed and excluded from interpretation;
                the SPEC §6.3 power sketch calls for ≈ 64 participants per comparison group.
              </li>
            </ul>
          </Card>

          <p className="pb-2 text-center text-xs text-muted">
            Dashboard queries ran in {dash.queryMs.toLocaleString("en-US")} ms across ~
            {(800_000).toLocaleString("en-US")} observations ·{" "}
            <Link
              href="/research?supine=y&firmness=medium"
              className="underline underline-offset-4"
            >
              open this cohort in the explorer
            </Link>
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
