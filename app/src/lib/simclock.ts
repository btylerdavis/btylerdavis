import type { ConsentRecord } from "@prisma/client";
import { prisma } from "./db";
import { evaluateGrants, type DataClass } from "./consent";
import {
  batchSize,
  buildIngestGate,
  emptyBatch,
  generateWindow,
  mergeBatch,
  writeBatch,
  type GeneratedBatch,
  type WriteCounts,
} from "./synthetic/generator";
import { addDays, buildProfile, DEMO_EPOCH } from "./synthetic/profiles";

/**
 * The time machine (DEMO.md Act 3). A singleton SimClock row holds the
 * demo's "current date"; advancing it generates the newly-elapsed nights for
 * every active participant using the same deterministic nightly logic as the
 * seed — so advancing 7 days produces exactly the rows a fresh 97-day seed
 * would contain. Ingest consent gates apply per data class: a revoked
 * participant accrues NO new rows.
 */

export const SIM_CLOCK_ID = "singleton";

/**
 * Demo safety rail: the clock never advances past day 400 of the demo
 * timeline (DEMO_EPOCH = Marcus's enrollment). Advancing the whole cohort
 * one day writes ~10k rows; 400 days keeps the database and every chart
 * window comfortably inside rehearsed territory.
 */
export const MAX_SIM_DAYS = 400;

export function maxSimDate(): Date {
  return addDays(DEMO_EPOCH, MAX_SIM_DAYS);
}

/** Whole days since Marcus's enrollment (day 0 = DEMO_EPOCH). */
export function simDayNumber(date: Date): number {
  return Math.round((date.getTime() - DEMO_EPOCH.getTime()) / 86_400_000);
}

export async function getSimClock(): Promise<Date> {
  const row = await prisma.simClock.findUnique({ where: { id: SIM_CLOCK_ID } });
  if (!row) throw new Error("SimClock not initialized — run `npm run seed` first");
  return row.currentDate;
}

/** Missing-safe read for pages that render a "seed first" hint instead. */
export async function getSimClockOrNull(): Promise<Date | null> {
  const row = await prisma.simClock.findUnique({ where: { id: SIM_CLOCK_ID } });
  return row?.currentDate ?? null;
}

export async function setSimClock(date: Date): Promise<void> {
  await prisma.simClock.upsert({
    where: { id: SIM_CLOCK_ID },
    update: { currentDate: date },
    create: { id: SIM_CLOCK_ID, currentDate: date },
  });
}

export interface AdvanceSummary {
  from: Date;
  to: Date;
  daysAdvanced: number;
  written: WriteCounts;
  participantsProcessed: number;
  /** live-enrolled participants skipped: no synthetic profile backs them, so
   *  the simulator generates no nightly stream for them (their real data
   *  would arrive from device sync, not the time machine) */
  participantsSkipped: number;
  /** participants with at least one data class dropped by the ingest gate */
  participantsConsentLimited: number;
  /** rows dropped by the per-flush policy revalidation (consent/lifecycle
   *  changed between generation and commit — audit F-04) */
  rowsDroppedAtCommit: number;
}

const FLUSH_THRESHOLD = 20_000;

/**
 * Advance the sim clock by n days, generating the newly-elapsed nights
 * (oldClock, newClock] for all participants. Writes go through the consent
 * ingest gate; classes without a current "collect" grant are dropped.
 */
export async function advanceDays(n: number): Promise<AdvanceSummary> {
  if (!Number.isInteger(n) || n < 1) throw new Error(`advanceDays: n must be a positive integer, got ${n}`);

  const from = await getSimClock();
  const to = addDays(from, n);
  if (to > maxSimDate()) {
    throw new Error(
      `advanceDays: refusing to advance past day ${MAX_SIM_DAYS} of the demo timeline ` +
        `(requested day ${simDayNumber(to)})`
    );
  }

  // Terminal lifecycle (audit F-01): tombstoned/deleting participants are
  // never enumerated for generation — and the per-flush policy revalidation
  // below re-checks that inside every write transaction anyway.
  const participants = await prisma.participant.findMany({
    where: { deletedAt: null, lifecycleState: { in: ["active", "deletion_pending"] } },
    select: { id: true },
  });
  const consentByParticipant = new Map<string, ConsentRecord[]>();
  for (const record of await prisma.consentRecord.findMany()) {
    const list = consentByParticipant.get(record.participantId) ?? [];
    list.push(record);
    consentByParticipant.set(record.participantId, list);
  }

  // Only the seeded synthetic cohort can be regenerated: buildProfile derives
  // a latent profile (and its device ids) from the participant id, and the
  // seed persists exactly those device rows. A live-enrolled demo participant
  // (created through the enroll flow) has a random id whose derived profile
  // references device ids that were never persisted — generating their nights
  // would emit observations/sessions pointing at non-existent Device rows and
  // the batched write would abort the whole cohort's advance on a foreign-key
  // violation. Such participants are cleanly SKIPPED here: they simply have no
  // synthetic nightly stream (their real data comes from device sync, not the
  // simulator). The sentinel is the derived wearable device — every seeded
  // profile has exactly one, unconditionally persisted by the seed; no
  // live-enrolled participant has a device at that derived id.
  const seededDeviceIds = new Set(
    (await prisma.device.findMany({ select: { id: true } })).map((d) => d.id)
  );
  const isSeeded = (profile: ReturnType<typeof buildProfile>): boolean =>
    seededDeviceIds.has(profile.wearableDeviceId);

  const written: WriteCounts = { observations: 0, sleepSessions: 0, proResponses: 0, treatmentEvents: 0 };
  let participantsSkipped = 0;
  let participantsConsentLimited = 0;
  let rowsDroppedAtCommit = 0;
  let buffer: GeneratedBatch = emptyBatch();

  // Each flush is a policy-guarded transaction: lifecycle + per-class
  // collect grants are re-validated for every participant in the batch at
  // commit time, so a revocation or deletion racing the generation loop can
  // never land rows after the fact (audit F-04).
  const flush = async () => {
    const counts = await writeBatch(buffer);
    written.observations += counts.observations;
    written.sleepSessions += counts.sleepSessions;
    written.proResponses += counts.proResponses;
    written.treatmentEvents += counts.treatmentEvents;
    rowsDroppedAtCommit += counts.dropped;
    buffer = emptyBatch();
  };

  for (const { id } of participants) {
    const profile = buildProfile(id);

    // Live-enrolled participant with no synthetic backing: skip cleanly.
    // Never abort the batch for one un-generatable participant.
    if (!isSeeded(profile)) {
      participantsSkipped += 1;
      continue;
    }

    const grants = evaluateGrants(consentByParticipant.get(id) ?? []);
    const gate = await buildIngestGate(id, grants);

    if (hasAnyDrop(gate, profile)) participantsConsentLimited += 1;

    mergeBatch(buffer, generateWindow(profile, from, to, gate));
    if (batchSize(buffer) >= FLUSH_THRESHOLD) await flush();
  }
  await flush();

  await setSimClock(to);
  return {
    from,
    to,
    daysAdvanced: n,
    written,
    participantsProcessed: participants.length,
    participantsSkipped,
    participantsConsentLimited,
    rowsDroppedAtCommit,
  };
}

/** true when the gate drops any data class this participant would emit */
function hasAnyDrop(gate: (dc: DataClass) => boolean, profile: ReturnType<typeof buildProfile>): boolean {
  const relevant: DataClass[] = ["wearable_sleep", "pro_responses"];
  if (profile.hasCpap) relevant.push("cpap_telemetry");
  if (profile.hasSleepMat) relevant.push("sleep_mat");
  return relevant.some((dc) => !gate(dc));
}
