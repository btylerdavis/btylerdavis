"use client";

import { useRef, useState, useTransition } from "react";
import type { ChatTurnResult } from "@/lib/assistant/chat";
import { PillSunButton } from "@/components/assistant/ui";
import { sendChatMessage } from "./actions";

/**
 * Patient-facing chat surface (new design language). Pure client state for
 * the transcript; every assistant turn arrives from the governed server
 * pipeline with its safety-check trail attached, and the panel renders
 * that trail under each reply — the governance is visible, not implied.
 */

interface TranscriptEntry {
  key: string;
  role: "user" | "assistant";
  text: string;
  turn?: ChatTurnResult;
}

const STARTERS = [
  "How am I doing?",
  "When are my supplies due?",
  "My mask keeps leaking",
  "Can I change my pressure?",
];

const GUARDRAIL_LABELS: Record<string, string> = {
  comfort: "Comfort",
  "adherence-support": "Adherence support",
  "discuss-with-provider": "Discuss with your provider",
};

function shortLogId(logId: string | null): string {
  return logId ? `${logId.slice(0, 8)}…` : "—";
}

/* Checks render as a flex-wrap row (never inline nowrap runs): JSX strips the
   whitespace between the spans, which otherwise fuses them into one
   unbreakable line that overflows narrow viewports. */
function ChecksLine({ turn }: { turn: ChatTurnResult }) {
  return (
    <p className="mt-3 flex flex-wrap gap-x-3 gap-y-0.5 border-t border-hairline pt-2 text-[12px] text-graphite">
      {turn.checks.map((check) => (
        <span key={check.id} className="whitespace-nowrap">
          {check.passed ? "✓" : "✕"} {check.label.toLowerCase()}
        </span>
      ))}
      <span className="whitespace-nowrap">· logged {shortLogId(turn.logId)}</span>
    </p>
  );
}

function AssistantBubble({ turn }: { turn: ChatTurnResult }) {
  // Consent-refused: the assistant is silenced; only the policy notice shows.
  if (turn.silenced) {
    return (
      <div className="max-w-[92%] rounded-2xl border border-hairline bg-vellum p-4">
        <p className="text-[13px] font-semibold tracking-[0.12em] text-graphite uppercase">
          Assistant paused
        </p>
        <p className="mt-1 text-[15px] text-ink">
          {turn.silencedReason ?? "No current consent grant admits the assistant."} Nothing was
          answered from this record.
        </p>
        {turn.logId && (
          <p className="mt-2 text-[12px] text-graphite">
            Refusal logged {shortLogId(turn.logId)} — withheld by the safety chain.
          </p>
        )}
      </div>
    );
  }

  // Chain-withheld: generation happened but a check failed; nothing renders.
  if (!turn.passed || turn.reply === null) {
    return (
      <div className="max-w-[92%] rounded-2xl border border-hairline bg-vellum p-4">
        <p className="text-[13px] font-semibold tracking-[0.12em] text-graphite uppercase">
          Reply withheld
        </p>
        <p className="mt-1 text-[15px] text-ink">
          The drafted reply did not clear the safety chain, so it was withheld and the check
          trail was logged.
        </p>
        <ChecksLine turn={turn} />
      </div>
    );
  }

  const escalated = turn.escalated;
  return (
    <div
      className={
        escalated
          ? "max-w-[92%] rounded-2xl bg-navy p-4 text-white"
          : "max-w-[92%] rounded-2xl border border-hairline bg-white p-4"
      }
    >
      <p
        className={`text-[13px] font-semibold tracking-[0.12em] uppercase ${
          escalated ? "text-skylight" : "text-brand"
        }`}
      >
        {GUARDRAIL_LABELS[turn.reply.guardrail] ?? turn.reply.guardrail}
      </p>
      <p className={`mt-1 text-[16px] font-semibold ${escalated ? "text-white" : "text-ink"}`}>
        {turn.reply.title}
      </p>
      <p className={`mt-1.5 text-[15px] leading-relaxed ${escalated ? "text-white/85" : "text-graphite"}`}>
        {turn.reply.body}
      </p>
      {turn.reply.chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {turn.reply.chips.map((chip) => (
            <span
              key={chip.label}
              className={`rounded-full px-2.5 py-1 text-[12px] ${
                escalated
                  ? "bg-white/10 text-skylight"
                  : "border border-hairline bg-vellum text-graphite"
              }`}
            >
              <span className="font-semibold">{chip.label}:</span> {chip.value}
            </span>
          ))}
        </div>
      )}
      {escalated ? (
        <p className="mt-3 flex flex-wrap gap-x-3 gap-y-0.5 border-t border-white/15 pt-2 text-[12px] text-white/70">
          {turn.checks.map((check) => (
            <span key={check.id} className="whitespace-nowrap">
              {check.passed ? "✓" : "✕"} {check.label.toLowerCase()}
            </span>
          ))}
          <span className="whitespace-nowrap">· logged {shortLogId(turn.logId)}</span>
          <span className="whitespace-nowrap">· queued for clinician review</span>
        </p>
      ) : (
        <ChecksLine turn={turn} />
      )}
    </div>
  );
}

export function ChatPanel({
  participantId,
  disabled,
}: {
  participantId: string;
  disabled: boolean;
}) {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const counter = useRef(0);

  const send = (text: string) => {
    const message = text.trim();
    if (message.length === 0 || pending || disabled) return;
    counter.current += 1;
    const key = counter.current;
    setDraft("");
    setEntries((prev) => [...prev, { key: `u-${key}`, role: "user", text: message }]);
    startTransition(async () => {
      // The per-turn audit id is minted server-side in the action.
      const turn = await sendChatMessage(participantId, message);
      setEntries((prev) => [...prev, { key: `a-${key}`, role: "assistant", text: "", turn }]);
    });
  };

  return (
    <div className="flex h-full flex-col rounded-2xl border border-hairline bg-white">
      {/* Transcript */}
      <div className="flex-1 space-y-4 overflow-y-auto p-5 sm:p-6">
        {entries.length === 0 && (
          <div className="rounded-2xl bg-vellum p-4 text-[15px] text-graphite">
            Ask about your therapy routine, your supply schedule, or mask comfort — answers come
            only from your consented registry data. Clinical questions go to your care team.
          </div>
        )}
        {entries.map((entry) =>
          entry.role === "user" ? (
            <div key={entry.key} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl bg-navy px-4 py-2.5 text-[15px] text-white">
                {entry.text}
              </div>
            </div>
          ) : (
            <div key={entry.key} className="flex justify-start">
              {entry.turn && <AssistantBubble turn={entry.turn} />}
            </div>
          )
        )}
        {pending && (
          <p className="text-[13px] text-graphite">Checking your consented data…</p>
        )}
      </div>

      {/* Starters + input */}
      <div className="border-t border-hairline p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {STARTERS.map((starter) => (
            <button
              key={starter}
              type="button"
              disabled={disabled || pending}
              onClick={() => send(starter)}
              className="rounded-full border border-hairline bg-vellum px-3 py-1.5 text-[13px] font-medium text-graphite transition-colors hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-45"
            >
              {starter}
            </button>
          ))}
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            send(draft);
          }}
        >
          <input
            type="text"
            value={draft}
            maxLength={500}
            disabled={disabled || pending}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={disabled ? "Assistant paused — no current consent" : "Type a message…"}
            className="min-w-0 flex-1 rounded-full border border-hairline bg-white px-4 py-2.5 text-[15px] text-ink placeholder:text-graphite/60 focus:border-brand focus:outline-none disabled:bg-vellum"
          />
          <PillSunButton
            type="submit"
            size="compact"
            disabled={disabled || pending || draft.trim().length === 0}
          >
            Send
          </PillSunButton>
        </form>
      </div>
    </div>
  );
}
