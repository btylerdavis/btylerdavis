import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

/**
 * Demo identity service — the stand-in for the production Identity & Consent
 * Service (ICS) that DEMO.md's Lane C row calls "the demo identity service".
 *
 * This module and getLinkedProfile are the ONLY places DemoIdentity is
 * touched. It exposes exactly two operations, neither of which returns
 * outcomes data:
 *
 * 1. registerIdentity — writes the display record at enrollment.
 * 2. matchRetailParticipants — resolves a display name to participant ids
 *    for the coach's "existing retail participant" lookup. Matching a person
 *    across doors is an identity-service concern; whether their DATA may be
 *    joined stays with the consent engine (Lane C + getLinkedProfile).
 */

type Db = Prisma.TransactionClient | typeof prisma;

export async function registerIdentity(
  participantId: string,
  displayName: string,
  email: string,
  db: Db = prisma
): Promise<void> {
  await db.demoIdentity.create({
    data: { participantId, displayName, email },
  });
}

export interface IdentityMatch {
  participantId: string;
  displayName: string;
}

/**
 * Case-insensitive display-name search over retail-enrolled participants.
 * Returns identity fields only — never outcomes rows.
 */
export async function matchRetailParticipants(
  query: string,
  db: Db = prisma
): Promise<IdentityMatch[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const matches = await db.demoIdentity.findMany({
    where: {
      displayName: { contains: trimmed },
      participant: { enrollmentTouchpoint: "retail" },
    },
    select: { participantId: true, displayName: true },
    orderBy: { displayName: "asc" },
    take: 5,
  });
  return matches;
}
