"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/Button";
import type { RevocationReport } from "@/lib/compliance/revocation";
import { restoreAllAction, revokeAllAction, type RevocationOutcome } from "./actions";

/**
 * The kill-switch console (client): the danger button revokes every consent
 * server-side, and the returned report renders before → after on one screen
 * — cohort counts dropping, ingest gates throwing, read gates blocking. The
 * purple button is the demo-only reset: it re-grants via NEW records, so the
 * audit trail (server-rendered below) keeps the whole story.
 */

export function RevocationConsole({
  participantId,
  displayLabel,
}: {
  participantId: string;
  displayLabel: string;
}) {
  const [pending, startTransition] = useTransition();
  const [report, setReport] = useState<RevocationReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (action: (id: string) => Promise<RevocationOutcome>) => {
    setError(null);
    startTransition(async () => {
      const outcome = await action(participantId);
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
        <Button variant="danger" size="lg" disabled={pending} onClick={() => run(revokeAllAction)}>
          {pending ? "Working…" : `Revoke all consents — ${displayLabel}`}
        </Button>
        <Button variant="purple" disabled={pending} onClick={() => run(restoreAllAction)}>
          Restore consents (demo reset)
        </Button>
        {error && <span className="text-sm font-semibold text-danger">{error}</span>}
      </div>
      <p className="text-xs text-muted">
        Revocation flips the current records to <span className="font-semibold">revoked</span> —
        nothing is deleted. Restore issues <span className="font-semibold">new</span> grant
        records; the audit trail below keeps every step forever.
      </p>

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
        revoked ? "border-danger/40 bg-danger/5" : "border-accent-purple/40 bg-accent-purple/5"
      }`}
    >
      <p className="text-sm font-semibold text-navy">
        {revoked ? "Revoked" : "Restored"}:{" "}
        {report.instruments.length > 0 ? report.instruments.join(", ") : "nothing to change"} —
        enforcement re-checked live:
      </p>

      {/* Before / after numbers */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-pale-blue text-left text-xs tracking-wide text-muted uppercase">
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
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">
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
                {probe.error && <span className="text-muted"> — {probe.error}</span>}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">
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
                <span className="text-muted">
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
    <tr className="border-b border-pale-blue/60 last:border-0">
      <td className="py-1.5 pr-4 text-body">{label}</td>
      <td className="py-1.5 pr-4 tabular-nums text-muted">{before}</td>
      <td
        className={`py-1.5 pr-4 font-semibold tabular-nums ${changed ? tone : "text-navy"}`}
      >
        {after}
        {changed && " ←"}
      </td>
    </tr>
  );
}
