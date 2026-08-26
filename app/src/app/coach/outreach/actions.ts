"use server";

import { refresh } from "next/cache";
import { decideOutreach, OUTREACH_SIGNALS, type DecisionOutcome } from "@/lib/assistant/queue";
import type { OutreachSignal } from "@/lib/assistant/replies";

/**
 * One-click Approve / Skip on outreach-queue items (Addendum A). Thin:
 * decideOutreach re-runs the full governed pipeline against CURRENT
 * consent before recording anything — a stale click on a revoked
 * participant is refused server-side, whatever the page showed.
 */

export async function decideOutreachAction(
  participantId: string,
  signal: OutreachSignal,
  status: "approved" | "skipped"
): Promise<DecisionOutcome> {
  if (
    typeof participantId !== "string" ||
    participantId.length === 0 ||
    !OUTREACH_SIGNALS.includes(signal) ||
    (status !== "approved" && status !== "skipped")
  ) {
    return { ok: false, reason: "Invalid decision" };
  }
  const outcome = await decideOutreach(participantId, signal, status);
  refresh();
  return outcome;
}
