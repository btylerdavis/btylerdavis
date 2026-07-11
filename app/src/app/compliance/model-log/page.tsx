import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/Card";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { formatDay, shortId } from "@/lib/format";
import { listModelDecisions } from "@/lib/recommendations/decisionLog";
import { RECS_MODEL_ID, recsMode } from "@/lib/recommendations/pipeline";
import { GUARDRAIL_LABELS, type GuardrailClass } from "@/lib/recommendations/rules";
import { ReviewButton } from "./ReviewButton";

/**
 * Model decision log (audit level-up 12) — the governance story made
 * visible. Read-only table: every rendered recommendation card, its engine
 * (model id + version), zod schema validity, the full SafetyCheck chain
 * outcome (denylist, claim-evidence linkage, guardrail class), the sim date,
 * and the clinician-review state for provider-class cards. A future
 * governed LLM logs through the exact same rows — this page does not change
 * when the engine does.
 */
export const metadata: Metadata = { title: "Model decision log" };

export const dynamic = "force-dynamic";

const TIMESTAMP_FORMAT = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

const BADGE_CLASSES: Record<GuardrailClass, string> = {
  comfort: "bg-sky-blue text-white",
  "adherence-support": "bg-brand-blue text-white",
  "discuss-with-provider": "bg-accent-purple text-white",
};

export default async function ModelLogPage() {
  const { entries, total, queuedForReview } = await listModelDecisions(200);
  const mode = recsMode();

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader variant="compliance" />
      <main className="flex-1 bg-pale-blue">
        <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-8 sm:px-6 sm:py-10">
          {/* Header */}
          <Card className="p-6 sm:p-8">
            <p className="text-xs font-semibold tracking-[0.14em] text-accent-purple uppercase">
              Compliance console · model decision log
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-navy sm:text-3xl">
              Every generated card, checked and on the record
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-muted">
              {total.toLocaleString("en-US")} logged decision{total === 1 ? "" : "s"} ·{" "}
              {queuedForReview.toLocaleString("en-US")} awaiting clinician review. Each row is
              one recommendation card leaving the generation pipeline: the engine and version,
              zod schema validity, and the SafetyCheck chain — banned-phrase denylist,
              claim–evidence linkage against the consent-scoped evidence bundle, and the
              guardrail-class validator. Engine today:{" "}
              <span className="font-mono font-semibold text-navy">{RECS_MODEL_ID}</span>{" "}
              (deterministic templates; RECS_MODE=templates is the permanent fallback
              {mode.fellBack && ` — requested mode "${mode.requested}" fell back`}). A governed
              LLM would log through these same rows (SPEC §10.4).
            </p>
          </Card>

          {/* The log table */}
          <Card className="p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-navy">Logged decisions</h2>
              <p className="text-xs text-muted">
                newest first · showing {Math.min(entries.length, total).toLocaleString("en-US")}{" "}
                of {total.toLocaleString("en-US")} · read-only — rows are audit facts
              </p>
            </div>
            {entries.length === 0 ? (
              <p className="mt-3 text-sm text-muted">
                No decisions logged yet — open any participant&apos;s recommendations page and
                every rendered card will appear here with its full check trail.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[920px] text-sm">
                  <thead>
                    <tr className="border-b border-pale-blue text-left text-xs tracking-wide text-muted uppercase">
                      <th className="py-2 pr-4 font-semibold">Logged (UTC)</th>
                      <th className="py-2 pr-4 font-semibold">Sim date</th>
                      <th className="py-2 pr-4 font-semibold">Participant</th>
                      <th className="py-2 pr-4 font-semibold">Rule</th>
                      <th className="py-2 pr-4 font-semibold">Guardrail</th>
                      <th className="py-2 pr-4 font-semibold">Engine</th>
                      <th className="py-2 pr-4 font-semibold">Schema</th>
                      <th className="py-2 pr-4 font-semibold">Safety checks</th>
                      <th className="py-2 font-semibold">Clinician review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr key={entry.id} className="border-b border-pale-blue/60 last:border-0 align-top">
                        <td className="py-2.5 pr-4 whitespace-nowrap text-muted">
                          {TIMESTAMP_FORMAT.format(entry.createdAt)}
                        </td>
                        <td className="py-2.5 pr-4 whitespace-nowrap text-muted">
                          {formatDay(entry.simDate)}
                        </td>
                        <td className="py-2.5 pr-4 font-mono text-xs whitespace-nowrap text-body">
                          {shortId(entry.participantId)}
                        </td>
                        <td className="py-2.5 pr-4 font-mono text-xs whitespace-nowrap text-body">
                          {entry.ruleId}
                        </td>
                        <td className="py-2.5 pr-4 whitespace-nowrap">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${
                              BADGE_CLASSES[entry.guardrail as GuardrailClass] ??
                              "bg-pale-blue text-navy"
                            }`}
                          >
                            {GUARDRAIL_LABELS[entry.guardrail as GuardrailClass] ??
                              entry.guardrail}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4 font-mono text-xs whitespace-nowrap text-muted">
                          {entry.model} · {entry.modelVersion}
                        </td>
                        <td className="py-2.5 pr-4 whitespace-nowrap">
                          <CheckChip passed={entry.schemaValid} label="zod" />
                        </td>
                        <td className="py-2.5 pr-4">
                          <div className="flex flex-wrap gap-1">
                            {entry.checks.map((check) => (
                              <span key={check.id} title={check.detail}>
                                <CheckChip passed={check.passed} label={check.id} />
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-2.5 whitespace-nowrap">
                          {!entry.reviewQueued ? (
                            <span className="text-xs text-muted">n/a</span>
                          ) : entry.reviewedAt !== null ? (
                            <span className="text-xs text-body">
                              <span className="font-semibold text-success">Reviewed</span> ·{" "}
                              {entry.reviewedBy} · {formatDay(entry.reviewedAt)}
                            </span>
                          ) : (
                            <ReviewButton logId={entry.id} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-muted">
              Checks: denylist (banned diagnosis/directive phrases) · evidence_linkage (every
              cited claim exists in the consent-scoped evidence bundle; a revoked class has no
              claims) · guardrail_class (draft class matches the registered rule; provider
              cards route to the provider). A failed check withholds the card from the
              participant page — the log keeps the refusal.
            </p>
          </Card>

          <p className="pb-2 text-center text-xs text-muted">
            Provider-class cards queue for clinician review at first render — the demo button
            stamps reviewedBy/reviewedAt ·{" "}
            <Link href="/compliance/revocation" className="underline underline-offset-4">
              revocation console
            </Link>{" "}
            ·{" "}
            <Link href="/compliance/deletions" className="underline underline-offset-4">
              deletions
            </Link>
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function CheckChip({ passed, label }: { passed: boolean; label: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold whitespace-nowrap ${
        passed ? "bg-success/10 text-success" : "bg-danger/10 text-danger"
      }`}
    >
      {passed ? "✓" : "✗"} {label}
    </span>
  );
}
