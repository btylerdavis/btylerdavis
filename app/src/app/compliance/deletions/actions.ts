"use server";

import { refresh } from "next/cache";
import {
  declineDeletion,
  executeDeletion,
  type DeletionExecutionReport,
} from "@/lib/compliance/deletion";

/**
 * Deletion-console actions (SPEC §9.4; DEMO.md reserve → working). Execute
 * runs the whole consequence atomically — revoke everything, hard-delete the
 * identified-tier rows, tombstone the participant, record counts + ledger
 * reference on the request — and returns the report so the console shows
 * exactly what was deleted in one round trip. refresh() then re-renders the
 * server-rendered request list against the new state.
 */

export type ExecuteOutcome =
  | { ok: true; report: DeletionExecutionReport }
  | { ok: false; error: string };

export async function executeDeletionAction(requestId: string): Promise<ExecuteOutcome> {
  const result = await executeDeletion(requestId);
  refresh();
  return result;
}

export type DeclineOutcome = { ok: true } | { ok: false; error: string };

export async function declineDeletionAction(
  requestId: string,
  reason?: string
): Promise<DeclineOutcome> {
  const result = await declineDeletion(requestId, reason);
  refresh();
  return result.ok ? { ok: true } : result;
}
