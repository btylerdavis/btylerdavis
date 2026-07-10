"use server";

import { refresh } from "next/cache";
import { deleteSavedCohort, saveCohort } from "@/lib/research/savedCohorts";

/**
 * Saved-cohort actions (DEMO.md Act 5 reserve → working). The query string
 * is re-validated and the count snapshot recomputed server-side in
 * saveCohort — nothing from the client is trusted beyond the name and the
 * filter params the explorer already treats as public URL state.
 */

export type SaveCohortOutcome = { ok: true } | { ok: false; error: string };

export async function saveCohortAction(name: string, query: string): Promise<SaveCohortOutcome> {
  const result = await saveCohort(name, query);
  if (!result.ok) return result;
  refresh();
  return { ok: true };
}

export async function deleteSavedCohortAction(id: string): Promise<void> {
  await deleteSavedCohort(id);
  refresh();
}
