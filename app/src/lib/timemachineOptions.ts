/**
 * Client-safe time machine constants + helpers — kept out of the
 * "use server" action module (which may only export async functions) and
 * out of simclock.ts (which imports Prisma), so client components can use
 * them too.
 */

/** Largest advance a single action call performs (~20s of generation). */
export const ADVANCE_CHUNK_DAYS = 7;

/**
 * Splits a long jump into action-sized chunks so the UI can report progress
 * between calls: 30 → [7, 7, 7, 7, 2].
 */
export function chunkAdvance(totalDays: number): number[] {
  const chunks: number[] = [];
  for (let left = totalDays; left > 0; left -= ADVANCE_CHUNK_DAYS) {
    chunks.push(Math.min(ADVANCE_CHUNK_DAYS, left));
  }
  return chunks;
}
