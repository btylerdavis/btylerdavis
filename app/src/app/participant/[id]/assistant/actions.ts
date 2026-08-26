"use server";

import { randomUUID } from "node:crypto";
import { runChatTurn, type ChatTurnResult } from "@/lib/assistant/chat";

/**
 * Chat server action (Addendum A). Thin: all governance lives in
 * runChatTurn — consent gate, consent-gated reads, zod schema, SafetyCheck
 * chain, ModelDecisionLog row. The action only validates the transport
 * shape and mints the per-turn audit id (server-side, so every turn logs
 * distinctly regardless of client state). No page revalidation: the
 * transcript is client state, and the audit trail lands in the model log
 * regardless.
 */

const MAX_MESSAGE_LENGTH = 500;

export async function sendChatMessage(
  participantId: string,
  message: string
): Promise<ChatTurnResult> {
  if (
    typeof participantId !== "string" ||
    participantId.length === 0 ||
    typeof message !== "string" ||
    message.trim().length === 0 ||
    message.length > MAX_MESSAGE_LENGTH
  ) {
    return {
      clockIso: "",
      intent: "unknown",
      silenced: true,
      silencedReason: "Invalid message",
      reply: null,
      escalated: false,
      schemaValid: false,
      checks: [],
      passed: false,
      logId: null,
    };
  }
  const turnId = randomUUID().replace(/-/g, "").slice(0, 12);
  return runChatTurn(participantId, message.trim(), { turnId });
}
