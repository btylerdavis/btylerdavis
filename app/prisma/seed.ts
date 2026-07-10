import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient, type Prisma } from "@prisma/client";
import { assertIngestAllowed, evaluateGrants } from "../src/lib/consent";
import { MATTRESS_CATALOG } from "../src/lib/synthetic/catalog";
import { enrollmentRows } from "../src/lib/synthetic/enrollment";
import {
  batchSize,
  buildIngestGate,
  createManyChunked,
  emptyBatch,
  generateWindow,
  mergeBatch,
  writeBatch,
  type GeneratedBatch,
  type WriteCounts,
} from "../src/lib/synthetic/generator";
import {
  addDays,
  buildProfile,
  COHORT_SIZE,
  DEMO_EPOCH,
  INITIAL_CLOCK_OFFSET_DAYS,
  MARCUS_REED_PARTICIPANT_ID,
  participantIdForIndex,
  seedScenario,
} from "../src/lib/synthetic/profiles";
import { SIM_CLOCK_ID } from "../src/lib/simclock";

/**
 * Deterministic synthetic-cohort seed (~2,000 participants). Rerunning
 * produces byte-identical data: all ids and values derive from the cohort
 * seed via seeded PRNGs, and even the audit timestamps are pinned
 * (ConsentRecord.createdAt = grantedAt; Observation.ingestedAt =
 * effectiveDate + 1 day) — see determinism.test.ts. Every
 * observation/session/PRO/purchase write passes the consent ingest gate
 * (assertIngestAllowed) built from the participant's just-created consent
 * records.
 *
 * Run: npm run seed
 *
 * Scenario switcher (DEMO.md §3 — the selection-bias conversation):
 *
 *   SCENARIO=null npm run seed
 *
 * seeds the SAME cohort (identical people, arms, adherence, consents) with
 * the mattress supine effect ≈ 0 — flagship buyers' 8–15-point supine drop
 * is remapped into the 0–3-point noise band, so the medium firmness band on
 * /research/positional reads flat ("what if mattresses do nothing?").
 * Deterministic per scenario; the Marcus summary line below carries a
 * "(scenario: null)" suffix so a rehearsal can't mistake which cohort is
 * loaded. If you advance the time machine afterwards, start the server with
 * the same SCENARIO so generated nights stay consistent. Default (unset or
 * SCENARIO=default) is the flagship-effect cohort the demo script uses.
 */

const FLUSH_THRESHOLD = 25_000;

/**
 * Dedicated single-connection client for the bulk load. WAL journal +
 * synchronous=OFF trade crash-durability for write throughput — fine for a
 * regenerable local demo database, and what keeps the seed under 2 minutes.
 */
const prismaDir = path.dirname(fileURLToPath(import.meta.url));
const rawUrl = process.env.DATABASE_URL ?? `file:${path.join(prismaDir, "dev.db")}`;
const resolvedUrl = rawUrl.startsWith("file:")
  ? `file:${path.resolve(prismaDir, rawUrl.slice("file:".length).split("?")[0])}`
  : rawUrl;
const prisma = new PrismaClient({
  datasourceUrl: `${resolvedUrl}?connection_limit=1`,
});

async function tuneSqliteForBulkLoad(): Promise<void> {
  if (!resolvedUrl.startsWith("file:")) return; // Postgres etc.: no pragmas
  await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL;");
  await prisma.$executeRawUnsafe("PRAGMA synchronous = OFF;");
  await prisma.$executeRawUnsafe("PRAGMA temp_store = MEMORY;");
}

async function resetDatabase(): Promise<void> {
  // FK-safe delete order.
  await prisma.deletionRequest.deleteMany();
  await prisma.savedCohort.deleteMany();
  await prisma.observation.deleteMany();
  await prisma.sleepSession.deleteMany();
  await prisma.proResponse.deleteMany();
  await prisma.mattressPurchase.deleteMany();
  await prisma.mattressCatalog.deleteMany();
  await prisma.device.deleteMany();
  await prisma.treatmentEvent.deleteMany();
  await prisma.episode.deleteMany();
  await prisma.consentRecord.deleteMany();
  await prisma.demoIdentity.deleteMany();
  await prisma.participant.deleteMany();
  await prisma.simClock.deleteMany();
}

async function main() {
  const startedAt = Date.now();
  const clockDate = addDays(DEMO_EPOCH, INITIAL_CLOCK_OFFSET_DAYS);
  const scenario = seedScenario(); // validates SCENARIO before any writes

  console.log(
    `Seeding synthetic cohort (${COHORT_SIZE} participants)...` +
      (scenario === "null" ? " [scenario: null — mattress supine effect ≈ 0]" : "")
  );
  await tuneSqliteForBulkLoad();
  await resetDatabase();

  // 1. Reference data.
  await prisma.mattressCatalog.createMany({ data: MATTRESS_CATALOG });

  // 2. Profiles + enrollment-time rows (participants, identities, consents,
  //    episodes, scheduled events, devices).
  const profiles = Array.from({ length: COHORT_SIZE }, (_, i) => buildProfile(participantIdForIndex(i)));
  const enrollment = profiles.map(enrollmentRows);

  await createManyChunked(enrollment.map((e) => e.participant), (data) =>
    prisma.participant.createMany({ data })
  );
  await createManyChunked(enrollment.map((e) => e.identity), (data) =>
    prisma.demoIdentity.createMany({ data })
  );
  await createManyChunked(enrollment.flatMap((e) => e.consentRecords), (data) =>
    prisma.consentRecord.createMany({ data })
  );
  await createManyChunked(enrollment.flatMap((e) => e.episodes), (data) =>
    prisma.episode.createMany({ data })
  );
  await createManyChunked(enrollment.flatMap((e) => e.treatmentEvents), (data) =>
    prisma.treatmentEvent.createMany({ data })
  );
  await createManyChunked(enrollment.flatMap((e) => e.devices), (data) =>
    prisma.device.createMany({ data })
  );

  // 3. Consent gates (from the records just written), then gated writes.
  const consentByParticipant = new Map<string, Awaited<ReturnType<typeof prisma.consentRecord.findMany>>>();
  for (const record of await prisma.consentRecord.findMany()) {
    const list = consentByParticipant.get(record.participantId) ?? [];
    list.push(record);
    consentByParticipant.set(record.participantId, list);
  }

  // Mattress purchases (gated on mattress_purchase "collect").
  const purchases: Prisma.MattressPurchaseCreateManyInput[] = [];
  for (let i = 0; i < profiles.length; i++) {
    const purchase = enrollment[i].mattressPurchase;
    if (!purchase) continue;
    const grants = evaluateGrants(consentByParticipant.get(profiles[i].id) ?? []);
    await assertIngestAllowed(profiles[i].id, "mattress_purchase", { grants });
    purchases.push(purchase);
  }
  await createManyChunked(purchases, (data) => prisma.mattressPurchase.createMany({ data }));

  // 4. Longitudinal data: (enrollment - 1d, clock] per participant, streamed
  //    in batched createMany writes.
  const written: WriteCounts = { observations: 0, sleepSessions: 0, proResponses: 0, treatmentEvents: 0 };
  let buffer: GeneratedBatch = emptyBatch();
  const flush = async () => {
    const counts = await writeBatch(buffer, prisma);
    written.observations += counts.observations;
    written.sleepSessions += counts.sleepSessions;
    written.proResponses += counts.proResponses;
    written.treatmentEvents += counts.treatmentEvents;
    buffer = emptyBatch();
  };

  for (const profile of profiles) {
    const grants = evaluateGrants(consentByParticipant.get(profile.id) ?? []);
    const gate = await buildIngestGate(profile.id, grants);
    mergeBatch(buffer, generateWindow(profile, addDays(profile.enrollmentDate, -1), clockDate, gate));
    if (batchSize(buffer) >= FLUSH_THRESHOLD) await flush();
  }
  await flush();

  // 5. The time machine's clock: 90 days after Marcus's enrollment.
  await prisma.simClock.upsert({
    where: { id: SIM_CLOCK_ID },
    update: { currentDate: clockDate },
    create: { id: SIM_CLOCK_ID, currentDate: clockDate },
  });

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  const marcus = profiles[0];
  console.log(`Seed complete in ${seconds}s`);
  console.log(`  participants:      ${profiles.length}`);
  console.log(`  observations:      ${written.observations}`);
  console.log(`  sleep sessions:    ${written.sleepSessions}`);
  console.log(`  PRO responses:     ${written.proResponses}`);
  console.log(`  treatment events:  ${written.treatmentEvents} (nightly) + ${enrollment.flatMap((e) => e.treatmentEvents).length} (scheduled)`);
  console.log(`  mattress purchases: ${purchases.length}`);
  console.log(`  sim clock [${SIM_CLOCK_ID}]: ${clockDate.toISOString().slice(0, 10)}`);
  console.log(
    `  Marcus Reed: ${MARCUS_REED_PARTICIPANT_ID} (${marcus.arm}, AHI ${marcus.ahi}, supine ${marcus.supineAhi})` +
      (scenario === "null" ? " (scenario: null)" : "")
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
