import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { buttonClasses } from "@/components/Button";
import { Card } from "@/components/Card";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { TimeMachineWidget } from "@/components/TimeMachineWidget";
import { formatDay } from "@/lib/format";
import {
  DURATION_OPTIONS,
  loadProposal,
  parseProposalParams,
  PROPOSAL_PRESETS,
  type ProposalFilterKey,
} from "@/lib/partner/proposal";
import { ARM_LABELS, FIRMNESS_BAND_LABELS } from "@/lib/research/cohort";
import { MAX_SIM_DAYS, simDayNumber } from "@/lib/simclock";
import { DUA_COOKIE } from "../dua";

/** Form metadata per filter dimension (rendered only within the preset's family). */
const FILTER_SELECT_META: Record<ProposalFilterKey, { label: string; options: [string, string][] }> = {
  severity: {
    label: "OSA severity",
    options: [
      ["mild", "Mild"],
      ["moderate", "Moderate"],
      ["severe", "Severe"],
    ],
  },
  supine: {
    label: "Supine-predominant",
    options: [
      ["y", "Yes"],
      ["n", "No"],
    ],
  },
  arm: {
    label: "Treatment arm",
    options: Object.entries(ARM_LABELS) as [string, string][],
  },
  firmness: {
    label: "Firmness band",
    options: Object.entries(FIRMNESS_BAND_LABELS) as [string, string][],
  },
};

/**
 * Sponsored-study proposal generator (DEMO.md Act 7 reserve → working;
 * SPEC §12.4). DUA-gated like the dashboard. The form is a GET form — every
 * proposal is a bookmarkable URL — and the generated one-pager below it
 * carries LIVE consent-filtered cohort counts released through the
 * disclosure-control layer (audit F-12): BANDED counts (never exact),
 * complementary suppression across the whole filter lattice, approved query
 * families per research question, and a release-ledger row for every count
 * that leaves the page. Print → PDF for the one-page handout (chrome
 * stripped by the print stylesheet).
 */
export const metadata: Metadata = { title: "Study proposal" };

export const dynamic = "force-dynamic";

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

export default async function ProposalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const cookieStore = await cookies();
  if (!cookieStore.has(DUA_COOKIE)) redirect("/partner");

  const params = await searchParams;
  const inputs = parseProposalParams(params);
  const proposal = await loadProposal(inputs);
  const clockDate = new Date(`${proposal.clockIso}T00:00:00Z`);
  const dayNumber = simDayNumber(clockDate);
  const { preset, filters, durationMonths } = proposal.inputs;

  const cohortLine = [
    filters.severity ? `${filters.severity} OSA` : null,
    filters.supine === "y" ? "supine-predominant" : filters.supine === "n" ? "not supine-predominant" : null,
    filters.arm ? ARM_LABELS[filters.arm] : null,
    filters.firmness ? FIRMNESS_BAND_LABELS[filters.firmness] : null,
  ].filter(Boolean);

  return (
    <div className="flex min-h-screen flex-col">
      <div className="print:hidden">
        <SiteHeader variant="partner" />
      </div>
      <main className="flex-1 bg-cream print:bg-white">
        <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-8 sm:px-6 sm:py-10 print:max-w-none print:space-y-3 print:px-0 print:py-0">
          {/* Console header + form (screen only) */}
          <Card className="p-6 sm:p-8 print:hidden">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">
                  Partner console · sponsored-study proposal
                </p>
                <h1 className="mt-2 text-2xl font-semibold text-navy sm:text-3xl">
                  Draft a study proposal
                </h1>
                <p className="mt-2 max-w-2xl text-sm text-graphite">
                  Pick a research question from the SPEC §6.3–6.4 preset list and narrow the
                  cohort within that question’s approved query family; the one-pager below
                  fills in live consent-filtered feasibility counts — released as bands, never
                  exact — and the SPEC §12.4 price band. Print the page for the handout.
                </p>
              </div>
              <TimeMachineWidget
                simDateIso={proposal.clockIso}
                dayNumber={dayNumber}
                daysRemaining={Math.max(0, MAX_SIM_DAYS - dayNumber)}
              />
            </div>

            <form method="get" className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="block text-sm sm:col-span-2 lg:col-span-3">
                <span className="font-semibold text-navy">Research question</span>
                <select
                  name="q"
                  defaultValue={preset.key}
                  className="mt-1 w-full rounded-card border border-hairline px-3 py-1.5 text-sm focus:ring-2 focus:ring-brand focus:outline-none"
                >
                  {PROPOSAL_PRESETS.map((candidate) => (
                    <option key={candidate.key} value={candidate.key}>
                      {candidate.label}
                    </option>
                  ))}
                </select>
              </label>
              {/* Approved query family (level-up 6): only the preset's own
                  filter dimensions render — anything else is dropped at
                  parse time, so free combination exists only within the
                  family. */}
              {preset.family.filterKeys.map((key) => (
                <ProposalSelect
                  key={key}
                  name={key}
                  label={FILTER_SELECT_META[key].label}
                  value={filters[key]}
                  options={FILTER_SELECT_META[key].options}
                />
              ))}
              <label className="block text-sm">
                <span className="font-semibold text-navy">Duration</span>
                <select
                  name="dur"
                  defaultValue={String(durationMonths)}
                  className="mt-1 w-full rounded-card border border-hairline px-3 py-1.5 text-sm focus:ring-2 focus:ring-brand focus:outline-none"
                >
                  {DURATION_OPTIONS.map((months) => (
                    <option key={months} value={months}>
                      {months} months
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-end">
                <button type="submit" className={buttonClasses("primary", "sm")}>
                  Generate proposal
                </button>
              </div>
            </form>

            {/* Approved query families — the disclosure-control note */}
            <div className="mt-4 rounded-card bg-cream/60 p-4 text-xs text-graphite">
              <p className="font-semibold text-navy">
                Approved query families (SPEC §12.3 · disclosure control)
              </p>
              <p className="mt-1">
                Feasibility queries are restricted to preset families — free filter combination
                is allowed only <span className="font-semibold">within</span> a family; other
                filters are ignored. This question’s family:{" "}
                <span className="font-semibold text-navy">{preset.family.label}</span>. All
                released counts are banded (&lt;11 suppressed · 11–20 · 21–50 · 51–200 ·
                &gt;200) with complementary suppression across the whole family lattice, and
                every release is logged in the{" "}
                <Link href="/partner/releases" className="font-semibold underline underline-offset-4">
                  release ledger
                </Link>
                .
              </p>
            </div>
          </Card>

          {/* Watermark banner — kept in print on purpose */}
          <div className="rounded-card border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm text-ink print:rounded-none print:border-x-0">
            <span className="font-semibold text-warning">Illustrative — synthetic cohort.</span>{" "}
            Production proposals attach the pre-specified SAP and DUA terms (SPEC §11.2, §12.3).
          </div>

          {/* The one-page proposal */}
          <Card className="p-6 sm:p-10 print:p-0 print:shadow-none">
            <article className="mx-auto max-w-3xl print:max-w-none">
              <p className="text-xs font-semibold tracking-[0.14em] text-graphite uppercase">
                Sponsored-study proposal · sleep outcomes registry ({preset.specRef})
              </p>
              <h2 className="mt-3 font-display text-xl leading-snug font-semibold text-navy sm:text-2xl">
                {preset.question}
              </h2>
              <p className="mt-2 text-sm text-graphite">
                Prepared for the sponsoring partner under DUA · {formatDay(proposal.clockIso)}{" "}
                (simulation clock) · {durationMonths}-month engagement
              </p>

              <div className="mt-6 space-y-5">
                <section>
                  <h3 className="text-sm font-semibold tracking-wide text-navy uppercase">
                    Design
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink">{preset.design}</p>
                </section>

                <section>
                  <h3 className="text-sm font-semibold tracking-wide text-navy uppercase">
                    Cohort & live feasibility
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink">
                    Eligible cohort:{" "}
                    <span className="font-semibold text-navy">
                      {cohortLine.length > 0 ? cohortLine.join(", ") : "all research-consented participants"}
                    </span>
                    . As of {formatDay(proposal.clockIso)}, the consent-filtered research tier
                    holds{" "}
                    <span className="font-semibold text-navy tabular-nums">
                      {proposal.cohort.matched.display}
                    </span>{" "}
                    matching participants of{" "}
                    <span className="font-semibold text-navy tabular-nums">
                      {proposal.cohort.total.display}
                    </span>{" "}
                    total (counts release as bands with k &lt; {proposal.cohort.threshold}{" "}
                    suppression and complementary suppression — SPEC §12.3 + disclosure-control
                    release rules).
                    {proposal.feasibility.met !== null && (
                      <>
                        {" "}
                        The SPEC §6.3 power sketch needs ≈ {proposal.feasibility.nPerGroup} per
                        comparison group ({proposal.feasibility.required} total):{" "}
                        <span
                          className={`font-semibold ${
                            proposal.feasibility.met ? "text-success" : "text-warning"
                          }`}
                        >
                          {proposal.feasibility.met
                            ? "the released band clears that bar today"
                            : "the released band does not reach that bar yet"}
                        </span>
                        .
                      </>
                    )}
                    {proposal.feasibility.bandNote !== null && (
                      <>
                        {" "}
                        The SPEC §6.3 power sketch needs ≈ {proposal.feasibility.nPerGroup} per
                        comparison group ({proposal.feasibility.required} total):{" "}
                        <span className="font-semibold text-warning">
                          {proposal.feasibility.bandNote}
                        </span>
                        .
                      </>
                    )}
                  </p>

                  {proposal.firmnessBreakdown !== null && (
                    <div className="mt-3">
                      <p className="text-xs font-semibold tracking-wide text-graphite uppercase">
                        Matched cohort by firmness band (released bands)
                      </p>
                      <table className="mt-1.5 w-full max-w-md text-sm">
                        <tbody>
                          {proposal.firmnessBreakdown.map((row) => (
                            <tr
                              key={row.band}
                              className="border-b border-hairline/60 last:border-0"
                            >
                              <td className="py-1 pr-4 text-ink">{row.label}</td>
                              <td className="py-1 text-right font-semibold text-navy tabular-nums">
                                {row.released.display}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="mt-1 text-xs text-graphite">
                        Sub-counts come from the same audited lattice release as the totals —
                        no cell is derivable by subtraction from the numbers on this page.
                      </p>
                    </div>
                  )}
                </section>

                <section>
                  <h3 className="text-sm font-semibold tracking-wide text-navy uppercase">
                    Endpoints (SPEC §6.5)
                  </h3>
                  <p className="mt-1 text-sm text-ink">
                    <span className="font-semibold">Primary:</span> {preset.primaryEndpoint}
                  </p>
                  <ul className="mt-1 list-disc pl-5 text-sm text-ink">
                    {preset.secondaryEndpoints.map((endpoint) => (
                      <li key={endpoint}>{endpoint}</li>
                    ))}
                  </ul>
                </section>

                <section>
                  <h3 className="text-sm font-semibold tracking-wide text-navy uppercase">
                    Timeline · {durationMonths} months
                  </h3>
                  <table className="mt-2 w-full text-sm">
                    <tbody>
                      {proposal.timeline.map((phase) => (
                        <tr key={phase.phase} className="border-b border-hairline/60 last:border-0">
                          <td className="py-1.5 pr-4 font-semibold whitespace-nowrap text-navy">
                            {phase.phase}
                          </td>
                          <td className="py-1.5 pr-4 whitespace-nowrap text-ink tabular-nums">
                            {phase.months} mo
                          </td>
                          <td className="py-1.5 text-xs text-graphite">{phase.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>

                <section>
                  <h3 className="text-sm font-semibold tracking-wide text-navy uppercase">
                    Price band (SPEC §12.4)
                  </h3>
                  <p className="mt-1 text-sm text-ink">
                    <span className="font-semibold text-navy tabular-nums">
                      {usd(proposal.priceBand.min)} – {usd(proposal.priceBand.max)}
                    </span>{" "}
                    · {proposal.priceBand.basis}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-warning">
                    {proposal.honestyLine}
                  </p>
                </section>

                <section>
                  <h3 className="text-sm font-semibold tracking-wide text-navy uppercase">
                    Rules of engagement (SPEC §12.3)
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink">
                    De-identified or Limited-Data-Set access under DUA only — never identified
                    data, never raw resale. The DUA prohibits re-identification attempts, onward
                    transfer, and marketing use of participant-level data; every released cell
                    is banded with k-suppression and complementary suppression, exactly as on
                    the dashboard you just used, and every released count is recorded in the
                    release ledger.
                  </p>
                </section>
              </div>

              <p className="mt-6 border-t border-hairline pt-3 text-xs text-graphite">
                Generated {formatDay(proposal.clockIso)} (simulation clock) from live
                consent-filtered registry queries · joint venture of Sleeptopia, Inc. and The
                Mattress Hub.
              </p>
            </article>
          </Card>

          <p className="pb-2 text-center text-xs text-graphite print:hidden">
            Cohort queries ran in {proposal.queryMs.toLocaleString("en-US")} ms ·{" "}
            {proposal.releasesLogged} count release{proposal.releasesLogged === 1 ? "" : "s"}{" "}
            logged to the{" "}
            <Link href="/partner/releases" className="underline underline-offset-4">
              release ledger
            </Link>{" "}
            ·{" "}
            <Link href="/partner/dashboard" className="underline underline-offset-4">
              back to the partner dashboard
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

function ProposalSelect({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string | undefined;
  options: [string, string][];
}) {
  return (
    <label className="block text-sm">
      <span className="font-semibold text-navy">{label}</span>
      <select
        name={name}
        defaultValue={value ?? ""}
        className="mt-1 w-full rounded-card border border-hairline px-3 py-1.5 text-sm focus:ring-2 focus:ring-brand focus:outline-none"
      >
        <option value="">Any</option>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}
