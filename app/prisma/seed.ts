import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { evaluateGrants } from "../src/lib/consent";
import {
  writeEnrollmentArtifactsGuarded,
  writeGeneratedBatchGuarded,
  writeMattressPurchasesGuarded,
} from "../src/lib/consent/policyRepo";
import { MATTRESS_CATALOG } from "../src/lib/synthetic/catalog";
import { enrollmentRows } from "../src/lib/synthetic/enrollment";
import {
  batchSize,
  buildIngestGate,
  createManyChunked,
  emptyBatch,
  generateWindow,
  mergeBatch,
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
 * effectiveDate + 1 day) — see determinism.test.ts. EVERY subject-data write
 * — episodes, scheduled events, devices, purchases, and all nightly rows —
 * goes through the policy repository, which re-checks lifecycle + the row's
 * data-class collect grant inside the write transaction (audit F-03/F-04).
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

  // 2. Profiles + enrollment-time identity/consent rows (participants,
  //    identities, consent events). Consent records land BEFORE any
  //    subject-data row so every gate evaluates against a real history.
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

  // 3. Enrollment-time subject-data artifacts (episodes, scheduled events,
  //    devices) — through the policy repository, which re-checks lifecycle +
  //    each row's own lineage class against the consent records just
  //    written (audit F-03: no seed write bypasses the gate).
  const artifactCounts = await writeEnrollmentArtifactsGuarded(
    {
      episodes: enrollment.flatMap((e) => e.episodes),
      treatmentEvents: enrollment.flatMap((e) => e.treatmentEvents),
      devices: enrollment.flatMap((e) => e.devices),
    },
    prisma
  );
  if (artifactCounts.dropped > 0) {
    throw new Error(
      `Seed integrity: ${artifactCounts.dropped} enrollment artifact(s) failed the consent gate — ` +
        `the deterministic cohort must be fully self-consistent`
    );
  }

  const consentByParticipant = new Map<string, Awaited<ReturnType<typeof prisma.consentRecord.findMany>>>();
  for (const record of await prisma.consentRecord.findMany()) {
    const list = consentByParticipant.get(record.participantId) ?? [];
    list.push(record);
    consentByParticipant.set(record.participantId, list);
  }

  // Mattress purchases: policy-guarded bulk insert (lifecycle +
  // mattress_purchase "collect" re-checked inside the write transaction).
  const purchaseResult = await writeMattressPurchasesGuarded(
    enrollment.flatMap((e) => (e.mattressPurchase ? [e.mattressPurchase] : [])),
    prisma
  );
  if (purchaseResult.droppedParticipants.length > 0) {
    throw new Error(
      `Seed integrity: ${purchaseResult.droppedParticipants.length} mattress purchase(s) failed the consent gate`
    );
  }

  // 4. Longitudinal data: (enrollment - 1d, clock] per participant, streamed
  //    in policy-guarded batched writes (per-flush revalidation).
  const written: WriteCounts = { observations: 0, sleepSessions: 0, proResponses: 0, treatmentEvents: 0 };
  let buffer: GeneratedBatch = emptyBatch();
  const flush = async () => {
    const counts = await writeGeneratedBatchGuarded(buffer, prisma);
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
  console.log(`  treatment events:  ${written.treatmentEvents} (nightly) + ${artifactCounts.treatmentEvents} (scheduled)`);
  console.log(`  mattress purchases: ${purchaseResult.written}`);
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
