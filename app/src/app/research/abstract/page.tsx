import Link from "next/link";
import { Card } from "@/components/Card";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { TimeMachineWidget } from "@/components/TimeMachineWidget";
import { formatDay } from "@/lib/format";
import { loadMockAbstract } from "@/lib/research/abstract";
import { MAX_SIM_DAYS, simDayNumber } from "@/lib/simclock";
import { CopyAbstractButton } from "./CopyAbstractButton";

/**
 * Mock conference abstract (DEMO.md Act 7 — research output), AASM SLEEP
 * style. The Results numbers are live queries against the consent-filtered
 * research cohort: advance the time machine and the abstract changes. The
 * print stylesheet (Tailwind print: variants) strips the chrome so the
 * browser's Print → PDF produces a clean one-pager, watermark included.
 */
export const dynamic = "force-dynamic";

export default async function AbstractPage() {
  const abstract = await loadMockAbstract();
  const clockDate = new Date(`${abstract.clockIso}T00:00:00Z`);
  const dayNumber = simDayNumber(clockDate);

  return (
    <div className="flex min-h-screen flex-col">
      <div className="print:hidden">
        <SiteHeader variant="research" />
      </div>
      <main className="flex-1 bg-pale-blue print:bg-white">
        <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-8 sm:px-6 sm:py-10 print:max-w-none print:space-y-3 print:px-0 print:py-0">
          {/* Console header (screen only) */}
          <Card className="p-6 sm:p-8 print:hidden">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold tracking-[0.14em] text-sky-blue uppercase">
                  Research · publication ladder, rung 1 (SPEC §11.1)
                </p>
                <h1 className="mt-2 text-2xl font-semibold text-navy sm:text-3xl">
                  Conference abstract, auto-populated
                </h1>
                <p className="mt-2 max-w-2xl text-sm text-muted">
                  AASM SLEEP-style structure; every number in Results is a live query against
                  the consent-filtered research cohort as of {formatDay(abstract.clockIso)}.
                  Print this page for the one-pager.
                </p>
              </div>
              <div className="flex flex-col items-start gap-2 sm:items-end">
                <TimeMachineWidget
                  simDateIso={abstract.clockIso}
                  dayNumber={dayNumber}
                  daysRemaining={Math.max(0, MAX_SIM_DAYS - dayNumber)}
                />
                <CopyAbstractButton text={abstract.plainText} />
              </div>
            </div>
          </Card>

          {/* Watermark banner — kept in print on purpose */}
          <div className="rounded-card border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm text-body print:rounded-none print:border-x-0">
            <span className="font-semibold text-warning">Illustrative — synthetic cohort.</span>{" "}
            Production abstracts follow the SAP + authorship policy (SPEC §11).
          </div>

          {/* The abstract itself */}
          <Card className="p-6 sm:p-10 print:p-0 print:shadow-none">
            <article className="mx-auto max-w-2xl print:max-w-none">
              <p className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
                Abstract · sleep epidemiology — registries &amp; real-world data
              </p>
              <h2 className="mt-3 font-heading text-xl leading-snug font-semibold text-navy sm:text-2xl">
                {abstract.title}
              </h2>
              <p className="mt-3 text-sm font-semibold text-body">{abstract.authors}</p>
              <p className="text-sm text-muted italic">{abstract.affiliations}</p>

              <div className="mt-6 space-y-4">
                {abstract.sections.map((section) => (
                  <section key={section.heading}>
                    <h3 className="text-sm font-semibold tracking-wide text-navy uppercase">
                      {section.heading}
                    </h3>
                    <p className="mt-1 text-sm leading-relaxed text-body">{section.text}</p>
                  </section>
                ))}
              </div>

              <p className="mt-6 border-t border-pale-blue pt-3 text-xs text-muted">
                Support: joint venture of Sleeptopia, Inc. and The Mattress Hub. Registry data
                are consent-provenanced; analyses use the de-identified research tier under
                per-data-class scopes. Generated {formatDay(abstract.clockIso)} (simulation
                clock) from {abstract.stats.cohortN.toLocaleString("en-US")} consented
                participants.
              </p>
            </article>
          </Card>

          <p className="pb-2 text-center text-xs text-muted print:hidden">
            Cohort queries ran in {abstract.queryMs.toLocaleString("en-US")} ms · numbers refresh
            with the time machine ·{" "}
            <Link href="/research/positional" className="underline underline-offset-4">
              the dashboard behind these numbers
            </Link>
          </p>
        </div>
      </main>
      <div className="print:hidden">
        <Footer />
      </div>
    </div>
  );
}
