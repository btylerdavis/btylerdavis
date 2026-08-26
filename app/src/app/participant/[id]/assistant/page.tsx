import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { newDirectionClass } from "@/components/assistant/fonts";
import {
  ArrowLink,
  Display,
  Eyebrow,
  HairlineCard,
  Highlight,
  NightBand,
  SectionSub,
} from "@/components/assistant/ui";
import { loadAssistantView } from "@/lib/assistant/chat";
import { getLinkedDisplayNames } from "@/lib/identity";
import { getParticipant } from "@/lib/consent/policyRepo";
import { GUARDRAIL_FOOTER } from "@/lib/recommendations/rules";
import { formatDay, shortId } from "@/lib/format";
import { ChatPanel } from "./ChatPanel";

/**
 * AI Care Assistant — patient-facing chat (Addendum A), styled in the NEW
 * Sleeptopia design language (the standard the rest of the app moves to).
 *
 * Server shell: consent state + the snapshot of consent-gated numbers the
 * assistant answers from. The chat itself runs through the governed
 * pipeline per turn (actions.ts → runChatTurn). A participant without a
 * current grant sees the paused state — the input is disabled and the
 * server refuses regardless.
 */
export const metadata: Metadata = { title: "Care assistant" };

export const dynamic = "force-dynamic";

const hours = (min: number): string => `${(min / 60).toFixed(1)} h`;

export default async function AssistantPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const participant = await getParticipant(id);
  if (!participant) notFound();

  const alive =
    participant.deletedAt === null &&
    (participant.lifecycleState === "active" ||
      participant.lifecycleState === "deletion_pending");

  const view = alive ? await loadAssistantView(id) : null;
  /** non-null only when the assistant consent gate is open */
  const ready = view !== null && view.consented ? view : null;
  const names = ready ? await getLinkedDisplayNames([id]) : new Map<string, string>();
  const displayName = names.get(id) ?? null;
  const paused = ready === null;

  return (
    <div className={`flex min-h-screen flex-col bg-cream text-ink ${newDirectionClass}`}>
      <SiteHeader variant="site" />
      <main className="flex-1">
        <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
          {/* Header */}
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <Eyebrow>AI care assistant · scripted · works offline</Eyebrow>
              <Display className="mt-3">
                Answers from <Highlight>your consented data</Highlight>, nothing else
              </Display>
              <SectionSub>
                {displayName ?? `Participant ${shortId(id)}`} · registry day{" "}
                {view ? formatDay(view.clockIso) : "—"} · CPAP check-ins, supply schedule, and
                comfort troubleshooting. Clinical questions route to the care team.
              </SectionSub>
            </div>
            <Link
              href={`/participant/${id}`}
              className="text-[15px] font-semibold text-brand underline-offset-4 hover:text-night hover:underline"
            >
              ← Participant snapshot
            </Link>
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-[1fr_320px]">
            {/* Chat column */}
            <div className="min-h-[540px]">
              {paused ? (
                <HairlineCard className="p-6 sm:p-8">
                  <p className="eyebrow font-grotesk">Assistant paused</p>
                  <p className="mt-3 font-display text-[26px] font-medium leading-[1.2] text-ink">
                    {alive
                      ? "No current consent grant admits the assistant"
                      : "This record's lifecycle forbids assistant access"}
                  </p>
                  <p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-graphite">
                    {alive
                      ? "The assistant reads only consent-granted data. With every covering " +
                        "grant revoked or absent, it is silenced immediately: no chat answers " +
                        "from this record and no outreach items about it. Consent can be " +
                        "restored through the re-consent flow."
                      : "Deleted and mid-deletion records receive no assistant activity of any " +
                        "kind."}
                  </p>
                  {alive && (
                    <div className="mt-5">
                      <ArrowLink href={`/participant/${id}/reconsent`}>
                        Re-consent flow
                      </ArrowLink>
                    </div>
                  )}
                </HairlineCard>
              ) : (
                <ChatPanel participantId={id} disabled={false} />
              )}
              <p className="mt-3 text-[12.5px] text-graphite">
                {GUARDRAIL_FOOTER}. Scripted engine
                {view?.mode.fellBack
                  ? ` — requested mode "${view.mode.requested}" fell back to scripted`
                  : ""}
                ; every turn is screened and logged.
              </p>
            </div>

            {/* Side rail */}
            <div className="space-y-4">
              <HairlineCard className="p-5">
                <p className="eyebrow font-grotesk">What I can see today</p>
                {ready === null ? (
                  <p className="mt-3 text-[14px] text-graphite">
                    Nothing — the consent gate is closed, so no data is read at all.
                  </p>
                ) : (
                  <dl className="mt-3 space-y-2.5 text-[14px]">
                    <div className="flex items-baseline justify-between gap-2">
                      <dt className="text-graphite">Nights at 4+ h, last 30</dt>
                      <dd className="font-semibold text-ink">
                        {ready.adherencePct30 !== null
                          ? `${Math.round(ready.adherencePct30)}% of ${ready.cpapNights30}`
                          : "no readable data"}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <dt className="text-graphite">Average use, last 2 weeks</dt>
                      <dd className="font-semibold text-ink">
                        {ready.usageLast14Mean !== null
                          ? `${hours(ready.usageLast14Mean)}/night`
                          : "no readable data"}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <dt className="text-graphite">Registered machine</dt>
                      <dd className="font-semibold text-ink">{ready.cpapLabel ?? "none on file"}</dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <dt className="text-graphite">CPAP setup</dt>
                      <dd className="font-semibold text-ink">
                        {ready.cpapSetupIso
                          ? `${formatDay(ready.cpapSetupIso)} (${ready.daysSinceSetup} d)`
                          : "none on file"}
                      </dd>
                    </div>
                  </dl>
                )}
                {ready !== null && ready.blockedDataClasses.length > 0 && (
                  <p className="mt-3 border-t border-hairline pt-2.5 text-[12.5px] text-graphite">
                    Sealed by consent:{" "}
                    <span className="font-medium">{ready.blockedDataClasses.join(", ")}</span> —
                    the assistant cannot cite these classes.
                  </p>
                )}
              </HairlineCard>

              <NightBand className="p-5">
                <p className="text-[13.5px] font-semibold tracking-[0.16em] text-skylight uppercase">
                  Every reply is screened
                </p>
                <ul className="mt-3 space-y-2 text-[14px] text-white/85">
                  <li>1 · Banned-phrase denylist — no diagnosis or therapy-change language</li>
                  <li>2 · Claim–evidence linkage — every cited claim exists in the consent-scoped bundle</li>
                  <li>3 · Guardrail-class validator — clinical topics route to the provider</li>
                </ul>
                <p className="mt-3 text-[13px] text-white/70">
                  Each turn writes one row to the model decision log; escalations queue for
                  clinician review.
                </p>
                <Link
                  href="/compliance/model-log"
                  className="mt-3 inline-block text-[14px] font-semibold text-skylight underline-offset-4 hover:underline"
                >
                  Open the model decision log →
                </Link>
              </NightBand>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
