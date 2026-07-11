import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { executeDeletion, requestDeletion } from "../compliance/deletion";
import { prisma } from "../db";
import { ingestParsedImport, type ParsedImportPayload } from "../imports/ingest";
import { setSimClock } from "../simclock";
import { addDays } from "../synthetic/profiles";
import { grantConsent, revokeConsent } from "./engine";
import {
  guardedSubjectWriteOrBlocked,
  writeGeneratedBatchGuarded,
  writeMattressPurchasesGuarded,
} from "./policyRepo";

/**
 * Race closure (audit F-04, level-up 5): consent/lifecycle are re-checked
 * INSIDE every write transaction, so a revocation or deletion that lands
 * between "check" and "write" wins — the stale writer's rows are dropped or
 * refused, never committed. These tests stage the audit's barrier scenarios
 * deterministically: authorization is captured (a generated batch, a parsed
 * import), the consent state changes, and then the stale write is attempted.
 */

const SIM_TODAY = new Date(Date.UTC(2026, 5, 30));

async function wipe() {
  await prisma.deletionRequest.deleteMany();
  await prisma.pendingImport.deleteMany();
  await prisma.importBatch.deleteMany();
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

async function makeConsented(): Promise<string> {
  const id = randomUUID();
  await prisma.participant.create({
    data: {
      id,
      yearOfBirth: 1975,
      sex: "male",
      enrollmentTouchpoint: "retail",
      createdAt: addDays(SIM_TODAY, -90),
    },
  });
  await grantConsent(id, "LANE_A", { grantedAt: addDays(SIM_TODAY, -90) });
  await grantConsent(id, "LANE_B", { grantedAt: addDays(SIM_TODAY, -90) });
  return id;
}

// Leave no rows referencing participants behind for later test files whose
// wipe helpers predate the DeletionRequest model.
afterAll(async () => {
  await prisma.deletionRequest.deleteMany();
});

beforeEach(async () => {
  await wipe();
  await setSimClock(SIM_TODAY);
});

describe("stale generated batches (seed / time machine flush)", () => {
  function wearableBatch(participantId: string, nights: number) {
    return {
      observations: Array.from({ length: nights }, (_, i) => ({
        participantId,
        source: "healthkit",
        concept: "sleep_duration_min",
        valueNumeric: 400,
        unit: "min",
        effectiveDate: addDays(SIM_TODAY, -(i + 1)),
        grain: "day",
        qualityFlags: "[]",
      })),
      sleepSessions: [],
      proResponses: [],
      treatmentEvents: [],
    };
  }

  it("a batch generated under a since-revoked gate is dropped at commit", async () => {
    const subject = await makeConsented();
    const bystander = await makeConsented();

    // The generation loop snapshotted consent, built the batch… (barrier)
    const batch = {
      observations: [
        ...wearableBatch(subject, 3).observations,
        ...wearableBatch(bystander, 2).observations,
      ],
      sleepSessions: [],
      proResponses: [],
      treatmentEvents: [],
    };

    // …then the revocation lands BEFORE the flush.
    await revokeConsent(subject, "LANE_A");
    await revokeConsent(subject, "LANE_B");

    const counts = await writeGeneratedBatchGuarded(batch);
    expect(counts.observations).toBe(2); // bystander only
    expect(counts.dropped).toBe(3);
    expect(await prisma.observation.count({ where: { participantId: subject } })).toBe(0);
    expect(await prisma.observation.count({ where: { participantId: bystander } })).toBe(2);
  });

  it("a batch generated before a deletion never lands after the hard delete", async () => {
    const subject = await makeConsented();
    const batch = wearableBatch(subject, 4);

    const filed = await requestDeletion(subject);
    if (!filed.ok) throw new Error("request failed");
    const executed = await executeDeletion(filed.request.id);
    expect(executed.ok).toBe(true);

    const counts = await writeGeneratedBatchGuarded(batch);
    expect(counts.observations).toBe(0);
    expect(counts.dropped).toBe(4);
    // The audit's core concern: no rows created after the hard-delete pass.
    expect(await prisma.observation.count({ where: { participantId: subject } })).toBe(0);
  });

  it("stale purchase batches are dropped the same way", async () => {
    const subject = await makeConsented();
    const purchase = {
      participantId: subject,
      sku: "RACE-SKU",
      purchaseDate: SIM_TODAY,
      deliveryDate: addDays(SIM_TODAY, 10),
      storeId: "MH-TEST",
    };
    await prisma.mattressCatalog.create({
      data: {
        sku: "RACE-SKU",
        brand: "Tempur-Pedic",
        model: "Race Medium Hybrid",
        firmnessRating: 6,
        materialClass: "hybrid",
        size: "Queen",
      },
    });

    await revokeConsent(subject, "LANE_B"); // mattress_purchase gone
    const result = await writeMattressPurchasesGuarded([purchase]);
    expect(result.written).toBe(0);
    expect(result.droppedParticipants).toEqual([subject]);
    expect(await prisma.mattressPurchase.count()).toBe(0);
  });
});

describe("guarded interactive writes re-check inside the transaction", () => {
  it("a write authorized by a stale pre-check is refused at commit time", async () => {
    const subject = await makeConsented();
    // The caller pre-checked earlier (stale) — then revocation lands.
    await revokeConsent(subject, "LANE_A");
    await revokeConsent(subject, "LANE_B");

    const outcome = await guardedSubjectWriteOrBlocked(
      subject,
      ["hst_clinical"],
      async (tx) => {
        await tx.observation.create({
          data: {
            participantId: subject,
            source: "hst",
            concept: "ahi",
            valueNumeric: 24,
            effectiveDate: SIM_TODAY,
            grain: "session",
            qualityFlags: "[]",
          },
        });
      }
    );
    expect(outcome.ok).toBe(false);
    expect(await prisma.observation.count({ where: { participantId: subject } })).toBe(0);
  });
});

describe("imports revalidate per chunk (audit F-04: long windows)", () => {
  function bigImport(nights: number): ParsedImportPayload {
    return {
      kind: "apple_health",
      source: "healthkit",
      observations: Array.from({ length: nights }, (_, i) => ({
        day: addDays(new Date(Date.UTC(2026, 0, 1)), i).toISOString().slice(0, 10),
        concept: "sleep_duration_min",
        value: 400,
        unit: "min",
      })),
      sessions: [],
      firstDay: "2026-01-01",
      lastDay: addDays(new Date(Date.UTC(2026, 0, 1)), nights - 1).toISOString().slice(0, 10),
    };
  }

  it("a revocation landing mid-import stops every subsequent chunk", async () => {
    const subject = await makeConsented();
    const payload = bigImport(4500); // 3 chunks of 2000/2000/500

    let chunksWritten = 0;
    const result = await ingestParsedImport(subject, payload, {
      onChunkWritten: async () => {
        chunksWritten += 1;
        if (chunksWritten === 1) {
          // The barrier: revoke while the import is between chunks.
          await revokeConsent(subject, "LANE_A");
          await revokeConsent(subject, "LANE_B");
        }
      },
    });

    expect(result.blocked).toBe(true);
    if (!result.blocked) return;
    expect(result.observationsWritten).toBe(2000); // first chunk only
    expect(await prisma.observation.count({ where: { participantId: subject } })).toBe(2000);
  });

  it("a deletion landing mid-import leaves ZERO rows behind (no post-delete resurrection)", async () => {
    const subject = await makeConsented();
    const payload = bigImport(4500);

    let interrupted = false;
    const result = await ingestParsedImport(subject, payload, {
      onChunkWritten: async () => {
        if (interrupted) return;
        interrupted = true;
        const filed = await requestDeletion(subject);
        if (!filed.ok) throw new Error("request failed");
        const executed = await executeDeletion(filed.request.id);
        if (!executed.ok) throw new Error("execute failed");
      },
    });

    expect(result.blocked).toBe(true);
    // The hard delete removed the first chunk; the guard refused the rest —
    // the audit's "rows created after the hard-delete pass" is exactly zero.
    expect(await prisma.observation.count({ where: { participantId: subject } })).toBe(0);
    const participant = await prisma.participant.findUniqueOrThrow({ where: { id: subject } });
    expect(participant.lifecycleState).toBe("deleted");
  });
});
