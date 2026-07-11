import { prisma } from "../db";
import { parseScopeJson } from "./engine";

/**
 * Attrition / consent-change timeline (audit level-up 11): per-sim-month
 * counts of enrollments, full revocations, per-class revocations,
 * administrative restores, signed re-consents, and executed deletions —
 * ALL projected from the immutable consent event ledger (plus the deletion
 * requests and the registry enrollment dates). Nothing here is estimated:
 * every bar on the /research/robustness timeline is a count of ledger
 * events, so the chart doubles as an audit view of consent churn.
 *
 * The computation is a pure function (computeConsentTimeline) over plain
 * event rows so it is unit-testable without a database; loadConsentTimeline
 * is the thin prisma loader (this module lives inside the approved consent
 * boundary).
 */

/** The ledger columns the timeline needs (subset of ConsentRecord). */
export interface TimelineLedgerEvent {
  participantId: string;
  instrumentType: string;
  /** "grant" | "revoke" | "scope_revision" */
  eventType: string;
  revision: number;
  /** "granted" | "revoked" | "expired" */
  status: string;
  grantedAt: Date;
  revokedAt: Date | null;
  /** JSON ConsentScope string */
  scope: string;
  createdAt: Date;
}

export interface ConsentTimelineInput {
  events: TimelineLedgerEvent[];
  /** registry enrollment dates (Participant.createdAt, tombstones included —
   *  a deleted participant's enrollment still happened) */
  enrollments: Date[];
  /** executed deletion dates (DeletionRequest.resolvedAt, status executed) */
  deletions: Date[];
}

export interface ConsentTimelineMonth {
  /** "YYYY-MM" (UTC) */
  month: string;
  /** participants enrolled (registry row created) this month */
  enrollments: number;
  /** signed grant events beyond an instrument's first — the re-consent flow
   *  or a fresh signature after a full revocation */
  reconsents: number;
  /** instrument-level revoke events (the full kill switch) */
  fullRevocations: number;
  /** data classes removed by scope_revision events (partial revocation) */
  classRevocations: number;
  /** data classes re-enabled by scope_revision events (admin restores,
   *  always inside the signed ceiling) */
  restores: number;
  /** executed deletion requests */
  deletions: number;
}

/** "YYYY-MM" bucket for a date (UTC). */
export function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function nextMonth(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return m === 12
    ? `${year + 1}-01`
    : `${year}-${String(m + 1).padStart(2, "0")}`;
}

const distinctClasses = (scopeJson: string): Set<string> =>
  new Set(parseScopeJson(scopeJson).map((grant) => grant.dataClass));

/**
 * Projects the event ledger into per-month counts. Event dating follows the
 * ledger's own semantics: grants and scope revisions carry their (sim-clock)
 * grantedAt; revokes carry revokedAt. Per-instrument streams are replayed in
 * revision order, so "classes removed/added" always compares against the
 * instrument's actual previous state — a restore after a full revocation
 * re-adds every class from the empty state, a reduction on a live grant
 * removes exactly the revoked classes.
 */
export function computeConsentTimeline(input: ConsentTimelineInput): ConsentTimelineMonth[] {
  interface Tally {
    enrollments: number;
    reconsents: number;
    fullRevocations: number;
    classRevocations: number;
    restores: number;
    deletions: number;
  }
  const months = new Map<string, Tally>();
  const tally = (month: string): Tally => {
    const existing = months.get(month);
    if (existing) return existing;
    const fresh: Tally = {
      enrollments: 0,
      reconsents: 0,
      fullRevocations: 0,
      classRevocations: 0,
      restores: 0,
      deletions: 0,
    };
    months.set(month, fresh);
    return fresh;
  };

  for (const date of input.enrollments) tally(monthKey(date)).enrollments += 1;
  for (const date of input.deletions) tally(monthKey(date)).deletions += 1;

  // Replay each (participant, instrument) stream in revision order.
  const streams = new Map<string, TimelineLedgerEvent[]>();
  for (const event of input.events) {
    const key = `${event.participantId}|${event.instrumentType}`;
    const list = streams.get(key) ?? [];
    list.push(event);
    streams.set(key, list);
  }

  for (const stream of streams.values()) {
    stream.sort(
      (a, b) => a.revision - b.revision || a.createdAt.getTime() - b.createdAt.getTime()
    );
    // The instrument's effective class set before the event being replayed.
    let effectiveClasses = new Set<string>();
    let seenGrant = false;
    for (const event of stream) {
      if (event.eventType === "revoke") {
        tally(monthKey(event.revokedAt ?? event.grantedAt)).fullRevocations += 1;
        effectiveClasses = new Set();
        continue;
      }
      const isGranted = event.status === "granted" && event.revokedAt === null;
      const newClasses = isGranted ? distinctClasses(event.scope) : new Set<string>();
      if (event.eventType === "grant") {
        if (seenGrant) tally(monthKey(event.grantedAt)).reconsents += 1;
        seenGrant = true;
        effectiveClasses = newClasses;
        continue;
      }
      // scope_revision: administrative reduction (partial revocation) and/or
      // ceiling-bounded restore, measured against the actual previous state.
      const bucket = tally(monthKey(event.grantedAt));
      for (const dataClass of effectiveClasses) {
        if (!newClasses.has(dataClass)) bucket.classRevocations += 1;
      }
      for (const dataClass of newClasses) {
        if (!effectiveClasses.has(dataClass)) bucket.restores += 1;
      }
      effectiveClasses = newClasses;
    }
  }

  // Contiguous month axis, oldest → newest (gaps filled with zero rows).
  const keys = [...months.keys()].sort();
  if (keys.length === 0) return [];
  const rows: ConsentTimelineMonth[] = [];
  for (let month = keys[0]; month <= keys[keys.length - 1]; month = nextMonth(month)) {
    rows.push({ month, ...(months.get(month) ?? tally(month)) });
    months.delete(month); // tally() above may have created the gap row
  }
  return rows;
}

/** Loads the ledger + registry + deletion inputs and computes the timeline. */
export async function loadConsentTimeline(): Promise<ConsentTimelineMonth[]> {
  const [events, participants, deletions] = await Promise.all([
    prisma.consentRecord.findMany({
      select: {
        participantId: true,
        instrumentType: true,
        eventType: true,
        revision: true,
        status: true,
        grantedAt: true,
        revokedAt: true,
        scope: true,
        createdAt: true,
      },
    }),
    prisma.participant.findMany({ select: { createdAt: true } }),
    prisma.deletionRequest.findMany({
      where: { status: "executed", resolvedAt: { not: null } },
      select: { resolvedAt: true },
    }),
  ]);
  return computeConsentTimeline({
    events,
    enrollments: participants.map((participant) => participant.createdAt),
    deletions: deletions.map((request) => request.resolvedAt as Date),
  });
}
