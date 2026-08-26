import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/Card";
import { CoverageStrip } from "@/components/CoverageStrip";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { TimeMachineWidget } from "@/components/TimeMachineWidget";
import { ChartCard } from "@/components/charts/ChartCard";
import {
  BandDeltaChart,
  ConsentTimelineChart,
  MissingnessChart,
  type MissingnessPoint,
} from "@/components/charts/RobustnessCharts";
import { SERIES } from "@/components/charts/theme";
import { consentCoverage } from "@/lib/consent";
import { formatDay } from "@/lib/format";
import { FIRMNESS_BAND_LABELS } from "@/lib/research/cohort";
import {
  loadRobustness,
  NIGHTLY_CLASS_LABELS,
  NIGHTLY_CLASSES,
  type BandDelta,
} from "@/lib/research/robustness";
import { MAX_SIM_DAYS, simDayNumber } from "@/lib/simclock";

/**
 * Bias & robustness views (audit level-up 11): before adding more headline
 * comparisons, this page interrogates the ones we have — missingness by data
 * class, the attrition/consent-change timeline straight from the immutable
 * consent ledger, a resting-HR negative control by firmness band, and an
 * E-value sensitivity note for the flagship delta. Everything is computed
 * from the consent-filtered research tier through the approved aggregate
 * modules; a revoked class vanishes from numerator AND denominator.
 */
export const metadata: Metadata = { title: "Bias & robustness" };

export const dynamic = "force-dynamic";

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const fmtMonth = (month: string) => MONTH_LABEL.format(new Date(`${month}-01T00:00:00Z`));

const fmtSigned = (value: number, digits = 1) =>
  `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}`;

function bandPoints(deltas: BandDelta[]) {
  return deltas.map((delta) => ({
    band: delta.band,
    label: FIRMNESS_BAND_LABELS[delta.band],
    mean: delta.stats.mean === null ? null : Math.round(delta.stats.mean * 10) / 10,
    ci95: delta.stats.ci95 === null ? null : Math.round(delta.stats.ci95 * 100) / 100,
    n: delta.stats.n,
  }));
}

export default async function RobustnessPage() {
  const dash = await loadRobustness();
  const clockDate = new Date(`${dash.clockIso}T00:00:00Z`);
  const dayNumber = simDayNumber(clockDate);
  const coverage = await consentCoverage({ use: "research_deid", clock: clockDate });

  // Pivot missingness cells → one chart point per month.
  const months = [...new Set(dash.missingness.map((cell) => cell.month))].sort();
  const missingnessPoints: MissingnessPoint[] = months.map((month) => {
    const point: MissingnessPoint = {
      month,
      wearable_sleep: null,
      cpap_telemetry: null,
      sleep_mat: null,
    };
    for (const cell of dash.missingness) {
      if (cell.month === month) point[cell.dataClass] = cell.pctPresent;
    }
    return point;
  });

  const { scenario, sensitivity } = dash;
  const scenarioLabel = (value: string) =>
    value === "null" ? "null (mattress supine effect ≈ 0)" : "default (flagship effect)";

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader variant="research" />
      <main className="flex-1 bg-cream">
        <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-8 sm:px-6 sm:py-10">
          {/* Header */}
          <Card className="p-6 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">
                  Research · bias & robustness (audit level-up 11)
                </p>
                <h1 className="mt-2 text-2xl font-semibold text-navy sm:text-3xl">
                  Interrogate the headline before believing it
                </h1>
                <p className="mt-2 max-w-2xl text-sm text-graphite">
                  Missingness by data class, consent churn straight from the immutable ledger,
                  a negative-control outcome, and sensitivity to unmeasured confounding — for
                  the{" "}
                  <Link
                    href="/research/positional"
                    className="font-semibold underline underline-offset-4"
                  >
                    flagship positional cohort
                  </Link>{" "}
                  ({dash.flagshipCount.toLocaleString("en-US")} members) as of{" "}
                  {formatDay(dash.clockIso)}. Consent-filtered (research_deid): a revoked class
                  drops out of every numerator <em>and</em> denominator on this page.
                </p>
              </div>
              <TimeMachineWidget
                simDateIso={dash.clockIso}
                dayNumber={dayNumber}
                daysRemaining={Math.max(0, MAX_SIM_DAYS - dayNumber)}
              />
            </div>
          </Card>

          {/* Scenario banner (level-up 11 scenario sweep hook) */}
          {scenario.mismatch ? (
            <Card tone="wash" className="border border-warning/50 p-4">
              <p className="text-sm text-ink">
                <span className="font-semibold text-warning">Scenario mismatch:</span> this
                server is running with{" "}
                <span className="font-mono font-semibold">
                  SCENARIO={process.env.SCENARIO}
                </span>{" "}
                but the database was seeded with{" "}
                <span className="font-semibold text-navy">
                  {scenario.seeded ? scenarioLabel(scenario.seeded.scenario) : "no stamped scenario"}
                </span>
                . Advancing the time machine now would generate inconsistent nights — restart
                the server with the matching SCENARIO, or re-seed.
              </p>
            </Card>
          ) : (
            <Card tone="wash" className="border border-sky/40 p-4">
              <p className="text-sm text-ink">
                <span className="font-semibold text-navy">Scenario:</span> this database was
                seeded with{" "}
                <span className="font-semibold text-navy">
                  {scenario.seeded
                    ? scenarioLabel(scenario.seeded.scenario)
                    : "an unstamped seed — run `npm run seed` to stamp the scenario marker"}
                </span>
                {scenario.env !== null && (
                  <>
                    {" "}
                    · server env <span className="font-mono">SCENARIO={scenario.env}</span>{" "}
                    matches
                  </>
                )}
                . Scenario sweep: <span className="font-mono">SCENARIO=null npm run seed</span>{" "}
                rebuilds the identical cohort with the mattress effect zeroed — every panel
                below is expected to go flat except missingness and the timeline.
              </p>
            </Card>
          )}

          {/* Consent-coverage denominators (level-up 9) */}
          <CoverageStrip
            coverage={coverage}
            tierLabel="research tier (research_deid)"
            context="every robustness panel reads only the Contributing set"
          />

          {/* Missingness by data class */}
          <ChartCard
            title="Missingness by data class"
            subtitle="% of expected nights with data, per calendar month · consent-granted instruments only"
            isEmpty={dash.missingness.length === 0}
            emptyMessage="No instrumented, consent-granted nights yet — advance the clock."
          >
            <MissingnessChart points={missingnessPoints} />
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-hairline text-left text-xs tracking-wide text-graphite uppercase">
                    <th className="py-2 pr-4 font-semibold">Data class</th>
                    {months.map((month) => (
                      <th key={month} className="py-2 pr-4 font-semibold">
                        {fmtMonth(month)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {NIGHTLY_CLASSES.map((dataClass) => (
                    <tr key={dataClass} className="border-b border-hairline/60 last:border-0">
                      <td className="py-2.5 pr-4 font-semibold text-navy">
                        {NIGHTLY_CLASS_LABELS[dataClass]}
                      </td>
                      {months.map((month) => {
                        const cell = dash.missingness.find(
                          (candidate) =>
                            candidate.month === month && candidate.dataClass === dataClass
                        );
                        return (
                          <td key={month} className="py-2.5 pr-4 tabular-nums">
                            {!cell || cell.pctPresent === null ? (
                              <span className="text-graphite">—</span>
                            ) : (
                              <>
                                <span className="font-semibold text-navy">
                                  {cell.pctPresent.toFixed(1)}%
                                </span>{" "}
                                <span className="text-xs text-graphite">
                                  {cell.presentNights.toLocaleString("en-US")}/
                                  {cell.expectedNights.toLocaleString("en-US")} nights
                                </span>
                              </>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-graphite">
              Expected nights = every night from instrument start (enrollment for wearables and
              the under-mattress sensor; setup for CPAP) to the sim clock, for participants
              holding a current research grant on the class. HST, PRO, and purchase classes are
              event- or schedule-cadence and have no nightly denominator, so they are not
              charted rather than faked. Wearables miss ~15% of nights by design; CPAP reports
              every therapy night (gaps included, as therapy_gap outcomes).
            </p>
          </ChartCard>

          {/* Attrition / consent-change timeline */}
          <ChartCard
            title="Attrition & consent-change timeline"
            subtitle="per sim-month, projected from the immutable consent event ledger"
          >
            <ConsentTimelineChart points={dash.timeline} />
            <p className="mt-3 text-xs text-graphite">
              Enrollments come from the registry record; every other bar is a ledger event —
              full instrument revocations, per-class scope revisions (classes removed /
              restored), signed re-consents, and executed deletions. Because the ledger is
              append-only, this chart is an audit surface: it cannot disagree with the consent
              engine.
            </p>
          </ChartCard>

          {/* Negative control */}
          <ChartCard
            title="Negative control: resting heart rate"
            subtitle="pre → post mattress-delivery change by firmness band, 95% CI · same windows as the flagship effect"
            isEmpty={dash.negativeControl.every((delta) => delta.stats.n === 0)}
            emptyMessage="No flagship members with wearable nights in both windows are readable under current consents."
          >
            <div className="grid gap-6 lg:grid-cols-2">
              <BandDeltaChart
                points={bandPoints(dash.supineDeltas)}
                caption="The effect: supine time change (pp)"
                color={SERIES.primary}
                unit=" pp"
                domain={[-14, 4]}
              />
              <BandDeltaChart
                points={bandPoints(dash.negativeControl)}
                caption="The negative control: resting HR change (bpm)"
                color={SERIES.secondary}
                unit=" bpm"
                domain={[-4, 4]}
              />
            </div>
            <div className="mt-4 rounded-card bg-cream/60 p-4 text-sm text-ink">
              <p>
                <span className="font-semibold text-navy">Why flat is reassuring:</span> a
                mattress has no physiological pathway to resting heart rate — its causal
                channel is sleep <em>position</em>. So the same participants, the same
                pre/post windows, and the same pipeline should show the supine effect on the
                left and <span className="font-semibold">no band contrast</span> on the right.
                If the negative control moved with firmness band, the flagship delta would be
                suspect: it would mean the bands differ in something beyond the mattress
                (selection, concurrent therapy timing, a pipeline bug) — the same forces that
                could fabricate the supine result. CPAP does move resting HR, but CPAP timing
                is independent of firmness band, so it cancels across bands.
              </p>
            </div>
          </ChartCard>

          {/* Sensitivity to unmeasured confounding */}
          <Card tone="wash" className="border border-sky/40 p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-navy">
              Sensitivity to unmeasured confounding (E-value)
            </h2>
            {sensitivity.eValue === null ||
            sensitivity.medium.mean === null ||
            sensitivity.others.mean === null ? (
              <p className="mt-2 text-sm text-graphite">
                Not enough members with pre/post supine windows in both band groups to compute
                the E-value yet — advance the clock.
              </p>
            ) : (
              <>
                <p className="mt-2 max-w-3xl text-sm text-ink">
                  Flagship delta: medium-band supine change{" "}
                  <span className="font-semibold tabular-nums">
                    {fmtSigned(sensitivity.medium.mean)} pp
                  </span>{" "}
                  (n={sensitivity.medium.n}) vs other bands{" "}
                  <span className="font-semibold tabular-nums">
                    {fmtSigned(sensitivity.others.mean)} pp
                  </span>{" "}
                  (n={sensitivity.others.n}) — a standardized difference of{" "}
                  <span className="font-semibold tabular-nums">
                    {Math.abs(sensitivity.eValue.d).toFixed(2)}
                  </span>{" "}
                  (≈ risk ratio {sensitivity.eValue.approxRr.toFixed(1)}), giving an{" "}
                  <span className="font-semibold tabular-nums">
                    E-value of {sensitivity.eValue.eValue.toFixed(1)}
                  </span>
                  .
                </p>
                <p className="mt-2 max-w-3xl text-sm text-ink">
                  <span className="font-semibold text-navy">In plain language:</span> to
                  explain this delta away with no real mattress effect, a hidden confounder
                  would have to be associated with <em>both</em> firmness-band choice and
                  supine-time change by a risk ratio of at least{" "}
                  {sensitivity.eValue.eValue.toFixed(1)}× each — far stronger than plausible
                  lifestyle or severity differences between mattress shoppers.
                </p>
                <p className="mt-2 text-xs text-graphite">
                  E-value per VanderWeele & Ding (2017), from the standardized mean
                  difference via RR ≈ e^(0.91·d). Synthetic demonstration cohort — the method,
                  not the number, is the exhibit.
                </p>
              </>
            )}
          </Card>

          <p className="pb-2 text-center text-xs text-graphite">
            Robustness queries ran in {dash.queryMs.toLocaleString("en-US")} ms ·{" "}
            <Link href="/research/positional" className="underline underline-offset-4">
              flagship dashboard
            </Link>{" "}
            ·{" "}
            <Link href="/research/compare" className="underline underline-offset-4">
              treatment comparisons
            </Link>
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
