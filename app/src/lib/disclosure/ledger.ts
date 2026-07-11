import type { ReleaseLedgerEntry } from "@prisma/client";
import { prisma } from "../db";
import type { ReleasedCount } from "./bands";

/**
 * Release ledger (audit F-12, level-up 10 + level-up 6 release manifests).
 *
 * Every partner-facing count release is recorded: which surface released it,
 * the canonical query, the metric, the BAND that actually left the system
 * (never the underlying count), and the sim-clock date. The ledger is the
 * release manifest the differencing audit runs against, and it is visible —
 * DUA-gated — at /partner/releases, so a partner can see exactly what has
 * ever been disclosed to their tier.
 *
 * This module is part of the approved persistence layer (ESLint policy
 * boundary): pages and feature modules log releases through it, never
 * through raw prisma.
 */

export type ReleaseSurface = "partner_proposal" | "partner_dashboard";

export interface CountReleaseRecord {
  surface: ReleaseSurface;
  /** canonical query descriptor (preset + validated filters) */
  query: string;
  /** which released number this row logs (e.g. "matched", "firmness:soft") */
  metric: string;
  /** the released band — NEVER an exact count */
  band: string;
  /** sim-clock date at release */
  clockDate: Date;
}

/** Shapes a released count into its ledger record. */
export function releaseRecord(
  surface: ReleaseSurface,
  query: string,
  metric: string,
  released: ReleasedCount,
  clockDate: Date
): CountReleaseRecord {
  return { surface, query, metric, band: released.display, clockDate };
}

/** Appends one ledger row per released count (one createMany). */
export async function recordCountReleases(records: CountReleaseRecord[]): Promise<number> {
  if (records.length === 0) return 0;
  const { count } = await prisma.releaseLedgerEntry.createMany({
    data: records.map((record) => ({
      surface: record.surface,
      query: record.query,
      metric: record.metric,
      band: record.band,
      clockDate: record.clockDate,
    })),
  });
  return count;
}

export interface ReleaseLedgerPage {
  entries: ReleaseLedgerEntry[];
  total: number;
}

/** Newest-first ledger page for /partner/releases. */
export async function listCountReleases(limit = 200): Promise<ReleaseLedgerPage> {
  const [entries, total] = await Promise.all([
    prisma.releaseLedgerEntry.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    }),
    prisma.releaseLedgerEntry.count(),
  ]);
  return { entries, total };
}
