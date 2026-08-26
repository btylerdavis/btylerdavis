import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/Card";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { DELETION_TABLES, getDeletionCertificate } from "@/lib/compliance/deletion";
import { pseudonym } from "@/lib/deid";
import { formatDay } from "@/lib/format";

/**
 * Printable deletion certificate. Rendered ONLY from the stored execution
 * snapshot on the DeletionRequest record — per-table counts, ledger record
 * count and ledger reference were all captured atomically inside the
 * execution transaction (audit F-01: no certificate fact is ever recomputed
 * live, so nothing that happens after execution can change this page). The
 * print stylesheet strips the chrome exactly like the abstract page:
 * browser Print → PDF yields the one-pager, watermark included.
 */
export const metadata: Metadata = { title: "Deletion certificate" };

export const dynamic = "force-dynamic";

export default async function DeletionCertificatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const certificate = await getDeletionCertificate(id);
  const resolvedAt = certificate?.request.resolvedAt;
  if (!certificate || !resolvedAt) notFound();

  const { request, counts, totalRows: total, ledgerCount: ledgerRecords } = certificate;

  return (
    <div className="flex min-h-screen flex-col">
      <div className="print:hidden">
        <SiteHeader variant="compliance" />
      </div>
      <main className="flex-1 bg-cream print:bg-white">
        <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-8 sm:px-6 sm:py-10 print:max-w-none print:space-y-3 print:px-0 print:py-0">
          {/* Console header (screen only) */}
          <Card className="p-6 sm:p-8 print:hidden">
            <p className="text-xs font-semibold tracking-[0.14em] text-lake uppercase">
              Compliance · deletion certificate
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-navy sm:text-3xl">
              Certificate of data deletion
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-graphite">
              Rendered from the execution record itself — the counts below were captured
              atomically when the request was executed. Print this page for the one-pager.{" "}
              <Link
                href="/compliance/deletions"
                className="font-semibold underline underline-offset-4"
              >
                Back to the console
              </Link>
            </p>
          </Card>

          {/* Watermark banner — kept in print on purpose */}
          <div className="rounded-card border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm text-ink print:rounded-none print:border-x-0">
            <span className="font-semibold text-warning">Illustrative — synthetic cohort.</span>{" "}
            Production certificates are issued under the counsel-final instrument terms
            (SPEC §9.4).
          </div>

          {/* The certificate itself */}
          <Card className="p-6 sm:p-10 print:p-0 print:shadow-none">
            <article className="mx-auto max-w-2xl print:max-w-none">
              <p className="text-xs font-semibold tracking-[0.14em] text-graphite uppercase">
                Sleep outcomes registry · joint venture of Sleeptopia, Inc. and The Mattress Hub
              </p>
              <h2 className="mt-3 font-display text-xl leading-snug font-semibold text-navy sm:text-2xl">
                Certificate of Data Deletion
              </h2>

              <dl className="mt-6 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
                <CertField
                  label="Data subject (research pseudonym)"
                  value={pseudonym(request.participantId)}
                />
                <CertField label="Registry participant id" value={request.participantId} mono />
                <CertField label="Deletion requested" value={formatDay(request.requestedAt)} />
                <CertField label="Deletion executed" value={formatDay(resolvedAt)} />
                <CertField label="Certificate reference" value={`DEL-${request.id.slice(0, 8).toUpperCase()}`} mono />
                <CertField
                  label="Consent ledger reference (stored at execution)"
                  value={certificate.ledgerRef}
                  mono
                />
                <div className="sm:col-span-2">
                  <CertField
                    label={`Certificate content hash (SHA-256 of the stored snapshot${
                      certificate.contentHashVerified ? " — verified against the snapshot" : ""
                    })`}
                    value={certificate.contentHash}
                    mono
                  />
                </div>
              </dl>

              <h3 className="mt-8 text-sm font-semibold tracking-wide text-navy uppercase">
                Identified-tier records destroyed
              </h3>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline text-left text-xs tracking-wide text-graphite uppercase">
                    <th className="py-2 pr-4 font-semibold">Record class</th>
                    <th className="py-2 text-right font-semibold">Rows deleted</th>
                  </tr>
                </thead>
                <tbody>
                  {DELETION_TABLES.map((table) => (
                    <tr key={table.key} className="border-b border-hairline/60 last:border-0">
                      <td className="py-1.5 pr-4 text-ink">{table.label}</td>
                      <td className="py-1.5 text-right font-semibold tabular-nums text-navy">
                        {counts[table.key].toLocaleString("en-US")}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="py-2 pr-4 font-semibold text-navy">Total</td>
                    <td className="py-2 text-right font-semibold tabular-nums text-navy">
                      {total.toLocaleString("en-US")}
                    </td>
                  </tr>
                </tbody>
              </table>

              <h3 className="mt-8 text-sm font-semibold tracking-wide text-navy uppercase">
                Scope & limits of this deletion
              </h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink">
                <li>
                  Every consent instrument was revoked at execution; collection stopped the same
                  instant and all read gates now refuse this subject’s data.
                </li>
                <li>
                  This deletion is <span className="font-semibold">terminal</span>: the record
                  cannot be re-enrolled, re-consented, or restored by any administrative or
                  participant-facing action.
                </li>
                <li>
                  The immutable consent event ledger ({ledgerRecords.toLocaleString("en-US")}{" "}
                  records at execution, captured in this certificate’s snapshot) is retained
                  as a legal record of what was consented, revoked, and deleted, and when. No
                  ledger record is ever updated or deleted.
                </li>
                <li>
                  Research-mart releases published before execution are immutable:
                  already-de-identified data in the research tier cannot be recalled. The
                  participant was informed of this, up front and in plain language, in the
                  consent itself (SPEC §9.4).
                </li>
              </ul>

              <p className="mt-6 border-t border-hairline pt-3 text-xs text-graphite">
                Issued {formatDay(resolvedAt)} (simulation clock) by the registry
                compliance console. Deletion executed atomically with consent revocation;
                every figure on this certificate is the stored execution snapshot.
              </p>
            </article>
          </Card>

          <p className="pb-2 text-center text-xs text-graphite print:hidden">
            Use the browser’s Print → Save as PDF for the one-pager ·{" "}
            <Link href="/compliance/deletions" className="underline underline-offset-4">
              all deletion requests
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

function CertField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-semibold tracking-wide text-graphite uppercase">{label}</dt>
      <dd className={`mt-0.5 text-navy ${mono ? "font-mono text-xs break-all" : "font-semibold"}`}>
        {value}
      </dd>
    </div>
  );
}
