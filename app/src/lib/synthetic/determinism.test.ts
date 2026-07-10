import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { assertIngestAllowed, evaluateGrants } from "../consent";
import { MATTRESS_CATALOG } from "./catalog";
import { enrollmentRows } from "./enrollment";
import {
  buildIngestGate,
  emptyBatch,
  generateWindow,
  mergeBatch,
  writeBatch,
} from "./generator";
import { addDays, buildProfile, DEMO_EPOCH, participantIdForIndex } from "./profiles";

/**
 * Seed determinism, proven end-to-end (audit F4): the generator is run TWICE
 * for the same small fixture cohort into two separate SQLite databases, then
 * every row of every table — INCLUDING the createdAt / ingestedAt timestamp
 * columns whose schema defaults are now() — is hashed. The hashes must be
 * identical, which they can only be because seed paths pin those columns to
 * deterministic values (consent createdAt = grantedAt; observation
 * ingestedAt = effectiveDate + 1 day).
 */

const FIXTURE_COHORT = 12; // Marcus + 11 cohort participants
const WINDOW_TO = addDays(DEMO_EPOCH, 40);

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const schemaPath = path.join(rootDir, "prisma", "schema.prisma");

const workDir = mkdtempSync(path.join(tmpdir(), "sleeptopia-determinism-"));
const clients: PrismaClient[] = [];

afterAll(async () => {
  for (const client of clients) await client.$disconnect();
  rmSync(workDir, { recursive: true, force: true });
});

/** Fresh empty database with the current schema at the given path. */
function pushSchema(dbPath: string): void {
  execSync(`npx prisma db push --skip-generate --schema "${schemaPath}"`, {
    cwd: rootDir,
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    stdio: "pipe",
  });
}

/** Mirrors prisma/seed.ts for the fixture cohort (consent-gated writes). */
async function seedFixture(client: PrismaClient): Promise<void> {
  await client.mattressCatalog.createMany({ data: MATTRESS_CATALOG });

  const profiles = Array.from({ length: FIXTURE_COHORT }, (_, i) =>
    buildProfile(participantIdForIndex(i))
  );
  const enrollment = profiles.map(enrollmentRows);

  await client.participant.createMany({ data: enrollment.map((e) => e.participant) });
  await client.demoIdentity.createMany({ data: enrollment.map((e) => e.identity) });
  await client.consentRecord.createMany({
    data: enrollment.flatMap((e) => e.consentRecords),
  });
  await client.episode.createMany({ data: enrollment.flatMap((e) => e.episodes) });
  await client.treatmentEvent.createMany({
    data: enrollment.flatMap((e) => e.treatmentEvents),
  });
  await client.device.createMany({ data: enrollment.flatMap((e) => e.devices) });

  const consentByParticipant = new Map<string, Awaited<ReturnType<typeof client.consentRecord.findMany>>>();
  for (const record of await client.consentRecord.findMany()) {
    const list = consentByParticipant.get(record.participantId) ?? [];
    list.push(record);
    consentByParticipant.set(record.participantId, list);
  }

  for (let i = 0; i < profiles.length; i++) {
    const purchase = enrollment[i].mattressPurchase;
    if (!purchase) continue;
    const grants = evaluateGrants(consentByParticipant.get(profiles[i].id) ?? []);
    await assertIngestAllowed(profiles[i].id, "mattress_purchase", { grants });
    await client.mattressPurchase.create({ data: purchase });
  }

  const batch = emptyBatch();
  for (const profile of profiles) {
    const grants = evaluateGrants(consentByParticipant.get(profile.id) ?? []);
    const gate = await buildIngestGate(profile.id, grants);
    mergeBatch(
      batch,
      generateWindow(profile, addDays(profile.enrollmentDate, -1), WINDOW_TO, gate)
    );
  }
  await writeBatch(batch, client);
}

/**
 * SHA-256 over EVERY value column of EVERY row (dates serialize to ISO via
 * JSON, so createdAt / ingestedAt / revokedAt are all inside the hash).
 */
async function snapshotHash(client: PrismaClient): Promise<string> {
  const byId = { orderBy: { id: "asc" } } as const;
  const snapshot = {
    participants: await client.participant.findMany(byId),
    identities: await client.demoIdentity.findMany(byId),
    consentRecords: await client.consentRecord.findMany(byId),
    episodes: await client.episode.findMany(byId),
    treatmentEvents: await client.treatmentEvent.findMany(byId),
    devices: await client.device.findMany(byId),
    catalog: await client.mattressCatalog.findMany({ orderBy: { sku: "asc" } }),
    purchases: await client.mattressPurchase.findMany(byId),
    observations: await client.observation.findMany(byId),
    sleepSessions: await client.sleepSession.findMany(byId),
    proResponses: await client.proResponse.findMany(byId),
  };
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

describe("seed determinism (fixture cohort, two databases)", () => {
  it(
    "two generator runs produce byte-identical rows, timestamps included",
    { timeout: 120_000 },
    async () => {
      const dbA = path.join(workDir, "run-a.db");
      const dbB = path.join(workDir, "run-b.db");
      pushSchema(dbA);
      copyFileSync(dbA, dbB); // identical empty schema, no second push

      const clientA = new PrismaClient({ datasourceUrl: `file:${dbA}` });
      const clientB = new PrismaClient({ datasourceUrl: `file:${dbB}` });
      clients.push(clientA, clientB);

      await seedFixture(clientA);
      await seedFixture(clientB);

      // Guard against vacuous equality: the fixture generated real data.
      const observationCount = await clientA.observation.count();
      expect(observationCount).toBeGreaterThan(100);
      expect(await clientA.consentRecord.count()).toBeGreaterThan(FIXTURE_COHORT);

      // The determinism rules themselves, spot-checked on stored rows:
      const observation = await clientA.observation.findFirstOrThrow({
        orderBy: { id: "asc" },
      });
      expect(observation.ingestedAt.getTime()).toBe(
        observation.effectiveDate.getTime() + 86_400_000
      );
      const consent = await clientA.consentRecord.findFirstOrThrow({
        orderBy: { id: "asc" },
      });
      expect(consent.createdAt.getTime()).toBe(consent.grantedAt.getTime());

      // The headline: both runs hash identically, timestamp columns included.
      expect(await snapshotHash(clientA)).toBe(await snapshotHash(clientB));
    }
  );
});
