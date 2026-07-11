import type { ConsentRecord } from "@prisma/client";
import {
  assertActiveParticipant,
  assertIngestAllowed,
  ceilingCoversClass,
  ConsentError,
  DATA_CLASSES,
  getConsentStates,
  getObservations,
  grantSetHas,
  grantsFor,
  INSTRUMENT_SCOPES,
  INSTRUMENT_TYPES,
  latestRecordsByInstrument,
  loadAllGrants,
  loadGrants,
  parseScopeJson,
  restoreConsentScope,
  reviseConsentScope,
  revokeConsent,
  rowsAtRestByClass,
  ScopeCeilingError,
  signedScopeCeiling,
  signedScopeCeilingByInstrument,
  withConsentRetry,
  type ConsentScope,
  type DataClass,
  type InstrumentType,
} from "../consent";
import { prisma } from "../db";
import { getSimClock } from "../simclock";
import { addDays } from "../synthetic/profiles";

/**
 * Revocation kill switch (DEMO.md Act 6 finale). revokeAllConsents appends
 * an immutable revoke EVENT for every currently-granted instrument (records
 * are never updated or deleted), then PROVES the enforcement live: the
 * ingest gate throws, the gated readers block, and the consent-filtered
 * cohort counts drop. The restore path appends new ceiling-bounded events,
 * so the audit trail keeps the full grant → revoke → restore history — the
 * trail itself is the demo point.
 *
 * Partial revocation: revokeDataClass / restoreDataClass revise ONE data
 * class across every covering instrument via compare-and-swapped
 * scope_revision events — so only that class blocks (or resumes) everywhere
 * while the rest keeps flowing, and two concurrent revisions can never lose
 * each other's update (audit F-05).
 *
 * The SIGNED-SCOPE CEILING (audit F-02): restores can only re-enable grants
 * the participant proved with a signature. A class that was never signed is
 * `never_authorized` — distinct from `revoked` — and can only be enabled
 * through the participant-facing re-consent flow.
 */

const INGEST_PROBE_CLASSES: DataClass[] = [
  "wearable_sleep",
  "cpap_telemetry",
  "sleep_mat",
  "pro_responses",
  "hst_clinical",
  "mattress_purchase",
];

export interface IngestProbe {
  dataClass: DataClass;
  allowed: boolean;
  /** the actual ConsentError message when blocked */
  error: string | null;
}

export interface ReadProbe {
  use: "view_identified" | "research_deid";
  blocked: boolean;
  blockedDataClasses: DataClass[];
  rowsReturned: number;
}

export interface ConsentImpactSnapshot {
  /** participants holding ≥ 1 current research_deid grant (explorer total) */
  researchCohortCount: number;
  /** supine-predominant + delivered-mattress members (flagship banner count) */
  positionalCohortCount: number;
  /** the participant's data classes readable in the identified tier */
  viewableDataClasses: DataClass[];
  /** …and in the research tier */
  researchDataClasses: DataClass[];
  /** Lane C name visibility (the /coach patient-row name) */
  displayNameVisible: boolean;
  /** 30-day CPAP adherence as /coach computes it; null = no data or blocked */
  coachAdherencePct: number | null;
  /** latest Lane A status ("granted" | "revoked" | null if never signed) */
  laneAStatus: string | null;
}

/**
 * The consent-dependent numbers the control room shows before/after. Uses
 * the same loadAllGrants + aggregate pattern as the dashboards, scoped to
 * the few counts the demo compares.
 */
export async function snapshotConsentImpact(
  participantId: string
): Promise<ConsentImpactSnapshot> {
  const clock = await getSimClock();
  const [allGrants, hstRows, purchaseGroups, adherenceRows, states] = await Promise.all([
    loadAllGrants(),
    prisma.observation.findMany({
      where: { source: "hst", concept: { in: ["supine_ahi", "nonsupine_ahi"] } },
      select: { participantId: true, concept: true, valueNumeric: true },
    }),
    prisma.mattressPurchase.groupBy({
      by: ["participantId"],
      where: { deliveryDate: { not: null } },
    }),
    prisma.observation.groupBy({
      by: ["concept"],
      where: {
        participantId,
        concept: { in: ["cpap_usage_minutes", "therapy_gap"] },
        effectiveDate: { gt: addDays(clock, -30), lte: clock },
      },
      _count: { _all: true },
    }),
    getConsentStates(participantId),
  ]);

  const grants = grantsFor(allGrants, participantId);
  const canResearch = (pid: string, dataClass: DataClass) =>
    grantSetHas(grantsFor(allGrants, pid), dataClass, "research_deid");

  // Explorer top line: anyone holding ≥ 1 research grant.
  let researchCohortCount = 0;
  for (const grantSet of allGrants.values()) {
    if (DATA_CLASSES.some((dataClass) => grantSetHas(grantSet, dataClass, "research_deid"))) {
      researchCohortCount += 1;
    }
  }

  // Flagship banner: supine-predominant (hst grant) + delivered mattress
  // (purchase grant) — the same membership rule the positional page applies.
  const supine = new Map<string, { s?: number; ns?: number }>();
  for (const row of hstRows) {
    const entry = supine.get(row.participantId) ?? {};
    if (row.concept === "supine_ahi") entry.s = row.valueNumeric ?? undefined;
    else entry.ns = row.valueNumeric ?? undefined;
    supine.set(row.participantId, entry);
  }
  const delivered = new Set(purchaseGroups.map((group) => group.participantId));
  let positionalCohortCount = 0;
  for (const [pid, entry] of supine) {
    if (
      entry.s !== undefined &&
      entry.ns !== undefined &&
      entry.s >= 2 * entry.ns &&
      delivered.has(pid) &&
      canResearch(pid, "hst_clinical") &&
      canResearch(pid, "mattress_purchase")
    ) {
      positionalCohortCount += 1;
    }
  }

  // The participant's own gate states + coach-row numbers.
  const viewableDataClasses = DATA_CLASSES.filter((dataClass) =>
    grantSetHas(grants, dataClass, "view_identified")
  );
  const researchDataClasses = DATA_CLASSES.filter((dataClass) =>
    grantSetHas(grants, dataClass, "research_deid")
  );

  const nights = adherenceRows.reduce((sum, row) => sum + row._count._all, 0);
  const okNights = await prisma.observation.count({
    where: {
      participantId,
      concept: "cpap_usage_minutes",
      valueNumeric: { gte: 240 },
      effectiveDate: { gt: addDays(clock, -30), lte: clock },
    },
  });
  const coachAdherencePct =
    nights > 0 && grantSetHas(grants, "cpap_telemetry", "view_identified")
      ? Math.round((okNights / nights) * 100)
      : null;

  return {
    researchCohortCount,
    positionalCohortCount,
    viewableDataClasses,
    researchDataClasses,
    displayNameVisible: grantSetHas(grants, "linkage", "view_identified"),
    coachAdherencePct,
    laneAStatus: states.find((state) => state.instrumentType === "LANE_A")?.status ?? null,
  };
}

/** Exercises the ingest gate per data class with FRESH grants. */
export async function probeIngestGates(participantId: string): Promise<IngestProbe[]> {
  const grants = await loadGrants(participantId);
  const probes: IngestProbe[] = [];
  for (const dataClass of INGEST_PROBE_CLASSES) {
    try {
      await assertIngestAllowed(participantId, dataClass, { grants });
      probes.push({ dataClass, allowed: true, error: null });
    } catch (error) {
      if (!(error instanceof ConsentError)) throw error;
      probes.push({ dataClass, allowed: false, error: error.message });
    }
  }
  return probes;
}

/** Exercises a gated read (observations) for the given tier. */
export async function probeGatedRead(
  participantId: string,
  use: "view_identified" | "research_deid"
): Promise<ReadProbe> {
  const result = await getObservations(participantId, { use });
  return {
    use,
    blocked: result.blocked,
    blockedDataClasses: result.blockedDataClasses,
    rowsReturned: result.data.length,
  };
}

export interface RevocationReport {
  participantId: string;
  action: "revoke" | "restore";
  /** instruments revoked / re-granted / scope-revised by this action */
  instruments: InstrumentType[];
  /** present for per-data-class actions (partial revocation) */
  dataClass?: DataClass;
  before: ConsentImpactSnapshot;
  after: ConsentImpactSnapshot;
  ingestProbes: IngestProbe[];
  identifiedReadProbe: ReadProbe;
  researchReadProbe: ReadProbe;
}

/** Shared tail of every console action: after-snapshot + live gate probes. */
async function finishReport(
  participantId: string,
  action: "revoke" | "restore",
  instruments: InstrumentType[],
  before: ConsentImpactSnapshot,
  dataClass?: DataClass
): Promise<RevocationReport> {
  const [after, ingestProbes, identifiedReadProbe, researchReadProbe] = await Promise.all([
    snapshotConsentImpact(participantId),
    probeIngestGates(participantId),
    probeGatedRead(participantId, "view_identified"),
    probeGatedRead(participantId, "research_deid"),
  ]);
  return {
    participantId,
    action,
    instruments,
    ...(dataClass ? { dataClass } : {}),
    before,
    after,
    ingestProbes,
    identifiedReadProbe,
    researchReadProbe,
  };
}

/**
 * Revokes every currently-granted instrument in ONE transaction (the UI
 * presents this as one operation), then re-checks enforcement. Rows already
 * at rest are NOT deleted — they are quarantined behind the read gates (the
 * row-count panel on the page makes that visible).
 */
export async function revokeAllConsents(participantId: string): Promise<RevocationReport> {
  const before = await snapshotConsentImpact(participantId);

  const revoked = await withConsentRetry(() =>
    prisma.$transaction(async (tx) => {
      await assertActiveParticipant(participantId, tx);
      const states = await getConsentStates(participantId, tx);
      const done: InstrumentType[] = [];
      for (const state of states) {
        if (state.status !== "granted") continue;
        const record = await revokeConsent(participantId, state.instrumentType as InstrumentType, {
          db: tx,
        });
        if (record) done.push(state.instrumentType as InstrumentType);
      }
      return done;
    })
  );

  return finishReport(participantId, "revoke", revoked, before);
}

/**
 * Demo reset: restores every instrument the participant EVER signed — to its
 * SIGNED-SCOPE CEILING, never the template (audit F-02) — as new immutable
 * events; the prior revocation stays in the ledger forever. A custom Lane B
 * scope therefore comes back exactly as signed, and a class that was never
 * signed stays off until the re-consent flow captures a fresh signature.
 */
export async function restoreAllConsents(participantId: string): Promise<RevocationReport> {
  const before = await snapshotConsentImpact(participantId);
  const clock = await getSimClock();

  const restored = await withConsentRetry(() =>
    prisma.$transaction(async (tx) => {
      await assertActiveParticipant(participantId, tx);
      const records = await tx.consentRecord.findMany({ where: { participantId } });
      const latest = latestRecordsByInstrument(records);
      const ceilings = signedScopeCeilingByInstrument(records);
      const done: InstrumentType[] = [];

      for (const [instrumentType, ceiling] of ceilings) {
        const ceilingScope = ceilingToScope(ceiling);
        if (ceilingScope.length === 0) continue;
        const current = latest.get(instrumentType);
        if (!current) continue;

        if (current.status === "granted" && current.revokedAt === null) {
          // Granted but possibly reduced: restore to the signed ceiling only
          // if something is missing.
          const held = new Set(
            parseScopeJson(current.scope).map((grant) => `${grant.dataClass}|${grant.use}`)
          );
          const missing = ceilingScope.some(
            (grant) => !held.has(`${grant.dataClass}|${grant.use}`)
          );
          if (!missing) continue;
          const created = await reviseConsentScope(participantId, instrumentType, ceilingScope, {
            grantedAt: clock,
            db: tx,
            expectedRevision: current.revision,
          });
          if (created) done.push(instrumentType);
        } else {
          const created = await restoreConsentScope(participantId, instrumentType, ceilingScope, {
            grantedAt: clock,
            db: tx,
            expectedRevision: current.revision,
          });
          if (created) done.push(instrumentType);
        }
      }
      return done;
    })
  );

  return finishReport(participantId, "restore", restored, before);
}

function ceilingToScope(ceiling: ReadonlySet<string>): ConsentScope {
  const scope: ConsentScope = [];
  for (const key of ceiling) {
    const [dataClass, use] = key.split("|");
    scope.push({ dataClass, use } as ConsentScope[number]);
  }
  return scope.sort(
    (a, b) => a.dataClass.localeCompare(b.dataClass) || a.use.localeCompare(b.use)
  );
}

// ---------------------------------------------------------------------------
// Partial revocation (per data class) — DEMO.md §3
// ---------------------------------------------------------------------------

/** Instruments whose template scope covers a data class (grid metadata). */
export function instrumentsCoveringClass(dataClass: DataClass): InstrumentType[] {
  return INSTRUMENT_TYPES.filter((instrument) =>
    INSTRUMENT_SCOPES[instrument].some((grant) => grant.dataClass === dataClass)
  );
}

/**
 * Three-state class model (audit F-02): a class the participant never signed
 * for is NOT "revoked" — it is "never_authorized", and the console offers
 * the re-consent flow instead of Restore.
 */
export type DataClassState = "granted" | "revoked" | "never_authorized";

export interface DataClassConsentState {
  dataClass: DataClass;
  state: DataClassState;
  /** current "collect" grant — scope revisions flip all uses together */
  granted: boolean;
  /** proven in a signed scope at some point (the restore ceiling) */
  everAuthorized: boolean;
  /** instruments with a CURRENT granted record whose SIGNED ceiling covers the class */
  revisableInstruments: InstrumentType[];
}

/** Per-data-class consent state for the console's toggle grid. */
export async function dataClassConsentStates(
  participantId: string
): Promise<DataClassConsentState[]> {
  const records = await prisma.consentRecord.findMany({ where: { participantId } });
  const latest = latestRecordsByInstrument(records);
  const ceilings = signedScopeCeilingByInstrument(records);
  const globalCeiling = signedScopeCeiling(records);
  const currentInstruments = new Set<InstrumentType>();
  for (const record of latest.values()) {
    if (record.status === "granted" && record.revokedAt === null) {
      currentInstruments.add(record.instrumentType as InstrumentType);
    }
  }
  const grants = await loadGrants(participantId);
  return DATA_CLASSES.map((dataClass) => {
    const granted = grantSetHas(grants, dataClass, "collect");
    const everAuthorized = ceilingCoversClass(globalCeiling, dataClass);
    return {
      dataClass,
      state: granted ? "granted" : everAuthorized ? "revoked" : "never_authorized",
      granted,
      everAuthorized,
      revisableInstruments: INSTRUMENT_TYPES.filter((instrument) => {
        if (!currentInstruments.has(instrument)) return false;
        const ceiling = ceilings.get(instrument);
        return ceiling !== undefined && ceilingCoversClass(ceiling, dataClass);
      }),
    };
  });
}

/**
 * Revokes ONE data class: every currently-granted instrument whose scope
 * still covers the class gets a NEW scope_revision event with that class's
 * grants removed. The derivation and the append run in ONE transaction with
 * a compare-and-swap on each instrument's latest revision, so a concurrent
 * revision of another class can never silently resurrect this one (audit
 * F-05). All other classes keep flowing; the ledger keeps every step.
 */
export async function revokeDataClass(
  participantId: string,
  dataClass: DataClass
): Promise<RevocationReport> {
  const before = await snapshotConsentImpact(participantId);
  const clock = await getSimClock();

  const revised = await withConsentRetry(() =>
    prisma.$transaction(async (tx) => {
      await assertActiveParticipant(participantId, tx);
      const latest = latestRecordsByInstrument(
        await tx.consentRecord.findMany({ where: { participantId } })
      );
      const done: InstrumentType[] = [];
      for (const record of latest.values()) {
        if (record.status !== "granted" || record.revokedAt !== null) continue;
        const scope = parseScopeJson(record.scope);
        if (!scope.some((grant) => grant.dataClass === dataClass)) continue;
        const reduced = scope.filter((grant) => grant.dataClass !== dataClass);
        const created = await reviseConsentScope(
          participantId,
          record.instrumentType as InstrumentType,
          reduced,
          { grantedAt: clock, db: tx, expectedRevision: record.revision }
        );
        if (created) done.push(record.instrumentType as InstrumentType);
      }
      return done;
    })
  );

  return finishReport(participantId, "revoke", revised, before, dataClass);
}

/**
 * Restores ONE data class: every currently-granted instrument whose SIGNED
 * ceiling covers the class gets a NEW scope_revision event with the class's
 * previously-signed grants added back. A class the participant never signed
 * for throws ScopeCeilingError — enabling it requires the re-consent flow
 * (audit F-02). A fully revoked instrument is untouched — restoring it is
 * the all-or-nothing restore button's job.
 */
export async function restoreDataClass(
  participantId: string,
  dataClass: DataClass
): Promise<RevocationReport> {
  const before = await snapshotConsentImpact(participantId);
  const clock = await getSimClock();

  const revised = await withConsentRetry(() =>
    prisma.$transaction(async (tx) => {
      await assertActiveParticipant(participantId, tx);
      const records = await tx.consentRecord.findMany({ where: { participantId } });
      const latest = latestRecordsByInstrument(records);
      const ceilings = signedScopeCeilingByInstrument(records);
      const globalCeiling = signedScopeCeiling(records);

      if (!ceilingCoversClass(globalCeiling, dataClass)) {
        throw new ScopeCeilingError(participantId, "*", [
          { dataClass, use: "collect" },
        ]);
      }

      const done: InstrumentType[] = [];
      for (const record of latest.values()) {
        if (record.status !== "granted" || record.revokedAt !== null) continue;
        const instrument = record.instrumentType as InstrumentType;
        const ceiling = ceilings.get(instrument);
        if (!ceiling) continue;
        const signedGrants = ceilingToScope(ceiling).filter(
          (grant) => grant.dataClass === dataClass
        );
        if (signedGrants.length === 0) continue; // never signed on this instrument
        const scope = parseScopeJson(record.scope);
        const missing = signedGrants.filter(
          (grant) =>
            !scope.some((held) => held.dataClass === grant.dataClass && held.use === grant.use)
        );
        if (missing.length === 0) continue; // class already fully granted here
        const created = await reviseConsentScope(
          participantId,
          instrument,
          [...scope, ...missing],
          { grantedAt: clock, db: tx, expectedRevision: record.revision }
        );
        if (created) done.push(instrument);
      }
      return done;
    })
  );

  return finishReport(participantId, "restore", revised, before, dataClass);
}

export interface DataClassRowCounts {
  dataClass: DataClass;
  rows: number;
  viewIdentified: boolean;
  researchDeid: boolean;
}

/**
 * Rows at rest per data class for one participant (observations + sessions +
 * PROs + purchases + treatment events, classified by their own lineage),
 * alongside the current read-gate state — the "quarantined, not deleted"
 * panel. Also reports rows whose lineage cannot be classified (they are
 * quarantined outright — audit F-10).
 */
export async function countRowsByDataClass(participantId: string): Promise<{
  rows: DataClassRowCounts[];
  unclassifiedRows: number;
}> {
  const [grants, atRest] = await Promise.all([
    loadGrants(participantId),
    rowsAtRestByClass(participantId),
  ]);

  return {
    rows: DATA_CLASSES.filter((dataClass) => dataClass !== "linkage").map((dataClass) => ({
      dataClass,
      rows: atRest.byClass.get(dataClass) ?? 0,
      viewIdentified: grantSetHas(grants, dataClass, "view_identified"),
      researchDeid: grantSetHas(grants, dataClass, "research_deid"),
    })),
    unclassifiedRows: atRest.unclassified,
  };
}

// ---------------------------------------------------------------------------
// Console page data (kept here so pages never import raw prisma)
// ---------------------------------------------------------------------------

/** Consent ledger rows for the audit-trail table (immutable events). */
export type ConsentLedgerRecord = ConsentRecord;

/** A handful of Lane-C-linked participant ids for the console's picker. */
export async function listLinkageCandidates(limit = 6): Promise<string[]> {
  const records = await prisma.consentRecord.findMany({
    where: { instrumentType: "LANE_C" },
    select: { participantId: true },
    distinct: ["participantId"],
    take: limit,
    orderBy: { grantedAt: "asc" },
  });
  return records.map((record) => record.participantId);
}
