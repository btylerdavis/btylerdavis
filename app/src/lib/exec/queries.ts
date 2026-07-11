import {
  getAllGrantedDevices,
  grantedObservationNights,
  grantSetHas,
  grantsFor,
  loadAllGrants,
  treatmentEventRowDataClass,
  type DataClass,
} from "../consent";
import { prisma } from "../db";
import { toIsoDay } from "../format";
import { getSimClock, simDayNumber } from "../simclock";

/**
 * Exec/business dashboard aggregates (DEMO.md Act 7 — Kevin's view).
 * Aggregate counts only, consent-filtered exactly like the coach and
 * research layers: effective grants are evaluated once (loadAllGrants) and
 * every stage/tile only counts participants holding the matching
 * view_identified grant — revoke someone and the funnel forgets them on the
 * next render. No names, no per-participant rows leave this module.
 */

/** SPEC §3.5 targets the growth bars are drawn against. */
export const TARGETS = {
  enrolledM12: { min: 300, max: 600, label: "Month-12 target · 300–600" },
  enrolledM24: { min: 1500, max: 3000, label: "Month-24 target · 1,500–3,000" },
  linkedM24: { min: 400, label: "Month-24 target · ≥ 400 linked" },
} as const;

/** Demo revenue assumptions (editable on the page, stored in URL params). */
export const DEFAULT_ASSUMPTIONS = {
  /** HST reimbursement per completed referral (~$300) */
  hstValue: 300,
  /** lifetime value of a CPAP setup (~$1,200) */
  cpapValue: 1200,
} as const;

export interface RevenueAssumptions {
  hstValue: number;
  cpapValue: number;
}

/** Parses ?hst=&cpap= URL params (clamped, integers, demo defaults). */
export function parseAssumptions(params: {
  hst?: string | string[];
  cpap?: string | string[];
}): RevenueAssumptions {
  const parse = (value: string | string[] | undefined, fallback: number): number => {
    const n = typeof value === "string" ? Number(value) : NaN;
    if (!Number.isFinite(n)) return fallback;
    return Math.min(100_000, Math.max(0, Math.round(n)));
  };
  return {
    hstValue: parse(params.hst, DEFAULT_ASSUMPTIONS.hstValue),
    cpapValue: parse(params.cpap, DEFAULT_ASSUMPTIONS.cpapValue),
  };
}

export interface ExecFunnelStage {
  stage: string;
  count: number;
  note?: string;
}

export interface ExecDashboard {
  clockIso: string;
  dayNumber: number;
  /** retail STOP-BANG → risk → HST → new-therapy conversions */
  funnel: ExecFunnelStage[];
  revenue: {
    assumptions: RevenueAssumptions;
    hstCount: number;
    cpapSetupCount: number;
    totalValue: number;
  };
  growth: {
    consented: number;
    linked: number;
  };
  assets: {
    consented: number;
    linked: number;
    observationNights: number;
    instrumented: number;
  };
  queryMs: number;
}

export async function loadExecDashboard(
  assumptions: RevenueAssumptions = { ...DEFAULT_ASSUMPTIONS }
): Promise<ExecDashboard> {
  const startedAt = performance.now();
  const clock = await getSimClock();

  const allGrants = await loadAllGrants();
  const [participants, screens, hstGroups, therapyEvents, matDevices, grantedNights] =
    await Promise.all([
      // Tombstones drop out of every stage/tile (defense in depth — F-01).
      prisma.participant.findMany({
        where: { deletedAt: null, lifecycleState: { not: "deleted" } },
        select: { id: true, enrollmentTouchpoint: true },
      }),
      prisma.proResponse.findMany({
        where: { instrument: "STOP_BANG", administeredAt: { lte: clock } },
        select: { participantId: true, totalScore: true },
      }),
      prisma.observation.groupBy({
        by: ["participantId"],
        where: { source: "hst", concept: "ahi", effectiveDate: { lte: clock } },
      }),
      prisma.treatmentEvent.findMany({
        where: {
          type: { in: ["cpap_setup", "appliance_delivery"] },
          eventDate: { lte: clock },
        },
        select: { participantId: true, type: true, dataClass: true },
      }),
      // Consent-gated device read: sleep-mat rows only for participants with
      // a current sleep_mat view grant.
      getAllGrantedDevices({
        use: "view_identified",
        classes: ["sleep_mat"],
        grants: allGrants,
      }),
      // Consent-aware nights: classified per source class BEFORE counting,
      // so a revoked class contributes zero nights (audit F-07).
      grantedObservationNights({ use: "view_identified", grants: allGrants }),
    ]);

  const canView = (participantId: string, dataClass: DataClass) =>
    grantSetHas(grantsFor(allGrants, participantId), dataClass, "view_identified");

  // Treatment events are gated per event on their OWN lineage class (audit
  // F-06): cpap_setup under cpap_telemetry, appliance_delivery under
  // hst_clinical. Unknown lineage is quarantined.
  const grantedEvents = therapyEvents.filter((event) => {
    const dataClass = treatmentEventRowDataClass(event);
    return dataClass !== null && canView(event.participantId, dataClass);
  });

  // --- the retail → clinic referral funnel -----------------------------------
  const retailIds = new Set(
    participants.filter((p) => p.enrollmentTouchpoint === "retail").map((p) => p.id)
  );
  const bestScore = new Map<string, number>();
  for (const screen of screens) {
    if (!retailIds.has(screen.participantId)) continue;
    if (!canView(screen.participantId, "pro_responses")) continue;
    const current = bestScore.get(screen.participantId);
    if (current === undefined || screen.totalScore > current) {
      bestScore.set(screen.participantId, screen.totalScore);
    }
  }
  const screened = new Set(bestScore.keys());
  const atRisk = new Set(
    [...bestScore.entries()].filter(([, score]) => score >= 3).map(([id]) => id)
  );

  const hstIds = new Set(
    hstGroups
      .map((group) => group.participantId)
      .filter((id) => canView(id, "hst_clinical"))
  );
  const hstDone = new Set([...atRisk].filter((id) => hstIds.has(id)));

  // CPAP setups count ONLY under a current cpap_telemetry grant (audit F-07:
  // the revenue tile must not price a revoked class).
  const cpapSetupIds = new Set(
    grantedEvents.filter((event) => event.type === "cpap_setup").map((e) => e.participantId)
  );
  const therapyIds = new Set(grantedEvents.map((event) => event.participantId));
  const converted = new Set([...hstDone].filter((id) => therapyIds.has(id)));
  const cpapSetupCount = [...hstDone].filter((id) => cpapSetupIds.has(id)).length;

  const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);
  const funnel: ExecFunnelStage[] = [
    { stage: "Retail STOP-BANG screens", count: screened.size },
    {
      stage: "Intermediate / high risk",
      count: atRisk.size,
      note: `score ≥ 3 · ${pct(atRisk.size, screened.size)}% of screens`,
    },
    {
      stage: "HST referrals completed",
      count: hstDone.size,
      note: `${pct(hstDone.size, atRisk.size)}% of at-risk`,
    },
    {
      stage: "New Sleeptopia therapy patients",
      count: converted.size,
      note: `CPAP or appliance started · ${pct(converted.size, hstDone.size)}% of HSTs`,
    },
  ];

  // --- growth vs SPEC §3.5 targets ---------------------------------------------
  const consented = participants.filter(
    (p) => grantsFor(allGrants, p.id).size > 0
  ).length;
  const linked = participants.filter((p) =>
    grantSetHas(grantsFor(allGrants, p.id), "linkage", "view_identified")
  ).length;

  // --- data-asset tiles -----------------------------------------------------------
  // Consent-aware nights: per-class classification happened upstream — a
  // revoked class contributes nothing here (audit F-07).
  let observationNights = 0;
  for (const nights of grantedNights.values()) observationNights += nights;
  // matDevices arrive pre-gated on the sleep_mat view grant.
  const instrumented = new Set(matDevices.map((device) => device.participantId)).size;

  return {
    clockIso: toIsoDay(clock),
    dayNumber: simDayNumber(clock),
    funnel,
    revenue: {
      assumptions,
      hstCount: hstDone.size,
      cpapSetupCount,
      totalValue:
        hstDone.size * assumptions.hstValue + cpapSetupCount * assumptions.cpapValue,
    },
    growth: { consented, linked },
    assets: { consented, linked, observationNights, instrumented },
    queryMs: Math.round(performance.now() - startedAt),
  };
}
