"use server";

import { refresh } from "next/cache";
import { countActiveLast7 } from "@/lib/consent";
import { toIsoDay } from "@/lib/format";
import {
  advanceDays,
  getSimClock,
  MAX_SIM_DAYS,
  maxSimDate,
  simDayNumber,
} from "@/lib/simclock";
import { addDays } from "@/lib/synthetic/profiles";
import { ADVANCE_CHUNK_DAYS } from "@/lib/timemachineOptions";

/**
 * Time machine server actions (DEMO.md Act 3). The UI advances in chunks of
 * at most ADVANCE_CHUNK_DAYS so long jumps report progress between chunks
 * instead of one silent multi-minute request. Every call re-checks the
 * day-400 rail — the domain guard in advanceDays is the backstop; here we
 * refuse politely.
 */

export interface AdvanceOk {
  ok: true;
  fromIso: string;
  toIso: string;
  daysAdvanced: number;
  /** wearable nights generated in this advance */
  nightsGenerated: number;
  observationsAdded: number;
  proResponsesAdded: number;
  treatmentEventsAdded: number;
  participantsProcessed: number;
  /** live-enrolled participants skipped (no synthetic nightly stream) */
  participantsSkipped: number;
  /** participants with at least one data class dropped by the ingest gate */
  participantsConsentLimited: number;
  /** participants with any observation in the 7 sim-days ending at the new clock */
  participantsActiveLast7: number;
  dayNumber: number;
  daysRemaining: number;
  /** server-side generation time for this chunk */
  tookMs: number;
}

export interface AdvanceBlocked {
  ok: false;
  error: string;
  dayNumber: number;
  daysRemaining: number;
}

export type AdvanceOutcome = AdvanceOk | AdvanceBlocked;

export async function advanceSim(days: number): Promise<AdvanceOutcome> {
  const current = await getSimClock();
  const currentDay = simDayNumber(current);

  if (!Number.isInteger(days) || days < 1 || days > ADVANCE_CHUNK_DAYS * 5) {
    return {
      ok: false,
      error: `Advance must be 1–${ADVANCE_CHUNK_DAYS * 5} days per call`,
      dayNumber: currentDay,
      daysRemaining: MAX_SIM_DAYS - currentDay,
    };
  }

  if (addDays(current, days) > maxSimDate()) {
    const daysRemaining = Math.max(0, MAX_SIM_DAYS - currentDay);
    return {
      ok: false,
      error:
        daysRemaining === 0
          ? `The demo timeline ends at day ${MAX_SIM_DAYS} — the clock is already there.`
          : `That would pass day ${MAX_SIM_DAYS} of the demo timeline. Up to ${daysRemaining} more day${daysRemaining === 1 ? "" : "s"} can be generated.`,
      dayNumber: currentDay,
      daysRemaining,
    };
  }

  const startedAt = Date.now();
  const summary = await advanceDays(days);
  // Consent-aware activity count (audit F-07): classified per data class.
  const participantsActiveLast7 = await countActiveLast7(summary.to);
  const tookMs = Date.now() - startedAt;
  const dayNumber = simDayNumber(summary.to);

  // Every open page re-renders against the new clock (force-dynamic pages).
  refresh();

  return {
    ok: true,
    fromIso: toIsoDay(summary.from),
    toIso: toIsoDay(summary.to),
    daysAdvanced: summary.daysAdvanced,
    nightsGenerated: summary.written.sleepSessions,
    observationsAdded: summary.written.observations,
    proResponsesAdded: summary.written.proResponses,
    treatmentEventsAdded: summary.written.treatmentEvents,
    participantsProcessed: summary.participantsProcessed,
    participantsSkipped: summary.participantsSkipped,
    participantsConsentLimited: summary.participantsConsentLimited,
    participantsActiveLast7,
    dayNumber,
    daysRemaining: MAX_SIM_DAYS - dayNumber,
    tookMs,
  };
}
