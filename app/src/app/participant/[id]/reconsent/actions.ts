"use server";

import { refresh } from "next/cache";
import { DATA_CLASSES, type DataClass } from "@/lib/consent";
import { reconsentDataClass, type ReconsentResult } from "@/lib/consent/reconsent";
import { getSimClock } from "@/lib/simclock";

/**
 * Participant-facing re-consent action (audit F-02, level-up 2): records a
 * fresh SIGNED grant event for a never-authorized data class. This is the
 * only path that can expand the authorized-scope ceiling — the compliance
 * console's Restore buttons are ceiling-bounded and cannot.
 */
export async function signReconsent(
  participantId: string,
  dataClass: string,
  signatureCaptured: boolean
): Promise<ReconsentResult> {
  if (!(DATA_CLASSES as readonly string[]).includes(dataClass)) {
    return { ok: false, error: "Unknown data class" };
  }
  const clock = await getSimClock();
  const result = await reconsentDataClass(
    participantId,
    dataClass as DataClass,
    signatureCaptured,
    { grantedAt: clock }
  );
  if (result.ok) refresh();
  return result;
}
