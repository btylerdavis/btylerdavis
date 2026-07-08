import type { Prisma } from "@prisma/client";
import { grantSetHas, grantsFor, loadAllGrants, type GrantSet } from "./consent";
import { prisma } from "./db";

/**
 * Demo identity service — the stand-in for the production Identity & Consent
 * Service (ICS) that DEMO.md's Lane C row calls "the demo identity service".
 *
 * This module and getLinkedProfile are the ONLY places DemoIdentity is
 * touched. It exposes display-name operations only, none of which return
 * outcomes data:
 *
 * 1. registerIdentity — writes the display record at enrollment.
 * 2. matchRetailParticipants / matchParticipantsByName — resolve a display
 *    name to participant ids for coach lookups. Matching a person across
 *    doors is an identity-service concern; whether their DATA may be joined
 *    stays with the consent engine (Lane C + getLinkedProfile).
 * 3. getLinkedDisplayNames — bulk names for list views, double-gated the
 *    same way getLinkedProfile is (linkage grant + identified tier).
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

export interface IdentityMatchWithDoor extends IdentityMatch {
  enrollmentTouchpoint: string;
}

/**
 * Case-insensitive display-name search across BOTH doors — the import
 * screen's participant picker. Identity fields only, never outcomes rows.
 */
export async function matchParticipantsByName(
  query: string,
  db: Db = prisma
): Promise<IdentityMatchWithDoor[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const matches = await db.demoIdentity.findMany({
    where: { displayName: { contains: trimmed } },
    select: {
      participantId: true,
      displayName: true,
      participant: { select: { enrollmentTouchpoint: true } },
    },
    orderBy: { displayName: "asc" },
    take: 8,
  });
  return matches.map((match) => ({
    participantId: match.participantId,
    displayName: match.displayName,
    enrollmentTouchpoint: match.participant.enrollmentTouchpoint,
  }));
}

/**
 * Bulk display names for list views (coach portal). Double-gated exactly
 * like getLinkedProfile: a name is returned ONLY for participants holding a
 * current linkage ("Lane C") grant for the identified tier — everyone else
 * stays pseudonymous. Pass preloaded grants to avoid a second consent scan.
 */
export async function getLinkedDisplayNames(
  participantIds: string[],
  opts: { grants?: Map<string, GrantSet>; db?: Db } = {}
): Promise<Map<string, string>> {
  const db = opts.db ?? prisma;
  const grants = opts.grants ?? (await loadAllGrants(db));
  const permitted = participantIds.filter((id) =>
    grantSetHas(grantsFor(grants, id), "linkage", "view_identified")
  );
  if (permitted.length === 0) return new Map();
  const rows = await db.demoIdentity.findMany({
    where: { participantId: { in: permitted } },
    select: { participantId: true, displayName: true },
  });
  return new Map(rows.map((row) => [row.participantId, row.displayName]));
}
