import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/Card";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { TimeMachineWidget } from "@/components/TimeMachineWidget";
import { TrendSparkline } from "@/components/charts/ResearchCharts";
import {
  countRowsByDataClass,
  dataClassConsentStates,
  listLinkageCandidates,
  snapshotConsentImpact,
} from "@/lib/compliance/revocation";
import {
  getConsentHistory,
  getConsentStates,
  getObservations,
  loadGrants,
  type DataClass,
} from "@/lib/consent";
import { getParticipant } from "@/lib/consent/policyRepo";
import { formatDay, shortId, toIsoDay } from "@/lib/format";
import { getLinkedDisplayNames } from "@/lib/identity";
import { getSimClock, MAX_SIM_DAYS, simDayNumber } from "@/lib/simclock";
import { addDays, MARCUS_REED_PARTICIPANT_ID } from "@/lib/synthetic/profiles";
import { RevocationConsole } from "./RevocationConsole";

/**
 * Revocation kill switch (DEMO.md Act 6 finale) — the demo control room.
 * Every panel here is a live read: consent states and audit trail from the
 * append-only ledger, rows-at-rest per data class with their gate state, the
 * identified-tier sparkline, and the cohort numbers the kill switch will
 * move. The console (client) triggers the server action and renders the
 * before/after report; refresh() re-renders these panels around it.
 */
export const metadata: Metadata = { title: "Revocation console" };

export const dynamic = "force-dynamic";

const CLASS_LABELS: Record<DataClass, string> = {
  wearable_sleep: "Wearable sleep",
  cpap_telemetry: "CPAP telemetry",
  hst_clinical: "Clinical (HST + events)",
  mattress_purchase: "Mattress purchase",
  sleep_mat: "Under-mattress sensor",
  pro_responses: "Questionnaires",
  linkage: "Record linkage",
  registry_demographics: "Registry demographics",
};

export default async function RevocationPage({
  searchParams,
}: {
  searchParams: Promise<{ participant?: string }>;
}) {
  const params = await searchParams;
  const requested = params.participant ?? MARCUS_REED_PARTICIPANT_ID;
  const exists = await getParticipant(requested);
  const id = exists ? requested : MARCUS_REED_PARTICIPANT_ID;

  const clock = await getSimClock();
  const dayNumber = simDayNumber(clock);

  // Participant picker: Marcus + a handful of Lane-C-linked participants.
  const linkedIds = await listLinkageCandidates(6);
  const candidateIds = [
    MARCUS_REED_PARTICIPANT_ID,
    ...linkedIds.filter((pid) => pid !== MARCUS_REED_PARTICIPANT_ID).slice(0, 4),
  ];
  if (!candidateIds.includes(id)) candidateIds.push(id);

  const [names, grants, states, history, atRest, snapshot, classStates] = await Promise.all([
    getLinkedDisplayNames([...candidateIds, id]),
    loadGrants(id),
    getConsentStates(id),
    getConsentHistory(id),
    countRowsByDataClass(id),
    snapshotConsentImpact(id),
    dataClassConsentStates(id),
  ]);

  // Identified-tier sparkline: last 30 nights of sleep efficiency.
  const sparkRead = await getObservations(id, {
    use: "view_identified",
    grants,
    concepts: ["sleep_efficiency"],
    from: addDays(clock, -30),
    to: clock,
  });
  const sparkPoints = sparkRead.data.map((obs) => ({
    day: toIsoDay(obs.effectiveDate),
    value: obs.valueNumeric,
  }));

  const label = names.get(id) ?? shortId(id);
  const rowCounts = atRest.rows;
  const totalRows = rowCounts.reduce((sum, row) => sum + row.rows, 0) + atRest.unclassifiedRows;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader variant="compliance" />
      <main className="flex-1 bg-cream">
        <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-8 sm:px-6 sm:py-10">
          {/* Header + picker */}
          <Card className="p-6 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold tracking-[0.14em] text-lake uppercase">
                  Compliance · revocation kill switch
                </p>
                <h1 className="mt-2 text-2xl font-semibold text-navy sm:text-3xl">
                  Consent enforcement, live: {label}
                </h1>
                <p className="mt-2 max-w-2xl text-sm text-graphite">
                  Not a slide — the button below revokes real consent records, and every gate in
                  the system re-checks them: ingest throws, reads block, cohort counts drop.
                  Reversible for the next demo run; the ledger keeps it all.
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {candidateIds.map((pid) => (
                    <Link
                      key={pid}
                      href={`/compliance/revocation?participant=${pid}`}
                      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                        pid === id
                          ? "bg-lake text-white"
                          : "bg-cream text-navy hover:bg-hairline"
                      }`}
                    >
                      {names.get(pid) ?? shortId(pid)}
                    </Link>
                  ))}
                </div>
              </div>
              <TimeMachineWidget
                simDateIso={toIsoDay(clock)}
                dayNumber={dayNumber}
                daysRemaining={Math.max(0, MAX_SIM_DAYS - dayNumber)}
              />
            </div>
          </Card>

          {/* Live state: consents / rows / trend */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-5">
              <h2 className="text-sm font-semibold tracking-wide text-graphite uppercase">
                Consent states now
              </h2>
              <ul className="mt-3 space-y-2">
                {states.length === 0 && <li className="text-sm text-graphite">No records.</li>}
                {states.map((state) => (
                  <li key={state.instrumentType} className="flex items-center gap-2 text-sm">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        state.status === "granted"
                          ? "bg-success/10 text-success"
                          : "bg-danger/10 text-danger"
                      }`}
                    >
                      {state.status}
                    </span>
                    <span className="font-semibold text-navy">{state.instrumentType}</span>
                    <span className="text-xs text-graphite">
                      {state.historyCount} record{state.historyCount === 1 ? "" : "s"}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-graphite">
                In the research mart: {snapshot.researchDataClasses.length} data classes exported ·
                flagship cohort membership{" "}
                {snapshot.positionalCohortCount > 0 ? "counted" : "n/a"} — see before/after on
                revoke.
              </p>
            </Card>

            <Card className="p-5">
              <h2 className="text-sm font-semibold tracking-wide text-graphite uppercase">
                Rows at rest · {totalRows.toLocaleString("en-US")} total
              </h2>
              <table className="mt-3 w-full text-sm">
                <tbody>
                  {rowCounts.map((row) => (
                    <tr key={row.dataClass} className="border-b border-hairline/60 last:border-0">
                      <td className="py-1.5 pr-2 text-ink">{CLASS_LABELS[row.dataClass]}</td>
                      <td className="py-1.5 pr-2 text-right font-semibold tabular-nums text-navy">
                        {row.rows.toLocaleString("en-US")}
                      </td>
                      <td className="py-1.5 text-right">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            row.viewIdentified
                              ? "bg-success/10 text-success"
                              : "bg-danger/10 text-danger"
                          }`}
                        >
                          {row.viewIdentified ? "readable" : "quarantined"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {atRest.unclassifiedRows > 0 && (
                <p className="mt-2 text-xs font-semibold text-danger">
                  {atRest.unclassifiedRows.toLocaleString("en-US")} row(s) have no known data
                  class — quarantined, never readable (fail closed).
                </p>
              )}
              <p className="mt-2 text-xs text-graphite">
                Revocation never deletes rows — it seals them behind the read gates.
              </p>
            </Card>

            <Card className="p-5">
              <h2 className="text-sm font-semibold tracking-wide text-graphite uppercase">
                Sleep efficiency · last 30 nights
              </h2>
              {sparkRead.blocked ? (
                <div className="mt-3 rounded-card bg-danger/5 px-3 py-2">
                  <span className="rounded-full border border-danger/40 bg-danger/5 px-2.5 py-0.5 text-xs font-semibold text-danger">
                    Blocked: read gate refused wearable data
                  </span>
                </div>
              ) : sparkPoints.length === 0 ? (
                <p className="mt-3 text-sm text-graphite">No nights in the window.</p>
              ) : (
                <div className="mt-2">
                  <TrendSparkline points={sparkPoints} unit="%" />
                </div>
              )}
              <p className="mt-2 text-xs text-graphite">
                Identified-tier read (view_identified) — this panel goes red the moment consent is
                revoked.{" "}
                <Link
                  href={`/participant/${id}/trends`}
                  className="font-semibold underline underline-offset-4"
                >
                  Full trends →
                </Link>
              </p>
            </Card>
          </div>

          {/* The kill switch */}
          <Card className="border border-danger/30 p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-navy">The kill switch</h2>
            <p className="mt-1 mb-4 text-sm text-graphite">
              Revokes Lane A, B and C in one stroke — or just one data class from the grid —
              then re-probes every gate and recounts the cohorts: before and after, on one
              screen.
            </p>
            <RevocationConsole
              participantId={id}
              displayLabel={label}
              classStates={classStates.map((state) => ({
                dataClass: state.dataClass,
                label: CLASS_LABELS[state.dataClass],
                state: state.state,
                revisable: state.revisableInstruments.length > 0,
              }))}
            />
          </Card>

          {/* Audit trail */}
          <Card className="p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-navy">
                Audit trail · immutable consent event ledger
              </h2>
              <p className="text-xs text-graphite">
                {history.length} event{history.length === 1 ? "" : "s"} — every grant,
                revocation and scope revision is a NEW record; nothing is ever updated or
                deleted
              </p>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-hairline text-left text-xs tracking-wide text-graphite uppercase">
                    <th className="py-2 pr-4 font-semibold">#</th>
                    <th className="py-2 pr-4 font-semibold">Instrument</th>
                    <th className="py-2 pr-4 font-semibold">Event</th>
                    <th className="py-2 pr-4 font-semibold">Version</th>
                    <th className="py-2 pr-4 font-semibold">Granted</th>
                    <th className="py-2 pr-4 font-semibold">Revoked</th>
                    <th className="py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((record, index) => (
                    <tr key={record.id} className="border-b border-hairline/60 last:border-0">
                      <td className="py-2 pr-4 tabular-nums text-graphite">{index + 1}</td>
                      <td className="py-2 pr-4 font-semibold text-navy">
                        {record.instrumentType}
                        <span className="ml-1 text-xs font-normal text-graphite">
                          r{record.revision}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-graphite">
                        {record.eventType.replace(/_/g, " ")}
                      </td>
                      <td className="py-2 pr-4 text-graphite">{record.instrumentVersion}</td>
                      <td className="py-2 pr-4 whitespace-nowrap text-ink">
                        {formatDay(record.grantedAt)}
                      </td>
                      <td className="py-2 pr-4 whitespace-nowrap text-ink">
                        {record.revokedAt ? formatDay(record.revokedAt) : "—"}
                      </td>
                      <td className="py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            record.status === "granted"
                              ? "bg-success/10 text-success"
                              : "bg-danger/10 text-danger"
                          }`}
                        >
                          {record.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <p className="pb-2 text-center text-xs text-graphite">
            Watch the numbers move elsewhere too:{" "}
            <Link href="/coach" className="underline underline-offset-4">
              coach portal
            </Link>{" "}
            ·{" "}
            <Link href="/research" className="underline underline-offset-4">
              cohort explorer
            </Link>{" "}
            ·{" "}
            <Link href="/research/positional" className="underline underline-offset-4">
              flagship dashboard
            </Link>
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
