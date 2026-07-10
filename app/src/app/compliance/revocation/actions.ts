"use server";

import { refresh } from "next/cache";
import { prisma } from "@/lib/db";
import {
  restoreAllConsents,
  restoreDataClass,
  revokeAllConsents,
  revokeDataClass,
  type RevocationReport,
} from "@/lib/compliance/revocation";
import { DATA_CLASSES, type DataClass } from "@/lib/consent";

/**
 * Revocation control-room actions (DEMO.md Act 6 finale). Every action
 * returns the full before/after report so the console renders the impact in
 * one round trip, then refresh() re-renders every server-rendered panel
 * (consent states, class grid, row counts, audit trail, sparkline) against
 * the new consent state. The per-class pair drives the partial-revocation
 * toggle grid.
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

function isDataClass(value: string): value is DataClass {
  return (DATA_CLASSES as readonly string[]).includes(value);
}

export async function revokeClassAction(
  participantId: string,
  dataClass: string
): Promise<RevocationOutcome> {
  if (!isDataClass(dataClass)) return { ok: false, error: "Unknown data class" };
  if (!(await participantExists(participantId))) {
    return { ok: false, error: "Unknown participant" };
  }
  const report = await revokeDataClass(participantId, dataClass);
  refresh();
  return { ok: true, ...report };
}

export async function restoreClassAction(
  participantId: string,
  dataClass: string
): Promise<RevocationOutcome> {
  if (!isDataClass(dataClass)) return { ok: false, error: "Unknown data class" };
  if (!(await participantExists(participantId))) {
    return { ok: false, error: "Unknown participant" };
  }
  const report = await restoreDataClass(participantId, dataClass);
  refresh();
  return { ok: true, ...report };
}
