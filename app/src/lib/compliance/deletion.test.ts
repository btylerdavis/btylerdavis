import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  getConsentHistory,
  getConsentStates,
  getLinkedProfile,
  getObservations,
  grantConsent,
  loadGrants,
} from "../consent";
import { prisma } from "../db";
import { loadExecDashboard } from "../exec/queries";
import { getLinkedDisplayNames, registerIdentity } from "../identity";
import { loadExplorer } from "../research/explorer";
import { loadResearchCohort } from "../research/cohort";
import { setSimClock } from "../simclock";
import { addDays } from "../synthetic/profiles";
import {
  certificateContentHash,
  countIdentifiedRows,
  declineDeletion,
  executeDeletion,
  getDeletionCertificate,
  getParticipantDeletionState,
  parseDeletionCounts,
  requestDeletion,
  totalDeleted,
  type DeletionCounts,
} from "./deletion";

/**
 * Deletion workflow round-trip (SPEC §9.4; DEMO.md Lane B reserve →
 * working): request → execute hard-deletes every identified-tier row and
 * revokes every consent, the participant row tombstones, the append-only
 * consent ledger SURVIVES — and every gated surface serves nothing for the
 * deleted subject afterwards. Deletion is stronger than revocation: rows are
 * gone, not sealed. The recorded counts must match what was actually
 * deleted, because the certificate renders from them.
 */

const SIM_TODAY = new Date(Date.UTC(2026, 5, 30));
const SKU = "DEL-TEST-SKU";

// Rows seeded per participant by seedSubject (the expected deletion counts).
const EXPECTED: DeletionCounts = {
  observations: 12, // 3 hst + 5 cpap + 4 sleep_mat
  sleepSessions: 1,
  proResponses: 2,
  devices: 2,
  mattressPurchases: 1,
  treatmentEvents: 1,
  episodes: 1,
  // Import trust boundary tables (audit v2 HIGH fix): now part of the
  // deletion pass/certificate; seedSubject stages no imports, so 0.
  pendingImports: 0,
  importBatches: 0,
  demoIdentity: 1,
};

async function wipe() {
  await prisma.deletionRequest.deleteMany();
  await prisma.savedCohort.deleteMany();
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

async function seedSubject(name: string): Promise<string> {
  const id = randomUUID();
  const enrolled = addDays(SIM_TODAY, -90);
  await prisma.participant.create({
    data: {
      id,
      yearOfBirth: 1974,
      sex: "male",
      enrollmentTouchpoint: "retail",
      createdAt: enrolled,
    },
  });
  await registerIdentity(id, name, `${name.toLowerCase().replace(/ /g, ".")}@example.com`);
  await grantConsent(id, "LANE_B", { grantedAt: enrolled });
  await grantConsent(id, "LANE_A", { grantedAt: addDays(enrolled, 7) });
  await grantConsent(id, "LANE_C", { grantedAt: addDays(enrolled, 7) });

  await prisma.observation.createMany({
    data: [
      { concept: "ahi", valueNumeric: 24 },
      { concept: "supine_ahi", valueNumeric: 41 },
      { concept: "nonsupine_ahi", valueNumeric: 9.8 },
    ].map((row) => ({
      participantId: id,
      source: "hst",
      effectiveDate: addDays(enrolled, 7),
      grain: "session",
      qualityFlags: "[]",
      ...row,
    })),
  });
  await prisma.observation.createMany({
    data: Array.from({ length: 5 }, (_, i) => ({
      participantId: id,
      source: "airview",
      concept: "cpap_usage_minutes",
      valueNumeric: 380,
      unit: "min",
      effectiveDate: addDays(SIM_TODAY, -(i + 1)),
      grain: "day",
      qualityFlags: "[]",
    })),
  });
  await prisma.observation.createMany({
    data: Array.from({ length: 4 }, (_, i) => ({
      participantId: id,
      source: "sleep_mat",
      concept: "supine_time_pct",
      valueNumeric: 45,
      unit: "%",
      effectiveDate: addDays(SIM_TODAY, -(i + 1)),
      grain: "day",
      qualityFlags: "[]",
    })),
  });
  await prisma.sleepSession.create({
    data: {
      participantId: id,
      source: "healthkit",
      startTs: addDays(SIM_TODAY, -1),
      endTs: new Date(addDays(SIM_TODAY, -1).getTime() + 8 * 3_600_000),
      summary: "{}",
    },
  });
  await prisma.proResponse.createMany({
    data: [
      {
        participantId: id,
        instrument: "ESS",
        instrumentVersion: "1.0",
        administeredAt: enrolled,
        itemScores: "[]",
        totalScore: 14,
      },
      {
        participantId: id,
        instrument: "STOP_BANG",
        instrumentVersion: "1.0",
        administeredAt: enrolled,
        itemScores: "[]",
        totalScore: 6,
      },
    ],
  });
  await prisma.device.createMany({
    data: [
      { participantId: id, deviceClass: "cpap", make: "ResMed", model: "AirSense 11", assignedAt: enrolled },
      { participantId: id, deviceClass: "sleep_mat", make: "Withings", model: "Sleep Analyzer", assignedAt: enrolled },
    ],
  });
  await prisma.mattressPurchase.create({
    data: {
      participantId: id,
      sku: SKU,
      purchaseDate: addDays(enrolled, 3),
      deliveryDate: addDays(enrolled, 13),
      storeId: "MH-TEST",
    },
  });
  await prisma.treatmentEvent.create({
    data: { participantId: id, type: "cpap_setup", eventDate: addDays(enrolled, 14), detail: "{}" },
  });
  await prisma.episode.create({
    data: { participantId: id, protocolPhase: "baseline", startDate: enrolled },
  });
  return id;
}

beforeEach(async () => {
  await wipe();
  await setSimClock(SIM_TODAY);
  await prisma.mattressCatalog.create({
    data: {
      sku: SKU,
      brand: "Tempur-Pedic",
      model: "TEMPUR-ProAdapt Medium Hybrid",
      firmnessRating: 6,
      materialClass: "hybrid",
      size: "Queen",
    },
  });
});

// Leave no rows referencing participants behind for the other test files,
// whose wipe helpers predate the DeletionRequest model.
afterAll(async () => {
  await prisma.deletionRequest.deleteMany();
  await prisma.savedCohort.deleteMany();
});

describe("deletion requests", () => {
  it("files a pending request at the sim clock; duplicates are refused", async () => {
    const subject = await seedSubject("Delia Deleted");
    const filed = await requestDeletion(subject, "  please remove my data  ");
    expect(filed.ok).toBe(true);
    if (!filed.ok) return;
    expect(filed.request.status).toBe("pending");
    expect(filed.request.requestedAt).toEqual(SIM_TODAY);
    expect(filed.request.note).toBe("please remove my data");

    const duplicate = await requestDeletion(subject);
    expect(duplicate).toEqual({ ok: false, error: "A deletion request is already pending" });

    const unknown = await requestDeletion(randomUUID());
    expect(unknown).toEqual({ ok: false, error: "Unknown participant" });
  });

  it("execute hard-deletes identified rows, tombstones the participant, keeps the ledger — and every gated surface serves nothing", async () => {
    const subject = await seedSubject("Delia Deleted");
    const bystander = await seedSubject("Kept Kim");

    // Live counts before: exactly what seedSubject wrote.
    expect(await countIdentifiedRows(subject)).toEqual(EXPECTED);

    const filed = await requestDeletion(subject, "consumer right");
    expect(filed.ok).toBe(true);
    if (!filed.ok) return;

    const executed = await executeDeletion(filed.request.id);
    expect(executed.ok).toBe(true);
    if (!executed.ok) return;
    const { report } = executed;

    // --- the report: counts match reality, certificate-grade ------------------
    expect(report.counts).toEqual(EXPECTED);
    expect(report.totalRows).toBe(totalDeleted(EXPECTED));
    expect(report.revokedInstruments.sort()).toEqual(["LANE_A", "LANE_B", "LANE_C"]);
    expect(report.executedAt).toEqual(SIM_TODAY);
    // Consent v2 (audit F-14): revocation APPENDS immutable revoke events —
    // 3 signed grants + 3 revoke events survive in the ledger.
    expect(report.ledgerRecords).toBe(6);
    expect(report.ledgerRef).toContain("6 records retained");

    // --- hard deletion: identified-tier rows are GONE, not sealed --------------
    expect(await countIdentifiedRows(subject)).toEqual({
      observations: 0,
      sleepSessions: 0,
      proResponses: 0,
      devices: 0,
      mattressPurchases: 0,
      treatmentEvents: 0,
      episodes: 0,
      // Import trust boundary tables (audit v2): part of the deletion pass.
      pendingImports: 0,
      importBatches: 0,
      demoIdentity: 0,
    });

    // --- tombstone: the participant row survives with deletedAt ----------------
    const tombstone = await prisma.participant.findUnique({ where: { id: subject } });
    expect(tombstone).not.toBeNull();
    expect(tombstone!.deletedAt).toEqual(SIM_TODAY);

    // --- the consent ledger SURVIVES: immutable events, latest = revoked -------
    const ledger = await getConsentHistory(subject);
    expect(ledger).toHaveLength(6); // 3 signed grants (untouched) + 3 revoke events
    expect(ledger.filter((record) => record.eventType === "grant")).toHaveLength(3);
    expect(
      ledger
        .filter((record) => record.eventType === "grant")
        .every((record) => record.status === "granted" && record.revokedAt === null)
    ).toBe(true); // prior facts are IMMUTABLE
    const states = await getConsentStates(subject);
    expect(states).toHaveLength(3);
    expect(
      states.every((state) => state.status === "revoked" && state.revokedAt !== null)
    ).toBe(true); // ...but every instrument's CURRENT state is revoked

    // --- the request row carries the certificate data --------------------------
    const request = await prisma.deletionRequest.findUniqueOrThrow({
      where: { id: filed.request.id },
    });
    expect(request.status).toBe("executed");
    expect(request.resolvedAt).toEqual(SIM_TODAY);
    expect(request.activeKey).toBeNull(); // active-request slot released
    expect(parseDeletionCounts(request.deletionCounts)).toEqual(EXPECTED);
    expect(request.ledgerRef).toBe(report.ledgerRef);
    expect(request.ledgerCount).toBe(6); // certificate snapshot, stored at execution
    // Observable workflow (level-up 8): attempt metadata on a clean success.
    expect(request.attempts).toBe(1);
    expect(report.attempt).toBe(1);
    expect(request.lastAttemptError).toBeNull();
    // Immutable certificate hash: stored at execution, returned on the report.
    expect(request.contentHash).toBe(report.contentHash);
    expect(request.contentHash).toMatch(/^[0-9a-f]{64}$/);

    // --- terminal lifecycle -----------------------------------------------------
    expect(tombstone!.lifecycleState).toBe("deleted");

    // --- gated surfaces: nothing, anywhere ---------------------------------------
    expect((await loadGrants(subject)).size).toBe(0);
    for (const use of ["view_identified", "research_deid"] as const) {
      const obs = await getObservations(subject, { use });
      expect(obs.blocked).toBe(true);
      expect(obs.data).toHaveLength(0);
    }
    const linked = await getLinkedProfile(subject, { use: "view_identified" });
    expect(linked.blocked).toBe(true);
    expect(await getLinkedDisplayNames([subject, bystander])).toEqual(
      new Map([[bystander, "Kept Kim"]])
    );

    const research = await loadResearchCohort();
    expect(research.byId.has(subject)).toBe(false);
    expect(research.members.map((member) => member.id)).toEqual([bystander]);
    const explorer = await loadExplorer({});
    expect(explorer.cohortTotal).toBe(1);
    const exec = await loadExecDashboard();
    expect(exec.growth.consented).toBe(1);
    expect(exec.growth.linked).toBe(1);

    // --- no resurrection paths ----------------------------------------------------
    expect(await executeDeletion(filed.request.id)).toEqual({
      ok: false,
      error: "Request is already executed",
    });
    expect(await requestDeletion(subject)).toEqual({
      ok: false,
      error: "This record has already been deleted",
    });

    // --- bystander fully intact ---------------------------------------------------
    expect(await countIdentifiedRows(bystander)).toEqual(EXPECTED);
    const bystanderObs = await getObservations(bystander, { use: "view_identified" });
    expect(bystanderObs.blocked).toBe(false);
    expect(bystanderObs.data.length).toBeGreaterThan(0);
  });

  it("stores an immutable certificate hash: stable, verifiable, and independent of later database changes", async () => {
    const subject = await seedSubject("Delia Deleted");
    const filed = await requestDeletion(subject);
    if (!filed.ok) throw new Error("request failed");
    const executed = await executeDeletion(filed.request.id);
    if (!executed.ok) throw new Error("execute failed");
    const { report } = executed;

    // The stored hash is exactly the canonical hash of the stored snapshot.
    const recomputed = certificateContentHash({
      requestId: report.requestId,
      participantId: report.participantId,
      requestedAt: report.requestedAt,
      executedAt: report.executedAt,
      counts: report.counts,
      ledgerCount: report.ledgerRecords,
      ledgerRef: report.ledgerRef,
    });
    expect(recomputed).toBe(report.contentHash);
    // Stability: hashing the same snapshot again yields the same digest.
    expect(
      certificateContentHash({
        requestId: report.requestId,
        participantId: report.participantId,
        requestedAt: report.requestedAt,
        executedAt: report.executedAt,
        counts: { ...report.counts },
        ledgerCount: report.ledgerRecords,
        ledgerRef: report.ledgerRef,
      })
    ).toBe(report.contentHash);
    // Sensitivity: any snapshot field change changes the digest.
    expect(
      certificateContentHash({
        requestId: report.requestId,
        participantId: report.participantId,
        requestedAt: report.requestedAt,
        executedAt: report.executedAt,
        counts: { ...report.counts, observations: report.counts.observations + 1 },
        ledgerCount: report.ledgerRecords,
        ledgerRef: report.ledgerRef,
      })
    ).not.toBe(report.contentHash);

    // The certificate renders the STORED hash and verifies it against the
    // stored snapshot fields — never a live query.
    const certificate = await getDeletionCertificate(filed.request.id);
    expect(certificate?.contentHash).toBe(report.contentHash);
    expect(certificate?.contentHashVerified).toBe(true);

    // Unrelated database activity after execution cannot move the hash.
    await seedSubject("Later Larry");
    const after = await getDeletionCertificate(filed.request.id);
    expect(after?.contentHash).toBe(report.contentHash);
    expect(after?.contentHashVerified).toBe(true);
  });

  it("surfaces the full participant-facing state machine, including declined", async () => {
    const subject = await seedSubject("Kept Kim");
    const filed = await requestDeletion(subject, "first thoughts");
    if (!filed.ok) throw new Error("request failed");

    let state = await getParticipantDeletionState(subject);
    expect(state.pending?.id).toBe(filed.request.id);
    expect(state.declined).toBeNull();
    expect(state.executed).toBeNull();

    await declineDeletion(filed.request.id, "wrong record (demo)");
    state = await getParticipantDeletionState(subject);
    expect(state.pending).toBeNull();
    expect(state.declined?.id).toBe(filed.request.id);

    // Declined is not terminal: a new request can be filed and executed.
    const again = await requestDeletion(subject);
    if (!again.ok) throw new Error("second request failed");
    await executeDeletion(again.request.id);
    state = await getParticipantDeletionState(subject);
    expect(state.executed?.id).toBe(again.request.id);
    expect(state.declined?.id).toBe(filed.request.id); // history stays visible
  });

  it("decline resolves the request and touches nothing else", async () => {
    const subject = await seedSubject("Kept Kim");
    const filed = await requestDeletion(subject, "second thoughts");
    expect(filed.ok).toBe(true);
    if (!filed.ok) return;

    const declined = await declineDeletion(filed.request.id, "wrong record (demo)");
    expect(declined.ok).toBe(true);
    if (!declined.ok) return;
    expect(declined.request.status).toBe("declined");
    expect(declined.request.resolvedAt).toEqual(SIM_TODAY);
    expect(declined.request.note).toBe("wrong record (demo)");

    // Nothing was deleted or revoked.
    expect(await countIdentifiedRows(subject)).toEqual(EXPECTED);
    expect((await loadGrants(subject)).size).toBeGreaterThan(0);
    const participant = await prisma.participant.findUniqueOrThrow({ where: { id: subject } });
    expect(participant.deletedAt).toBeNull();

    // Declined ≠ blocked forever: a new request can be filed.
    const again = await requestDeletion(subject);
    expect(again.ok).toBe(true);

    // A resolved request cannot be executed or re-declined.
    expect(await executeDeletion(filed.request.id)).toEqual({
      ok: false,
      error: "Request is already declined",
    });
    expect(await declineDeletion(filed.request.id)).toEqual({
      ok: false,
      error: "Request is already declined",
    });
  });
});
