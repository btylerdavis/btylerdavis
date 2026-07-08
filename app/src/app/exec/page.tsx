import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/Card";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { TimeMachineWidget } from "@/components/TimeMachineWidget";
import { AdherenceFunnel } from "@/components/charts/AdherenceFunnel";
import { buttonClasses } from "@/components/Button";
import { formatDay } from "@/lib/format";
import { loadExecDashboard, parseAssumptions, TARGETS } from "@/lib/exec/queries";
import { MAX_SIM_DAYS } from "@/lib/simclock";

/**
 * Exec/business dashboard (DEMO.md Act 7 — Kevin's view): the retail→clinic
 * referral funnel with a configurable revenue assumption (URL-param inputs,
 * demo defaults), cohort growth against the SPEC §3.5 targets, and the
 * data-asset tiles. All counts are consent-filtered aggregates — the same
 * discipline as the coach and research layers, one level up.
 */
export const metadata: Metadata = { title: "Exec dashboard" };

export const dynamic = "force-dynamic";

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

export default async function ExecDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ hst?: string | string[]; cpap?: string | string[] }>;
}) {
  const params = await searchParams;
  const assumptions = parseAssumptions(params);
  const dash = await loadExecDashboard(assumptions);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader variant="exec" />
      <main className="flex-1 bg-pale-blue">
        <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-8 sm:px-6 sm:py-10">
          {/* Header */}
          <Card className="p-6 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold tracking-[0.14em] text-sky-blue uppercase">
                  Executive dashboard · the business layer
                </p>
                <h1 className="mt-2 text-2xl font-semibold text-navy sm:text-3xl">
                  Two doors, one funnel, one data asset
                </h1>
                <p className="mt-2 max-w-2xl text-sm text-muted">
                  The referral funnel is a direct, measurable win independent of the research
                  value (SPEC §9.2); the growth bars track the §3.5 definition of successful.
                  Every count below is consent-filtered — revoked participants are already gone.
                </p>
              </div>
              <TimeMachineWidget
                simDateIso={dash.clockIso}
                dayNumber={dash.dayNumber}
                daysRemaining={Math.max(0, MAX_SIM_DAYS - dash.dayNumber)}
              />
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-5">
            {/* Referral funnel */}
            <Card className="p-5 sm:p-6 lg:col-span-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold text-navy">
                  Retail → clinic referral funnel
                </h2>
                <p className="text-xs text-muted">retail door, cumulative as of {formatDay(dash.clockIso)}</p>
              </div>
              <div className="mt-4">
                <AdherenceFunnel stages={dash.funnel} />
              </div>
              <p className="mt-2 text-xs text-muted">
                Screens are STOP-BANG completions at The Mattress Hub; conversions are screens
                that became Sleeptopia therapy patients (CPAP or appliance started). The
                synthetic cohort models full referral acceptance — expect real drop-off at the
                HST step in production.
              </p>
            </Card>

            {/* Revenue assumptions */}
            <Card className="p-5 sm:p-6 lg:col-span-2">
              <h2 className="text-lg font-semibold text-navy">Referral-funnel value</h2>
              <p className="mt-1 text-xs text-muted">
                Editable assumptions — demo defaults, stored in the URL so a scenario is a
                shareable link.
              </p>
              <form method="get" className="mt-4 space-y-3">
                <label className="block text-sm">
                  <span className="font-semibold text-navy">HST reimbursement</span>
                  <span className="text-muted"> · per completed referral</span>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-muted">$</span>
                    <input
                      type="number"
                      name="hst"
                      min={0}
                      max={100000}
                      step={25}
                      defaultValue={assumptions.hstValue}
                      className="w-28 rounded-card border border-pale-blue px-3 py-1.5 text-sm tabular-nums focus:ring-2 focus:ring-brand-blue focus:outline-none"
                    />
                    <span className="text-xs text-muted">
                      × {dash.revenue.hstCount.toLocaleString("en-US")} HSTs
                    </span>
                  </div>
                </label>
                <label className="block text-sm">
                  <span className="font-semibold text-navy">CPAP setup value</span>
                  <span className="text-muted"> · equipment + supplies</span>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-muted">$</span>
                    <input
                      type="number"
                      name="cpap"
                      min={0}
                      max={100000}
                      step={50}
                      defaultValue={assumptions.cpapValue}
                      className="w-28 rounded-card border border-pale-blue px-3 py-1.5 text-sm tabular-nums focus:ring-2 focus:ring-brand-blue focus:outline-none"
                    />
                    <span className="text-xs text-muted">
                      × {dash.revenue.cpapSetupCount.toLocaleString("en-US")} setups
                    </span>
                  </div>
                </label>
                <button type="submit" className={buttonClasses("outline", "sm")}>
                  Recompute
                </button>
              </form>
              <div className="mt-4 rounded-card bg-pale-blue/70 p-4">
                <p className="text-xs font-semibold tracking-wide text-muted uppercase">
                  Estimated funnel value to date
                </p>
                <p className="mt-1 text-3xl font-semibold text-navy tabular-nums">
                  {usd(dash.revenue.totalValue)}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {dash.revenue.hstCount.toLocaleString("en-US")} HSTs × {usd(assumptions.hstValue)}{" "}
                  + {dash.revenue.cpapSetupCount.toLocaleString("en-US")} CPAP setups ×{" "}
                  {usd(assumptions.cpapValue)} · assumptions, not bookings
                </p>
              </div>
            </Card>
          </div>

          {/* Growth vs SPEC §3.5 targets */}
          <Card className="p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-navy">
                Cohort growth vs SPEC §3.5 targets
              </h2>
              <p className="text-xs text-muted">
                bands are the &ldquo;successful when&rdquo; column, drawn to scale
              </p>
            </div>
            <div className="mt-5 space-y-6">
              <TargetBar
                label="Consented participants"
                value={dash.growth.consented}
                axisMax={3300}
                bands={[
                  { from: TARGETS.enrolledM12.min, to: TARGETS.enrolledM12.max, label: "M12: 300–600" },
                  { from: TARGETS.enrolledM24.min, to: TARGETS.enrolledM24.max, label: "M24: 1,500–3,000" },
                ]}
              />
              <TargetBar
                label="Lane C linked participants"
                value={dash.growth.linked}
                axisMax={900}
                bands={[{ from: TARGETS.linkedM24.min, to: null, label: "M24: ≥ 400" }]}
              />
            </div>
            <p className="mt-4 text-xs text-muted">
              Linked (Lane C) participants are the platform&apos;s most valuable cohort — raw
              enrollment without linkage is explicitly not success (SPEC §3.5).
            </p>
          </Card>

          {/* Data-asset tiles */}
          <Card className="p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-navy">The asset we are building</h2>
              <p className="text-xs text-muted">
                linked, longitudinal, consent-provenanced — the moat (SPEC §12.2)
              </p>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <AssetTile
                value={dash.assets.consented}
                label="Consented participants"
                note="holding ≥ 1 current grant"
              />
              <AssetTile
                value={dash.assets.linked}
                label="Linked participants"
                note="retail + clinical records joined (Lane C)"
              />
              <AssetTile
                value={dash.assets.observationNights}
                label="Observation-nights"
                note="nights with ≥ 1 measured signal"
              />
              <AssetTile
                value={dash.assets.instrumented}
                label="Instrumented sub-cohort"
                note="under-mattress sensor in place"
              />
            </div>
          </Card>

          {/* Partnership pipeline */}
          <Card className="p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-navy">Partnership pipeline</h2>
              <p className="text-xs text-muted">SPEC §12.1 tiers · demo-honest status</p>
            </div>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              <PipelineRow
                partner="Tempur-Sealy"
                status="working"
                detail="DUA-gated dashboard live (demo) — de-identified outcomes for their models"
                href="/partner"
              />
              <PipelineRow
                partner="Wearable vendors"
                status="reserve"
                detail="validation studies vs clinical ground truth — built on interest"
              />
              <PipelineRow
                partner="Dental sleep practices & DME"
                status="reserve"
                detail="multi-site onboarding — the realistic path to scale (R7)"
              />
              <PipelineRow
                partner="Payers"
                status="phase 4"
                detail="adherence/outcomes evidence for coverage — never a v1 dependency"
              />
            </ul>
          </Card>

          <p className="pb-2 text-center text-xs text-muted">
            Queries ran in {dash.queryMs.toLocaleString("en-US")} ms · consent-filtered
            aggregates · revenue figures are assumptions ·{" "}
            <Link href="/research/abstract" className="underline underline-offset-4">
              see the research output
            </Link>
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function AssetTile({ value, label, note }: { value: number; label: string; note: string }) {
  return (
    <div className="rounded-card bg-pale-blue/70 p-4">
      <p className="text-2xl font-semibold text-navy tabular-nums">
        {value.toLocaleString("en-US")}
      </p>
      <p className="mt-0.5 text-sm font-semibold text-body">{label}</p>
      <p className="mt-0.5 text-xs text-muted">{note}</p>
    </div>
  );
}

/**
 * Progress bar with target bands drawn as markers on the same scale —
 * "where we are" against "what §3.5 calls successful".
 */
function TargetBar({
  label,
  value,
  axisMax,
  bands,
}: {
  label: string;
  value: number;
  axisMax: number;
  bands: { from: number; to: number | null; label: string }[];
}) {
  const pct = (n: number) => Math.min(100, (n / axisMax) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-navy">{label}</p>
        <p className="text-sm font-semibold text-navy tabular-nums">
          {value.toLocaleString("en-US")}
        </p>
      </div>
      <div className="relative mt-2 h-4 rounded-full bg-pale-blue">
        {/* target bands under the fill */}
        {bands.map((band) => (
          <div
            key={band.label}
            className="absolute inset-y-0 rounded-full bg-success/15"
            style={{
              left: `${pct(band.from)}%`,
              width: `${pct(band.to ?? axisMax) - pct(band.from)}%`,
            }}
            aria-hidden
          />
        ))}
        {/* the value fill */}
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-brand-blue/85"
          style={{ width: `${pct(value)}%` }}
          aria-hidden
        />
        {/* band edge markers */}
        {bands.flatMap((band) => [
          <div
            key={`${band.label}-from`}
            className="absolute inset-y-[-3px] w-0.5 bg-success"
            style={{ left: `${pct(band.from)}%` }}
            aria-hidden
          />,
          ...(band.to !== null
            ? [
                <div
                  key={`${band.label}-to`}
                  className="absolute inset-y-[-3px] w-0.5 bg-success"
                  style={{ left: `${pct(band.to)}%` }}
                  aria-hidden
                />,
              ]
            : []),
        ])}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
        {bands.map((band) => (
          <span key={band.label} className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2.5 w-0.5 bg-success" />
            {band.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function PipelineRow({
  partner,
  status,
  detail,
  href,
}: {
  partner: string;
  status: "working" | "reserve" | "phase 4";
  detail: string;
  href?: string;
}) {
  const badge =
    status === "working"
      ? "bg-success/10 text-success"
      : status === "reserve"
        ? "bg-pale-blue text-navy"
        : "bg-accent-purple/10 text-accent-purple";
  return (
    <li className="rounded-card border border-pale-blue p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-navy">
          {href ? (
            <Link href={href} className="underline-offset-4 hover:underline">
              {partner}
            </Link>
          ) : (
            partner
          )}
        </p>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge}`}>
          {status}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">{detail}</p>
    </li>
  );
}
