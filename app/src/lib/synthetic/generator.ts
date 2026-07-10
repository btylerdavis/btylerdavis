import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import {
  assertIngestAllowed,
  ConsentError,
  DATA_CLASSES,
  type DataClass,
  type GrantSet,
} from "../consent";
import { Rng } from "./prng";
import { addDays, COHORT_SEED, dayIso, type ParticipantProfile } from "./profiles";

/**
 * Synthetic nightly data generation. All functions here are deterministic:
 * each night's values come from a PRNG seeded on (participantId, date), so
 * the time machine generating a night later produces exactly the rows a
 * full seed would have.
 *
 * Consent: every write path routes through the ingest gate. Callers build a
 * gate with buildIngestGate (which exercises assertIngestAllowed per data
 * class) and generation DROPS rows for non-granted classes — the T2.6
 * "connector drops payloads" behavior. writeBatch then re-asserts before
 * insert as defense in depth.
 */

export interface GeneratedBatch {
  observations: Prisma.ObservationCreateManyInput[];
  sleepSessions: Prisma.SleepSessionCreateManyInput[];
  proResponses: Prisma.ProResponseCreateManyInput[];
  treatmentEvents: Prisma.TreatmentEventCreateManyInput[];
}

export function emptyBatch(): GeneratedBatch {
  return { observations: [], sleepSessions: [], proResponses: [], treatmentEvents: [] };
}

export type IngestGate = (dataClass: DataClass) => boolean;

/**
 * Evaluates assertIngestAllowed for every data class once, returning a
 * synchronous predicate for the generation hot path. This is THE consent
 * check for all synthetic writes; a class missing a current "collect" grant
 * is dropped (and counted by callers via gateAllows).
 */
export async function buildIngestGate(participantId: string, grants: GrantSet): Promise<IngestGate> {
  const allowed = new Set<DataClass>();
  for (const dataClass of DATA_CLASSES) {
    try {
      await assertIngestAllowed(participantId, dataClass, { grants });
      allowed.add(dataClass);
    } catch (error) {
      if (!(error instanceof ConsentError)) throw error;
      // dropped: no current "collect" grant for this class
    }
  }
  return (dataClass) => allowed.has(dataClass);
}

// ---------------------------------------------------------------------------
// Baseline HST
// ---------------------------------------------------------------------------

/**
 * Determinism rule (F-series audit): every synthetic observation is stamped
 * as ingested the morning AFTER its effective date — a constant, so seed
 * runs and time-machine advances produce byte-identical rows. Runtime paths
 * (imports, enroll flows) keep the schema's now() default.
 */
export function syntheticIngestedAt(effectiveDate: Date): Date {
  return addDays(effectiveDate, 1);
}

const HST_UNITS: Record<string, string> = {
  ahi: "events/h",
  supine_ahi: "events/h",
  nonsupine_ahi: "events/h",
  odi: "events/h",
  spo2_mean: "%",
  spo2_nadir: "%",
  supine_time_pct: "%",
};

/** Baseline home-sleep-test observations (source "hst", grain "session"). */
export function hstObservationRows(
  profile: ParticipantProfile,
  gate: IngestGate
): Prisma.ObservationCreateManyInput[] {
  if (!gate("hst_clinical")) return [];
  const rng = new Rng(`${COHORT_SEED}:hst:${profile.id}`);
  const studyDate = addDays(profile.enrollmentDate, profile.hstOffsetDays);
  const values: Record<string, number> = {
    ahi: profile.ahi,
    supine_ahi: profile.supineAhi,
    nonsupine_ahi: profile.nonsupineAhi,
    odi: profile.odi,
    spo2_mean: profile.spo2MeanBaseline,
    spo2_nadir: profile.spo2Nadir,
    supine_time_pct: profile.baselineSupinePct,
  };
  return Object.entries(values).map(([concept, value]) => ({
    id: rng.uuid(),
    participantId: profile.id,
    source: "hst",
    concept,
    valueNumeric: round1(value),
    unit: HST_UNITS[concept],
    effectiveDate: studyDate,
    grain: "session",
    qualityFlags: "[]",
    ingestedAt: syntheticIngestedAt(studyDate),
  }));
}

// ---------------------------------------------------------------------------
// Nightly generation
// ---------------------------------------------------------------------------

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function ramp(days: number, rampDays: number): number {
  return clamp(days / rampDays, 0, 1);
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** Generate one night (effectiveDate = the morning-after date, UTC midnight). */
export function nightlyRows(profile: ParticipantProfile, date: Date, gate: IngestGate): GeneratedBatch {
  const batch = emptyBatch();
  const rng = new Rng(`${COHORT_SEED}:night:${profile.id}:${dayIso(date)}`);
  const p = profile;

  const cpapSetupDate = addDays(p.enrollmentDate, p.treatmentStartOffsetDays);
  const applianceDate = addDays(p.enrollmentDate, p.treatmentStartOffsetDays);
  const mattressDeliveryDate = addDays(p.enrollmentDate, p.mattressDeliveryOffsetDays);

  const daysOnCpap = p.hasCpap ? daysBetween(cpapSetupDate, date) : -1;
  const cpapActive = p.hasCpap && daysOnCpap >= 1;
  const cpapAbandoned = cpapActive && !p.cpapAdherent && daysOnCpap > p.cpapAbandonAfterDays;
  const daysOnAppliance = p.hasAppliance ? daysBetween(applianceDate, date) : -1;
  const applianceActive = p.hasAppliance && daysOnAppliance >= 1;
  const daysOnMattress = p.hasMattress ? daysBetween(mattressDeliveryDate, date) : -1;
  const mattressActive = p.hasMattress && daysOnMattress >= 1;

  // Is any therapy plausibly moving downstream physiology tonight?
  const therapyActive =
    (cpapActive && p.cpapAdherent) ||
    (applianceActive && p.applianceAdherent) ||
    (mattressActive && p.supineDropPoints > 6);
  const therapyRamp = therapyActive
    ? ramp(Math.max(cpapActive ? daysOnCpap : 0, applianceActive ? daysOnAppliance : 0, mattressActive ? daysOnMattress : 0), 30)
    : 0;

  // --- CPAP telemetry (source "airview") -----------------------------------
  if (cpapActive && gate("cpap_telemetry")) {
    if (cpapAbandoned) {
      // Abandonment is an outcome: emit therapy_gap, never nulls.
      batch.observations.push({
        id: rng.uuid(),
        participantId: p.id,
        source: "airview",
        deviceId: p.cpapDeviceId,
        concept: "therapy_gap",
        valueNumeric: 1,
        effectiveDate: date,
        grain: "day",
        qualityFlags: JSON.stringify(["device_gap"]),
        ingestedAt: syntheticIngestedAt(date),
      });
    } else {
      const declineFactor = p.cpapAdherent ? 1 : 1 - 0.8 * ramp(daysOnCpap, p.cpapAbandonAfterDays);
      const skipped = rng.chance(p.cpapSkipNightP);
      const usage = skipped ? 0 : clamp(rng.normal(p.cpapMeanUsageMin * declineFactor, 50), 25, 620);
      batch.observations.push({
        id: rng.uuid(),
        participantId: p.id,
        source: "airview",
        deviceId: p.cpapDeviceId,
        concept: "cpap_usage_minutes",
        valueNumeric: Math.round(usage),
        unit: "min",
        effectiveDate: date,
        grain: "day",
        qualityFlags: "[]",
        ingestedAt: syntheticIngestedAt(date),
      });
      if (!skipped) {
        const residBase = p.cpapAdherent ? 2.0 + p.ahi * 0.02 : 3.5 + p.ahi * 0.05;
        const leak = clamp(rng.normal(11, 6), 0, 45);
        batch.observations.push(
          {
            id: rng.uuid(),
            participantId: p.id,
            source: "airview",
            deviceId: p.cpapDeviceId,
            concept: "residual_ahi",
            valueNumeric: round1(clamp(rng.normal(residBase, 1.4), 0.1, 14)),
            unit: "events/h",
            effectiveDate: date,
            grain: "day",
            qualityFlags: "[]",
            ingestedAt: syntheticIngestedAt(date),
          },
          {
            id: rng.uuid(),
            participantId: p.id,
            source: "airview",
            deviceId: p.cpapDeviceId,
            concept: "mask_leak_p95",
            valueNumeric: round1(leak),
            unit: "L/min",
            effectiveDate: date,
            grain: "day",
            qualityFlags: leak > 30 ? JSON.stringify(["high_leak"]) : "[]",
            ingestedAt: syntheticIngestedAt(date),
          }
        );
      }
    }
  }

  // --- Wearable night (source healthkit / aggregator:*) --------------------
  // ~15% of wearable nights missing.
  if (gate("wearable_sleep") && rng.chance(0.85)) {
    const shortWear = rng.chance(0.05);
    const efficiency = clamp(p.sleepEfficiencyBase + 3.5 * therapyRamp + rng.normal(0, 2.5), 45, 99);
    const duration = clamp(p.sleepDurationBase + 12 * therapyRamp + rng.normal(0, 35), 180, 620);
    const restingHr = clamp(p.restingHrBase - 2.5 * therapyRamp + rng.normal(0, 2), 40, 100);
    const hrv = clamp(p.hrvSdnnBase + 4 * therapyRamp + rng.normal(0, 5), 8, 120);
    const cpapSpo2Boost = cpapActive && p.cpapAdherent && !cpapAbandoned ? 1.0 * ramp(daysOnCpap, 21) : 0;
    const spo2 = clamp(p.spo2MeanBaseline + cpapSpo2Boost + rng.normal(0, 0.5), 85, 98.5);
    const flags = shortWear ? JSON.stringify(["short_wear"]) : "[]";

    const bedtime = new Date(addDays(date, -1).getTime() + (22 * 60 + rng.int(0, 105)) * 60_000);
    const endTs = new Date(bedtime.getTime() + (duration / clamp(efficiency / 100, 0.5, 0.99)) * 60_000);
    batch.sleepSessions.push({
      id: rng.uuid(),
      participantId: p.id,
      source: p.wearable.source,
      deviceId: p.wearableDeviceId,
      startTs: bedtime,
      endTs,
      summary: JSON.stringify({
        efficiency: round1(efficiency),
        durationMin: Math.round(duration),
        interruptions: rng.int(0, 4),
        stages: {
          deep: Math.round(duration * rng.uniform(0.12, 0.2)),
          rem: Math.round(duration * rng.uniform(0.18, 0.25)),
          core: Math.round(duration * rng.uniform(0.5, 0.6)),
        },
      }),
    });

    const wearableObs: [string, number, string][] = [
      ["sleep_efficiency", round1(efficiency), "%"],
      ["sleep_duration_min", Math.round(duration), "min"],
      ["resting_hr", round1(restingHr), "bpm"],
      ["hrv_sdnn", round1(hrv), "ms"],
      ["spo2_mean", round1(spo2), "%"],
    ];
    for (const [concept, valueNumeric, unit] of wearableObs) {
      batch.observations.push({
        id: rng.uuid(),
        participantId: p.id,
        source: p.wearable.source,
        deviceId: p.wearableDeviceId,
        concept,
        valueNumeric,
        unit,
        effectiveDate: date,
        grain: "day",
        qualityFlags: flags,
        ingestedAt: syntheticIngestedAt(date),
      });
    }
  }

  // --- Under-mattress sensor (source "sleep_mat", ~25% sub-cohort) ---------
  if (p.hasSleepMat && gate("sleep_mat") && rng.chance(0.93)) {
    // Flagship signal: supine time drops profile.supineDropPoints over ~7
    // nights after mattress delivery (8-15 pts for supine-predominant
    // participants on medium-firm hybrids).
    const drop = mattressActive ? p.supineDropPoints * ramp(daysOnMattress, 7) : 0;
    const supine = clamp(p.baselineSupinePct - drop + rng.normal(0, 5), 3, 97);
    batch.observations.push({
      id: rng.uuid(),
      participantId: p.id,
      source: "sleep_mat",
      deviceId: p.sleepMatDeviceId,
      concept: "supine_time_pct",
      valueNumeric: round1(supine),
      unit: "%",
      effectiveDate: date,
      grain: "day",
      qualityFlags: "[]",
      ingestedAt: syntheticIngestedAt(date),
    });
  }

  // --- Oral-appliance nightly wear self-report (PRO) ------------------------
  if (applianceActive && gate("pro_responses")) {
    const wearP = p.applianceAdherent ? 0.9 : clamp(0.7 - 0.008 * daysOnAppliance, 0.15, 0.7);
    const worn = rng.chance(wearP);
    const hours = worn ? round1(clamp(rng.normal(6.5, 1), 1.5, 9.5)) : 0;
    batch.proResponses.push({
      id: rng.uuid(),
      participantId: p.id,
      instrument: "nightly_wear",
      instrumentVersion: "1.0",
      administeredAt: new Date(date.getTime() + 8 * 3_600_000),
      itemScores: JSON.stringify({ worn, hours }),
      totalScore: hours,
    });
  }

  // --- therapy_stop treatment event fires the night abandonment begins ------
  if (
    cpapActive &&
    !p.cpapAdherent &&
    daysOnCpap === p.cpapAbandonAfterDays + 1 &&
    gate("cpap_telemetry")
  ) {
    batch.treatmentEvents.push({
      id: rng.uuid(),
      participantId: p.id,
      type: "therapy_stop",
      eventDate: date,
      detail: JSON.stringify({ therapy: "cpap", reason: "adherence_decline" }),
    });
  }

  return batch;
}

// ---------------------------------------------------------------------------
// Scheduled PROs (ESS/ISI baseline / day-30 / day-90; STOP-BANG for retail)
// ---------------------------------------------------------------------------

const ESS_ITEMS = 8;
const ESS_ITEM_MAX = 3;
const ISI_ITEMS = 7;
const ISI_ITEM_MAX = 4;

function distributeItems(rng: Rng, total: number, items: number, itemMax: number): number[] {
  const scores = new Array<number>(items).fill(0);
  let remaining = Math.min(total, items * itemMax);
  while (remaining > 0) {
    const idx = rng.int(0, items - 1);
    if (scores[idx] < itemMax) {
      scores[idx] += 1;
      remaining -= 1;
    }
  }
  return scores;
}

/**
 * Scheduled PRO responses whose due date falls inside [from, to].
 * Cadence: ESS + ISI at baseline / day-30 / day-90; STOP-BANG at enrollment
 * for retail enrollees.
 */
export function scheduledProRows(
  profile: ParticipantProfile,
  from: Date,
  to: Date,
  gate: IngestGate
): Prisma.ProResponseCreateManyInput[] {
  if (!gate("pro_responses")) return [];
  const rows: Prisma.ProResponseCreateManyInput[] = [];
  const p = profile;

  const due = (offsetDays: number) => addDays(p.enrollmentDate, offsetDays);
  const inWindow = (d: Date) => d >= from && d <= to;

  if (p.enrollmentTouchpoint === "retail" && inWindow(due(0))) {
    const rng = new Rng(`${COHORT_SEED}:pro:${p.id}:stopbang`);
    const items = distributeItems(rng, p.stopBangScore, 8, 1);
    rows.push({
      id: rng.uuid(),
      participantId: p.id,
      instrument: "STOP_BANG",
      instrumentVersion: "1.0",
      administeredAt: new Date(due(0).getTime() + 10 * 3_600_000),
      itemScores: JSON.stringify(items),
      totalScore: p.stopBangScore,
    });
  }

  for (const offset of [0, 30, 90]) {
    const dueDate = due(offset);
    if (!inWindow(dueDate)) continue;
    // Improvement reaches 60% at day 30 and 100% at day 90.
    const fraction = offset === 0 ? 0 : offset === 30 ? 0.6 : 1;

    const essRng = new Rng(`${COHORT_SEED}:pro:${p.id}:ess:${offset}`);
    const essTotal = Math.round(
      clamp(p.essBaseline - p.essImprovement * fraction + essRng.normal(0, 0.7), 0, ESS_ITEMS * ESS_ITEM_MAX)
    );
    rows.push({
      id: essRng.uuid(),
      participantId: p.id,
      instrument: "ESS",
      instrumentVersion: "1.0",
      administeredAt: new Date(dueDate.getTime() + 9 * 3_600_000),
      itemScores: JSON.stringify(distributeItems(essRng, essTotal, ESS_ITEMS, ESS_ITEM_MAX)),
      totalScore: essTotal,
    });

    const isiRng = new Rng(`${COHORT_SEED}:pro:${p.id}:isi:${offset}`);
    const isiTotal = Math.round(
      clamp(p.isiBaseline - p.isiImprovement * fraction + isiRng.normal(0, 1), 0, ISI_ITEMS * ISI_ITEM_MAX)
    );
    rows.push({
      id: isiRng.uuid(),
      participantId: p.id,
      instrument: "ISI",
      instrumentVersion: "1.0",
      administeredAt: new Date(dueDate.getTime() + 9.5 * 3_600_000),
      itemScores: JSON.stringify(distributeItems(isiRng, isiTotal, ISI_ITEMS, ISI_ITEM_MAX)),
      totalScore: isiTotal,
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Window generation + batched writes
// ---------------------------------------------------------------------------

/**
 * All generated rows with effective/due dates in (fromExclusive, to] (UTC
 * midnights), clipped to the participant's enrollment. Exclusive lower bound
 * makes windows composable without duplication: the seed generates
 * (enrollment - 1d, clock] and the time machine (oldClock, newClock].
 * Includes nightly rows, scheduled PROs, and baseline HST when its study
 * date falls inside the window.
 */
export function generateWindow(
  profile: ParticipantProfile,
  fromExclusive: Date,
  to: Date,
  gate: IngestGate
): GeneratedBatch {
  const batch = emptyBatch();
  const windowStart = addDays(fromExclusive, 1);
  const firstDay = windowStart > profile.enrollmentDate ? windowStart : profile.enrollmentDate;
  if (firstDay > to) return batch;

  const hstDate = addDays(profile.enrollmentDate, profile.hstOffsetDays);
  if (hstDate >= firstDay && hstDate <= to) {
    batch.observations.push(...hstObservationRows(profile, gate));
  }

  // Nights: the first night lands the morning after enrollment.
  const firstNight = addDays(profile.enrollmentDate, 1);
  for (let d = firstDay > firstNight ? firstDay : firstNight; d <= to; d = addDays(d, 1)) {
    const night = nightlyRows(profile, d, gate);
    mergeBatch(batch, night);
  }

  batch.proResponses.push(...scheduledProRows(profile, firstDay, to, gate));
  return batch;
}

const CHUNK_ROWS = 2000;

export async function createManyChunked<T>(
  rows: T[],
  create: (chunk: T[]) => Promise<{ count: number }>
): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK_ROWS) {
    const { count } = await create(rows.slice(i, i + CHUNK_ROWS));
    written += count;
  }
  return written;
}

export interface WriteCounts {
  observations: number;
  sleepSessions: number;
  proResponses: number;
  treatmentEvents: number;
}

/** Client surface writeBatch needs (shared client or a seed-tuned one). */
export type BatchWriter = Pick<
  typeof prisma,
  "observation" | "sleepSession" | "proResponse" | "treatmentEvent"
>;

/** Batched createMany for a generated batch. */
export async function writeBatch(batch: GeneratedBatch, db: BatchWriter = prisma): Promise<WriteCounts> {
  return {
    observations: await createManyChunked(batch.observations, (data) =>
      db.observation.createMany({ data })
    ),
    sleepSessions: await createManyChunked(batch.sleepSessions, (data) =>
      db.sleepSession.createMany({ data })
    ),
    proResponses: await createManyChunked(batch.proResponses, (data) =>
      db.proResponse.createMany({ data })
    ),
    treatmentEvents: await createManyChunked(batch.treatmentEvents, (data) =>
      db.treatmentEvent.createMany({ data })
    ),
  };
}

export function mergeBatch(target: GeneratedBatch, source: GeneratedBatch): void {
  target.observations.push(...source.observations);
  target.sleepSessions.push(...source.sleepSessions);
  target.proResponses.push(...source.proResponses);
  target.treatmentEvents.push(...source.treatmentEvents);
}

export function batchSize(batch: GeneratedBatch): number {
  return (
    batch.observations.length +
    batch.sleepSessions.length +
    batch.proResponses.length +
    batch.treatmentEvents.length
  );
}
