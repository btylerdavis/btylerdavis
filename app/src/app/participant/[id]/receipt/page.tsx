import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/Card";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import {
  buildScopeHistory,
  CLASS_DISABLES,
  CLASS_LABELS,
  getConsentHistory,
  getConsentStates,
  parseScopeJson,
  type ConsentUse,
} from "@/lib/consent";
import { getParticipant } from "@/lib/consent/policyRepo";
import { formatDay } from "@/lib/format";
import { getSimClock } from "@/lib/simclock";

/**
 * Printable CONSENT RECEIPT (level-up 7) — the participant-facing sibling of
 * the deletion certificate, using the same print-CSS pattern: browser
 * Print → PDF yields the handout, watermark included. Everything on the
 * page is rendered from the immutable consent event ledger: the current
 * signed scopes per data class, the per-class signed/revoked/restored
 * history with dates and instrument versions, and the never-authorized
 * classes called out explicitly (nothing can enable those but a fresh
 * signature).
 */
export const metadata: Metadata = { title: "Consent receipt" };

export const dynamic = "force-dynamic";

const LANE_LABELS: Record<string, string> = {
  LANE_A: "Lane A — clinical consent + HIPAA authorization",
  LANE_B: "Lane B — consumer consent",
  LANE_C: "Lane C — record linkage",
};

const USE_LABELS: Record<ConsentUse, string> = {
  collect: "collect",
  view_identified: "identified views",
  research_deid: "research (de-identified)",
};

const ACTION_LABELS: Record<string, string> = {
  signed: "Signed",
  revoked: "Revoked",
  restored: "Restored",
  revised: "Scope revised",
};

export default async function ConsentReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const participant = await getParticipant(id);
  if (!participant) notFound();

  const [simDate, consents, ledger] = await Promise.all([
    getSimClock(),
    getConsentStates(id),
    getConsentHistory(id),
  ]);
  const scopeHistory = buildScopeHistory(ledger);
  const deleted = participant.deletedAt !== null;

  return (
    <div className="flex min-h-screen flex-col">
      <div className="print:hidden">
        <SiteHeader variant="site" />
      </div>
      <main className="flex-1 bg-cream print:bg-white">
        <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-8 sm:px-6 sm:py-10 print:max-w-none print:space-y-3 print:px-0 print:py-0">
          {/* Screen-only header */}
          <Card className="p-6 sm:p-8 print:hidden">
            <p className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">
              Participant · consent receipt
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-navy sm:text-3xl">
              Your consent receipt
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-graphite">
              Rendered from the immutable consent ledger — every signature, revocation and
              restore, exactly as recorded. Use the browser’s Print → Save as PDF for a
              copy.{" "}
              <Link
                href={`/participant/${id}`}
                className="font-semibold underline underline-offset-4"
              >
                Back to your record
              </Link>
            </p>
          </Card>

          {/* Watermark banner — kept in print on purpose */}
          <div className="rounded-card border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm text-ink print:rounded-none print:border-x-0">
            <span className="font-semibold text-warning">Illustrative — synthetic cohort.</span>{" "}
            Production receipts are issued under the counsel-final instrument terms (SPEC §9.4).
          </div>

          {/* The receipt itself */}
          <Card className="p-6 sm:p-10 print:p-0 print:shadow-none">
            <article className="mx-auto max-w-2xl print:max-w-none">
              <p className="text-xs font-semibold tracking-[0.14em] text-graphite uppercase">
                Sleep outcomes registry · joint venture of Sleeptopia, Inc. and The Mattress Hub
              </p>
              <h2 className="mt-3 font-display text-xl leading-snug font-semibold text-navy sm:text-2xl">
                Consent Receipt
              </h2>

              <dl className="mt-6 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
                <ReceiptField label="Registry participant id" value={id} mono />
                <ReceiptField label="Issued" value={formatDay(simDate)} />
                <ReceiptField
                  label="Consent events on ledger"
                  value={ledger.length.toLocaleString("en-US")}
                />
                <ReceiptField
                  label="Record status"
                  value={deleted ? `deleted ${formatDay(participant.deletedAt as Date)} (terminal)` : "active"}
                />
              </dl>

              {deleted && (
                <p className="mt-4 rounded-card border border-danger/30 bg-danger/5 px-4 py-2.5 text-sm text-danger print:rounded-none">
                  This record was deleted. Deletion is terminal — the consents below are shown
                  as a legal record only; no re-consent or restore can recreate the record.
                </p>
              )}

              {/* Current instruments */}
              <h3 className="mt-8 text-sm font-semibold tracking-wide text-navy uppercase">
                Consent instruments — current state
              </h3>
              {consents.length === 0 ? (
                <p className="mt-2 text-sm text-graphite">No consent records.</p>
              ) : (
                <table className="mt-2 w-full text-sm">
                  <thead>
                    <tr className="border-b border-hairline text-left text-xs tracking-wide text-graphite uppercase">
                      <th className="py-2 pr-4 font-semibold">Instrument</th>
                      <th className="py-2 pr-4 font-semibold">Version</th>
                      <th className="py-2 pr-4 font-semibold">Status</th>
                      <th className="py-2 font-semibold">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {consents.map((consent) => (
                      <tr
                        key={consent.instrumentType}
                        className="border-b border-hairline/60 last:border-0"
                      >
                        <td className="py-1.5 pr-4 text-ink">
                          {LANE_LABELS[consent.instrumentType] ?? consent.instrumentType}
                        </td>
                        <td className="py-1.5 pr-4 text-graphite">v{consent.instrumentVersion}</td>
                        <td className="py-1.5 pr-4 font-semibold text-navy">{consent.status}</td>
                        <td className="py-1.5 text-graphite">
                          {formatDay(consent.revokedAt ?? consent.grantedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Per-class signed scopes + history */}
              <h3 className="mt-8 text-sm font-semibold tracking-wide text-navy uppercase">
                Data classes — current signed scope and full history
              </h3>
              <div className="mt-2 space-y-3">
                {scopeHistory.map((entry) => (
                  <div
                    key={entry.dataClass}
                    className="rounded-card border border-hairline/80 px-4 py-2.5 print:rounded-none print:border-x-0"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold text-navy">
                        {CLASS_LABELS[entry.dataClass]}
                      </p>
                      <p className="text-xs font-semibold">
                        {entry.state === "granted" ? (
                          <span className="text-success">
                            granted · {entry.currentUses.map((use) => USE_LABELS[use]).join(" · ")}
                          </span>
                        ) : entry.state === "revoked" ? (
                          <span className="text-danger">revoked (restorable — was signed)</span>
                        ) : (
                          <span className="text-graphite">
                            never authorized — requires a fresh signature
                          </span>
                        )}
                      </p>
                    </div>
                    <p className="mt-1 text-xs text-graphite">
                      {entry.state === "granted" ? "Revoking this: " : "While off: "}
                      {CLASS_DISABLES[entry.dataClass]}
                    </p>
                    {entry.events.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5 text-xs text-ink">
                        {entry.events.map((event, index) => (
                          <li key={index}>
                            <span
                              className={`font-semibold ${
                                event.action === "revoked" ? "text-danger" : "text-navy"
                              }`}
                            >
                              {ACTION_LABELS[event.action] ?? event.action}
                            </span>{" "}
                            {formatDay(event.date)} · {event.instrumentType} v
                            {event.instrumentVersion} · {event.eventType.replace(/_/g, " ")}
                            {event.uses.length > 0 &&
                              ` → ${event.uses.map((use) => USE_LABELS[use]).join(", ")}`}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>

              {/* The raw ledger, event by event */}
              <h3 className="mt-8 text-sm font-semibold tracking-wide text-navy uppercase">
                Ledger events (immutable, oldest first)
              </h3>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline text-left text-xs tracking-wide text-graphite uppercase">
                    <th className="py-2 pr-4 font-semibold">Date</th>
                    <th className="py-2 pr-4 font-semibold">Instrument</th>
                    <th className="py-2 pr-4 font-semibold">Event</th>
                    <th className="py-2 font-semibold">Classes in scope</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((record) => (
                    <tr key={record.id} className="border-b border-hairline/60 last:border-0">
                      <td className="py-1.5 pr-4 whitespace-nowrap text-graphite">
                        {formatDay(record.revokedAt ?? record.grantedAt)}
                      </td>
                      <td className="py-1.5 pr-4 whitespace-nowrap text-ink">
                        {record.instrumentType} v{record.instrumentVersion} · rev{" "}
                        {record.revision}
                      </td>
                      <td className="py-1.5 pr-4 whitespace-nowrap font-semibold text-navy">
                        {record.eventType.replace(/_/g, " ")}
                      </td>
                      <td className="py-1.5 text-xs text-graphite">
                        {[
                          ...new Set(parseScopeJson(record.scope).map((grant) => grant.dataClass)),
                        ]
                          .map((dataClass) => CLASS_LABELS[dataClass] ?? dataClass)
                          .join(", ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p className="mt-6 border-t border-hairline pt-3 text-xs text-graphite">
                Issued {formatDay(simDate)} (simulation clock). This receipt is a projection of
                the append-only consent event ledger: no event on it is ever updated or
                deleted, and administrative actions can never exceed the scopes you signed.
              </p>
            </article>
          </Card>

          <p className="pb-2 text-center text-xs text-graphite print:hidden">
            Use the browser’s Print → Save as PDF for the handout ·{" "}
            <Link href={`/participant/${id}`} className="underline underline-offset-4">
              back to the record
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

function ReceiptField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold tracking-wide text-graphite uppercase">{label}</dt>
      <dd className={`mt-0.5 text-navy ${mono ? "font-mono text-xs break-all" : "font-semibold"}`}>
        {value}
      </dd>
    </div>
  );
}
