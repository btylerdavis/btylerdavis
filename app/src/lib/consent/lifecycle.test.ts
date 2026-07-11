import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  connectWearable,
  enrollRetail,
  recordMattressPurchase,
} from "@/app/enroll/retail/actions";
import {
  confirmHstIntake,
  enrollClinicPatient,
  grantLinkage,
  loadSampleHst,
  recordCpapSetup,
} from "@/app/enroll/clinic/actions";
import {
  declineDeletion,
  executeDeletion,
  getDeletionCertificate,
  requestDeletion,
} from "../compliance/deletion";
import {
  restoreAllConsents,
  restoreDataClass,
  revokeAllConsents,
  revokeDataClass,
} from "../compliance/revocation";
import { prisma } from "../db";
import { ingestParsedImport } from "../imports/ingest";
import { advanceDays, setSimClock } from "../simclock";
import { MATTRESS_CATALOG } from "../synthetic/catalog";
import { enrollmentRows } from "../synthetic/enrollment";
import { addDays, buildProfile, DEMO_EPOCH, MARCUS_REED_PARTICIPANT_ID } from "../synthetic/profiles";
import { reconsentDataClass } from "./reconsent";
import {
  assertActiveParticipant,
  grantConsent,
  LifecycleError,
  loadGrants,
  restoreConsentScope,
  reviseConsentScope,
  revokeConsent,
} from "./index";
import { guardedSubjectWriteOrBlocked } from "./policyRepo";
import type { StopBangAnswers } from "../stopbang";

/**
 * TOMBSTONE FINALITY (audit F-01, level-up 1): an executed deletion is
 * TERMINAL. This suite runs the full mutation-API matrix against a deleted
 * participant — consent grants, scope revisions, restores, both enrollment
 * doors, CPAP setup, wearable connect, purchases, HST intake, imports,
 * re-consent, simulation generation — and asserts every one of them is
 * refused with zero rows written. It also proves the deletion workflow
 * itself is atomic and unwedgeable (audit F-08) and that the certificate
 * renders only from its stored execution snapshot.
 */

const SIM_TODAY = new Date(Date.UTC(2026, 5, 30));

const ANSWERS: StopBangAnswers = {
  snoring: true,
  tiredness: true,
  observed_apnea: true,
  pressure: true,
  bmi: false,
  age: true,
  neck: true,
  gender: true,
};

const ALL_ON = {
  wearable_sleep: true,
  sleep_mat: true,
  mattress_purchase: true,
  pro_responses: true,
};

async function wipe() {
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

/** A fully-enrolled retail participant with a delivered purchase. */
async function enrollSubject(): Promise<string> {
  const enrolled = await enrollRetail({
    displayName: "Terminal Tess",
    answers: ANSWERS,
    toggles: ALL_ON,
  });
  await grantConsent(enrolled.participantId, "LANE_A", { grantedAt: SIM_TODAY });
  const purchase = await recordMattressPurchase(enrolled.participantId, "TP-PROADAPT-MH-Q");
  expect(purchase.blocked).toBe(false);
  return enrolled.participantId;
}

/** Files + executes a deletion; returns the executed request id. */
async function deleteSubject(participantId: string): Promise<string> {
  const filed = await requestDeletion(participantId, "finality test");
  expect(filed.ok).toBe(true);
  if (!filed.ok) throw new Error("request failed");
  const executed = await executeDeletion(filed.request.id);
  expect(executed.ok).toBe(true);
  if (!executed.ok) throw new Error("execute failed");
  return filed.request.id;
}

async function identifiedRowCount(participantId: string): Promise<number> {
  const where = { where: { participantId } };
  const counts = await Promise.all([
    prisma.observation.count(where),
    prisma.sleepSession.count(where),
    prisma.proResponse.count(where),
    prisma.device.count(where),
    prisma.mattressPurchase.count(where),
    prisma.treatmentEvent.count(where),
    prisma.episode.count(where),
    prisma.demoIdentity.count(where),
  ]);
  return counts.reduce((sum, count) => sum + count, 0);
}

// Leave no rows referencing participants behind for later test files whose
// wipe helpers predate the DeletionRequest model.
afterAll(async () => {
  await prisma.deletionRequest.deleteMany();
});

beforeEach(async () => {
  await wipe();
  await setSimClock(SIM_TODAY);
  await prisma.mattressCatalog.createMany({ data: MATTRESS_CATALOG });
});

describe("tombstone finality — every mutation API refuses a deleted participant", () => {
  it("consent mutations: grant / revise / restore / revoke-all / class ops / re-consent are all refused", async () => {
    const subject = await enrollSubject();
    await deleteSubject(subject);
    const ledgerBefore = await prisma.consentRecord.count({ where: { participantId: subject } });

    // The lifecycle guard itself.
    await expect(assertActiveParticipant(subject)).rejects.toBeInstanceOf(LifecycleError);

    // Engine-level mutations (the audit's exact resurrection path: a fresh
    // Lane A grant after execution).
    await expect(grantConsent(subject, "LANE_A")).rejects.toBeInstanceOf(LifecycleError);
    await expect(grantConsent(subject, "LANE_B")).rejects.toBeInstanceOf(LifecycleError);
    // Nothing granted remains to revise/revoke — and nothing may be appended.
    expect(await reviseConsentScope(subject, "LANE_B", [])).toBeNull();
    expect(await revokeConsent(subject, "LANE_B")).toBeNull();
    await expect(
      restoreConsentScope(subject, "LANE_B", [{ dataClass: "pro_responses", use: "collect" }])
    ).rejects.toBeInstanceOf(LifecycleError);

    // Compliance-console operations (audit repro #2: restoreAllConsents).
    await expect(restoreAllConsents(subject)).rejects.toBeInstanceOf(LifecycleError);
    await expect(revokeAllConsents(subject)).rejects.toBeInstanceOf(LifecycleError);
    await expect(restoreDataClass(subject, "wearable_sleep")).rejects.toBeInstanceOf(
      LifecycleError
    );
    await expect(revokeDataClass(subject, "wearable_sleep")).rejects.toBeInstanceOf(
      LifecycleError
    );

    // The re-consent flow (the only ceiling-expanding path) is closed too.
    const reconsent = await reconsentDataClass(subject, "hst_clinical", true);
    expect(reconsent.ok).toBe(false);

    // grantLinkage (the clinic Lane C beat).
    await expect(grantLinkage(subject)).rejects.toThrow(/deleted/);

    // NOTHING was appended to the ledger and no grant re-materialized.
    expect(await prisma.consentRecord.count({ where: { participantId: subject } })).toBe(
      ledgerBefore
    );
    expect((await loadGrants(subject)).size).toBe(0);
  });

  it("data writes: CPAP setup, wearable connect, purchase, HST intake, imports, guarded writes — zero rows land", async () => {
    const subject = await enrollSubject();
    await deleteSubject(subject);

    // Audit repro #1/#3: CPAP setup used to recreate device/event/episodes.
    const cpap = await recordCpapSetup(subject, "airsense11");
    expect(cpap.blocked).toBe(true);

    const wearable = await connectWearable(subject, "apple");
    expect(wearable.connected).toBe(false);

    const purchase = await recordMattressPurchase(subject, "TP-PROADAPT-MH-Q");
    expect(purchase.blocked).toBe(true);

    const sample = await loadSampleHst("csv");
    if (!sample.ok) throw new Error("fixture should parse");
    const hst = await confirmHstIntake(subject, sample.parsed);
    expect(hst.blocked).toBe(true);

    const importResult = await ingestParsedImport(subject, {
      kind: "apple_health",
      source: "healthkit",
      observations: [{ day: "2026-06-29", concept: "sleep_duration_min", value: 400, unit: "min" }],
      sessions: [],
      firstDay: "2026-06-29",
      lastDay: "2026-06-29",
    });
    expect(importResult.blocked).toBe(true);

    // The policy repository refuses directly, inside the transaction.
    const guarded = await guardedSubjectWriteOrBlocked(subject, [], async (tx) => {
      await tx.observation.create({
        data: {
          participantId: subject,
          source: "healthkit",
          concept: "sleep_duration_min",
          valueNumeric: 400,
          effectiveDate: SIM_TODAY,
          grain: "day",
          qualityFlags: "[]",
        },
      });
    });
    expect(guarded.ok).toBe(false);

    // Re-enrollment through the clinic door is refused (audit repro #4).
    await expect(
      enrollClinicPatient({ mode: "existing", participantId: subject }, true)
    ).rejects.toThrow(/deleted/);

    // A second deletion request is refused.
    expect(await requestDeletion(subject)).toEqual({
      ok: false,
      error: "This record has already been deleted",
    });

    // The identified tier stayed EMPTY through all of it.
    expect(await identifiedRowCount(subject)).toBe(0);
  });

  it("the time machine never generates for a tombstone (and drops stale batch rows at commit)", async () => {
    // Cohort profiles so nightly generation has real work to do.
    const marcus = buildProfile(MARCUS_REED_PARTICIPANT_ID);
    const rows = enrollmentRows(marcus);
    await prisma.participant.create({ data: rows.participant });
    await prisma.consentRecord.createMany({ data: rows.consentRecords });
    await prisma.device.createMany({ data: rows.devices });

    const subject = await enrollSubject();
    await deleteSubject(subject);

    await setSimClock(addDays(DEMO_EPOCH, 30));
    const summary = await advanceDays(3);

    // The tombstone was not even enumerated; Marcus still accrues data.
    expect(await identifiedRowCount(subject)).toBe(0);
    expect(
      await prisma.observation.count({ where: { participantId: marcus.id } })
    ).toBeGreaterThan(0);
    expect(summary.rowsDroppedAtCommit).toBe(0);
  });
});

describe("deletion workflow atomicity (audit F-08)", () => {
  it("a failure mid-execution rolls back completely — the request stays pending and is retryable", async () => {
    const subject = await enrollSubject();
    const filed = await requestDeletion(subject);
    expect(filed.ok).toBe(true);
    if (!filed.ok) return;

    // The audit's exact fault injection: remove the SimClock row.
    await prisma.simClock.deleteMany();
    await expect(executeDeletion(filed.request.id)).rejects.toThrow(/npm run seed/);

    // NOT wedged in `executing`; nothing was deleted or revoked — and the
    // failed attempt is OBSERVABLE on the request (level-up 8): attempt
    // count, wall-clock timestamp, and the error, all outside the rolled-
    // back transaction.
    const request = await prisma.deletionRequest.findUniqueOrThrow({
      where: { id: filed.request.id },
    });
    expect(request.status).toBe("pending");
    expect(request.attempts).toBe(1);
    expect(request.lastAttemptAt).not.toBeNull();
    expect(request.lastAttemptError).toMatch(/npm run seed/);
    const participant = await prisma.participant.findUniqueOrThrow({ where: { id: subject } });
    expect(participant.deletedAt).toBeNull();
    expect(participant.lifecycleState).toBe("deletion_pending");
    expect((await loadGrants(subject)).size).toBeGreaterThan(0);

    // Retry succeeds once the fault clears; the success clears the recorded
    // failure and stamps the immutable certificate hash.
    await setSimClock(SIM_TODAY);
    const retried = await executeDeletion(filed.request.id);
    expect(retried.ok).toBe(true);
    if (retried.ok) expect(retried.report.attempt).toBe(2);
    expect(await identifiedRowCount(subject)).toBe(0);
    const executed = await prisma.deletionRequest.findUniqueOrThrow({
      where: { id: filed.request.id },
    });
    expect(executed.attempts).toBe(2);
    expect(executed.lastAttemptError).toBeNull();
    expect(executed.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("concurrent executions: exactly one wins, counts stay accurate", async () => {
    const subject = await enrollSubject();
    const rowsBefore = await identifiedRowCount(subject);
    expect(rowsBefore).toBeGreaterThan(0);
    const filed = await requestDeletion(subject);
    if (!filed.ok) throw new Error("request failed");

    const [first, second] = await Promise.all([
      executeDeletion(filed.request.id),
      executeDeletion(filed.request.id),
    ]);
    const outcomes = [first, second];
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    const winner = outcomes.find((outcome) => outcome.ok);
    if (!winner || !winner.ok) throw new Error("no winner");
    // The stored counts reflect the REAL deletion, not a double-execute zero.
    expect(winner.report.totalRows).toBe(rowsBefore);
  });

  it("the active-request invariant is database-enforced, not just pre-checked", async () => {
    const subject = await enrollSubject();

    const [a, b] = await Promise.all([requestDeletion(subject), requestDeletion(subject)]);
    expect([a, b].filter((outcome) => outcome.ok)).toHaveLength(1);

    // Even a direct write cannot create a second active request.
    await expect(
      prisma.deletionRequest.create({
        data: {
          participantId: subject,
          requestedAt: SIM_TODAY,
          status: "pending",
          activeKey: subject,
        },
      })
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("the certificate renders ONLY from the stored execution snapshot", async () => {
    const subject = await enrollSubject();
    const requestId = await deleteSubject(subject);

    const certificate = await getDeletionCertificate(requestId);
    expect(certificate).not.toBeNull();
    if (!certificate) return;
    const storedLedgerCount = certificate.ledgerCount;
    const storedCounts = { ...certificate.counts };
    expect(storedLedgerCount).toBeGreaterThan(0);

    // Simulate a later ledger change a live-count certificate would leak
    // (raw write — no product path can do this to a tombstone).
    await prisma.consentRecord.create({
      data: {
        participantId: subject,
        instrumentType: "LANE_C",
        instrumentVersion: "raw",
        eventType: "grant",
        revision: 99,
        status: "granted",
        grantedAt: SIM_TODAY,
        scope: "[]",
      },
    });

    const after = await getDeletionCertificate(requestId);
    expect(after?.ledgerCount).toBe(storedLedgerCount); // snapshot, not live
    expect(after?.counts).toEqual(storedCounts);
    expect(after?.ledgerRef).toContain(`${storedLedgerCount} records retained`);

    // A non-executed request has no certificate.
    const other = await enrollSubject();
    const pending = await requestDeletion(other);
    if (!pending.ok) throw new Error("request failed");
    expect(await getDeletionCertificate(pending.request.id)).toBeNull();
  });

  it("decline returns the participant to active and releases the unique active slot", async () => {
    const subject = await enrollSubject();
    const filed = await requestDeletion(subject);
    if (!filed.ok) throw new Error("request failed");

    const declined = await declineDeletion(filed.request.id, "wrong record");
    expect(declined.ok).toBe(true);

    const participant = await prisma.participant.findUniqueOrThrow({ where: { id: subject } });
    expect(participant.lifecycleState).toBe("active");
    // The unique slot is free: a new request can be filed.
    const again = await requestDeletion(subject);
    expect(again.ok).toBe(true);
  });
});
