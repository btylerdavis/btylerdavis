import type { ConsentRecord } from "@prisma/client";
import { ceilingCoversClass, parseScopeJson, signedScopeCeiling } from "./engine";
import {
  CONSENT_USES,
  DATA_CLASSES,
  type ConsentEventType,
  type ConsentUse,
  type DataClass,
} from "./types";

/**
 * Participant-facing scope history (level-up 7): replays the immutable
 * consent event ledger into a per-DATA-CLASS timeline — when each class was
 * SIGNED, REVOKED, RESTORED or administratively REVISED, under which
 * instrument and version — plus the three-state current answer (granted /
 * revoked / never_authorized).
 *
 * Everything here is a PURE function of the ConsentRecord event stream: the
 * participant page and the printable consent receipt render exactly what the
 * ledger proves, never a parallel state table.
 */

export type ScopeHistoryAction = "signed" | "revoked" | "restored" | "revised";

export interface ScopeHistoryEvent {
  /** sim-clock date of the event (revokedAt for revoke events) */
  date: Date;
  action: ScopeHistoryAction;
  instrumentType: string;
  instrumentVersion: string;
  /** raw ledger event type ("grant" | "revoke" | "scope_revision") */
  eventType: ConsentEventType;
  /** uses in force for this class AFTER the event */
  uses: ConsentUse[];
}

export interface DataClassScopeHistory {
  dataClass: DataClass;
  /** three-state answer (audit F-02): never_authorized ≠ revoked */
  state: "granted" | "revoked" | "never_authorized";
  /** uses currently in force for the class */
  currentUses: ConsentUse[];
  /** ever proven in a signed scope (the restore ceiling covers it) */
  everAuthorized: boolean;
  /** chronological per-class event timeline */
  events: ScopeHistoryEvent[];
}

interface InstrumentSnapshot {
  status: string;
  revokedAt: Date | null;
  scope: ReturnType<typeof parseScopeJson>;
}

/** Chronological replay order: createdAt, then per-instrument revision. */
function replayOrder(a: ConsentRecord, b: ConsentRecord): number {
  const byCreated = a.createdAt.getTime() - b.createdAt.getTime();
  if (byCreated !== 0) return byCreated;
  if (a.instrumentType !== b.instrumentType) {
    return a.instrumentType.localeCompare(b.instrumentType);
  }
  return a.revision - b.revision;
}

function classUses(current: Map<string, InstrumentSnapshot>, dataClass: DataClass): Set<ConsentUse> {
  const uses = new Set<ConsentUse>();
  for (const snapshot of current.values()) {
    if (snapshot.status !== "granted" || snapshot.revokedAt !== null) continue;
    for (const grant of snapshot.scope) {
      if (grant.dataClass === dataClass) uses.add(grant.use);
    }
  }
  return uses;
}

const sortUses = (uses: Set<ConsentUse>): ConsentUse[] =>
  CONSENT_USES.filter((use) => uses.has(use));

const sameUses = (a: Set<ConsentUse>, b: Set<ConsentUse>): boolean =>
  a.size === b.size && [...a].every((use) => b.has(use));

/**
 * Builds the per-class scope history from a participant's full consent
 * event stream (getConsentHistory / any ConsentRecord[]).
 */
export function buildScopeHistory(records: ConsentRecord[]): DataClassScopeHistory[] {
  const ordered = [...records].sort(replayOrder);
  const ceiling = signedScopeCeiling(records);

  const current = new Map<string, InstrumentSnapshot>();
  const uses = new Map<DataClass, Set<ConsentUse>>();
  const events = new Map<DataClass, ScopeHistoryEvent[]>();
  for (const dataClass of DATA_CLASSES) {
    uses.set(dataClass, new Set());
    events.set(dataClass, []);
  }

  for (const record of ordered) {
    current.set(record.instrumentType, {
      status: record.status,
      revokedAt: record.revokedAt,
      scope: parseScopeJson(record.scope),
    });

    const eventType = record.eventType as ConsentEventType;
    const date = eventType === "revoke" ? record.revokedAt ?? record.grantedAt : record.grantedAt;

    for (const dataClass of DATA_CLASSES) {
      const before = uses.get(dataClass) as Set<ConsentUse>;
      const after = classUses(current, dataClass);
      if (sameUses(before, after)) continue;
      uses.set(dataClass, after);

      let action: ScopeHistoryAction;
      if (before.size === 0 && after.size > 0) {
        action = eventType === "grant" ? "signed" : "restored";
      } else if (before.size > 0 && after.size === 0) {
        action = "revoked";
      } else {
        action = "revised";
      }
      (events.get(dataClass) as ScopeHistoryEvent[]).push({
        date,
        action,
        instrumentType: record.instrumentType,
        instrumentVersion: record.instrumentVersion,
        eventType,
        uses: sortUses(after),
      });
    }
  }

  return DATA_CLASSES.map((dataClass) => {
    const currentUses = sortUses(uses.get(dataClass) as Set<ConsentUse>);
    const everAuthorized = ceilingCoversClass(ceiling, dataClass);
    return {
      dataClass,
      state: currentUses.length > 0 ? "granted" : everAuthorized ? "revoked" : "never_authorized",
      currentUses,
      everAuthorized,
      events: events.get(dataClass) as ScopeHistoryEvent[],
    };
  });
}
