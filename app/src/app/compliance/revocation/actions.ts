"use server";

import { refresh } from "next/cache";
import {
  restoreAllConsents,
  restoreDataClass,
  revokeAllConsents,
  revokeDataClass,
  type RevocationReport,
} from "@/lib/compliance/revocation";
import {
  ConsentConflictError,
  DATA_CLASSES,
  LifecycleError,
  ScopeCeilingError,
  type DataClass,
} from "@/lib/consent";
import { getParticipant, isWritableLifecycle } from "@/lib/consent/policyRepo";

/**
 * Revocation control-room actions (DEMO.md Act 6 finale). Every action
 * returns the full before/after report so the console renders the impact in
 * one round trip, then refresh() re-renders every server-rendered panel
 * (consent states, class grid, row counts, audit trail, sparkline) against
 * the new consent state. The per-class pair drives the partial-revocation
 * toggle grid.
 *
 * Tombstones are refused outright (audit F-01) and a restore that would
 * exceed the signed-scope ceiling maps to a clear "requires re-consent"
 * error (audit F-02); CAS conflicts surface as retryable errors (F-05).
 */

export interface ActionFailure {
  ok: false;
  error: string;
}

export type RevocationOutcome = ({ ok: true } & RevocationReport) | ActionFailure;

async function refuseUnlessActive(participantId: string): Promise<string | null> {
  const participant = await getParticipant(participantId);
  if (!participant) return "Unknown participant";
  if (!isWritableLifecycle(participant)) {
    return "This record was deleted — its consent state is terminal and cannot be changed";
  }
  return null;
}

function mapError(error: unknown): ActionFailure | null {
  if (error instanceof LifecycleError) {
    return { ok: false, error: "This record was deleted — consent mutations are refused" };
  }
  if (error instanceof ScopeCeilingError) {
    return {
      ok: false,
      error:
        "Never authorized: this data class was not in any signed consent — " +
        "expanding scope requires the participant-facing re-consent flow",
    };
  }
  if (error instanceof ConsentConflictError) {
    return {
      ok: false,
      error: "A concurrent consent change landed first — reload and retry",
    };
  }
  return null;
}

export async function revokeAllAction(participantId: string): Promise<RevocationOutcome> {
  const refused = await refuseUnlessActive(participantId);
  if (refused) return { ok: false, error: refused };
  try {
    const report = await revokeAllConsents(participantId);
    refresh();
    return { ok: true, ...report };
  } catch (error) {
    const mapped = mapError(error);
    if (mapped) return mapped;
    throw error;
  }
}

export async function restoreAllAction(participantId: string): Promise<RevocationOutcome> {
  const refused = await refuseUnlessActive(participantId);
  if (refused) return { ok: false, error: refused };
  try {
    const report = await restoreAllConsents(participantId);
    refresh();
    return { ok: true, ...report };
  } catch (error) {
    const mapped = mapError(error);
    if (mapped) return mapped;
    throw error;
  }
}

function isDataClass(value: string): value is DataClass {
  return (DATA_CLASSES as readonly string[]).includes(value);
}

export async function revokeClassAction(
  participantId: string,
  dataClass: string
): Promise<RevocationOutcome> {
  if (!isDataClass(dataClass)) return { ok: false, error: "Unknown data class" };
  const refused = await refuseUnlessActive(participantId);
  if (refused) return { ok: false, error: refused };
  try {
    const report = await revokeDataClass(participantId, dataClass);
    refresh();
    return { ok: true, ...report };
  } catch (error) {
    const mapped = mapError(error);
    if (mapped) return mapped;
    throw error;
  }
}

export async function restoreClassAction(
  participantId: string,
  dataClass: string
): Promise<RevocationOutcome> {
  if (!isDataClass(dataClass)) return { ok: false, error: "Unknown data class" };
  const refused = await refuseUnlessActive(participantId);
  if (refused) return { ok: false, error: refused };
  try {
    const report = await restoreDataClass(participantId, dataClass);
    refresh();
    return { ok: true, ...report };
  } catch (error) {
    const mapped = mapError(error);
    if (mapped) return mapped;
    throw error;
  }
}
