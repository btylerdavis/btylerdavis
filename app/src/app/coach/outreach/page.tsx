import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import {
  Display,
  Eyebrow,
  HairlineCard,
  Highlight,
  NightBand,
  SectionSub,
  VellumPanel,
} from "@/components/assistant/ui";
import { loadOutreachQueue, OUTREACH_SIGNALS } from "@/lib/assistant/queue";
import { OUTREACH_SIGNAL_LABELS } from "@/lib/assistant/replies";
import { formatDay, shortId } from "@/lib/format";
import { DecisionButtons } from "./DecisionButtons";

/**
 * Coach-facing daily outreach queue (Addendum A), styled in the NEW
 * Sleeptopia design language. Items are computed live from consent-gated
 * signals; each drafted message arrives with its full safety-check trail
 * and one-click Approve / Skip. Approvals re-run the pipeline against
 * current consent server-side before anything is recorded.
 */
export const metadata: Metadata = { title: "Outreach queue" };

export const dynamic = "force-dynamic";


export default async function OutreachQueuePage() {
  const queue = await loadOutreachQueue();

  return (
    <div className="flex min-h-screen flex-col bg-cream text-ink">
      <SiteHeader variant="coach" />
      <main className="flex-1">
        <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
          {/* Header */}
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <Eyebrow>Coach console · AI care assistant</Eyebrow>
              <Display className="mt-3">
                Today’s outreach, <Highlight>drafted and checked</Highlight>
              </Display>
              <SectionSub>
                {formatDay(queue.clockIso)} · {queue.pendingTotal} open{" "}
                {queue.pendingTotal === 1 ? "signal" : "signals"} across the consented roster.
                Every item passed the consent gate and the safety chain before it reached this
                screen.
              </SectionSub>
            </div>
            <Link
              href="/coach"
              className="text-[15px] font-semibold text-brand underline-offset-4 hover:text-navy hover:underline"
            >
              ← Coach portal
            </Link>
          </div>

          {/* Signal totals — proof-point numerals */}
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {OUTREACH_SIGNALS.map((signal) => (
              <HairlineCard key={signal} className="p-4 sm:p-5">
                <p className="font-display text-[44px] font-medium leading-none text-navy">
                  {queue.totals[signal].toLocaleString("en-US")}
                </p>
                <p className="mt-2 text-[12.5px] font-semibold tracking-[0.14em] text-graphite uppercase">
                  {OUTREACH_SIGNAL_LABELS[signal]}
                </p>
              </HairlineCard>
            ))}
          </div>

          {/* Queue */}
          <div className="mt-6 space-y-4">
            {queue.items.length === 0 ? (
              <HairlineCard className="p-6 sm:p-8">
                <p className="font-display text-[26px] font-medium text-ink">Queue clear</p>
                <p className="mt-2 max-w-[56ch] text-[15px] text-graphite">
                  No open outreach signals on the consented roster for {formatDay(queue.clockIso)}.
                  Advance the time machine or revisit after new nights land.
                </p>
              </HairlineCard>
            ) : (
              queue.items.map((item) => (
                <HairlineCard key={`${item.participantId}-${item.signal}`} className="p-5 sm:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    {/* min-w floor: on phones the draft column refuses to
                        squeeze beside the buttons and wraps them below
                        instead — full-width message, decisions underneath */}
                    <div className="min-w-[16rem] flex-1">
                      {/* Who + why */}
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[16px] font-semibold text-ink">
                          {item.displayName ?? `Participant ${shortId(item.participantId)}`}
                        </span>
                        <span className="rounded-full bg-navy px-2.5 py-0.5 text-[11.5px] font-semibold text-white">
                          {item.signalLabel}
                        </span>
                        <span className="text-[13.5px] text-graphite">{item.signalDetail}</span>
                      </div>

                      {/* Drafted message */}
                      <VellumPanel className="mt-3 p-4">
                        <p className="text-[12px] font-semibold tracking-[0.14em] text-brand uppercase">
                          Drafted message
                        </p>
                        <p className="mt-1 text-[15.5px] font-semibold text-ink">
                          {item.draft.title}
                        </p>
                        <p className="mt-1 text-[14.5px] leading-relaxed text-graphite">
                          {item.draft.body}
                        </p>
                      </VellumPanel>

                      {/* Grounding chips + check trail */}
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {item.draft.chips.map((chip) => (
                          <span
                            key={chip.label}
                            className="rounded-full border border-hairline bg-white px-2.5 py-1 text-[12px] text-graphite"
                          >
                            <span className="font-semibold">{chip.label}:</span> {chip.value}
                          </span>
                        ))}
                      </div>
                      {/* flex-wrap (not inline nowrap runs): JSX strips the
                          whitespace between the spans, which otherwise fuses
                          them into one unbreakable line that overflows phones */}
                      <p className="mt-2.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-graphite">
                        {item.checks.map((check) => (
                          <span key={check.id} className="whitespace-nowrap">
                            {check.passed ? "✓" : "✕"} {check.label.toLowerCase()}
                          </span>
                        ))}
                        <span className="whitespace-nowrap">
                          · schema {item.schemaValid ? "valid" : "invalid"}
                        </span>
                        <span className="whitespace-nowrap">· logged {shortId(item.logId)}</span>
                      </p>
                    </div>

                    {/* Decision */}
                    <DecisionButtons participantId={item.participantId} signal={item.signal} />
                  </div>
                </HairlineCard>
              ))
            )}
            {queue.pendingTotal > queue.items.length && (
              <p className="text-[13.5px] text-graphite">
                Showing the first {queue.items.length} of {queue.pendingTotal} open signals —
                approve or skip to pull the next ones into today’s queue.
              </p>
            )}
          </div>

          {/* Decided today */}
          {queue.decidedToday.length > 0 && (
            <HairlineCard className="mt-6 p-5 sm:p-6">
              <p className="eyebrow font-sans">Decided today</p>
              <ul className="mt-3 divide-y divide-hairline">
                {queue.decidedToday.map((decision) => (
                  <li
                    key={`${decision.participantId}-${decision.signal}`}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[14px]"
                  >
                    <span className="min-w-0">
                      <span className="font-semibold text-ink">
                        {decision.displayName ?? `Participant ${shortId(decision.participantId)}`}
                      </span>{" "}
                      <span className="text-graphite">
                        · {decision.signalLabel} · {decision.draftTitle}
                      </span>
                    </span>
                    <span
                      className={
                        decision.status === "approved"
                          ? "rounded-full bg-navy px-2.5 py-0.5 text-[11.5px] font-semibold text-white"
                          : "rounded-full border border-ink px-2.5 py-0.5 text-[11.5px] font-semibold text-ink"
                      }
                    >
                      {decision.status} · {decision.decidedBy}
                    </span>
                  </li>
                ))}
              </ul>
            </HairlineCard>
          )}

          {/* Governance band */}
          <NightBand className="mt-6 p-6 sm:p-8">
            <p className="text-[13.5px] font-semibold tracking-[0.16em] text-skylight uppercase">
              How this queue is governed
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-[15px] font-semibold text-white">Consent first</p>
                <p className="mt-1 text-[14px] leading-relaxed text-white/80">
                  Items exist only for participants on the consented roster, and each signal is
                  gated on its own data class. A revocation removes the participant’s
                  items on the next render — and an approval clicked after a revocation is
                  refused server-side.
                </p>
              </div>
              <div>
                <p className="text-[15px] font-semibold text-white">Checked and logged</p>
                <p className="mt-1 text-[14px] leading-relaxed text-white/80">
                  Every drafted message runs the platform’s schema + safety chain
                  (denylist, claim–evidence linkage, guardrail class) and writes a model-log
                  row; Approve and Skip write a second decision row with the chain re-run at
                  decision time.
                </p>
              </div>
            </div>
            <Link
              href="/compliance/model-log"
              className="mt-4 inline-block text-[14px] font-semibold text-skylight underline-offset-4 hover:underline"
            >
              Open the model decision log →
            </Link>
          </NightBand>
        </div>
      </main>
      <Footer />
    </div>
  );
}
