import {
  DATA_CLASSES,
  getAllGrantedDevices,
  grantSetHas,
  grantsFor,
  loadAllGrants,
  type DataClass,
  type GrantSet,
} from "../consent";
import { prisma } from "../db";
import { getSimClock } from "../simclock";

/**
 * The research-tier cohort loader (DEMO.md Act 5) — one pass over the
 * ~784k-observation store that every /research page shares. Design mirrors
 * loadCoachDashboard: a handful of indexed groupBy/raw-SQL scans return
 * per-participant aggregates (≤ 2,000 groups each), and consent applies
 * cohort-wide in JS from ONE loadAllGrants evaluation.
 *
 * Consent semantics (use = "research_deid"):
 * - a participant with NO current research_deid grant on any data class is
 *   not a member at all — revoke someone and they vanish from every count;
 * - each attribute/outcome is scoped to its data class: no hst_clinical
 *   grant → severity/AHI/arm are null; no pro_responses grant → ESS change
 *   is null; and so on. Nulls simply drop out of means and filters.
 *
 * NOTE: raw SQL uses epoch-ms date arithmetic (Prisma stores SQLite DateTime
 * as INTEGER ms). On the Postgres swap, replace `+ <ms>` with intervals.
 */

export type SeverityBand = "mild" | "moderate" | "severe";
export type FirmnessBand = "soft" | "medium" | "firm";
export type ArmKey =
  | "cpap"
  | "appliance"
  | "mattress_only"
  | "cpap_mattress"
  | "appliance_mattress";

export const ARM_ORDER: ArmKey[] = [
  "cpap",
  "appliance",
  "mattress_only",
  "cpap_mattress",
  "appliance_mattress",
];

export const ARM_LABELS: Record<ArmKey, string> = {
  cpap: "CPAP only",
  appliance: "Appliance only",
  mattress_only: "Mattress only",
  cpap_mattress: "CPAP + mattress",
  appliance_mattress: "Appliance + mattress",
};

export const FIRMNESS_BAND_LABELS: Record<FirmnessBand, string> = {
  soft: "Soft (1–4)",
  medium: "Medium (5–7)",
  firm: "Firm (8–10)",
};

/** Normalized 1–10 firmness → band (soft 1–4 / medium 5–7 / firm 8–10). */
export function firmnessBand(rating: number): FirmnessBand {
  if (rating <= 4) return "soft";
  if (rating <= 7) return "medium";
  return "firm";
}

export function severityFromAhi(ahi: number): SeverityBand {
  if (ahi < 15) return "mild";
  if (ahi < 30) return "moderate";
  return "severe";
}

// Pre→post windows around mattress delivery (nights relative to delivery).
// Post starts at +8 to skip the ~7-night adjustment ramp; both windows need
// MIN_WINDOW_NIGHTS valid nights to count (SPEC §6.5 validity spirit).
export const SUPINE_PRE_DAYS = 28;
export const SUPINE_POST_START = 8;
export const SUPINE_POST_END = 35;
export const MIN_WINDOW_NIGHTS = 5;

const DAY_MS = 86_400_000;

export interface ResearchMember {
  id: string;
  /**
   * Demographics are registry_demographics-class data (audit F-11): null
   * unless the member holds a current research_deid grant on that class — a
   * linkage-only (or otherwise narrow) grant carries NO demographic fields
   * into the research tier or its exports.
   */
  sex: string | null;
  yearOfBirth: number | null;
  /** age at the sim clock (registry_demographics-scoped) */
  age: number | null;
  door: string | null;
  /** enrollment metadata (registry_demographics-scoped in every export) */
  enrollmentDate: Date | null;
  /** internal date-shift anchor — never exported directly */
  enrollmentAnchor: Date;
  grants: GrantSet;

  // hst_clinical-scoped
  ahi: number | null;
  severity: SeverityBand | null;
  supinePredominant: boolean | null;
  hstDate: Date | null;

  // treatment arm — needs hst_clinical (therapy devices are clinical-lane);
  // the mattress component additionally needs mattress_purchase
  arm: ArmKey | null;

  // mattress_purchase-scoped
  brand: string | null;
  model: string | null;
  materialClass: string | null;
  firmnessRating: number | null;
  firmnessBand: FirmnessBand | null;
  purchaseDate: Date | null;
  deliveryDate: Date | null;

  // pro_responses-scoped (ESS)
  essBaseline: number | null;
  essDay90: number | null;
  /** day-90 − baseline (negative = improvement); null unless both exist */
  essChange90: number | null;
  /** latest follow-up (day 90, else day 30) − baseline */
  essChangeFollowup: number | null;

  // cpap_telemetry-scoped
  /** % of post-setup CPAP nights (incl. therapy gaps) with ≥ 4 h usage */
  cpapAdherencePct: number | null;

  // sleep_mat-scoped (around mattress delivery)
  supinePre: number | null;
  supinePost: number | null;
  /** post − pre in percentage points (negative = less supine time) */
  supineChange: number | null;

  // wearable_sleep-scoped
  seffBaseline: number | null;
  seffDay90: number | null;
  seffChange: number | null;
}

export interface SupineNight {
  participantId: string;
  /** whole days relative to mattress delivery (0 = first post-delivery night) */
  dayOffset: number;
  value: number;
}

export interface ResearchCohort {
  clock: Date;
  /** participants holding ≥ 1 current research_deid grant */
  members: ResearchMember[];
  byId: Map<string, ResearchMember>;
  /**
   * Consent-filtered nightly supine observations in the −4w..+9w window
   * around delivery, for members with a delivery date (positional charts).
   */
  supineNights: SupineNight[];
  /** wall-clock ms spent on every query in this load */
  queryMs: number;
}

interface HstRow {
  pid: string;
  ahi: number | null;
  supineAhi: number | null;
  nonsupineAhi: number | null;
  hstMs: bigint | number | null;
}

interface EssRow {
  pid: string;
  base: number | null;
  day30: number | null;
  day90: number | null;
}

interface CpapRow {
  pid: string;
  ok: bigint | number;
  n: bigint | number;
}

interface SeffRow {
  pid: string;
  base: number | null;
  baseN: bigint | number;
  day90: number | null;
  day90N: bigint | number;
}

interface SupineRawRow {
  pid: string;
  offsetMs: bigint | number;
  value: number;
}

const num = (v: bigint | number): number => Number(v);

export async function loadResearchCohort(): Promise<ResearchCohort> {
  const startedAt = performance.now();
  const clock = await getSimClock();

  const allGrants = await loadAllGrants();
  const [participants, purchases, devices, hstRows, essRows, cpapRows, seffRows, supineRaw] =
    await Promise.all([
      // Tombstones can NEVER be research members, regardless of any grant
      // residue (audit F-01/F-11) — deletion revokes everything anyway, but
      // the lifecycle filter is enforced here too, in depth.
      prisma.participant.findMany({
        where: { deletedAt: null, lifecycleState: { not: "deleted" } },
        select: {
          id: true,
          yearOfBirth: true,
          sex: true,
          enrollmentTouchpoint: true,
          createdAt: true,
        },
      }),
      prisma.mattressPurchase.findMany({ include: { catalogItem: true } }),
      // Consent-gated device read: therapy devices come back only for
      // participants whose research_deid grant covers the device's class.
      getAllGrantedDevices({
        use: "research_deid",
        classes: ["cpap", "appliance"],
        grants: allGrants,
      }),
      // Baseline HST values + study date (hst-only concepts, indexed on concept).
      prisma.$queryRaw<HstRow[]>`
        SELECT participantId AS pid,
               MAX(CASE WHEN concept = 'ahi' THEN valueNumeric END) AS ahi,
               MAX(CASE WHEN concept = 'supine_ahi' THEN valueNumeric END) AS supineAhi,
               MAX(CASE WHEN concept = 'nonsupine_ahi' THEN valueNumeric END) AS nonsupineAhi,
               MAX(effectiveDate) AS hstMs
        FROM "Observation"
        WHERE concept IN ('ahi', 'supine_ahi', 'nonsupine_ahi')
        GROUP BY participantId
      `,
      // ESS at baseline / day-30 / day-90 windows relative to enrollment.
      prisma.$queryRaw<EssRow[]>`
        SELECT pr.participantId AS pid,
               AVG(CASE WHEN pr.administeredAt <= p.createdAt + ${10 * DAY_MS}
                        THEN pr.totalScore END) AS base,
               AVG(CASE WHEN pr.administeredAt >= p.createdAt + ${20 * DAY_MS}
                         AND pr.administeredAt <= p.createdAt + ${45 * DAY_MS}
                        THEN pr.totalScore END) AS day30,
               AVG(CASE WHEN pr.administeredAt >= p.createdAt + ${80 * DAY_MS}
                         AND pr.administeredAt <= p.createdAt + ${105 * DAY_MS}
                        THEN pr.totalScore END) AS day90
        FROM "ProResponse" pr
        JOIN "Participant" p ON p.id = pr.participantId
        WHERE pr.instrument = 'ESS'
        GROUP BY pr.participantId
      `,
      // CPAP adherence over all post-setup data nights (gaps in denominator).
      prisma.$queryRaw<CpapRow[]>`
        SELECT participantId AS pid,
               SUM(CASE WHEN concept = 'cpap_usage_minutes' AND valueNumeric >= 240
                        THEN 1 ELSE 0 END) AS ok,
               COUNT(*) AS n
        FROM "Observation"
        WHERE concept IN ('cpap_usage_minutes', 'therapy_gap')
        GROUP BY participantId
      `,
      // Sleep efficiency: first-two-weeks baseline vs day 76–90 window.
      prisma.$queryRaw<SeffRow[]>`
        SELECT o.participantId AS pid,
               AVG(CASE WHEN o.effectiveDate <= p.createdAt + ${14 * DAY_MS}
                        THEN o.valueNumeric END) AS base,
               COUNT(CASE WHEN o.effectiveDate <= p.createdAt + ${14 * DAY_MS}
                          THEN 1 END) AS baseN,
               AVG(CASE WHEN o.effectiveDate >= p.createdAt + ${76 * DAY_MS}
                         AND o.effectiveDate <= p.createdAt + ${90 * DAY_MS}
                        THEN o.valueNumeric END) AS day90,
               COUNT(CASE WHEN o.effectiveDate >= p.createdAt + ${76 * DAY_MS}
                           AND o.effectiveDate <= p.createdAt + ${90 * DAY_MS}
                          THEN 1 END) AS day90N
        FROM "Observation" o
        JOIN "Participant" p ON p.id = o.participantId
        WHERE o.concept = 'sleep_efficiency'
        GROUP BY o.participantId
      `,
      // Nightly supine % relative to (first) mattress delivery, −4w..+9w.
      prisma.$queryRaw<SupineRawRow[]>`
        SELECT o.participantId AS pid,
               o.effectiveDate - mp.deliveryMs AS offsetMs,
               o.valueNumeric AS value
        FROM "Observation" o
        JOIN (
          SELECT participantId, MIN(deliveryDate) AS deliveryMs
          FROM "MattressPurchase"
          WHERE deliveryDate IS NOT NULL
          GROUP BY participantId
        ) mp ON mp.participantId = o.participantId
        WHERE o.source = 'sleep_mat'
          AND o.concept = 'supine_time_pct'
          AND o.valueNumeric IS NOT NULL
          AND o.effectiveDate >= mp.deliveryMs - ${SUPINE_PRE_DAYS * DAY_MS}
          AND o.effectiveDate <= mp.deliveryMs + ${63 * DAY_MS}
      `,
    ]);

  const canResearch = (pid: string, dataClass: DataClass) =>
    grantSetHas(grantsFor(allGrants, pid), dataClass, "research_deid");
  const isMember = (pid: string) =>
    DATA_CLASSES.some((dataClass) => canResearch(pid, dataClass));

  const hstById = new Map(hstRows.map((row) => [row.pid, row]));
  const essById = new Map(essRows.map((row) => [row.pid, row]));
  const cpapById = new Map(cpapRows.map((row) => [row.pid, row]));
  const seffById = new Map(seffRows.map((row) => [row.pid, row]));

  const firstPurchase = new Map<string, (typeof purchases)[number]>();
  for (const purchase of purchases) {
    const current = firstPurchase.get(purchase.participantId);
    if (!current || purchase.purchaseDate < current.purchaseDate) {
      firstPurchase.set(purchase.participantId, purchase);
    }
  }
  const cpapIds = new Set(
    devices.filter((d) => d.deviceClass === "cpap").map((d) => d.participantId)
  );
  const applianceIds = new Set(
    devices.filter((d) => d.deviceClass === "appliance").map((d) => d.participantId)
  );

  // Supine pre/post per participant from the nightly rows (windowed means).
  const supineAgg = new Map<
    string,
    { preSum: number; preN: number; postSum: number; postN: number }
  >();
  const supineNights: SupineNight[] = [];
  for (const row of supineRaw) {
    if (!canResearch(row.pid, "sleep_mat")) continue;
    const dayOffset = Math.round(num(row.offsetMs) / DAY_MS);
    supineNights.push({ participantId: row.pid, dayOffset, value: row.value });
    const agg =
      supineAgg.get(row.pid) ?? { preSum: 0, preN: 0, postSum: 0, postN: 0 };
    if (dayOffset >= -SUPINE_PRE_DAYS && dayOffset < 0) {
      agg.preSum += row.value;
      agg.preN += 1;
    } else if (dayOffset >= SUPINE_POST_START && dayOffset <= SUPINE_POST_END) {
      agg.postSum += row.value;
      agg.postN += 1;
    }
    supineAgg.set(row.pid, agg);
  }

  const members: ResearchMember[] = [];
  for (const participant of participants) {
    if (!isMember(participant.id)) continue;
    const pid = participant.id;
    const grants = grantsFor(allGrants, pid);

    // Demographics + enrollment metadata are registry_demographics-class
    // data (audit F-11): without that research grant they are null here and
    // absent from every export/filter built on the member.
    const demographics = canResearch(pid, "registry_demographics");

    // --- hst_clinical-scoped -------------------------------------------------
    const hst = canResearch(pid, "hst_clinical") ? hstById.get(pid) : undefined;
    const ahi = hst?.ahi ?? null;
    const supinePredominant =
      hst?.supineAhi != null && hst?.nonsupineAhi != null
        ? hst.supineAhi >= 2 * hst.nonsupineAhi
        : null;

    // --- mattress_purchase-scoped --------------------------------------------
    const purchase = canResearch(pid, "mattress_purchase")
      ? firstPurchase.get(pid)
      : undefined;

    // --- arm derivation --------------------------------------------------------
    // Device rows arrive pre-gated (cpap → cpap_telemetry, appliance →
    // hst_clinical); the arm itself is a clinical attribute → hst_clinical
    // scope. The mattress component comes from the consent-scoped purchase.
    let arm: ArmKey | null = null;
    if (canResearch(pid, "hst_clinical")) {
      const hasCpap = cpapIds.has(pid);
      const hasAppliance = applianceIds.has(pid);
      const hasMattress = purchase !== undefined;
      if (hasCpap) arm = hasMattress ? "cpap_mattress" : "cpap";
      else if (hasAppliance) arm = hasMattress ? "appliance_mattress" : "appliance";
      else if (hasMattress) arm = "mattress_only";
    }

    // --- outcomes ---------------------------------------------------------------
    const ess = canResearch(pid, "pro_responses") ? essById.get(pid) : undefined;
    const essBaseline = ess?.base ?? null;
    const essDay90 = ess?.day90 ?? null;
    const essFollowup = ess?.day90 ?? ess?.day30 ?? null;

    const cpap = canResearch(pid, "cpap_telemetry") ? cpapById.get(pid) : undefined;
    const cpapAdherencePct =
      cpap && num(cpap.n) > 0 ? (num(cpap.ok) / num(cpap.n)) * 100 : null;

    const supine = supineAgg.get(pid); // already sleep_mat-gated above
    const supinePre =
      supine && supine.preN >= MIN_WINDOW_NIGHTS ? supine.preSum / supine.preN : null;
    const supinePost =
      supine && supine.postN >= MIN_WINDOW_NIGHTS ? supine.postSum / supine.postN : null;

    const seff = canResearch(pid, "wearable_sleep") ? seffById.get(pid) : undefined;
    const seffBaseline =
      seff && seff.base !== null && num(seff.baseN) >= MIN_WINDOW_NIGHTS ? seff.base : null;
    const seffDay90 =
      seff && seff.day90 !== null && num(seff.day90N) >= MIN_WINDOW_NIGHTS ? seff.day90 : null;

    members.push({
      id: pid,
      sex: demographics ? participant.sex : null,
      yearOfBirth: demographics ? participant.yearOfBirth : null,
      age: demographics ? clock.getUTCFullYear() - participant.yearOfBirth : null,
      door: demographics ? participant.enrollmentTouchpoint : null,
      enrollmentDate: demographics ? participant.createdAt : null,
      enrollmentAnchor: participant.createdAt,
      grants,
      ahi,
      severity: ahi !== null ? severityFromAhi(ahi) : null,
      supinePredominant,
      hstDate: hst?.hstMs != null ? new Date(num(hst.hstMs)) : null,
      arm,
      brand: purchase?.catalogItem.brand ?? null,
      model: purchase?.catalogItem.model ?? null,
      materialClass: purchase?.catalogItem.materialClass ?? null,
      firmnessRating: purchase?.catalogItem.firmnessRating ?? null,
      firmnessBand: purchase ? firmnessBand(purchase.catalogItem.firmnessRating) : null,
      purchaseDate: purchase?.purchaseDate ?? null,
      deliveryDate: purchase?.deliveryDate ?? null,
      essBaseline,
      essDay90,
      essChange90:
        essBaseline !== null && essDay90 !== null ? essDay90 - essBaseline : null,
      essChangeFollowup:
        essBaseline !== null && essFollowup !== null ? essFollowup - essBaseline : null,
      cpapAdherencePct,
      supinePre,
      supinePost,
      supineChange:
        supinePre !== null && supinePost !== null ? supinePost - supinePre : null,
      seffBaseline,
      seffDay90,
      seffChange:
        seffBaseline !== null && seffDay90 !== null ? seffDay90 - seffBaseline : null,
    });
  }

  const memberIds = new Set(members.map((member) => member.id));
  return {
    clock,
    members,
    byId: new Map(members.map((member) => [member.id, member])),
    supineNights: supineNights.filter((night) => memberIds.has(night.participantId)),
    queryMs: Math.round(performance.now() - startedAt),
  };
}

/** Mean over the non-null values; n = how many contributed. */
export function meanOf(values: (number | null)[]): { mean: number | null; n: number } {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) return { mean: null, n: 0 };
  return {
    mean: present.reduce((sum, value) => sum + value, 0) / present.length,
    n: present.length,
  };
}

// ---------------------------------------------------------------------------
// OMOP export data access (kept here so the route imports no raw prisma)
// ---------------------------------------------------------------------------

export interface ExportEpisodeRow {
  participantId: string;
  protocolPhase: string;
  startDate: Date;
  endDate: Date | null;
  /** consent lineage — the class whose research grant gates this row (F-09) */
  dataClass: string | null;
}

/** Episodes with their lineage class, for OBSERVATION_PERIOD building. */
export async function loadEpisodesForExport(): Promise<ExportEpisodeRow[]> {
  return prisma.episode.findMany({
    select: {
      participantId: true,
      protocolPhase: true,
      startDate: true,
      endDate: true,
      dataClass: true,
    },
  });
}

export interface ExportObservationRow {
  id: string;
  participantId: string;
  source: string;
  concept: string;
  valueNumeric: number | null;
  unit: string | null;
  effectiveDate: Date;
}

/** One cursor page of observations for MEASUREMENT streaming. */
export async function pageObservationsForExport(
  cursor: string | undefined,
  take: number
): Promise<ExportObservationRow[]> {
  return prisma.observation.findMany({
    take,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { id: "asc" },
    select: {
      id: true,
      participantId: true,
      source: true,
      concept: true,
      valueNumeric: true,
      unit: true,
      effectiveDate: true,
    },
  });
}
