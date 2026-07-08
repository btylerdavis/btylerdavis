import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/Card";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { TimeMachineWidget } from "@/components/TimeMachineWidget";
import { formatDay } from "@/lib/format";
import {
  filterGroups,
  filtersHref,
  loadExplorer,
  parseFilters,
  patchedHref,
  type OutcomeSummary,
} from "@/lib/research/explorer";
import { MAX_SIM_DAYS, simDayNumber } from "@/lib/simclock";
import { MATTRESS_CATALOG } from "@/lib/synthetic/catalog";

/**
 * Cohort explorer (DEMO.md Act 5) — server-rendered, URL-param filtered.
 * Every filter change is a link navigation, so any cohort is a bookmarkable
 * URL (the demo script pre-stages its cohorts as bookmarks). All aggregates
 * come from the consent-filtered research tier (use "research_deid"): a
 * revoked participant vanishes from every number on this page.
 */
export const metadata: Metadata = { title: "Cohort explorer" };

export const dynamic = "force-dynamic";

export default async function ResearchExplorerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters = parseFilters(params);
  const result = await loadExplorer(filters);

  const brands = [...new Set(MATTRESS_CATALOG.map((entry) => entry.brand))].sort();
  const groups = filterGroups(brands);
  const activeFilterCount = Object.keys(filters).length;
  const clockDate = new Date(`${result.clockIso}T00:00:00Z`);
  const dayNumber = simDayNumber(clockDate);

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
                  Research · cohort explorer
                </p>
                <h1 className="mt-2 text-2xl font-semibold text-navy sm:text-3xl">
                  <span className="tabular-nums">{result.matched.toLocaleString("en-US")}</span>{" "}
                  of {result.cohortTotal.toLocaleString("en-US")} research-consented
                  participants match
                </h1>
                <p className="mt-2 text-sm text-muted">
                  De-identified tier (research_deid) as of {formatDay(result.clockIso)} · consent
                  filtering applies to every count — a revoked participant vanishes from this page
                </p>
              </div>
              <TimeMachineWidget
                simDateIso={result.clockIso}
                dayNumber={dayNumber}
                daysRemaining={Math.max(0, MAX_SIM_DAYS - dayNumber)}
              />
            </div>
          </Card>

          {/* Filters */}
          <Card className="p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-navy">Filters</h2>
              <p className="text-xs text-muted">
                Filters live in the URL — every cohort is a shareable, bookmarkable link.
                {activeFilterCount > 0 && (
                  <>
                    {" "}
                    <Link
                      href={filtersHref({})}
                      className="font-semibold text-brand-blue underline-offset-4 hover:underline"
                    >
                      Clear all ({activeFilterCount})
                    </Link>
                  </>
                )}
              </p>
            </div>
            <div className="mt-4 space-y-3">
              {groups.map((group) => (
                <div key={group.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
                  <span className="w-36 shrink-0 text-xs font-semibold tracking-wide text-muted uppercase">
                    {group.label}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {group.options.map((option) => (
                      <FilterPill
                        key={option.label}
                        href={patchedHref(filters, group.key, option.value)}
                        active={filters[group.key] === option.value}
                        label={option.label}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Outcome summary over the filtered cohort */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <OutcomeCard
              title="ESS change · baseline → day 90"
              summary={result.outcomes.essChange90}
              unit=" pts"
              goodWhen="negative"
              subtitle="Epworth Sleepiness Scale; negative = less sleepy"
            />
            <OutcomeCard
              title="CPAP adherence"
              summary={result.outcomes.cpapAdherencePct}
              unit="%"
              goodWhen="neutral"
              subtitle="% of post-setup nights ≥ 4 h, mean per participant"
            />
            <OutcomeCard
              title="Supine time · pre → post mattress"
              summary={result.outcomes.supineChange}
              unit=" pp"
              goodWhen="negative"
              subtitle="under-mattress sensor, where a mattress was delivered"
            />
            <OutcomeCard
              title="Sleep-efficiency change"
              summary={result.outcomes.seffChange}
              unit=" pp"
              goodWhen="positive"
              subtitle="wearable; first 2 weeks vs days 76–90"
            />
          </div>

          <p className="pb-2 text-center text-xs text-muted">
            Cohort queries ran in {result.queryMs.toLocaleString("en-US")} ms across ~
            {(800_000).toLocaleString("en-US")} observations · deep-dive:{" "}
            <Link href="/research/positional" className="underline underline-offset-4">
              positional-OSA flagship dashboard
            </Link>
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function FilterPill({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
        active
          ? "bg-brand-blue text-white"
          : "bg-pale-blue text-navy hover:bg-utility-bar"
      }`}
    >
      {label}
    </Link>
  );
}

function OutcomeCard({
  title,
  summary,
  unit,
  goodWhen,
  subtitle,
}: {
  title: string;
  summary: OutcomeSummary;
  unit: string;
  goodWhen: "negative" | "positive" | "neutral";
  subtitle: string;
}) {
  const { mean, n } = summary;
  let tone = "text-navy";
  if (mean !== null && goodWhen !== "neutral") {
    const improving = goodWhen === "negative" ? mean < 0 : mean > 0;
    tone = improving ? "text-success" : "text-danger";
  }
  return (
    <Card className="p-5">
      <p className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</p>
      <p className={`mt-2 text-3xl font-semibold tabular-nums ${tone}`}>
        {mean === null ? "—" : `${mean > 0 ? "+" : mean < 0 ? "−" : ""}${Math.abs(mean).toFixed(1)}${unit}`}
      </p>
      <p className="mt-1 text-xs text-muted">
        {n > 0 ? `n = ${n.toLocaleString("en-US")} with data · ` : "no participants with data · "}
        {subtitle}
      </p>
    </Card>
  );
}
