import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/Button";
import { Card } from "@/components/Card";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { TimeMachineWidget } from "@/components/TimeMachineWidget";
import { AdherenceFunnel } from "@/components/charts/AdherenceFunnel";
import { ChartCard } from "@/components/charts/ChartCard";
import { loadCoachDashboard, type CoachFlagRow } from "@/lib/coach/queries";
import { formatDay, shortId } from "@/lib/format";

/**
 * Coach portal (DEMO.md Act 4) — the Sleeptopia-side operational view:
 * funnel tiles, the adherence funnel, data-quality flags, and the paginated
 * patient list. All aggregates are consent-filtered cohort-wide; names
 * appear only where the Lane C identified join permits.
 */
export const metadata: Metadata = { title: "Coach portal" };

export const dynamic = "force-dynamic";

const FLAG_PANEL_LIMIT = 8;

export default async function CoachPortalPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; sort?: string }>;
}) {
  const params = await searchParams;
  const page = Number.parseInt(params.page ?? "1", 10) || 1;
  const sortDir = params.sort === "asc" ? "asc" : "desc";

  const dashboard = await loadCoachDashboard({ page, sortDir });
  const { tiles, funnel, flags, patients } = dashboard;

  const sortToggleHref = `/coach?sort=${sortDir === "desc" ? "asc" : "desc"}`;
  const pageHref = (target: number) => `/coach?sort=${sortDir}&page=${target}`;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader variant="coach" />
      <main className="flex-1 bg-pale-blue">
        <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-8 sm:px-6 sm:py-10">
          {/* Header */}
          <Card className="p-6 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold tracking-[0.14em] text-sky-blue uppercase">
                  Coach portal
                </p>
                <h1 className="mt-2 text-2xl font-semibold text-navy sm:text-3xl">
                  Your patients, tonight
                </h1>
                <p className="mt-2 text-sm text-muted">
                  {tiles.enrolled.toLocaleString("en-US")} consented patients · both doors · as
                  of {formatDay(dashboard.clockIso)} — every number below passed the consent gate
                </p>
              </div>
              <div className="flex flex-col items-start gap-2 sm:items-end">
                <TimeMachineWidget
                  simDateIso={dashboard.clockIso}
                  dayNumber={dashboard.dayNumber}
                  daysRemaining={dashboard.daysRemaining}
                />
                <ButtonLink href="/coach/import" variant="purple" size="sm">
                  Import device data
                </ButtonLink>
              </div>
            </div>
          </Card>

          {/* Funnel strip */}
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatTile label="Enrolled" value={tiles.enrolled} />
            <StatTile label="Active last 7 days" value={tiles.activeLast7} />
            <StatTile label="CPAP adherent ≥70%" value={tiles.cpapAdherent} />
            <StatTile label="Supine-predominant" value={tiles.supinePredominant} />
            <StatTile label="Linked (Lane C)" value={tiles.linked} />
          </dl>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Adherence funnel */}
            <ChartCard
              title="CPAP adherence funnel"
              subtitle="adherent = ≥4 h on ≥70% of data nights"
            >
              <AdherenceFunnel
                stages={funnel.map((stage) => ({
                  stage: stage.note ? `${stage.stage} *` : stage.stage,
                  count: stage.count,
                }))}
              />
              <p className="mt-1 text-xs text-muted">
                * {funnel[2]?.note ?? ""} at 30 days · {funnel[3]?.note ?? ""} at 90 days
              </p>
            </ChartCard>

            {/* Data-quality flags */}
            <Card className="p-5 sm:p-6">
              <h2 className="text-lg font-semibold text-navy">Data-quality flags</h2>
              <div className="mt-4 space-y-4">
                <FlagPanel
                  title="Wearable silent ≥7 nights"
                  rows={flags.wearableGaps}
                  emptyCopy="Every wearable reported within the last week."
                />
                <FlagPanel
                  title="CPAP therapy-gap streak ≥5 nights"
                  rows={flags.therapyGaps}
                  emptyCopy="No active therapy-gap streaks."
                />
                <FlagPanel
                  title="Day-30 / day-90 questionnaires overdue"
                  rows={flags.overduePros}
                  emptyCopy="All scheduled questionnaires are in."
                />
              </div>
            </Card>
          </div>

          {/* Patient list */}
          <Card className="p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-navy">Patients</h2>
              <p className="text-xs text-muted">
                {patients.total.toLocaleString("en-US")} total · page {patients.page} of{" "}
                {patients.pageCount}
              </p>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-pale-blue text-left text-xs tracking-wide text-muted uppercase">
                    <th className="py-2 pr-4 font-semibold">Participant</th>
                    <th className="py-2 pr-4 font-semibold">Enrolled</th>
                    <th className="py-2 pr-4 font-semibold">Arm</th>
                    <th className="py-2 pr-4 font-semibold">Last data</th>
                    <th className="py-2 pr-4 font-semibold">
                      <Link
                        href={sortToggleHref}
                        className="inline-flex items-center gap-1 hover:text-brand-blue"
                        title="Sort by 30-day adherence"
                      >
                        Adherence 30d {sortDir === "desc" ? "↓" : "↑"}
                      </Link>
                    </th>
                    <th className="py-2 font-semibold">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {patients.rows.map((row) => (
                    <tr
                      key={row.participantId}
                      className="border-b border-pale-blue/60 last:border-0 hover:bg-pale-blue/40"
                    >
                      <td className="py-2.5 pr-4">
                        <Link
                          href={`/participant/${row.participantId}/trends`}
                          className="font-semibold text-navy hover:text-brand-blue"
                        >
                          {row.displayName ?? shortId(row.participantId)}
                        </Link>
                        <span className="ml-2 rounded-full bg-pale-blue px-2 py-0.5 text-[10px] font-semibold text-muted uppercase">
                          {row.enrollmentTouchpoint}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 whitespace-nowrap text-muted">
                        {formatDay(row.enrollmentDateIso)}
                      </td>
                      <td className="py-2.5 pr-4 text-body">
                        {row.armBadges.length > 0 ? row.armBadges.join(" + ") : "—"}
                      </td>
                      <td className="py-2.5 pr-4 whitespace-nowrap text-muted">
                        {row.lastDataIso ? formatDay(row.lastDataIso) : "—"}
                      </td>
                      <td className="py-2.5 pr-4">
                        <AdherenceCell pct={row.adherencePct} />
                      </td>
                      <td className="py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {row.flags.length === 0 ? (
                            <span className="text-xs text-muted">—</span>
                          ) : (
                            row.flags.map((flag) => (
                              <span
                                key={flag}
                                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                  flag === "Consent revoked"
                                    ? "border border-danger/40 bg-danger/5 text-danger"
                                    : "bg-warning/10 text-warning"
                                }`}
                              >
                                {flag}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Pagination */}
            <div className="mt-4 flex items-center justify-between gap-3">
              <PageLink
                href={pageHref(patients.page - 1)}
                disabled={patients.page <= 1}
                label="← Previous"
              />
              <p className="text-xs text-muted">
                Showing {(patients.page - 1) * 25 + 1}–
                {Math.min(patients.page * 25, patients.total)} of{" "}
                {patients.total.toLocaleString("en-US")}
              </p>
              <PageLink
                href={pageHref(patients.page + 1)}
                disabled={patients.page >= patients.pageCount}
                label="Next →"
              />
            </div>
          </Card>

          <p className="pb-2 text-center text-xs text-muted">
            Dashboard queries ran in {dashboard.queryMs.toLocaleString("en-US")} ms across ~
            {(800_000).toLocaleString("en-US")} observations.
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-card bg-surface px-4 py-3.5 shadow-card">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-navy">
        {value.toLocaleString("en-US")}
      </dd>
    </div>
  );
}

function AdherenceCell({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-muted">no CPAP</span>;
  const tone =
    pct >= 70 ? "text-success" : pct >= 40 ? "text-warning" : "text-danger";
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`w-10 text-right font-semibold tabular-nums ${tone}`}>{pct}%</span>
      <span aria-hidden className="h-1.5 w-16 overflow-hidden rounded-full bg-pale-blue">
        <span
          className={`block h-full rounded-full ${
            pct >= 70 ? "bg-success" : pct >= 40 ? "bg-warning" : "bg-danger"
          }`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </span>
    </span>
  );
}

function FlagPanel({
  title,
  rows,
  emptyCopy,
}: {
  title: string;
  rows: CoachFlagRow[];
  emptyCopy: string;
}) {
  const visible = rows.slice(0, FLAG_PANEL_LIMIT);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-navy">{title}</h3>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            rows.length > 0 ? "bg-warning/10 text-warning" : "bg-success/10 text-success"
          }`}
        >
          {rows.length.toLocaleString("en-US")}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="mt-1 text-xs text-muted">{emptyCopy}</p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {visible.map((row) => (
            <li
              key={`${row.participantId}-${row.detail}`}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-card bg-pale-blue/50 px-3 py-1.5 text-xs"
            >
              <Link
                href={`/participant/${row.participantId}/trends`}
                className="font-semibold text-navy hover:text-brand-blue"
              >
                {row.displayName ?? shortId(row.participantId)}
              </Link>
              <span className="text-body">{row.detail}</span>
              <span className="text-muted">since {formatDay(row.sinceIso)}</span>
            </li>
          ))}
          {rows.length > FLAG_PANEL_LIMIT && (
            <li className="px-3 pt-0.5 text-xs text-muted">
              + {(rows.length - FLAG_PANEL_LIMIT).toLocaleString("en-US")} more
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function PageLink({
  href,
  disabled,
  label,
}: {
  href: string;
  disabled: boolean;
  label: string;
}) {
  if (disabled) {
    return <span className="text-sm font-semibold text-muted/50">{label}</span>;
  }
  return (
    <Link
      href={href}
      className="text-sm font-semibold text-brand-blue underline-offset-4 hover:underline"
    >
      {label}
    </Link>
  );
}
