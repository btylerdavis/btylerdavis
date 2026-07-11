"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/Button";
import type { DeletionExecutionReport } from "@/lib/compliance/deletion";
import { declineDeletionAction, executeDeletionAction } from "./actions";

/**
 * The deletion console (client): Execute runs the full consequence server-
 * side — every consent revoked, identified-tier rows hard-deleted, the
 * participant row tombstoned — and the returned report renders the
 * confirmation with per-table counts and the retained-ledger reference.
 * Unlike the revocation kill switch, THERE IS NO RESTORE BUTTON: deletion is
 * stronger than revocation, and that asymmetry is the demo point.
 */

export interface DeletionCountRow {
  key: string;
  label: string;
  rows: number;
}

export interface DeletionRequestRow {
  requestId: string;
  participantId: string;
  label: string;
  door: string;
  status: string;
  requestedAtLabel: string;
  resolvedAtLabel: string | null;
  note: string | null;
  counts: DeletionCountRow[];
  totalRows: number;
  ledgerRef: string | null;
  /** observable workflow metadata (level-up 8) */
  attempts: number;
  lastAttemptAtLabel: string | null;
  lastAttemptError: string | null;
  contentHash: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-warning/10 text-warning",
  executing: "bg-accent-purple/10 text-accent-purple",
  executed: "bg-danger/10 text-danger",
  declined: "bg-pale-blue text-navy",
};

export function DeletionsConsole({ rows }: { rows: DeletionRequestRow[] }) {
  const [pending, startTransition] = useTransition();
  const [report, setReport] = useState<DeletionExecutionReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const execute = (requestId: string) => {
    setError(null);
    startTransition(async () => {
      const outcome = await executeDeletionAction(requestId);
      if (!outcome.ok) {
        setError(outcome.error);
        return;
      }
      setReport(outcome.report);
    });
  };

  const decline = (requestId: string) => {
    setError(null);
    startTransition(async () => {
      const outcome = await declineDeletionAction(requestId, "Declined from the console (demo)");
      if (!outcome.ok) setError(outcome.error);
    });
  };

  if (rows.length === 0 && report === null) {
    return (
      <p className="text-sm text-muted">
        No deletion requests on file. File one from any participant snapshot page — the
        &ldquo;Your data rights&rdquo; card.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* The full state machine, visible (level-up 8) */}
      <div className="rounded-card bg-pale-blue/50 px-4 py-2.5 text-xs text-muted">
        <span className="font-semibold text-navy">Request lifecycle:</span> pending →
        executing → executed <span className="text-navy">|</span> declined. A failed
        execution attempt rolls the request back to{" "}
        <span className="font-semibold">pending (retryable)</span> — the attempt count and
        error stay on the request. Executed requests are{" "}
        <span className="font-semibold text-danger">terminal</span>: there is no restore, and
        re-consent cannot recreate the record.
      </div>

      {error && <p className="text-sm font-semibold text-danger">{error}</p>}

      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.requestId} className="rounded-card border border-pale-blue p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    STATUS_BADGE[row.status] ?? "bg-pale-blue text-navy"
                  }`}
                >
                  {row.status}
                </span>
                {row.status === "pending" && row.lastAttemptError !== null && (
                  <span className="rounded-full bg-danger/10 px-2.5 py-0.5 text-xs font-semibold text-danger">
                    retryable failure
                  </span>
                )}
                <span className="text-sm font-semibold text-navy">{row.label}</span>
                <span className="text-xs text-muted">
                  {row.door} door · requested {row.requestedAtLabel}
                  {row.resolvedAtLabel ? ` · resolved ${row.resolvedAtLabel}` : ""}
                  {row.attempts > 0
                    ? ` · ${row.attempts} execution attempt${row.attempts === 1 ? "" : "s"}${
                        row.lastAttemptAtLabel ? ` (last ${row.lastAttemptAtLabel})` : ""
                      }`
                    : ""}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {row.status === "pending" && (
                  <>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={pending}
                      onClick={() => execute(row.requestId)}
                    >
                      {pending
                        ? "Working…"
                        : row.lastAttemptError !== null
                          ? "Retry execution"
                          : "Execute deletion"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => decline(row.requestId)}
                    >
                      Decline
                    </Button>
                  </>
                )}
                {row.status === "executed" && (
                  <Link
                    href={`/compliance/deletions/${row.requestId}/certificate`}
                    className="text-sm font-semibold text-brand-blue underline-offset-4 hover:underline"
                  >
                    Deletion certificate →
                  </Link>
                )}
              </div>
            </div>

            {row.status === "pending" && row.lastAttemptError !== null && (
              <p className="mt-2 rounded-card bg-danger/5 px-3 py-2 text-xs text-danger">
                <span className="font-semibold">
                  Attempt {row.attempts} failed; the transaction rolled back and the request
                  remains pending.
                </span>{" "}
                {row.lastAttemptError}
              </p>
            )}

            {row.status === "executing" && (
              <p className="mt-2 rounded-card bg-accent-purple/5 px-3 py-2 text-xs text-body">
                Execution in flight — with the single-transaction design this state never
                persists; if it does, the attempt metadata above is the audit trail.
              </p>
            )}

            {row.note && (
              <p className="mt-2 text-xs text-muted">
                Note: <span className="text-body">{row.note}</span>
              </p>
            )}

            {row.status !== "declined" && (
              <div className="mt-3">
                <p className="text-xs font-semibold tracking-wide text-muted uppercase">
                  {row.status === "pending"
                    ? `Identified-tier rows this would delete · ${row.totalRows.toLocaleString("en-US")} total`
                    : `Identified-tier rows deleted · ${row.totalRows.toLocaleString("en-US")} total`}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {row.counts.map((count) => (
                    <span
                      key={count.key}
                      className="rounded-full bg-pale-blue px-2.5 py-0.5 text-xs text-navy tabular-nums"
                    >
                      {count.label}: <span className="font-semibold">{count.rows.toLocaleString("en-US")}</span>
                    </span>
                  ))}
                </div>
                {row.ledgerRef && (
                  <p className="mt-1.5 text-xs text-muted">
                    Consent ledger retained (append-only): {row.ledgerRef}
                  </p>
                )}
                {row.status === "executed" && row.contentHash && (
                  <p className="mt-1.5 text-xs text-muted">
                    Certificate content hash (SHA-256, stored at execution):{" "}
                    <span className="font-mono break-all text-navy">{row.contentHash}</span>
                  </p>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {report && <ExecutionReportPanel report={report} />}
    </div>
  );
}

function ExecutionReportPanel({ report }: { report: DeletionExecutionReport }) {
  const countRows = Object.entries(report.counts);
  return (
    <div className="rounded-card border border-danger/40 bg-danger/5 p-4">
      <p className="text-sm font-semibold text-navy">
        Deletion executed (attempt {report.attempt}) —{" "}
        {report.totalRows.toLocaleString("en-US")} identified-tier rows hard-deleted;
        participant row tombstoned. Terminal: no restore, and re-consent cannot recreate the
        record.
      </p>
      <p className="mt-1 text-xs text-muted">
        Certificate content hash (SHA-256):{" "}
        <span className="font-mono break-all text-navy">{report.contentHash}</span>
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">
            Deleted, by table
          </p>
          <ul className="mt-1.5 space-y-0.5 text-xs">
            {countRows.map(([table, rows]) => (
              <li key={table} className="flex justify-between gap-3">
                <span className="text-body">{table}</span>
                <span className="font-semibold text-navy tabular-nums">
                  {rows.toLocaleString("en-US")}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-2 text-xs">
          <p>
            <span className="font-semibold tracking-wide text-muted uppercase">
              Consents revoked
            </span>
            <br />
            <span className="text-body">
              {report.revokedInstruments.length > 0
                ? report.revokedInstruments.join(", ")
                : "none were current (already revoked)"}
            </span>
          </p>
          <p>
            <span className="font-semibold tracking-wide text-muted uppercase">
              What survives
            </span>
            <br />
            <span className="text-body">
              The append-only consent ledger ({report.ledgerRecords} records — {report.ledgerRef})
              and the tombstoned participant row. Already-published de-identified mart releases
              are immutable and cannot be recalled (SPEC §9.4).
            </span>
          </p>
          <Link
            href={`/compliance/deletions/${report.requestId}/certificate`}
            className="inline-block font-semibold text-brand-blue underline underline-offset-4"
          >
            Open the printable deletion certificate →
          </Link>
        </div>
      </div>
    </div>
  );
}
