import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Card } from "@/components/Card";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { listCountReleases } from "@/lib/disclosure";
import { formatDay } from "@/lib/format";
import { DUA_COOKIE } from "../dua";

/**
 * Release ledger (audit F-12, level-up 10 + level-up 6 release manifests).
 * DUA-gated like the rest of the partner console. Every count a partner
 * surface has ever released — proposal feasibility numbers, dashboard
 * tiles/tables — appears here with the surface, the canonical query, the
 * metric, and the BAND that left the system. The ledger is what the
 * differencing audit runs against: it is the complete record of what this
 * tier has disclosed.
 */
export const metadata: Metadata = { title: "Release ledger" };

export const dynamic = "force-dynamic";

const SURFACE_LABELS: Record<string, string> = {
  partner_proposal: "Proposal generator",
  partner_dashboard: "Partner dashboard",
};

const TIMESTAMP_FORMAT = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export default async function ReleaseLedgerPage() {
  const cookieStore = await cookies();
  if (!cookieStore.has(DUA_COOKIE)) redirect("/partner");

  const { entries, total } = await listCountReleases(200);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader variant="partner" />
      <main className="flex-1 bg-pale-blue">
        <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-8 sm:px-6 sm:py-10">
          {/* Header */}
          <Card className="p-6 sm:p-8">
            <p className="text-xs font-semibold tracking-[0.14em] text-sky-blue uppercase">
              Partner console · release ledger · DUA-gated
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-navy sm:text-3xl">
              Every count that ever left this tier
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted">
              {total.toLocaleString("en-US")} recorded release
              {total === 1 ? "" : "s"}. Each row is one partner-facing count release: the
              surface, the canonical query, the metric, and the band that was actually
              disclosed — never an exact count. This manifest is what the differencing audit
              (banding + complementary suppression, zero inferable cells) is checked against.{" "}
              <Link href="/partner/dashboard" className="font-semibold underline underline-offset-4">
                Back to the dashboard
              </Link>{" "}
              ·{" "}
              <Link href="/partner/proposal" className="font-semibold underline underline-offset-4">
                proposal generator
              </Link>
            </p>
          </Card>

          {/* The ledger table */}
          <Card className="p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-navy">Recorded releases</h2>
              <p className="text-xs text-muted">
                newest first · showing {Math.min(entries.length, total).toLocaleString("en-US")}{" "}
                of {total.toLocaleString("en-US")}
              </p>
            </div>
            {entries.length === 0 ? (
              <p className="mt-3 text-sm text-muted">
                No releases recorded yet — open the partner dashboard or generate a proposal,
                and every released count will appear here.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-pale-blue text-left text-xs tracking-wide text-muted uppercase">
                      <th className="py-2 pr-4 font-semibold">Released (UTC)</th>
                      <th className="py-2 pr-4 font-semibold">Sim clock</th>
                      <th className="py-2 pr-4 font-semibold">Surface</th>
                      <th className="py-2 pr-4 font-semibold">Query</th>
                      <th className="py-2 pr-4 font-semibold">Metric</th>
                      <th className="py-2 font-semibold">Band released</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr key={entry.id} className="border-b border-pale-blue/60 last:border-0">
                        <td className="py-2 pr-4 whitespace-nowrap text-muted">
                          {TIMESTAMP_FORMAT.format(entry.createdAt)}
                        </td>
                        <td className="py-2 pr-4 whitespace-nowrap text-muted">
                          {formatDay(entry.clockDate)}
                        </td>
                        <td className="py-2 pr-4 whitespace-nowrap text-body">
                          {SURFACE_LABELS[entry.surface] ?? entry.surface}
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs break-all text-muted">
                          {entry.query}
                        </td>
                        <td className="py-2 pr-4 whitespace-nowrap font-medium text-body">
                          {entry.metric}
                        </td>
                        <td className="py-2 whitespace-nowrap">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                              entry.band.includes("suppressed") ||
                              entry.band.includes("withheld")
                                ? "bg-warning/10 text-warning"
                                : "bg-pale-blue text-navy"
                            }`}
                          >
                            {entry.band}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-muted">
              Bands: &lt;11 (suppressed) · 11–20 · 21–50 · 51–200 · &gt;200 · withheld
              (complementary suppression). Exact counts never appear here because exact counts
              are never released.
            </p>
          </Card>
        </div>
      </main>
      <Footer />
    </div>
  );
}
