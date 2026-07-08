import {
  assertIngestAllowed,
  ConsentError,
  DATA_CLASSES,
  getConsentStates,
  getObservations,
  grantConsent,
  grantSetHas,
  grantsFor,
  loadAllGrants,
  loadGrants,
  revokeConsent,
  sourceToDataClass,
  type DataClass,
  type InstrumentType,
} from "../consent";
import { prisma } from "../db";
import { getSimClock } from "../simclock";
import { addDays } from "../synthetic/profiles";

/**
 * Revocation kill switch (DEMO.md Act 6 finale). revokeAllConsents flips
 * every currently-granted instrument to revoked (append-only — records are
 * never deleted), then PROVES the enforcement live: the ingest gate throws,
 * the gated readers block, and the consent-filtered cohort counts drop. The
 * restore path re-grants via NEW records, so the audit trail keeps the full
 * grant → revoke → re-grant history — the trail itself is the demo point.
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
  /** instruments revoked / re-granted by this action */
  instruments: InstrumentType[];
  before: ConsentImpactSnapshot;
  after: ConsentImpactSnapshot;
  ingestProbes: IngestProbe[];
  identifiedReadProbe: ReadProbe;
  researchReadProbe: ReadProbe;
}

/**
 * Revokes every currently-granted instrument, then re-checks enforcement.
 * Rows already at rest are NOT deleted — they are quarantined behind the
 * read gates (the row-count panel on the page makes that visible).
 */
export async function revokeAllConsents(participantId: string): Promise<RevocationReport> {
  const before = await snapshotConsentImpact(participantId);

  const states = await getConsentStates(participantId);
  const revoked: InstrumentType[] = [];
  for (const state of states) {
    if (state.status !== "granted") continue;
    const record = await revokeConsent(participantId, state.instrumentType as InstrumentType);
    if (record) revoked.push(state.instrumentType as InstrumentType);
  }

  const [after, ingestProbes, identifiedReadProbe, researchReadProbe] = await Promise.all([
    snapshotConsentImpact(participantId),
    probeIngestGates(participantId),
    probeGatedRead(participantId, "view_identified"),
    probeGatedRead(participantId, "research_deid"),
  ]);

  return {
    participantId,
    action: "revoke",
    instruments: revoked,
    before,
    after,
    ingestProbes,
    identifiedReadProbe,
    researchReadProbe,
  };
}

/**
 * Demo reset: re-grants every instrument the participant EVER signed, as new
 * ConsentRecords — the prior revocation stays in the ledger forever.
 */
export async function restoreAllConsents(participantId: string): Promise<RevocationReport> {
  const before = await snapshotConsentImpact(participantId);
  const clock = await getSimClock();

  const states = await getConsentStates(participantId);
  const granted: InstrumentType[] = [];
  for (const state of states) {
    if (state.status === "granted") continue; // already current
    await grantConsent(participantId, state.instrumentType as InstrumentType, {
      grantedAt: clock,
    });
    granted.push(state.instrumentType as InstrumentType);
  }

  const [after, ingestProbes, identifiedReadProbe, researchReadProbe] = await Promise.all([
    snapshotConsentImpact(participantId),
    probeIngestGates(participantId),
    probeGatedRead(participantId, "view_identified"),
    probeGatedRead(participantId, "research_deid"),
  ]);

  return {
    participantId,
    action: "restore",
    instruments: granted,
    before,
    after,
    ingestProbes,
    identifiedReadProbe,
    researchReadProbe,
  };
}

export interface DataClassRowCounts {
  dataClass: DataClass;
  rows: number;
  viewIdentified: boolean;
  researchDeid: boolean;
}

/**
 * Rows at rest per data class for one participant (observations + sessions +
 * PROs + purchases + treatment events), alongside the current read-gate
 * state — the "quarantined, not deleted" panel.
 */
export async function countRowsByDataClass(
  participantId: string
): Promise<DataClassRowCounts[]> {
  const [grants, obsGroups, sessionGroups, proCount, purchaseCount, eventCount] =
    await Promise.all([
      loadGrants(participantId),
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
      prisma.treatmentEvent.count({ where: { participantId } }),
    ]);

  const rows = new Map<DataClass, number>();
  const add = (dataClass: DataClass, count: number) =>
    rows.set(dataClass, (rows.get(dataClass) ?? 0) + count);
  for (const group of obsGroups) add(sourceToDataClass(group.source), group._count._all);
  for (const group of sessionGroups) add(sourceToDataClass(group.source), group._count._all);
  add("pro_responses", proCount);
  add("mattress_purchase", purchaseCount);
  add("hst_clinical", eventCount); // treatment events are clinical-lane

  return DATA_CLASSES.filter((dataClass) => dataClass !== "linkage").map((dataClass) => ({
    dataClass,
    rows: rows.get(dataClass) ?? 0,
    viewIdentified: grantSetHas(grants, dataClass, "view_identified"),
    researchDeid: grantSetHas(grants, dataClass, "research_deid"),
  }));
}
