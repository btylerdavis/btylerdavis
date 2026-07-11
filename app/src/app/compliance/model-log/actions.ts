"use server";

import { refresh } from "next/cache";
import { markDecisionReviewed } from "@/lib/recommendations/decisionLog";
import { getSimClock } from "@/lib/simclock";

/**
 * Clinician-review stub action (audit level-up 12 — demo only): marks a
 * queued provider-class model-log row reviewed, stamping reviewedBy /
 * reviewedAt (sim-clock date). Structure only: the real clinician workflow
 * (assignment, sign-off identity, escalation) is a production build item —
 * this proves the log carries the fields and the queue drains.
 */

const DEMO_REVIEWER = "Sleep physician (demo)";

export interface ReviewOutcome {
  ok: boolean;
  error?: string;
}

export async function markReviewedAction(logId: string): Promise<ReviewOutcome> {
  if (typeof logId !== "string" || logId.length === 0) {
    return { ok: false, error: "Missing log entry id" };
  }
  const clock = await getSimClock();
  const outcome = await markDecisionReviewed(logId, DEMO_REVIEWER, clock);
  refresh();
  return outcome.ok ? { ok: true } : { ok: false, error: outcome.reason };
}
