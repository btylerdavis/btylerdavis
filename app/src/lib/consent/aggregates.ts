import { prisma } from "../db";
import { grantsFor, grantSetHas, loadAllGrants, type GrantSet } from "./engine";
import { treatmentEventRowDataClass } from "./gatedQueries";
import { sourceToDataClass } from "./scopes";
import { DATA_CLASSES, type ConsentUse, type DataClass } from "./types";

/**
 * Consent-aware AGGREGATE primitives (audit F-07, level-up 4).
 *
 * Dashboards must never filter an already-combined raw aggregate with "has
 * any grant": every primitive here classifies rows into data classes BEFORE
 * aggregation, so a revoked class contributes to no count, no freshness
 * date, and no night total — while every still-granted class keeps flowing.
 *
 * All primitives share the loadAllGrants pattern: consent is evaluated once
 * per render and applied in JS over per-(participant, source) group rows
 * (≤ cohort × #sources groups), never per row.
 */

type Grants = Map<string, GrantSet>;

const sourceGranted = (
  grants: Grants,
  participantId: string,
  source: string,
  use: ConsentUse
): boolean => {
  const dataClass = sourceToDataClass(source);
  if (dataClass === null) return false; // unknown source: quarantined (F-10)
  return grantSetHas(grantsFor(grants, participantId), dataClass, use);
};

/**
 * Participants with ≥ 1 observation in (from, to] whose data class is
 * granted for `use`. A participant whose only recent rows belong to a
 * revoked class is NOT active (audit F-07 repro #4).
 */
export async function activeParticipantIds(
  window: { from: Date; to: Date },
  opts: { use: ConsentUse; grants?: Grants }
): Promise<Set<string>> {
  const grants = opts.grants ?? (await loadAllGrants());
  const groups = await prisma.observation.groupBy({
    by: ["participantId", "source"],
    where: { effectiveDate: { gt: window.from, lte: window.to } },
  });
  const active = new Set<string>();
  for (const group of groups) {
    if (sourceGranted(grants, group.participantId, group.source, opts.use)) {
      active.add(group.participantId);
    }
  }
  return active;
}

/**
 * Latest observation date per participant, counting ONLY granted classes —
 * the consent-aware "last data" (audit F-07): a sealed class must not leak
 * freshness.
 */
export async function latestGrantedObservationDates(
  participantIds: string[],
  opts: { use: ConsentUse; grants?: Grants }
): Promise<Map<string, Date>> {
  if (participantIds.length === 0) return new Map();
  const grants = opts.grants ?? (await loadAllGrants());
  const groups = await prisma.observation.groupBy({
    by: ["participantId", "source"],
    where: { participantId: { in: participantIds } },
    _max: { effectiveDate: true },
  });
  const latest = new Map<string, Date>();
  for (const group of groups) {
    const max = group._max.effectiveDate;
    if (!max) continue;
    if (!sourceGranted(grants, group.participantId, group.source, opts.use)) continue;
    const current = latest.get(group.participantId);
    if (!current || max > current) latest.set(group.participantId, max);
  }
  return latest;
}

interface ClassNightsRow {
  pid: string;
  src: string;
  nights: bigint | number;
}

interface TotalNightsRow {
  pid: string;
  nights: bigint | number;
}

/**
 * Day-grain observation nights per participant, counting ONLY granted
 * classes (audit F-07). Exact when every class the participant has data for
 * is granted (the overwhelmingly common case — the distinct-date union is
 * taken straight from SQL); when some class is sealed, the count falls back
 * to the best granted class's distinct nights, a conservative lower bound
 * that can never include a revoked class.
 */
export async function grantedObservationNights(opts: {
  use: ConsentUse;
  grants?: Grants;
}): Promise<Map<string, number>> {
  const grants = opts.grants ?? (await loadAllGrants());
  const [perSource, totals] = await Promise.all([
    prisma.$queryRaw<ClassNightsRow[]>`
      SELECT participantId AS pid, source AS src, COUNT(DISTINCT effectiveDate) AS nights
      FROM "Observation"
      WHERE grain = 'day'
      GROUP BY participantId, source
    `,
    prisma.$queryRaw<TotalNightsRow[]>`
      SELECT participantId AS pid, COUNT(DISTINCT effectiveDate) AS nights
      FROM "Observation"
      WHERE grain = 'day'
      GROUP BY participantId
    `,
  ]);

  const fullyGranted = new Map<string, boolean>();
  const bestGranted = new Map<string, number>();
  for (const row of perSource) {
    const granted = sourceGranted(grants, row.pid, row.src, opts.use);
    fullyGranted.set(row.pid, (fullyGranted.get(row.pid) ?? true) && granted);
    if (granted) {
      bestGranted.set(row.pid, Math.max(bestGranted.get(row.pid) ?? 0, Number(row.nights)));
    }
  }

  const nights = new Map<string, number>();
  for (const row of totals) {
    if (fullyGranted.get(row.pid)) nights.set(row.pid, Number(row.nights));
    else if (bestGranted.has(row.pid)) nights.set(row.pid, bestGranted.get(row.pid) as number);
  }
  return nights;
}

export interface RegistryTotals {
  /** lifecycle-active participants holding ≥ 1 current grant */
  participants: number;
  /** observation rows whose class holds a current view_identified grant */
  observations: number;
  /** wearable/sleep-mat session rows, same per-class gate */
  sleepSessions: number;
  /** questionnaire rows for participants with a pro_responses view grant */
  proResponses: number;
}

/**
 * Product-facing registry totals (time-machine page), consent-gated per
 * class (audit F-07): a fully revoked participant — and every row of any
 * individually revoked class — drops from every number here on the next
 * render. Rows at rest are NOT deleted; they are simply no longer counted in
 * product surfaces (the compliance console still shows rows-at-rest).
 */
export async function gatedRegistryTotals(): Promise<RegistryTotals> {
  const use: ConsentUse = "view_identified";
  const [grants, participants, obsGroups, sessionGroups, proGroups] = await Promise.all([
    loadAllGrants(),
    prisma.participant.findMany({ where: { deletedAt: null }, select: { id: true } }),
    prisma.observation.groupBy({
      by: ["participantId", "source"],
      _count: { _all: true },
    }),
    prisma.sleepSession.groupBy({
      by: ["participantId", "source"],
      _count: { _all: true },
    }),
    prisma.proResponse.groupBy({ by: ["participantId"], _count: { _all: true } }),
  ]);

  const consentedParticipants = participants.filter(
    (participant) => grantsFor(grants, participant.id).size > 0
  ).length;

  let observations = 0;
  for (const group of obsGroups) {
    if (sourceGranted(grants, group.participantId, group.source, use)) {
      observations += group._count._all;
    }
  }
  let sleepSessions = 0;
  for (const group of sessionGroups) {
    if (sourceGranted(grants, group.participantId, group.source, use)) {
      sleepSessions += group._count._all;
    }
  }
  let proResponses = 0;
  for (const group of proGroups) {
    if (grantSetHas(grantsFor(grants, group.participantId), "pro_responses", use)) {
      proResponses += group._count._all;
    }
  }

  return {
    participants: consentedParticipants,
    observations,
    sleepSessions,
    proResponses,
  };
}

export interface StorageCounts {
  participants: number;
  observations: number;
  sleepSessions: number;
  proResponses: number;
  simClockDate: Date | null;
}

/**
 * INTERNAL STORAGE metric (dev status page only): raw physical row counts,
 * deliberately NOT consent-filtered — labeled as such wherever rendered.
 * Product surfaces must use gatedRegistryTotals instead.
 */
export async function internalStorageCounts(): Promise<StorageCounts> {
  const [participants, observations, sleepSessions, proResponses, clock] = await Promise.all([
    prisma.participant.count(),
    prisma.observation.count(),
    prisma.sleepSession.count(),
    prisma.proResponse.count(),
    prisma.simClock.findUnique({ where: { id: "singleton" } }),
  ]);
  return {
    participants,
    observations,
    sleepSessions,
    proResponses,
    simClockDate: clock?.currentDate ?? null,
  };
}

/**
 * Per-participant, per-data-class row counts across the subject-data tables
 * (compliance rows-at-rest panel). Unknown sources/lineage land in the
 * `unclassified` bucket — quarantined, never readable.
 */
export async function rowsAtRestByClass(participantId: string): Promise<{
  byClass: Map<DataClass, number>;
  unclassified: number;
}> {
  const [obsGroups, sessionGroups, proCount, purchaseCount, eventGroups, participant] =
    await Promise.all([
      prisma.observation.groupBy({
        by: ["source"],
        where: { participantId },
        _count: { _all: true },
      }),
      prisma.sleepSession.groupBy({
        by: ["source"],
        where: { participantId },
        _count: { _all: true },
      }),
      prisma.proResponse.count({ where: { participantId } }),
      prisma.mattressPurchase.count({ where: { participantId } }),
      prisma.treatmentEvent.groupBy({
        by: ["type", "dataClass"],
        where: { participantId },
        _count: { _all: true },
      }),
      prisma.participant.findUnique({ where: { id: participantId }, select: { id: true } }),
    ]);

  const byClass = new Map<DataClass, number>();
  let unclassified = 0;
  const add = (dataClass: DataClass | null, count: number) => {
    if (dataClass === null) unclassified += count;
    else byClass.set(dataClass, (byClass.get(dataClass) ?? 0) + count);
  };
  for (const group of obsGroups) add(sourceToDataClass(group.source), group._count._all);
  for (const group of sessionGroups) add(sourceToDataClass(group.source), group._count._all);
  add("pro_responses", proCount);
  add("mattress_purchase", purchaseCount);
  // Treatment events: classified by their persisted lineage column, falling
  // back to the exhaustive per-type mapping for pre-lineage rows (F-06).
  for (const group of eventGroups) {
    add(treatmentEventRowDataClass(group), group._count._all);
  }
  // The base registry record itself (registry_demographics, F-11).
  if (participant) add("registry_demographics", 1);

  return { byClass, unclassified };
}

/** Distinct participants active in the 7 days ending at `clock` (time machine). */
export async function countActiveLast7(
  clock: Date,
  use: ConsentUse = "view_identified"
): Promise<number> {
  const from = new Date(clock.getTime() - 7 * 86_400_000);
  const active = await activeParticipantIds({ from, to: clock }, { use });
  return active.size;
}

// ---------------------------------------------------------------------------
// Consent-coverage denominators (level-up 9)
// ---------------------------------------------------------------------------

export interface ConsentCoverage {
  /** lifecycle-alive registry participants (tombstones excluded) */
  eligible: number;
  /** of eligible: holding ≥ 1 current grant for `use` on the relevant classes */
  consented: number;
  /** of consented: ≥ 1 observation whose class clears the read gate for `use` */
  contributing: number;
  /** of contributing: ≥ 1 gate-clearing observation in the 7 days ending at `clock` */
  freshLast7: number;
}

/**
 * The eligible → consented → contributing → fresh-last-7-days funnel behind
 * every dashboard metric (level-up 9). Classification happens per
 * (participant, source) group BEFORE aggregation — the same discipline as
 * every other primitive here — so partial revocation moves these numbers
 * exactly the way it moves the metrics they contextualize: a participant
 * whose only rows belong to a revoked class stays "consented" (other grants
 * intact) but stops "contributing", and a fully revoked participant drops
 * out of both.
 */
export async function consentCoverage(opts: {
  use: ConsentUse;
  clock: Date;
  /** restrict "consented"/"contributing" to these classes (default: all) */
  dataClasses?: DataClass[];
  grants?: Grants;
}): Promise<ConsentCoverage> {
  const grants = opts.grants ?? (await loadAllGrants());
  const classes = opts.dataClasses ?? [...DATA_CLASSES];
  const freshFrom = new Date(opts.clock.getTime() - 7 * 86_400_000);

  const [participants, groups] = await Promise.all([
    prisma.participant.findMany({
      where: { deletedAt: null, lifecycleState: { not: "deleted" } },
      select: { id: true },
    }),
    prisma.observation.groupBy({
      by: ["participantId", "source"],
      where: { effectiveDate: { lte: opts.clock } },
      _max: { effectiveDate: true },
    }),
  ]);

  const alive = new Set(participants.map((participant) => participant.id));
  const consented = new Set<string>();
  for (const id of alive) {
    if (classes.some((dataClass) => grantSetHas(grantsFor(grants, id), dataClass, opts.use))) {
      consented.add(id);
    }
  }

  const contributing = new Set<string>();
  const fresh = new Set<string>();
  for (const group of groups) {
    if (!consented.has(group.participantId)) continue; // tombstones/no-grant out
    const dataClass = sourceToDataClass(group.source);
    if (dataClass === null || !classes.includes(dataClass)) continue; // quarantined (F-10)
    if (!grantSetHas(grantsFor(grants, group.participantId), dataClass, opts.use)) continue;
    contributing.add(group.participantId);
    const latest = group._max.effectiveDate;
    if (latest && latest > freshFrom && latest <= opts.clock) {
      fresh.add(group.participantId);
    }
  }

  return {
    eligible: alive.size,
    consented: consented.size,
    contributing: contributing.size,
    freshLast7: fresh.size,
  };
}
