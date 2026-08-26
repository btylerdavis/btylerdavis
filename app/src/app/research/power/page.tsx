import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses } from "@/components/Button";
import { Card } from "@/components/Card";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { TimeMachineWidget } from "@/components/TimeMachineWidget";
import { formatDay } from "@/lib/format";
import { FIRMNESS_BAND_LABELS, loadResearchCohort, type FirmnessBand } from "@/lib/research/cohort";
import { buildPositionalDashboard } from "@/lib/research/positional";
import {
  ALPHA_OPTIONS,
  nPerGroup,
  parsePowerParams,
  POWER_OPTIONS,
} from "@/lib/research/power";
import { MAX_SIM_DAYS, simDayNumber } from "@/lib/simclock";

/**
 * Power calculator (DEMO.md Act 5 reserve → working): the SPEC §6.3 power
 * sketch made interactive. Inputs live in the URL (every scenario is a
 * bookmarkable link, like the explorer); the result is overlaid with the
 * LIVE consent-filtered instrumented-cohort counts per firmness band, so
 * "do we have the n?" is answered against real registry state, not a slide.
 */
export const metadata: Metadata = { title: "Power calculator" };

export const dynamic = "force-dynamic";

const BANDS: FirmnessBand[] = ["soft", "medium", "firm"];

export default async function PowerCalculatorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const inputs = parsePowerParams(params);
  const n = nPerGroup(inputs.effectPp, inputs.sd, inputs.alpha, inputs.power);

  const cohort = await loadResearchCohort();
  const positional = buildPositionalDashboard(cohort);
  const clockDate = new Date(`${positional.clockIso}T00:00:00Z`);
  const dayNumber = simDayNumber(clockDate);

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
                  Research · power calculator (SPEC §6.3 sketch, interactive)
                </p>
                <h1 className="mt-2 text-2xl font-semibold text-navy sm:text-3xl">
                  How many participants per comparison group?
                </h1>
                <p className="mt-2 max-w-2xl text-sm text-graphite">
                  Two-sample normal approximation for a difference in mean supine sleep time.
                  The SPEC §6.3 sketch — 10 pp effect, SD ≈ 20, α = 0.05, 80% power — lands at
                  ≈ 64 per group; the instrumented cohort is sized in multiples of it (§13
                  Phase 2: ≥ 2× the target). Overlay counts are live and consent-filtered as of{" "}
                  {formatDay(positional.clockIso)}.
                </p>
              </div>
              <TimeMachineWidget
                simDateIso={positional.clockIso}
                dayNumber={dayNumber}
                daysRemaining={Math.max(0, MAX_SIM_DAYS - dayNumber)}
              />
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-5">
            {/* Inputs */}
            <Card className="p-5 sm:p-6 lg:col-span-2">
              <h2 className="text-lg font-semibold text-navy">Assumptions</h2>
              <p className="mt-1 text-xs text-graphite">
                Stored in the URL — every scenario is a shareable link.
              </p>
              <form method="get" className="mt-4 space-y-3">
                <label className="block text-sm">
                  <span className="font-semibold text-navy">Detectable effect</span>
                  <span className="text-graphite"> · pp of supine sleep time</span>
                  <input
                    type="number"
                    name="effect"
                    min={1}
                    max={50}
                    step={1}
                    defaultValue={inputs.effectPp}
                    className="mt-1 w-28 rounded-card border border-hairline px-3 py-1.5 text-sm tabular-nums focus:ring-2 focus:ring-brand focus:outline-none"
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-semibold text-navy">Standard deviation</span>
                  <span className="text-graphite"> · pp (SPEC sketch: ≈ 20)</span>
                  <input
                    type="number"
                    name="sd"
                    min={1}
                    max={100}
                    step={1}
                    defaultValue={inputs.sd}
                    className="mt-1 w-28 rounded-card border border-hairline px-3 py-1.5 text-sm tabular-nums focus:ring-2 focus:ring-brand focus:outline-none"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-sm">
                    <span className="font-semibold text-navy">α (two-sided)</span>
                    <select
                      name="alpha"
                      defaultValue={String(inputs.alpha)}
                      className="mt-1 w-full rounded-card border border-hairline px-3 py-1.5 text-sm tabular-nums focus:ring-2 focus:ring-brand focus:outline-none"
                    >
                      {ALPHA_OPTIONS.map((alpha) => (
                        <option key={alpha} value={alpha}>
                          {alpha}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    <span className="font-semibold text-navy">Power</span>
                    <select
                      name="power"
                      defaultValue={String(inputs.power)}
                      className="mt-1 w-full rounded-card border border-hairline px-3 py-1.5 text-sm tabular-nums focus:ring-2 focus:ring-brand focus:outline-none"
                    >
                      {POWER_OPTIONS.map((power) => (
                        <option key={power} value={power}>
                          {Math.round(power * 100)}%
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <button type="submit" className={buttonClasses("outline", "sm")}>
                  Recompute
                </button>
              </form>
              <p className="mt-4 text-xs text-graphite">
                n per group = 2 · ((z₁₋α/2 + z₁₋β) · SD / Δ)² — a planning approximation, not a
                SAP. Production analyses pre-specify the full plan (SPEC §11.2).
              </p>
            </Card>

            {/* Result + live overlay */}
            <Card className="p-5 sm:p-6 lg:col-span-3">
              <h2 className="text-lg font-semibold text-navy">Required sample size</h2>
              <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-2">
                <div>
                  <p className="text-4xl font-semibold text-navy tabular-nums">{n}</p>
                  <p className="text-xs text-graphite">per comparison group</p>
                </div>
                <div>
                  <p className="text-2xl font-semibold text-ink tabular-nums">{n * 2}</p>
                  <p className="text-xs text-graphite">two-group total</p>
                </div>
                <div>
                  <p className="text-2xl font-semibold text-ink tabular-nums">{n * 2 * 2}</p>
                  <p className="text-xs text-graphite">at the §13 Phase-2 bar (≥ 2× target)</p>
                </div>
              </div>
              <p className="mt-2 text-xs text-graphite">
                Detecting a {inputs.effectPp} pp change (SD {inputs.sd}) at α = {inputs.alpha},{" "}
                {Math.round(inputs.power * 100)}% power.
              </p>

              <h3 className="mt-6 text-sm font-semibold tracking-wide text-graphite uppercase">
                Live instrumented cohort vs this target · by firmness band
              </h3>
              <p className="mt-1 text-xs text-graphite">
                Supine-predominant participants with a delivered mattress AND under-mattress
                sensor nights (consent-filtered, research tier) — the same membership rule as
                the{" "}
                <Link
                  href="/research/positional"
                  className="font-semibold underline underline-offset-4"
                >
                  flagship dashboard
                </Link>
                .
              </p>
              <ul className="mt-3 space-y-3">
                {BANDS.map((band) => {
                  const count = positional.bandN[band];
                  const met = count >= n;
                  const pct = Math.min(100, n > 0 ? (count / n) * 100 : 0);
                  return (
                    <li key={band}>
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-sm font-semibold text-navy">
                          {FIRMNESS_BAND_LABELS[band]}
                        </p>
                        <p className="text-sm tabular-nums">
                          <span className="font-semibold text-navy">
                            {count.toLocaleString("en-US")}
                          </span>{" "}
                          <span className="text-graphite">of {n}</span>{" "}
                          <span
                            className={`ml-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              met ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
                            }`}
                          >
                            {met ? "powered" : "not yet powered"}
                          </span>
                        </p>
                      </div>
                      <div className="relative mt-1.5 h-3 rounded-full bg-cream">
                        <div
                          className={`absolute inset-y-0 left-0 rounded-full ${
                            met ? "bg-success/70" : "bg-brand/70"
                          }`}
                          style={{ width: `${pct}%` }}
                          aria-hidden
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-xs text-graphite">
                Instrumented flagship cohort: {positional.instrumentedCount.toLocaleString("en-US")}{" "}
                of {positional.cohortCount.toLocaleString("en-US")} members · a band meeting the
                bar here still needs the pre-specified SAP before any claim (SPEC §11.2).
              </p>
            </Card>
          </div>

          <p className="pb-2 text-center text-xs text-graphite">
            Cohort queries ran in {cohort.queryMs.toLocaleString("en-US")} ms ·{" "}
            <Link href="/research/positional" className="underline underline-offset-4">
              flagship dashboard
            </Link>{" "}
            ·{" "}
            <Link href="/research?supine=y" className="underline underline-offset-4">
              supine-predominant cohort in the explorer
            </Link>
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
