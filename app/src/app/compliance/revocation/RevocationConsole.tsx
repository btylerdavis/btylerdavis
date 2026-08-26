"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/Button";
import type { RevocationReport } from "@/lib/compliance/revocation";
import {
  restoreAllAction,
  restoreClassAction,
  revokeAllAction,
  revokeClassAction,
  type RevocationOutcome,
} from "./actions";

/**
 * The kill-switch console (client): the danger button appends revoke events
 * for every consent server-side, and the returned report renders before →
 * after on one screen — cohort counts dropping, ingest gates throwing, read
 * gates blocking. The purple button is the demo-only reset: it restores via
 * NEW ceiling-bounded events, so the audit trail (server-rendered below)
 * keeps the whole story.
 *
 * The per-data-class grid is the partial-revocation console: each toggle
 * revises ONE class across every covering instrument — new scope-revision
 * events, compare-and-swapped, same immutable ledger, same live report.
 * Three states per class (audit F-02): granted / revoked / never authorized
 * — a never-signed class cannot be "restored"; it needs the participant-
 * facing re-consent flow.
 */

export interface ClassToggleState {
  dataClass: string;
  label: string;
  state: "granted" | "revoked" | "never_authorized";
  /** false when no currently-granted instrument's signed scope covers this class */
  revisable: boolean;
}

export function RevocationConsole({
  participantId,
  displayLabel,
  classStates,
}: {
  participantId: string;
  displayLabel: string;
  classStates: ClassToggleState[];
}) {
  const [pending, startTransition] = useTransition();
  const [report, setReport] = useState<RevocationReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (action: () => Promise<RevocationOutcome>) => {
    setError(null);
    startTransition(async () => {
      const outcome = await action();
      if (!outcome.ok) {
        setError(outcome.error);
        return;
      }
      setReport(outcome);
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="danger"
          size="lg"
          disabled={pending}
          onClick={() => run(() => revokeAllAction(participantId))}
        >
          {pending ? "Working…" : `Revoke all consents — ${displayLabel}`}
        </Button>
        <Button
          variant="navy"
          disabled={pending}
          onClick={() => run(() => restoreAllAction(participantId))}
        >
          Restore consents (demo reset)
        </Button>
        {error && <span className="text-sm font-semibold text-danger">{error}</span>}
      </div>
      <p className="text-xs text-graphite">
        Every change is a <span className="font-semibold">new immutable event</span> — nothing
        is ever updated or deleted. Restore re-enables only what was{" "}
        <span className="font-semibold">signed</span> (the authorized ceiling); the audit trail
        below keeps every step forever.
      </p>

      {/* Partial revocation: per-data-class toggle grid */}
      <div className="rounded-card border border-hairline bg-cream/40 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-navy">
            Partial revocation · per data class
          </h3>
          <p className="text-xs text-graphite">
            each toggle appends a scope-revised record — only that class blocks, the rest keeps
            flowing
          </p>
        </div>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {classStates.map((state) => (
            <li
              key={state.dataClass}
              className="flex items-center justify-between gap-2 rounded-card bg-white px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    state.state === "granted"
                      ? "bg-success/10 text-success"
                      : state.state === "revoked"
                        ? "bg-danger/10 text-danger"
                        : "bg-cream text-graphite"
                  }`}
                >
                  {state.state === "never_authorized" ? "never authorized" : state.state}
                </span>
                <span className="truncate text-sm font-semibold text-navy">{state.label}</span>
              </div>
              {state.state === "granted" ? (
                <Button
                  size="sm"
                  variant="danger"
                  disabled={pending}
                  onClick={() => run(() => revokeClassAction(participantId, state.dataClass))}
                >
                  Revoke
                </Button>
              ) : state.state === "revoked" ? (
                state.revisable ? (
                  <Button
                    size="sm"
                    variant="navy"
                    disabled={pending}
                    onClick={() => run(() => restoreClassAction(participantId, state.dataClass))}
                  >
                    Restore
                  </Button>
                ) : (
                  <span className="text-[11px] text-graphite">no granted instrument</span>
                )
              ) : (
                <a
                  href={`/participant/${participantId}/reconsent`}
                  className="text-[11px] font-semibold text-lake underline underline-offset-2"
                >
                  requires re-consent →
                </a>
              )}
            </li>
          ))}
        </ul>
      </div>

      {report && <ReportPanel report={report} />}
    </div>
  );
}

function ReportPanel({ report }: { report: RevocationReport }) {
  const revoked = report.action === "revoke";
  const changeTone = revoked ? "text-danger" : "text-success";
  return (
    <div
      className={`rounded-card border p-4 ${
        revoked ? "border-danger/40 bg-danger/5" : "border-lake/40 bg-lake/5"
      }`}
    >
      <p className="text-sm font-semibold text-navy">
        {revoked ? "Revoked" : "Restored"}
        {report.dataClass ? (
          <>
            {" "}
            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-navy">
              {report.dataClass}
            </span>{" "}
            across
          </>
        ) : (
          ":"
        )}{" "}
        {report.instruments.length > 0 ? report.instruments.join(", ") : "nothing to change"} —
        enforcement re-checked live:
      </p>

      {/* Before / after numbers */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs tracking-wide text-graphite uppercase">
              <th className="py-1.5 pr-4 font-semibold">Consent-filtered number</th>
              <th className="py-1.5 pr-4 font-semibold">Before</th>
              <th className="py-1.5 pr-4 font-semibold">After</th>
            </tr>
          </thead>
          <tbody>
            <BeforeAfterRow
              label="Research cohort (explorer total)"
              tone={changeTone}
              before={report.before.researchCohortCount.toLocaleString("en-US")}
              after={report.after.researchCohortCount.toLocaleString("en-US")}
              changed={report.before.researchCohortCount !== report.after.researchCohortCount}
            />
            <BeforeAfterRow
              label="Positional flagship cohort"
              tone={changeTone}
              before={report.before.positionalCohortCount.toLocaleString("en-US")}
              after={report.after.positionalCohortCount.toLocaleString("en-US")}
              changed={report.before.positionalCohortCount !== report.after.positionalCohortCount}
            />
            <BeforeAfterRow
              label="Coach row · name visible (Lane C)"
              tone={changeTone}
              before={report.before.displayNameVisible ? "yes" : "no"}
              after={report.after.displayNameVisible ? "yes" : "no"}
              changed={report.before.displayNameVisible !== report.after.displayNameVisible}
            />
            <BeforeAfterRow
              label="Coach row · 30-day CPAP adherence"
              tone={changeTone}
              before={
                report.before.coachAdherencePct === null
                  ? "hidden"
                  : `${report.before.coachAdherencePct}%`
              }
              after={
                report.after.coachAdherencePct === null
                  ? "hidden"
                  : `${report.after.coachAdherencePct}%`
              }
              changed={report.before.coachAdherencePct !== report.after.coachAdherencePct}
            />
            <BeforeAfterRow
              label="Data classes readable (identified tier)"
              tone={changeTone}
              before={String(report.before.viewableDataClasses.length)}
              after={String(report.after.viewableDataClasses.length)}
              changed={
                report.before.viewableDataClasses.length !==
                report.after.viewableDataClasses.length
              }
            />
            <BeforeAfterRow
              label="Data classes exported (research tier)"
              tone={changeTone}
              before={String(report.before.researchDataClasses.length)}
              after={String(report.after.researchDataClasses.length)}
              changed={
                report.before.researchDataClasses.length !==
                report.after.researchDataClasses.length
              }
            />
          </tbody>
        </table>
      </div>

      {/* Gate probes */}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div>
          <p className="text-xs font-semibold tracking-wide text-graphite uppercase">
            Ingest gate probe (writes)
          </p>
          <ul className="mt-1.5 space-y-1">
            {report.ingestProbes.map((probe) => (
              <li key={probe.dataClass} className="text-xs">
                <span
                  className={`mr-1.5 inline-block rounded-full px-2 py-0.5 font-semibold ${
                    probe.allowed
                      ? "bg-success/10 text-success"
                      : "bg-danger/10 text-danger"
                  }`}
                >
                  {probe.allowed ? "allows" : "throws"}
                </span>
                <span className="font-semibold text-navy">{probe.dataClass}</span>
                {probe.error && <span className="text-graphite"> — {probe.error}</span>}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold tracking-wide text-graphite uppercase">
            Read gate probe (queries)
          </p>
          <ul className="mt-1.5 space-y-1 text-xs">
            {[report.identifiedReadProbe, report.researchReadProbe].map((probe) => (
              <li key={probe.use}>
                <span
                  className={`mr-1.5 inline-block rounded-full px-2 py-0.5 font-semibold ${
                    probe.blocked ? "bg-danger/10 text-danger" : "bg-success/10 text-success"
                  }`}
                >
                  {probe.blocked ? "blocked" : "flowing"}
                </span>
                <span className="font-semibold text-navy">{probe.use}</span>{" "}
                <span className="text-graphite">
                  — {probe.rowsReturned.toLocaleString("en-US")} rows returned
                  {probe.blocked && probe.blockedDataClasses.length > 0
                    ? `; refused: ${probe.blockedDataClasses.join(", ")}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function BeforeAfterRow({
  label,
  before,
  after,
  changed,
  tone,
}: {
  label: string;
  before: string;
  after: string;
  changed: boolean;
  tone: string;
}) {
  return (
    <tr className="border-b border-hairline/60 last:border-0">
      <td className="py-1.5 pr-4 text-ink">{label}</td>
      <td className="py-1.5 pr-4 tabular-nums text-graphite">{before}</td>
      <td
        className={`py-1.5 pr-4 font-semibold tabular-nums ${changed ? tone : "text-navy"}`}
      >
        {after}
        {changed && " ←"}
      </td>
    </tr>
  );
}
