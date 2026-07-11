import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ButtonLink } from "@/components/Button";
import { Card } from "@/components/Card";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { TimeMachineWidget } from "@/components/TimeMachineWidget";
import { SERIES } from "@/components/charts/theme";
import { formatDay } from "@/lib/format";
import Link from "next/link";
import {
  loadPartnerDashboard,
  CATEGORY_LABEL,
  PARTNER_BRAND,
  type SuppressedStat,
} from "@/lib/partner/queries";
import type { ReleasedCount } from "@/lib/disclosure";
import { MAX_SIM_DAYS, simDayNumber } from "@/lib/simclock";
import { leaveDua } from "../actions";
import { DUA_COOKIE } from "../dua";

/**
 * The Tempur-Sealy dashboard (DEMO.md Act 7): everything on this page is a
 * research-tier aggregate (research_deid consent scope) released through the
 * de-identification suppression helpers — no names, no participant ids, no
 * cell under k=11. The DUA cookie gates entry; the "what you cannot see"
 * card makes SPEC §12.3's rules of engagement visible.
 */
export const metadata: Metadata = { title: "Partner dashboard" };

export const dynamic = "force-dynamic";

export default async function PartnerDashboardPage() {
  const cookieStore = await cookies();
  if (!cookieStore.has(DUA_COOKIE)) redirect("/partner");

  const dash = await loadPartnerDashboard();
  const clockDate = new Date(`${dash.clockIso}T00:00:00Z`);
  const dayNumber = simDayNumber(clockDate);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader variant="partner" />
      <main className="flex-1 bg-pale-blue">
        <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-8 sm:px-6 sm:py-10">
          {/* Header */}
          <Card className="p-6 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold tracking-[0.14em] text-sky-blue uppercase">
                  Partner console · de-identified, DUA-gated
                </p>
                <h1 className="mt-2 text-2xl font-semibold text-navy sm:text-3xl">
                  Tempur-Pedic outcomes vs category
                </h1>
                <p className="mt-2 max-w-2xl text-sm text-muted">
                  Research-tier aggregates only (research_deid consent scope). Every count is
                  released as a <span className="font-semibold text-navy">band</span> (11–20 ·
                  21–50 · 51–200 · &gt;200), never an exact number, with small cells suppressed
                  at k&nbsp;&lt;&nbsp;{dash.threshold} — so released numbers cannot be
                  differenced against each other.{" "}
                  <span className="font-semibold text-navy tabular-nums">
                    {dash.partnerPurchasers.display}
                  </span>{" "}
                  {PARTNER_BRAND} purchasers and{" "}
                  <span className="font-semibold text-navy tabular-nums">
                    {dash.otherPurchasers.display}
                  </span>{" "}
                  other-brand purchasers are visible to this tier as of{" "}
                  {formatDay(dash.clockIso)}. Every released count is logged in the{" "}
                  <Link href="/partner/releases" className="font-semibold underline underline-offset-4">
                    release ledger
                  </Link>
                  .
                </p>
                <div className="mt-4">
                  <ButtonLink href="/partner/proposal" size="sm">
                    Draft a study proposal
                  </ButtonLink>
                  <span className="ml-3 text-xs text-muted">
                    SPEC §6.3–6.4 presets · live cohort feasibility · §12.4 price band
                  </span>
                </div>
              </div>
              <TimeMachineWidget
                simDateIso={dash.clockIso}
                dayNumber={dayNumber}
                daysRemaining={Math.max(0, MAX_SIM_DAYS - dayNumber)}
              />
            </div>
          </Card>

          {/* Outcome tiles: partner vs category average */}
          <div className="grid gap-4 sm:grid-cols-2">
            {dash.tiles.map((tile) => (
              <Card key={tile.group} className="p-5 sm:p-6">
                <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">
                  {tile.group}
                </h2>
                <div className="mt-3 grid grid-cols-2 gap-4">
                  <OutcomeStat
                    label="Supine-time change"
                    stat={tile.supineChange}
                    unit="pp"
                    note="pre → post delivery"
                  />
                  <OutcomeStat
                    label="ESS change"
                    stat={tile.essChange}
                    unit="pts"
                    note="baseline → follow-up"
                  />
                </div>
              </Card>
            ))}
          </div>

          {/* Distribution: supine improvement, partner vs all other brands */}
          <Card className="p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-navy">
                Supine-time improvement distribution
              </h2>
              <p className="text-xs text-muted">
                per-participant change, pre → post delivery ·{" "}
                {dash.suppressedDistributionCells} cell
                {dash.suppressedDistributionCells === 1 ? "" : "s"} suppressed below
              </p>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs font-medium text-body">
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block h-3 w-3 rounded-[3px]"
                  style={{ background: SERIES.primary }}
                />
                {PARTNER_BRAND}
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block h-3 w-3 rounded-[3px]"
                  style={{ background: SERIES.secondary }}
                />
                {CATEGORY_LABEL}
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {dash.distribution.map((row) => (
                <div key={row.bucket} className="grid items-center gap-x-4 gap-y-1 sm:grid-cols-[110px_1fr]">
                  <p className="text-xs font-semibold text-navy tabular-nums">{row.bucket}</p>
                  <div className="space-y-1">
                    <DistBar
                      cell={row.partner}
                      pct={row.partnerPct}
                      color={SERIES.primary}
                      group={PARTNER_BRAND}
                    />
                    <DistBar
                      cell={row.others}
                      pct={row.othersPct}
                      color={SERIES.secondary}
                      group={CATEGORY_LABEL}
                    />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">
              Cell counts are released as bands; bars are APPROXIMATE shares computed from band
              midpoints (negative = less supine time), so a share can never be inverted into an
              exact count. Cells with 1–{dash.threshold - 1} participants are withheld and
              excluded from the shares entirely.
            </p>
          </Card>

          {/* Model-line table */}
          <Card className="p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-navy">Your model lines</h2>
              <p className="text-xs text-muted">
                rows under n={dash.threshold} suppressed — {dash.suppressedModelRows} below
              </p>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-pale-blue text-left text-xs tracking-wide text-muted uppercase">
                    <th className="py-2 pr-4 font-semibold">Line</th>
                    <th className="py-2 pr-4 font-semibold">n</th>
                    <th className="py-2 pr-4 font-semibold">Mean supine change</th>
                    <th className="py-2 pr-4 font-semibold">Mean ESS change</th>
                  </tr>
                </thead>
                <tbody>
                  {dash.modelRows.map((row) => (
                    <tr key={row.line} className="border-b border-pale-blue/60 last:border-0">
                      <td className="py-2.5 pr-4 font-semibold text-navy">TEMPUR-{row.line}</td>
                      <td className="py-2.5 pr-4 tabular-nums">
                        <CellValue cell={row.n} />
                      </td>
                      <td className="py-2.5 pr-4 tabular-nums">
                        {row.n.suppressed ? (
                          <span className="text-muted italic">withheld</span>
                        ) : (
                          fmtChange(row.meanSupineChange, "pp")
                        )}
                      </td>
                      <td className="py-2.5 pr-4 tabular-nums">
                        {row.n.suppressed ? (
                          <span className="text-muted italic">withheld</span>
                        ) : (
                          fmtChange(row.meanEssChange, "pts")
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* What you cannot see — the rules of engagement, visible */}
          <Card tone="dark" className="p-6 sm:p-8">
            <h2 className="text-xl font-semibold">What you cannot see</h2>
            <p className="mt-1 max-w-2xl text-sm text-white/75">
              The DUA excludes it, and the platform enforces the exclusion — these are query
              gates, not policy promises.
            </p>
            <ul className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <li className="rounded-card bg-white/10 p-4">
                <p className="font-semibold">Identified data</p>
                <p className="mt-1 text-white/75">
                  No names, contact details, or participant ids — this console reads the
                  research tier only; the identified tier is unreachable from partner queries.
                </p>
              </li>
              <li className="rounded-card bg-white/10 p-4">
                <p className="font-semibold">Other brands&apos; model detail</p>
                <p className="mt-1 text-white/75">
                  Competitors appear only as &ldquo;{CATEGORY_LABEL}&rdquo; in aggregate — never
                  by brand, line, or SKU.
                </p>
              </li>
              <li className="rounded-card bg-white/10 p-4">
                <p className="font-semibold">Raw rows</p>
                <p className="mt-1 text-white/75">
                  No nightly records, no per-participant extracts — aggregates with k&nbsp;&lt;&nbsp;
                  {dash.threshold} suppression are the only shape data leaves in.
                </p>
              </li>
              <li className="rounded-card bg-white/10 p-4">
                <p className="font-semibold">Small cells — or exact counts at all</p>
                <p className="mt-1 text-white/75">
                  Any count of 1–{dash.threshold - 1} is withheld before release, and every
                  released count is a band (11–20 · 21–50 · 51–200 · &gt;200) — subtracting
                  released numbers from each other yields ranges, never a hidden cell. Each
                  release is logged in the ledger.
                </p>
              </li>
            </ul>
          </Card>

          <div className="flex flex-wrap items-center justify-center gap-3 pb-2 text-xs text-muted">
            <span>
              Cohort queries ran in {dash.queryMs.toLocaleString("en-US")} ms · de-identified
              tier · DUA dua-demo-v1 accepted this session ·{" "}
              <Link href="/partner/releases" className="underline underline-offset-4">
                release ledger
              </Link>
            </span>
            <form action={leaveDua}>
              <button
                type="submit"
                className="font-semibold text-brand-blue underline underline-offset-4"
              >
                Leave &amp; re-arm the DUA gate
              </button>
            </form>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function CellValue({ cell }: { cell: ReleasedCount }) {
  if (cell.suppressed) {
    return (
      <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">
        {cell.display}
      </span>
    );
  }
  return <>{cell.display}</>;
}

function fmtChange(value: number | null, unit: string): string {
  if (value === null) return "—";
  return `${value < 0 ? "−" : "+"}${Math.abs(value).toFixed(1)} ${unit}`;
}

function OutcomeStat({
  label,
  stat,
  unit,
  note,
}: {
  label: string;
  stat: SuppressedStat;
  unit: string;
  note: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</p>
      {stat.n.suppressed ? (
        <p className="mt-1">
          <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">
            {stat.n.display}
          </span>
        </p>
      ) : (
        <>
          <p className="mt-1 text-2xl font-semibold text-navy tabular-nums">
            {fmtChange(stat.mean, unit)}
          </p>
          <p className="text-xs text-muted">
            n={stat.n.display} · {note}
          </p>
        </>
      )}
    </div>
  );
}

function DistBar({
  cell,
  pct,
  color,
  group,
}: {
  cell: ReleasedCount;
  pct: number | null;
  color: string;
  group: string;
}) {
  if (cell.suppressed) {
    return (
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning">
          {cell.display}
        </span>
        <span className="sr-only">{group}: suppressed</span>
      </div>
    );
  }
  const width = pct === null ? 0 : Math.max(pct, pct > 0 ? 2 : 0);
  return (
    <div className="flex items-center gap-2">
      <div className="h-4 flex-1 overflow-hidden rounded-full bg-pale-blue/70">
        <div
          className="h-full rounded-full"
          style={{ width: `${width}%`, background: color }}
          aria-hidden
        />
      </div>
      <span className="w-28 shrink-0 text-[11px] text-muted tabular-nums">
        {pct === null ? "—" : `${pct.toFixed(1)}%`} · {cell.display}
        <span className="sr-only"> {group}</span>
      </span>
    </div>
  );
}
