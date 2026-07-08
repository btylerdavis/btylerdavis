"use server";

import { refresh } from "next/cache";
import { prisma } from "@/lib/db";
import {
  restoreAllConsents,
  revokeAllConsents,
  type RevocationReport,
} from "@/lib/compliance/revocation";

/**
 * Revocation control-room actions (DEMO.md Act 6 finale). Both actions
 * return the full before/after report so the console renders the impact in
 * one round trip, then refresh() re-renders every server-rendered panel
 * (consent states, row counts, audit trail, sparkline) against the new
 * consent state.
 */

export interface ActionFailure {
  ok: false;
  error: string;
}

export type RevocationOutcome = ({ ok: true } & RevocationReport) | ActionFailure;

async function participantExists(participantId: string): Promise<boolean> {
  const row = await prisma.participant.findUnique({
    where: { id: participantId },
    select: { id: true },
  });
  return row !== null;
}

export async function revokeAllAction(participantId: string): Promise<RevocationOutcome> {
  if (!(await participantExists(participantId))) {
    return { ok: false, error: "Unknown participant" };
  }
  const report = await revokeAllConsents(participantId);
  refresh();
  return { ok: true, ...report };
}

export async function restoreAllAction(participantId: string): Promise<RevocationOutcome> {
  if (!(await participantExists(participantId))) {
    return { ok: false, error: "Unknown participant" };
  }
  const report = await restoreAllConsents(participantId);
  refresh();
  return { ok: true, ...report };
}
