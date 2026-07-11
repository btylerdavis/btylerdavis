import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/Button";
import { Card } from "@/components/Card";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { TimeMachineWidget } from "@/components/TimeMachineWidget";
import { getConsentStates, getLinkedProfile, loadGrants } from "@/lib/consent";
import { getParticipant } from "@/lib/consent/policyRepo";
import {
  ageBandFromYearOfBirth,
  buildSuppressedTable,
  pseudonym,
  shiftDate,
  SMALL_CELL_THRESHOLD,
} from "@/lib/deid";
import { formatDay, toIsoDay } from "@/lib/format";
import { loadResearchCohort } from "@/lib/research/cohort";
import { MAX_SIM_DAYS, simDayNumber } from "@/lib/simclock";
import { MARCUS_REED_PARTICIPANT_ID } from "@/lib/synthetic/profiles";

/**
 * De-identification demo (DEMO.md Act 6): the same record, twice. The left
 * card reads through identified-tier gates (view_identified + Lane C join);
 * the right card reads through research-tier gates (research_deid) and then
 * a REAL de-id transform — per-participant deterministic date shift,
 * pseudonym, 5-year age band, identifiers dropped. Below: small-cell
 * suppression on cohort counts, and the mart CSV extract.
 */
export const metadata: Metadata = { title: "De-identification" };

export const dynamic = "force-dynamic";

const SEVERITY_ORDER = ["mild", "moderate", "severe"];
const DAY_MS = 86_400_000;

export default async function DeidDemoPage() {
  const id = MARCUS_REED_PARTICIPANT_ID;
  const [participant, grants, cohort] = await Promise.all([
    getParticipant(id),
    loadGrants(id),
    loadResearchCohort(),
  ]);
  const [identified, research, consents] = await Promise.all([
    getLinkedProfile(id, { use: "view_identified", grants }),
    getLinkedProfile(id, { use: "research_deid", grants }),
    getConsentStates(id),
  ]);

  const clockIso = toIsoDay(cohort.clock);
  const dayNumber = simDayNumber(cohort.clock);

  // --- identified-tier facts --------------------------------------------------
  const enrollment = participant?.createdAt ?? null;
  const hstDate =
    identified.clinical?.hstObservations.find((obs) => obs.concept === "ahi")?.effectiveDate ??
    null;
  const ahi =
    identified.clinical?.hstObservations.find((obs) => obs.concept === "ahi")?.valueNumeric ??
    null;
  const supineAhi =
    identified.clinical?.hstObservations.find((obs) => obs.concept === "supine_ahi")
      ?.valueNumeric ?? null;
  const purchase = identified.retail?.mattressPurchases[0] ?? null;

  // --- research-tier facts, through the deid transform -------------------------
  const rHst =
    research.clinical?.hstObservations.find((obs) => obs.concept === "ahi") ?? null;
  const rPurchase = research.retail?.mattressPurchases[0] ?? null;
  const shiftedEnrollment = enrollment ? shiftDate(id, enrollment) : null;
  const shiftedHst = rHst ? shiftDate(id, rHst.effectiveDate) : null;
  const shiftedDelivery = rPurchase?.deliveryDate ? shiftDate(id, rPurchase.deliveryDate) : null;

  const intervalDays = (a: Date | null, b: Date | null) =>
    a && b ? Math.round((b.getTime() - a.getTime()) / DAY_MS) : null;
  const hstInterval = intervalDays(enrollment, hstDate);
  const shiftedHstInterval = intervalDays(shiftedEnrollment, shiftedHst);

  // --- suppression demo: brand × severity over the research cohort ------------
  const suppression = buildSuppressedTable(
    cohort.members
      .filter((member) => member.brand !== null && member.severity !== null)
      .map((member) => ({ row: member.brand as string, col: member.severity as string })),
    { colKeys: SEVERITY_ORDER }
  );

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
                  Research · de-identification (SPEC §4.4)
                </p>
                <h1 className="mt-2 text-2xl font-semibold text-navy sm:text-3xl">
                  One record, two tiers
                </h1>
                <p className="mt-2 max-w-2xl text-sm text-muted">
                  The identified tier powers care and per-participant features; the research mart
                  is produced by a governed pipeline — per-participant date shift (constant, so
                  intervals survive), pseudonyms, 5-year age bands, identifiers dropped, small
                  cells suppressed. Both sides below are live reads through their tier&apos;s
                  consent gate.
                </p>
              </div>
              <TimeMachineWidget
                simDateIso={clockIso}
                dayNumber={dayNumber}
                daysRemaining={Math.max(0, MAX_SIM_DAYS - dayNumber)}
              />
            </div>
          </Card>

          {/* Side by side */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Identified tier */}
            <Card className="p-5 sm:p-6">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold text-navy">Identified tier</h2>
                <span className="rounded-full bg-hero-navy px-2.5 py-0.5 text-[11px] font-semibold text-white">
                  view_identified · Lane C join
                </span>
              </div>
              {identified.blocked ? (
                <BlockedNote reason={identified.blockedReason} />
              ) : (
                <dl className="mt-4 space-y-2.5 text-sm">
                  <Field label="Name" value={identified.identity?.displayName ?? "—"} strong />
                  <Field label="Email" value={identified.identity?.email ?? "—"} />
                  <Field label="Location" value="Wichita, KS 67211 (demo-static)" />
                  <Field
                    label="Born"
                    value={
                      participant
                        ? `${participant.yearOfBirth} · age ${
                            cohort.clock.getUTCFullYear() - participant.yearOfBirth
                          } · ${participant.sex}`
                        : "—"
                    }
                  />
                  <Field
                    label="Enrolled"
                    value={
                      enrollment
                        ? `${formatDay(enrollment)} · ${participant?.enrollmentTouchpoint} door`
                        : "—"
                    }
                    highlight
                  />
                  <Field
                    label="HST study"
                    value={
                      hstDate
                        ? `${formatDay(hstDate)} · AHI ${ahi ?? "—"} · supine AHI ${supineAhi ?? "—"}`
                        : "—"
                    }
                    highlight
                  />
                  <Field
                    label="Mattress"
                    value={
                      purchase
                        ? `${purchase.brand} ${purchase.model} · delivered ${
                            purchase.deliveryDate ? formatDay(purchase.deliveryDate) : "—"
                          }`
                        : "—"
                    }
                    highlight
                  />
                  <Field
                    label="Consents"
                    value={consents
                      .map((state) => `${state.instrumentType}: ${state.status}`)
                      .join(" · ")}
                  />
                </dl>
              )}
              {hstInterval !== null && (
                <IntervalChip label={`HST +${hstInterval} days after enrollment`} />
              )}
            </Card>

            {/* Research tier */}
            <Card className="p-5 sm:p-6">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold text-navy">Research tier (de-identified)</h2>
                <span className="rounded-full bg-brand-blue px-2.5 py-0.5 text-[11px] font-semibold text-white">
                  research_deid · transformed
                </span>
              </div>
              {research.blocked ? (
                <BlockedNote reason={research.blockedReason} />
              ) : (
                <dl className="mt-4 space-y-2.5 text-sm">
                  <Field label="Pseudonym" value={pseudonym(id)} strong />
                  <Field label="Email" value="dropped" muted />
                  <Field label="Location" value="Kansas (state only)" />
                  <Field
                    label="Age band"
                    value={
                      participant
                        ? `${ageBandFromYearOfBirth(participant.yearOfBirth, cohort.clock)} · ${participant.sex}`
                        : "—"
                    }
                  />
                  <Field
                    label="Enrolled"
                    value={
                      shiftedEnrollment
                        ? `${formatDay(shiftedEnrollment)} · ${participant?.enrollmentTouchpoint} door`
                        : "—"
                    }
                    highlight
                  />
                  <Field
                    label="HST study"
                    value={
                      shiftedHst
                        ? `${formatDay(shiftedHst)} · AHI ${rHst?.valueNumeric ?? "—"} · supine AHI ${
                            research.clinical?.hstObservations.find(
                              (obs) => obs.concept === "supine_ahi"
                            )?.valueNumeric ?? "—"
                          }`
                        : "—"
                    }
                    highlight
                  />
                  <Field
                    label="Mattress"
                    value={
                      rPurchase
                        ? `${rPurchase.brand} · firmness ${rPurchase.firmnessRating}/10 · delivered ${
                            shiftedDelivery ? formatDay(shiftedDelivery) : "—"
                          }`
                        : "—"
                    }
                    highlight
                  />
                  <Field label="Consents" value="not exported to this tier" muted />
                </dl>
              )}
              {shiftedHstInterval !== null && (
                <IntervalChip
                  label={`HST +${shiftedHstInterval} days after enrollment — interval preserved`}
                />
              )}
              <p className="mt-3 text-xs text-muted">
                Every date above is shifted by a constant, per-participant offset within ±30 days
                (deterministic, seeded from the participant — never disclosed). Highlighted rows
                differ from the identified card; the intervals between them do not.
              </p>
            </Card>
          </div>

          {/* Small-cell suppression */}
          <Card className="p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-navy">
                Small-cell suppression · cohort counts by brand × severity
              </h2>
              <p className="text-xs text-muted">
                cells with 1–{SMALL_CELL_THRESHOLD - 1} participants are withheld —{" "}
                {suppression.suppressedCellCount} suppressed below
              </p>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-pale-blue text-left text-xs tracking-wide text-muted uppercase">
                    <th className="py-2 pr-4 font-semibold">Brand</th>
                    {suppression.colKeys.map((col) => (
                      <th key={col} className="py-2 pr-4 font-semibold">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {suppression.rowKeys.map((row) => (
                    <tr key={row} className="border-b border-pale-blue/60 last:border-0">
                      <td className="py-2 pr-4 font-semibold text-navy">{row}</td>
                      {suppression.colKeys.map((col) => {
                        const cell = suppression.cells[row][col];
                        return (
                          <td key={col} className="py-2 pr-4 tabular-nums">
                            {cell.suppressed ? (
                              <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">
                                {cell.display}
                              </span>
                            ) : (
                              cell.display
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Mart extract */}
          <Card tone="dark" className="p-6 sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">Research extract — the mart moment</h2>
                <p className="mt-1 max-w-xl text-sm text-white/75">
                  The full extract is <span className="font-semibold text-white">de-identified
                  row-level microdata</span> — one row per research-consented participant
                  (pseudonym, age band, shifted dates, exposure and outcome rollups). Row-level
                  data leaves only under a signed DUA: the download is gated on the partner DUA
                  acknowledgement and redirects to /partner to sign first. The aggregate
                  brand × severity table above is the published-table release — small cells
                  suppressed, no DUA needed. The OMOP bundle is the registry-standard cut of
                  the same mart: PERSON, OBSERVATION_PERIOD, MEASUREMENT and DEVICE_EXPOSURE
                  CSVs per TECHNICAL.md §T2.5, zipped, same DUA gate.
                </p>
              </div>
              <div className="flex flex-col items-stretch gap-2">
                <ButtonLink href="/research/deid/export" size="lg">
                  Export row-level extract (CSV · DUA required)
                </ButtonLink>
                <ButtonLink href="/research/deid/export/omop" variant="outline">
                  Export OMOP bundle (ZIP · DUA required)
                </ButtonLink>
                <ButtonLink href="/research/deid/export/aggregate" variant="purple">
                  Export aggregate table (CSV · suppressed)
                </ButtonLink>
              </div>
            </div>
          </Card>

          <p className="pb-2 text-center text-xs text-muted">
            Cohort queries ran in {cohort.queryMs.toLocaleString("en-US")} ms · production adds
            Expert Determination sign-off and a purchased re-identification risk assessment (SPEC
            §4.4) ·{" "}
            <Link href="/compliance/revocation" className="underline underline-offset-4">
              see the revocation kill switch
            </Link>
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function Field({
  label,
  value,
  strong = false,
  muted = false,
  highlight = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className={`flex gap-3 ${highlight ? "rounded-card bg-pale-blue/50 px-2 py-1 -mx-2" : ""}`}>
      <dt className="w-24 shrink-0 text-xs font-semibold tracking-wide text-muted uppercase leading-5">
        {label}
      </dt>
      <dd
        className={
          strong
            ? "font-semibold text-navy"
            : muted
              ? "text-muted italic"
              : "text-body"
        }
      >
        {value}
      </dd>
    </div>
  );
}

function IntervalChip({ label }: { label: string }) {
  return (
    <p className="mt-3">
      <span className="rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">
        {label}
      </span>
    </p>
  );
}

function BlockedNote({ reason }: { reason?: string }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-card bg-danger/5 px-4 py-3">
      <span className="rounded-full border border-danger/40 bg-danger/5 px-2.5 py-0.5 text-xs font-semibold text-danger">
        Blocked
      </span>
      <p className="text-sm text-body">
        {reason ?? "No current consent covers this read — the gate refused it."}
      </p>
    </div>
  );
}
