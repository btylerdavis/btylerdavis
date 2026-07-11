import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/Card";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { TimeMachineWidget } from "@/components/TimeMachineWidget";
import { DELETION_TABLES, listDeletionRequests } from "@/lib/compliance/deletion";
import { formatDay, shortId, toIsoDay } from "@/lib/format";
import { getLinkedDisplayNames } from "@/lib/identity";
import { getSimClock, MAX_SIM_DAYS, simDayNumber } from "@/lib/simclock";
import { DeletionsConsole, type DeletionRequestRow } from "./DeletionsConsole";

/**
 * Deletion-request console (SPEC §9.4 withdrawal & deletion; DEMO.md Lane B
 * reserve → working). Requests are filed from the participant snapshot page;
 * this console executes or declines them. Execution is STRONGER than the
 * revocation kill switch next door: consents are revoked AND the
 * identified-tier rows are hard-deleted — only the append-only consent
 * ledger and the tombstoned participant row survive, and there is no
 * restore button, on purpose.
 */
export const metadata: Metadata = { title: "Deletion requests" };

export const dynamic = "force-dynamic";

export default async function DeletionsPage() {
  const [clock, items] = await Promise.all([getSimClock(), listDeletionRequests()]);
  const dayNumber = simDayNumber(clock);

  // Names show only while a current Lane C view grant permits them — an
  // executed deletion removed the identity record entirely, so those rows
  // fall back to the pseudonymous id no matter what.
  const names = await getLinkedDisplayNames(items.map((item) => item.participant.id));

  const rows: DeletionRequestRow[] = items.map((item) => ({
    requestId: item.request.id,
    participantId: item.participant.id,
    label: names.get(item.participant.id) ?? `Participant ${shortId(item.participant.id)}`,
    door: item.participant.enrollmentTouchpoint,
    status: item.request.status,
    requestedAtLabel: formatDay(item.request.requestedAt),
    resolvedAtLabel: item.request.resolvedAt ? formatDay(item.request.resolvedAt) : null,
    note: item.request.note,
    counts: DELETION_TABLES.map((table) => ({
      key: table.key,
      label: table.label,
      rows: item.counts[table.key],
    })),
    totalRows: item.totalRows,
    ledgerRef: item.request.ledgerRef,
    // Observable workflow metadata (level-up 8): attempts survive rollbacks.
    attempts: item.request.attempts,
    lastAttemptAtLabel: item.request.lastAttemptAt
      ? `${toIsoDay(item.request.lastAttemptAt)} UTC`
      : null,
    lastAttemptError: item.request.lastAttemptError,
    contentHash: item.request.contentHash,
  }));

  const pendingCount = rows.filter((row) => row.status === "pending").length;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader variant="compliance" />
      <main className="flex-1 bg-pale-blue">
        <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-8 sm:px-6 sm:py-10">
          {/* Header */}
          <Card className="p-6 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold tracking-[0.14em] text-accent-purple uppercase">
                  Compliance · deletion requests
                </p>
                <h1 className="mt-2 text-2xl font-semibold text-navy sm:text-3xl">
                  The consumer right, executed for real
                </h1>
                <p className="mt-2 max-w-2xl text-sm text-muted">
                  {pendingCount.toLocaleString("en-US")} pending request
                  {pendingCount === 1 ? "" : "s"} as of {formatDay(clock)}. Deletion is
                  stronger than revocation: the{" "}
                  <Link
                    href="/compliance/revocation"
                    className="font-semibold underline underline-offset-4"
                  >
                    kill switch
                  </Link>{" "}
                  seals rows behind the read gates; executing a request here deletes the
                  identified-tier rows themselves — and there is no restore.
                </p>
              </div>
              <TimeMachineWidget
                simDateIso={toIsoDay(clock)}
                dayNumber={dayNumber}
                daysRemaining={Math.max(0, MAX_SIM_DAYS - dayNumber)}
              />
            </div>
          </Card>

          {/* Semantics card — what deletion does and does not do */}
          <Card tone="wash" className="border border-accent-purple/30 p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-navy">
              What execution deletes — and what it lawfully cannot
            </h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-body">
              <li>
                <span className="font-semibold">Deleted:</span> every identified-tier row —
                observations, sleep sessions, questionnaires, devices, purchases, treatment
                events, episodes, and the identity record. Collection stops the same instant
                (every consent is revoked first).
              </li>
              <li>
                <span className="font-semibold">Retained:</span> the append-only consent ledger
                (a legal record of what was consented and when — including this revocation) and
                the participant row as a tombstone, so the ledger keeps a valid subject
                reference. Nothing in the ledger is ever deleted.
              </li>
              <li>
                <span className="font-semibold">Immutable:</span> research-mart releases already
                published. Per SPEC §9.4, already-de-identified data in the research tier cannot
                be recalled — participants are told this up front, in plain language, in the
                consent itself.
              </li>
            </ul>
          </Card>

          {/* The console */}
          <Card className="border border-danger/30 p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-navy">Requests</h2>
            <p className="mt-1 mb-4 text-sm text-muted">
              Execution revokes every consent, hard-deletes the identified-tier rows (counts
              shown per table), tombstones the participant, and issues a printable certificate.
            </p>
            <DeletionsConsole rows={rows} />
          </Card>

          <p className="pb-2 text-center text-xs text-muted">
            File a request from any{" "}
            <Link href="/coach" className="underline underline-offset-4">
              participant snapshot
            </Link>{" "}
            (&ldquo;Your data rights&rdquo; card) · compare with{" "}
            <Link href="/compliance/revocation" className="underline underline-offset-4">
              revocation
            </Link>
            , which never deletes rows
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
