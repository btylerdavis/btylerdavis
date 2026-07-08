import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/Card";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { TimeMachineWidget } from "@/components/TimeMachineWidget";
import { ChartCard } from "@/components/charts/ChartCard";
import { ArmChangeColumns } from "@/components/charts/ResearchCharts";
import { SERIES } from "@/components/charts/theme";
import { formatDay } from "@/lib/format";
import { loadTreatmentComparison } from "@/lib/research/compare";
import { MAX_SIM_DAYS, simDayNumber } from "@/lib/simclock";

/**
 * Treatment comparisons (DEMO.md Act 5; SPEC §6.4): unadjusted group means
 * by treatment arm, shown WITH the covariate table and the confounding-by-
 * indication callout — the demo point is that the platform surfaces the
 * threat instead of burying it. Precomputed in lib/research/compare (tested).
 */
export const metadata: Metadata = { title: "Treatment comparisons" };

export const dynamic = "force-dynamic";

const ARM_SHORT: Record<string, string> = {
  cpap: "CPAP",
  appliance: "Appliance",
  mattress_only: "Mattress",
  cpap_mattress: "CPAP+Matt",
  appliance_mattress: "Appl+Matt",
};

export default async function TreatmentComparePage() {
  const result = await loadTreatmentComparison();
  const clockDate = new Date(`${result.clockIso}T00:00:00Z`);
  const dayNumber = simDayNumber(clockDate);

  const essPoints = result.arms.map((arm) => ({
    arm: arm.arm,
    label: ARM_SHORT[arm.arm] ?? arm.arm,
    value: arm.essChange.mean === null ? null : round1(arm.essChange.mean),
    n: arm.essChange.n,
  }));
  const seffPoints = result.arms.map((arm) => ({
    arm: arm.arm,
    label: ARM_SHORT[arm.arm] ?? arm.arm,
    value: arm.seffChange.mean === null ? null : round1(arm.seffChange.mean),
    n: arm.seffChange.n,
  }));

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader variant="research" />
      <main className="flex-1 bg-pale-blue">
        <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-8 sm:px-6 sm:py-10">
          {/* Header */}
          <Card className="p-6 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold tracking-[0.14em] text-sky-blue uppercase">
                  Research · treatment comparisons (SPEC §6.4)
                </p>
                <h1 className="mt-2 text-2xl font-semibold text-navy sm:text-3xl">
                  CPAP vs appliance vs mattress vs combinations
                </h1>
                <p className="mt-2 max-w-2xl text-sm text-muted">
                  {result.totalWithArm.toLocaleString("en-US")} research-consented participants
                  with a determinable arm as of {formatDay(result.clockIso)} · unadjusted group
                  means, shown with their covariates on purpose
                </p>
              </div>
              <TimeMachineWidget
                simDateIso={result.clockIso}
                dayNumber={dayNumber}
                daysRemaining={Math.max(0, MAX_SIM_DAYS - dayNumber)}
              />
            </div>
          </Card>

          {/* Outcome columns */}
          <ChartCard
            title="Mean outcome change by treatment arm"
            subtitle="different units, separate panels — n under each column"
          >
            <div className="grid gap-6 lg:grid-cols-2">
              <ArmChangeColumns
                points={essPoints}
                caption="ESS change · baseline → day 90 (points)"
                color={SERIES.primary}
                unit=" pts"
                domain={[-4, 1]}
              />
              <ArmChangeColumns
                points={seffPoints}
                caption="Sleep-efficiency change · baseline → day 76–90 (pp)"
                color={SERIES.secondary}
                unit=" pp"
                domain={[-1, 4]}
              />
            </div>
          </ChartCard>

          {/* Covariate table */}
          <Card className="p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-navy">Covariates by arm</h2>
              <p className="text-xs text-muted">
                the confounding-by-indication check — who actually ends up in each arm?
              </p>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className="border-b border-pale-blue text-left text-xs tracking-wide text-muted uppercase">
                    <th className="py-2 pr-4 font-semibold">Arm</th>
                    <th className="py-2 pr-4 font-semibold">n</th>
                    <th className="py-2 pr-4 font-semibold">Mean age</th>
                    <th className="py-2 pr-4 font-semibold">Mean baseline AHI</th>
                    <th className="py-2 pr-4 font-semibold">Severity mix (BMI proxy) — mild / mod / severe</th>
                  </tr>
                </thead>
                <tbody>
                  {result.arms.map((arm) => (
                    <tr key={arm.arm} className="border-b border-pale-blue/60 last:border-0">
                      <td className="py-2.5 pr-4 font-semibold text-navy">{arm.label}</td>
                      <td className="py-2.5 pr-4 tabular-nums">{arm.n.toLocaleString("en-US")}</td>
                      <td className="py-2.5 pr-4 tabular-nums">
                        {arm.covariates.meanAge === null ? "—" : arm.covariates.meanAge.toFixed(1)}
                      </td>
                      <td className="py-2.5 pr-4 tabular-nums">
                        {arm.covariates.meanAhi.mean === null
                          ? "—"
                          : `${arm.covariates.meanAhi.mean.toFixed(1)} events/h`}
                      </td>
                      <td className="py-2.5 pr-4 tabular-nums">
                        {arm.covariates.severityN === 0
                          ? "—"
                          : `${arm.covariates.severityPct.mild}% / ${arm.covariates.severityPct.moderate}% / ${arm.covariates.severityPct.severe}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Confounding callout */}
          <Card tone="wash" className="border border-warning/40 p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-navy">
              Read with care: confounding by indication
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-body">
              Treatment arms are <span className="font-semibold">chosen, not randomized</span>. In
              real-world data, sicker patients get CPAP and wealthier customers buy premium
              mattresses — so raw arm-to-arm differences mix treatment effect with who selected
              each treatment. This synthetic cohort assigns arms near-independently of severity
              (check the table above), which is exactly what real data will <em>not</em> do.
            </p>
            <p className="mt-2 max-w-3xl text-sm text-body">
              <span className="font-semibold">Production method (SPEC §6.4):</span> pre-specified
              covariate capture (age, sex, BMI, baseline AHI/severity, comorbidities,
              socioeconomic proxies) feeding{" "}
              <span className="font-semibold">propensity-score adjustment</span> with target-trial
              emulation framing; findings are framed as real-world effectiveness signals and
              hypothesis generators, never RCT-grade causal claims.
            </p>
          </Card>

          <p className="pb-2 text-center text-xs text-muted">
            Comparison queries ran in {result.queryMs.toLocaleString("en-US")} ms ·{" "}
            <Link href="/research" className="underline underline-offset-4">
              build your own cohort in the explorer
            </Link>
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
