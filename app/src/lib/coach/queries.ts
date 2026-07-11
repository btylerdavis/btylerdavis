import type { ConsentRecord } from "@prisma/client";
import {
  activeParticipantIds,
  evaluateGrants,
  getAllGrantedDevices,
  grantSetHas,
  grantsFor,
  latestGrantedObservationDates,
  loadAllGrants,
  type DataClass,
} from "../consent";
import { prisma } from "../db";
import { toIsoDay } from "../format";
import { getLinkedDisplayNames } from "../identity";
import { getSimClock, MAX_SIM_DAYS, simDayNumber } from "../simclock";
import { addDays } from "../synthetic/profiles";

/**
 * Coach portal aggregates (DEMO.md Act 4) — the Sleeptopia-side operational
 * view over ~800k observations, tuned to render well under 2s:
 *
 * - counts come from indexed groupBy aggregates and ONE raw SQL pass (the
 *   per-participant post-setup adherence for the funnel, which needs a
 *   per-row date window SQL can compute in a single scan);
 * - consent applies cohort-wide: effective grants are evaluated once via
 *   loadAllGrants, and every derived number/name is filtered to participants
 *   holding the matching view_identified grant — revoke a participant and
 *   they drop out of these aggregates on the next render;
 * - identity names flow only through identity.ts (getLinkedDisplayNames),
 *   double-gated on the Lane C linkage grant.
 *
 * NOTE: the raw query uses epoch-ms date arithmetic (Prisma stores SQLite
 * DateTime as INTEGER ms). On the planned Postgres swap, replace the two
 * `+ <ms>` windows with `+ interval '30 days'` / `+ interval '90 days'`.
 */

const ADHERENT_NIGHT_MIN = 240; // ≥4 h usage
const ADHERENCE_WINDOW_DAYS = 30;
const ADHERENT_PCT = 70;
export const COACH_PAGE_SIZE = 25;

const DAY_MS = 86_400_000;

export interface CoachPatientRow {
  participantId: string;
  /** present only with a current Lane C linkage grant (identified tier) */
  displayName: string | null;
  enrollmentDateIso: string;
  enrollmentTouchpoint: string;
  armBadges: string[];
  lastDataIso: string | null;
  /** % of CPAP-data nights ≥4 h in the last 30 sim-days; null = no CPAP data */
  adherencePct: number | null;
  flags: string[];
}

export interface CoachFlagRow {
  participantId: string;
  displayName: string | null;
  detail: string;
  sinceIso: string;
}

export interface CoachDashboard {
  clockIso: string;
  dayNumber: number;
  daysRemaining: number;
  tiles: {
    enrolled: number;
    activeLast7: number;
    cpapAdherent: number;
    supinePredominant: number;
    linked: number;
  };
  funnel: { stage: string; count: number; note?: string }[];
  flags: {
    wearableGaps: CoachFlagRow[];
    therapyGaps: CoachFlagRow[];
    overduePros: CoachFlagRow[];
  };
  patients: {
    rows: CoachPatientRow[];
    total: number;
    page: number;
    pageCount: number;
    sortDir: "asc" | "desc";
  };
  /** wall-clock ms spent loading every query on this render */
  queryMs: number;
}

interface FunnelRawRow {
  pid: string;
  setupMs: bigint | number;
  ok30: bigint | number;
  n30: bigint | number;
  ok90: bigint | number;
  n90: bigint | number;
}

const asNumber = (value: bigint | number): number => Number(value);

export async function loadCoachDashboard(opts: {
  page: number;
  sortDir: "asc" | "desc";
}): Promise<CoachDashboard> {
  const startedAt = performance.now();
  const clock = await getSimClock();
  const windowFrom = addDays(clock, -ADHERENCE_WINDOW_DAYS);

  const [allGrants, participants, laneARecords] = await Promise.all([
    loadAllGrants(),
    // Tombstones never appear in coach numbers (deletion revokes everything
    // anyway; the lifecycle filter is defense in depth — audit F-01).
    prisma.participant.findMany({
      where: { deletedAt: null, lifecycleState: { not: "deleted" } },
      select: { id: true, createdAt: true, enrollmentTouchpoint: true },
    }),
    prisma.consentRecord.findMany({ where: { instrumentType: "LANE_A" } }),
  ]);

  const canView = (participantId: string, dataClass: DataClass) =>
    grantSetHas(grantsFor(allGrants, participantId), dataClass, "view_identified");

  // --- clinic roster: everyone with a CURRENT granted Lane A -----------------
  // Membership uses the consent engine's own evaluation (evaluateGrants) over
  // the participant's Lane A history: the latest record must be granted and
  // not revoked. A fully-revoked participant is NOT on the roster and appears
  // in no coach number; the /compliance/revocation console (which reads the
  // consent ledger directly) is where revoked participants remain visible.
  const laneAByParticipant = new Map<string, ConsentRecord[]>();
  for (const record of laneARecords) {
    const list = laneAByParticipant.get(record.participantId) ?? [];
    list.push(record);
    laneAByParticipant.set(record.participantId, list);
  }
  const roster = participants.filter((participant) => {
    const records = laneAByParticipant.get(participant.id);
    return records !== undefined && evaluateGrants(records).size > 0;
  });
  const rosterIds = new Set(roster.map((participant) => participant.id));

  // --- aggregates (all indexed groupBy / one raw scan) -----------------------
  const [
    denominatorGroups,
    numeratorGroups,
    activeGranted,
    lastWearableGroups,
    recentGapGroups,
    hstRows,
    cpapSetups,
    funnelRaw,
    devices,
    purchases,
    essResponses,
  ] = await Promise.all([
    prisma.observation.groupBy({
      by: ["participantId"],
      where: {
        concept: { in: ["cpap_usage_minutes", "therapy_gap"] },
        effectiveDate: { gt: windowFrom, lte: clock },
      },
      _count: { _all: true },
    }),
    prisma.observation.groupBy({
      by: ["participantId"],
      where: {
        concept: "cpap_usage_minutes",
        valueNumeric: { gte: ADHERENT_NIGHT_MIN },
        effectiveDate: { gt: windowFrom, lte: clock },
      },
      _count: { _all: true },
    }),
    // Consent-aware activity: each observation is classified into its data
    // class BEFORE aggregation, so a participant whose only recent rows
    // belong to a revoked class is NOT "active" (audit F-07).
    activeParticipantIds(
      { from: addDays(clock, -7), to: clock },
      { use: "view_identified", grants: allGrants }
    ),
    prisma.observation.groupBy({
      by: ["participantId"],
      where: { concept: "sleep_duration_min" },
      _max: { effectiveDate: true },
    }),
    prisma.observation.groupBy({
      by: ["participantId"],
      where: { concept: "therapy_gap", effectiveDate: { gt: addDays(clock, -5), lte: clock } },
      _count: { _all: true },
    }),
    prisma.observation.findMany({
      where: { source: "hst", concept: { in: ["supine_ahi", "nonsupine_ahi"] } },
      select: { participantId: true, concept: true, valueNumeric: true },
    }),
    prisma.treatmentEvent.findMany({
      where: { type: "cpap_setup", eventDate: { lte: clock } },
      select: { participantId: true, eventDate: true },
    }),
    prisma.$queryRaw<FunnelRawRow[]>`
      SELECT
        o.participantId AS pid,
        te.eventDate AS setupMs,
        SUM(CASE WHEN o.effectiveDate <= te.eventDate + ${30 * DAY_MS}
                  AND o.concept = 'cpap_usage_minutes'
                  AND o.valueNumeric >= ${ADHERENT_NIGHT_MIN} THEN 1 ELSE 0 END) AS ok30,
        SUM(CASE WHEN o.effectiveDate <= te.eventDate + ${30 * DAY_MS} THEN 1 ELSE 0 END) AS n30,
        SUM(CASE WHEN o.effectiveDate <= te.eventDate + ${90 * DAY_MS}
                  AND o.concept = 'cpap_usage_minutes'
                  AND o.valueNumeric >= ${ADHERENT_NIGHT_MIN} THEN 1 ELSE 0 END) AS ok90,
        SUM(CASE WHEN o.effectiveDate <= te.eventDate + ${90 * DAY_MS} THEN 1 ELSE 0 END) AS n90
      FROM "Observation" o
      JOIN "TreatmentEvent" te
        ON te.participantId = o.participantId AND te.type = 'cpap_setup'
      WHERE o.concept IN ('cpap_usage_minutes', 'therapy_gap')
        AND o.effectiveDate > te.eventDate
      GROUP BY o.participantId, te.eventDate
    `,
    // Consent-gated device read: only devices whose participant holds the
    // matching view_identified grant come back (F-series audit: no raw reads).
    getAllGrantedDevices({
      use: "view_identified",
      classes: ["wearable", "cpap", "appliance"],
      grants: allGrants,
    }),
    prisma.mattressPurchase.findMany({ select: { participantId: true } }),
    prisma.proResponse.findMany({
      where: { instrument: "ESS" },
      select: { participantId: true, administeredAt: true },
    }),
  ]);

  // --- adherence % (last 30 sim-days), consent-filtered ----------------------
  const denominators = new Map(
    denominatorGroups.map((group) => [group.participantId, group._count._all])
  );
  const numerators = new Map(
    numeratorGroups.map((group) => [group.participantId, group._count._all])
  );
  const adherence = new Map<string, number>();
  for (const [participantId, nights] of denominators) {
    if (!rosterIds.has(participantId)) continue;
    if (nights === 0 || !canView(participantId, "cpap_telemetry")) continue;
    adherence.set(
      participantId,
      Math.round(((numerators.get(participantId) ?? 0) / nights) * 100)
    );
  }

  // --- funnel tiles -----------------------------------------------------------
  const activeIds = new Set(
    [...activeGranted].filter((participantId) => rosterIds.has(participantId))
  );

  const supineByParticipant = new Map<string, { supine?: number; nonsupine?: number }>();
  for (const row of hstRows) {
    if (!rosterIds.has(row.participantId)) continue;
    if (!canView(row.participantId, "hst_clinical")) continue;
    const entry = supineByParticipant.get(row.participantId) ?? {};
    if (row.concept === "supine_ahi") entry.supine = row.valueNumeric ?? undefined;
    else entry.nonsupine = row.valueNumeric ?? undefined;
    supineByParticipant.set(row.participantId, entry);
  }
  let supinePredominant = 0;
  for (const entry of supineByParticipant.values()) {
    if (entry.supine !== undefined && entry.nonsupine !== undefined && entry.supine >= 2 * entry.nonsupine) {
      supinePredominant += 1;
    }
  }

  const linked = roster.filter((participant) =>
    grantSetHas(grantsFor(allGrants, participant.id), "linkage", "view_identified")
  ).length;

  // --- adherence funnel (per-participant post-setup windows) -----------------
  const setupByParticipant = new Map<string, Date>();
  for (const setup of cpapSetups) {
    const existing = setupByParticipant.get(setup.participantId);
    if (!existing || setup.eventDate < existing) {
      setupByParticipant.set(setup.participantId, setup.eventDate);
    }
  }
  const funnelById = new Map<string, FunnelRawRow>();
  for (const row of funnelRaw) {
    if (!funnelById.has(row.pid)) funnelById.set(row.pid, row);
  }

  let stageSetup = 0;
  let stageFlowing = 0;
  let eligible30 = 0;
  let adherent30 = 0;
  let eligible90 = 0;
  let adherent90 = 0;
  for (const [participantId, setupDate] of setupByParticipant) {
    if (!rosterIds.has(participantId)) continue;
    if (!canView(participantId, "cpap_telemetry")) continue;
    stageSetup += 1;
    const row = funnelById.get(participantId);
    const total = row ? asNumber(row.n90) : 0;
    if (total > 0) stageFlowing += 1;
    if (addDays(setupDate, 30) <= clock) {
      eligible30 += 1;
      if (row && asNumber(row.n30) > 0 && asNumber(row.ok30) / asNumber(row.n30) >= 0.7) {
        adherent30 += 1;
      }
    }
    if (addDays(setupDate, 90) <= clock) {
      eligible90 += 1;
      if (row && asNumber(row.n90) > 0 && asNumber(row.ok90) / asNumber(row.n90) >= 0.7) {
        adherent90 += 1;
      }
    }
  }

  // --- data-quality flags ------------------------------------------------------
  const wearableDeviceIds = new Set(
    devices.filter((device) => device.deviceClass === "wearable").map((device) => device.participantId)
  );
  const lastWearable = new Map(
    lastWearableGroups.map((group) => [group.participantId, group._max.effectiveDate as Date])
  );
  const wearableGapIds: { participantId: string; sinceIso: string; detail: string }[] = [];
  for (const participant of roster) {
    if (!wearableDeviceIds.has(participant.id)) continue;
    if (!canView(participant.id, "wearable_sleep")) continue;
    const last = lastWearable.get(participant.id) ?? participant.createdAt;
    const silentDays = Math.floor((clock.getTime() - last.getTime()) / DAY_MS);
    if (silentDays >= 7) {
      wearableGapIds.push({
        participantId: participant.id,
        sinceIso: toIsoDay(addDays(last, 1)),
        detail: `${silentDays} nights without wearable data`,
      });
    }
  }
  wearableGapIds.sort((a, b) => a.sinceIso.localeCompare(b.sinceIso));

  const gapStreakIds = recentGapGroups
    .filter(
      (group) =>
        group._count._all >= 5 &&
        rosterIds.has(group.participantId) &&
        canView(group.participantId, "cpap_telemetry")
    )
    .map((group) => group.participantId);
  // Streak start: the night after the last recorded usage (or setup date).
  const lastUsageGroups = gapStreakIds.length
    ? await prisma.observation.groupBy({
        by: ["participantId"],
        where: { concept: "cpap_usage_minutes", participantId: { in: gapStreakIds } },
        _max: { effectiveDate: true },
      })
    : [];
  const lastUsage = new Map(
    lastUsageGroups.map((group) => [group.participantId, group._max.effectiveDate as Date])
  );
  const therapyGapRows = gapStreakIds
    .map((participantId) => {
      const since = addDays(
        lastUsage.get(participantId) ?? setupByParticipant.get(participantId) ?? clock,
        1
      );
      const nights = Math.floor((clock.getTime() - since.getTime()) / DAY_MS) + 1;
      return {
        participantId,
        sinceIso: toIsoDay(since),
        detail: `${nights} straight therapy-gap nights`,
      };
    })
    .sort((a, b) => a.sinceIso.localeCompare(b.sinceIso));

  const essByParticipant = new Map<string, Date[]>();
  for (const response of essResponses) {
    const list = essByParticipant.get(response.participantId) ?? [];
    list.push(response.administeredAt);
    essByParticipant.set(response.participantId, list);
  }
  const overdueRows: { participantId: string; sinceIso: string; detail: string }[] = [];
  for (const participant of roster) {
    const participantGrants = grantsFor(allGrants, participant.id);
    // A revoked participant isn't "overdue" — nothing is due once collection stops.
    if (
      !grantSetHas(participantGrants, "pro_responses", "collect") ||
      !grantSetHas(participantGrants, "pro_responses", "view_identified")
    ) {
      continue;
    }
    const responses = essByParticipant.get(participant.id) ?? [];
    for (const offset of [30, 90]) {
      const due = addDays(participant.createdAt, offset);
      if (addDays(due, 5) > clock) continue; // inside the 5-day grace window
      const answered = responses.some(
        (administeredAt) => Math.abs(administeredAt.getTime() - due.getTime()) <= 10 * DAY_MS
      );
      if (!answered) {
        overdueRows.push({
          participantId: participant.id,
          sinceIso: toIsoDay(due),
          detail: `Day-${offset} questionnaire due, not received`,
        });
      }
    }
  }
  overdueRows.sort((a, b) => a.sinceIso.localeCompare(b.sinceIso));

  const flagged = new Map<string, string[]>();
  const markFlag = (participantId: string, flag: string) => {
    const list = flagged.get(participantId) ?? [];
    list.push(flag);
    flagged.set(participantId, list);
  };
  for (const row of wearableGapIds) markFlag(row.participantId, "Wearable silent");
  for (const row of therapyGapRows) markFlag(row.participantId, "Therapy gap");
  for (const row of overdueRows) markFlag(row.participantId, "PRO overdue");
  // NOTE: there is intentionally no "Consent revoked" flag — a participant
  // without a current Lane A grant is not on the roster at all. Revocations
  // are audited on the /compliance/revocation console instead.

  // --- patient list: sort by adherence, page, then hydrate the page ----------
  const sorted = [...roster].sort((a, b) => {
    const aAdh = adherence.get(a.id);
    const bAdh = adherence.get(b.id);
    if (aAdh === undefined && bAdh === undefined) {
      return a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
    }
    if (aAdh === undefined) return 1; // no-CPAP rows always sink
    if (bAdh === undefined) return -1;
    const delta = opts.sortDir === "asc" ? aAdh - bAdh : bAdh - aAdh;
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  });

  const pageCount = Math.max(1, Math.ceil(sorted.length / COACH_PAGE_SIZE));
  const page = Math.min(Math.max(1, opts.page), pageCount);
  const pageRows = sorted.slice((page - 1) * COACH_PAGE_SIZE, page * COACH_PAGE_SIZE);
  const pageIds = pageRows.map((participant) => participant.id);

  // Consent-aware "last data": the freshest night among GRANTED classes only
  // — a sealed class must not leak freshness (audit F-07).
  const [lastData, pageNames] = await Promise.all([
    latestGrantedObservationDates(pageIds, { use: "view_identified", grants: allGrants }),
    getLinkedDisplayNames(pageIds, { grants: allGrants }),
  ]);

  const cpapDeviceIds = new Set(
    devices.filter((device) => device.deviceClass === "cpap").map((device) => device.participantId)
  );
  const applianceDeviceIds = new Set(
    devices
      .filter((device) => device.deviceClass === "appliance")
      .map((device) => device.participantId)
  );
  const purchaseIds = new Set(purchases.map((purchase) => purchase.participantId));

  const rows: CoachPatientRow[] = pageRows.map((participant) => {
    const armBadges: string[] = [];
    if (cpapDeviceIds.has(participant.id)) armBadges.push("CPAP");
    if (applianceDeviceIds.has(participant.id)) armBadges.push("Appliance");
    if (purchaseIds.has(participant.id) && canView(participant.id, "mattress_purchase")) {
      armBadges.push("Mattress");
    }
    const last = lastData.get(participant.id);
    return {
      participantId: participant.id,
      displayName: pageNames.get(participant.id) ?? null,
      enrollmentDateIso: toIsoDay(participant.createdAt),
      enrollmentTouchpoint: participant.enrollmentTouchpoint,
      armBadges,
      lastDataIso: last ? toIsoDay(last) : null,
      adherencePct: adherence.get(participant.id) ?? null,
      flags: flagged.get(participant.id) ?? [],
    };
  });

  // Names for the flag panels (top rows only, same identity gate).
  const flagPanelIds = [
    ...new Set(
      [...wearableGapIds, ...therapyGapRows, ...overdueRows]
        .slice(0, 60)
        .map((row) => row.participantId)
    ),
  ];
  const flagNames = await getLinkedDisplayNames(flagPanelIds, { grants: allGrants });
  const toFlagRows = (
    source: { participantId: string; sinceIso: string; detail: string }[]
  ): CoachFlagRow[] =>
    source.map((row) => ({
      participantId: row.participantId,
      displayName: flagNames.get(row.participantId) ?? null,
      detail: row.detail,
      sinceIso: row.sinceIso,
    }));

  const dayNumber = simDayNumber(clock);
  return {
    clockIso: toIsoDay(clock),
    dayNumber,
    daysRemaining: Math.max(0, MAX_SIM_DAYS - dayNumber),
    tiles: {
      enrolled: roster.length,
      activeLast7: activeIds.size,
      cpapAdherent: [...adherence.values()].filter((pct) => pct >= ADHERENT_PCT).length,
      supinePredominant,
      linked,
    },
    funnel: [
      { stage: "CPAP set up", count: stageSetup },
      { stage: "Telemetry flowing", count: stageFlowing },
      {
        stage: "Adherent at 30 days",
        count: adherent30,
        note: `of ${eligible30.toLocaleString("en-US")} eligible`,
      },
      {
        stage: "Adherent at 90 days",
        count: adherent90,
        note: `of ${eligible90.toLocaleString("en-US")} eligible`,
      },
    ],
    flags: {
      wearableGaps: toFlagRows(wearableGapIds),
      therapyGaps: toFlagRows(therapyGapRows),
      overduePros: toFlagRows(overdueRows),
    },
    patients: {
      rows,
      total: sorted.length,
      page,
      pageCount,
      sortDir: opts.sortDir,
    },
    queryMs: Math.round(performance.now() - startedAt),
  };
}
