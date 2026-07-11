import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import {
  confirmImport,
  loadSampleImport,
  previewImportUpload,
} from "@/app/coach/import/actions";
import { executeDeletion, requestDeletion } from "../compliance/deletion";
import { grantConsent, LineageError, revokeConsent, uniformRowDataClass } from "../consent";
import { guardedImportRowsWrite } from "../consent/policyRepo";
import { prisma } from "../db";
import { setSimClock } from "../simclock";
import {
  CONNECTOR_SCHEMAS,
  ImportValidationError,
  validateImportPayload,
} from "./connectors";
import {
  confirmPendingImport,
  ingestParsedImport,
  stagePendingImport,
  type ParsedImportPayload,
} from "./ingest";

/**
 * IMPORT TRUST BOUNDARY — adversarial suite (audit v2 HIGH finding).
 *
 * The old confirmImport accepted a client-round-tripped payload:
 * authorization keyed off caller-controlled `kind` while persisted lineage
 * came from caller-controlled `source`, so a forged payload could pass a
 * wearable consent check while storing CPAP-classified rows. The fixed
 * boundary is server-owned: preview parses + connector-schema-validates
 * server-side and stages a PendingImport keyed by a single-use token;
 * confirmImport accepts ONLY (token, participantId, align) — its signature
 * physically cannot carry a payload anymore. This suite proves the two
 * remaining payload entry points behind the action (stagePendingImport and
 * ingestParsedImport) refuse EVERY forged kind×source pairing plus tampered
 * concepts/units/bounds/dates/sessions with zero rows written, and that the
 * token itself cannot be swapped across participants, reused, or replayed
 * after expiry.
 */

const FIXTURES = path.join(process.cwd(), "public", "demo-fixtures");
const SIM_TODAY = new Date(Date.UTC(2026, 5, 30)); // 2026-06-30

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

async function createParticipant(): Promise<string> {
  const id = randomUUID();
  await prisma.participant.create({
    data: {
      id,
      yearOfBirth: 1974,
      sex: "male",
      enrollmentTouchpoint: "retail",
      createdAt: SIM_TODAY,
    },
  });
  return id;
}

/** zero subject-data rows AND zero staged/receipt rows for the participant */
async function expectNothingPersisted(participantId: string) {
  expect(await prisma.observation.count({ where: { participantId } })).toBe(0);
  expect(await prisma.sleepSession.count({ where: { participantId } })).toBe(0);
  expect(await prisma.pendingImport.count({ where: { participantId } })).toBe(0);
  expect(await prisma.importBatch.count({ where: { participantId } })).toBe(0);
}

function payloadFor(kind: string, source: string): ParsedImportPayload {
  // Rows use a concept/unit VALID for the claimed kind (when the kind is
  // real), so refusal provably comes from the kind→source pairing itself.
  const concept =
    kind === "airview"
      ? { concept: "cpap_usage_minutes", value: 480, unit: "min" }
      : { concept: "sleep_duration_min", value: 400, unit: "min" };
  return {
    kind: kind as ParsedImportPayload["kind"],
    source,
    observations: [{ day: "2026-06-29", ...concept }],
    sessions: [],
    firstDay: "2026-06-29",
    lastDay: "2026-06-29",
  };
}

beforeEach(async () => {
  await wipe();
  await setSimClock(SIM_TODAY);
});

// ---------------------------------------------------------------------------
// Forged kind × source cross-product
// ---------------------------------------------------------------------------

describe("forged kind×source payloads are refused with zero rows", () => {
  const KINDS = ["apple_health", "airview", "dentitrac", "hst", ""];
  const SOURCES = [
    "healthkit",
    "airview",
    "sd_card",
    "hst",
    "pro",
    "pos",
    "sleep_mat",
    "aggregator:garmin",
    "wearable:fitbit",
    "dentitrac",
    "totally_unknown",
  ];
  const VALID = new Set(["apple_health|healthkit", "airview|airview"]);

  it("every invalid pairing is refused at staging AND at ingest (server-action entry points)", async () => {
    const subject = await createParticipant();
    // Lane A covers BOTH wearable_sleep and cpap_telemetry collect — so any
    // refusal below is the connector schema, never a missing grant.
    await grantConsent(subject, "LANE_A", { grantedAt: SIM_TODAY });

    let pairsTried = 0;
    for (const kind of KINDS) {
      for (const source of SOURCES) {
        if (VALID.has(`${kind}|${source}`)) continue;
        pairsTried += 1;
        const forged = payloadFor(kind, source);

        // Entry point 1: preview staging (what previewImportUpload calls).
        const staged = await stagePendingImport(subject, forged);
        expect(staged.ok).toBe(false);

        // Entry point 2: the ingest engine behind confirm.
        await expect(ingestParsedImport(subject, forged)).rejects.toThrow(
          ImportValidationError
        );
      }
    }
    expect(pairsTried).toBe(KINDS.length * SOURCES.length - VALID.size);
    await expectNothingPersisted(subject);
  });

  it("reproduces the audit scenario: Lane B wearable consent cannot smuggle CPAP-classified rows", async () => {
    const subject = await createParticipant();
    await grantConsent(subject, "LANE_B", { grantedAt: SIM_TODAY }); // wearable ✓, cpap ✗

    const forged: ParsedImportPayload = {
      kind: "apple_health", // would authorize as wearable_sleep
      source: "airview", // would persist/classify as cpap_telemetry
      observations: [
        { day: "2026-06-30", concept: "cpap_usage_minutes", value: 480, unit: "min" },
      ],
      sessions: [],
      firstDay: "2026-06-30",
      lastDay: "2026-06-30",
    };

    const staged = await stagePendingImport(subject, forged);
    expect(staged.ok).toBe(false);
    if (staged.ok) return;
    expect(staged.reasons.join(" ")).toMatch(/source_mismatch/);
    expect(staged.reasons.join(" ")).toMatch(/unknown_concept/);

    await expect(ingestParsedImport(subject, forged)).rejects.toThrow(/source_mismatch/);
    await expectNothingPersisted(subject);
  });

  it("the inverse mismatch (airview kind, healthkit source) is refused too", async () => {
    const subject = await createParticipant();
    await grantConsent(subject, "LANE_A", { grantedAt: SIM_TODAY });
    const forged = payloadFor("airview", "healthkit");
    await expect(ingestParsedImport(subject, forged)).rejects.toThrow(/source_mismatch/);
    await expectNothingPersisted(subject);
  });
});

// ---------------------------------------------------------------------------
// Tampered concepts / units / bounds / dates / sessions
// ---------------------------------------------------------------------------

describe("tampered payload contents are refused with named reasons", () => {
  async function refuse(
    mutate: (payload: ParsedImportPayload) => void,
    reason: RegExp,
    kind: "apple_health" | "airview" = "apple_health"
  ) {
    const subject = await createParticipant();
    await grantConsent(subject, "LANE_A", { grantedAt: SIM_TODAY });
    const payload = payloadFor(kind, CONNECTOR_SCHEMAS[kind].canonicalSource);
    mutate(payload);
    const staged = await stagePendingImport(subject, payload);
    expect(staged.ok).toBe(false);
    if (!staged.ok) expect(staged.reasons.join(" ")).toMatch(reason);
    await expect(ingestParsedImport(subject, payload)).rejects.toThrow(reason);
    await expectNothingPersisted(subject);
  }

  it("cross-connector concept under a trusted source", () =>
    refuse((p) => {
      p.observations[0].concept = "cpap_usage_minutes"; // airview concept on apple_health
    }, /unknown_concept/));

  it("invented concept", () =>
    refuse((p) => {
      p.observations[0].concept = "ssn_digits";
    }, /unknown_concept/));

  it("wrong unit for an allowed concept", () =>
    refuse((p) => {
      p.observations[0] = { day: "2026-06-29", concept: "resting_hr", value: 60, unit: "min" };
    }, /unit_mismatch/));

  it("value out of physical bounds", () =>
    refuse(
      (p) => {
        p.observations[0] = {
          day: "2026-06-29",
          concept: "residual_ahi",
          value: 9000,
          unit: "events/h",
        };
      },
      /value_out_of_bounds/,
      "airview"
    ));

  it("non-finite value", () =>
    refuse((p) => {
      p.observations[0].value = Number.NaN;
    }, /value_out_of_bounds/));

  it("impossible calendar day", () =>
    refuse((p) => {
      p.observations[0].day = "2026-02-30";
      p.firstDay = "2026-02-30";
      p.lastDay = "2026-02-30";
    }, /invalid_day/));

  it("out-of-range year", () =>
    refuse((p) => {
      p.observations[0].day = "1899-06-29";
      p.firstDay = "1899-06-29";
      p.lastDay = "1899-06-29";
    }, /invalid_day/));

  it("declared date range disagreeing with row days", () =>
    refuse((p) => {
      p.lastDay = "2027-01-01";
    }, /date_range_mismatch/));

  it("sessions attached to a session-less connector", () =>
    refuse(
      (p) => {
        p.sessions = [
          {
            day: "2026-06-29",
            startIso: "2026-06-28T22:00:00Z",
            endIso: "2026-06-29T06:00:00Z",
            summary: { efficiency: 90, durationMin: 400, stages: { deep: 80, rem: 90, core: 230 } },
          },
        ];
      },
      /sessions_not_supported/,
      "airview"
    ));

  it("session that ends before it starts", () =>
    refuse((p) => {
      p.sessions = [
        {
          day: "2026-06-29",
          startIso: "2026-06-29T06:00:00Z",
          endIso: "2026-06-28T22:00:00Z",
          summary: { efficiency: 90, durationMin: 400, stages: { deep: 80, rem: 90, core: 230 } },
        },
      ];
    }, /invalid_session/));

  it("session summary out of bounds (efficiency 400%)", () =>
    refuse((p) => {
      p.sessions = [
        {
          day: "2026-06-29",
          startIso: "2026-06-28T22:00:00Z",
          endIso: "2026-06-29T06:00:00Z",
          summary: { efficiency: 400, durationMin: 400, stages: { deep: 80, rem: 90, core: 230 } },
        },
      ];
    }, /session_out_of_bounds/));

  it("empty payloads and oversized payloads are refused", async () => {
    const empty = payloadFor("apple_health", "healthkit");
    empty.observations = [];
    expect(validateImportPayload(empty)).toMatchObject({ ok: false });

    const huge = payloadFor("apple_health", "healthkit");
    huge.observations = Array.from({ length: 100_001 }, () => ({
      day: "2026-06-29",
      concept: "sleep_duration_min",
      value: 400,
      unit: "min",
    }));
    huge.firstDay = "2026-06-29";
    huge.lastDay = "2026-06-29";
    const result = validateImportPayload(huge);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.map((v) => v.code)).toContain("too_many_rows");
    }
  });
});

// ---------------------------------------------------------------------------
// Token misuse: swap / expiry / reuse
// ---------------------------------------------------------------------------

describe("single-use confirmation tokens", () => {
  async function stageValid(participantId: string) {
    const staged = await stagePendingImport(
      participantId,
      payloadFor("airview", "airview")
    );
    expect(staged.ok).toBe(true);
    if (!staged.ok) throw new Error("staging should succeed");
    return staged;
  }

  it("participant swap is refused without consuming the token (via the REAL server action)", async () => {
    const alice = await createParticipant();
    const mallory = await createParticipant();
    await grantConsent(alice, "LANE_A", { grantedAt: SIM_TODAY });
    await grantConsent(mallory, "LANE_A", { grantedAt: SIM_TODAY });

    const staged = await stageValid(alice);

    // confirmImport is the exported server action: (token, participantId,
    // align) — no payload parameter exists to forge anymore.
    const swapped = await confirmImport(staged.token, mallory, false);
    expect(swapped.blocked).toBe(true);
    if (swapped.blocked) expect(swapped.reason).toMatch(/participant_mismatch/);
    expect(await prisma.observation.count({ where: { participantId: mallory } })).toBe(0);
    expect(await prisma.importBatch.count()).toBe(0);

    // The rightful owner's preview is still valid afterwards.
    const rightful = await confirmPendingImport(staged.token, alice);
    expect(rightful.blocked).toBe(false);
    expect(await prisma.observation.count({ where: { participantId: alice } })).toBe(1);
  });

  it("an expired token is refused (wall-clock TTL)", async () => {
    const subject = await createParticipant();
    await grantConsent(subject, "LANE_A", { grantedAt: SIM_TODAY });
    const staged = await stageValid(subject);

    await prisma.pendingImport.update({
      where: { token: staged.token },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const result = await confirmPendingImport(staged.token, subject);
    expect(result.blocked).toBe(true);
    if (result.blocked) expect(result.reason).toMatch(/expired/);
    expect(await prisma.observation.count({ where: { participantId: subject } })).toBe(0);
    expect(await prisma.importBatch.count()).toBe(0);
  });

  it("a consumed token can never import twice", async () => {
    const subject = await createParticipant();
    await grantConsent(subject, "LANE_A", { grantedAt: SIM_TODAY });
    const staged = await stageValid(subject);

    const first = await confirmPendingImport(staged.token, subject);
    expect(first.blocked).toBe(false);
    const countAfterFirst = await prisma.observation.count({ where: { participantId: subject } });

    const replay = await confirmPendingImport(staged.token, subject);
    expect(replay.blocked).toBe(true);
    if (replay.blocked) expect(replay.reason).toMatch(/already_used/);
    expect(await prisma.observation.count({ where: { participantId: subject } })).toBe(
      countAfterFirst
    );
    expect(await prisma.importBatch.count()).toBe(1); // only the first import's receipt
  });

  it("an unknown token is refused", async () => {
    const subject = await createParticipant();
    await grantConsent(subject, "LANE_A", { grantedAt: SIM_TODAY });
    const result = await confirmPendingImport("forged-token", subject);
    expect(result.blocked).toBe(true);
    if (result.blocked) expect(result.reason).toMatch(/not_found/);
    await expectNothingPersisted(subject);
  });

  it("staging for a revoked participant still stages, but confirmation is refused by the gate", async () => {
    const subject = await createParticipant();
    await grantConsent(subject, "LANE_A", { grantedAt: SIM_TODAY });
    const staged = await stageValid(subject);
    expect(staged.authority).toMatchObject({ instrumentType: "LANE_A", revision: 1 });

    await revokeConsent(subject, "LANE_A");
    const result = await confirmPendingImport(staged.token, subject);
    expect(result.blocked).toBe(true);
    if (result.blocked) expect(result.reason).toMatch(/cpap_telemetry/);
    expect(await prisma.observation.count({ where: { participantId: subject } })).toBe(0);
    expect(await prisma.importBatch.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Row-lineage authorization (mixed / unknown batches)
// ---------------------------------------------------------------------------

describe("row-level lineage authorization refuses mixed and unknown batches", () => {
  it("uniformRowDataClass fails closed", () => {
    expect(uniformRowDataClass([{ source: "healthkit" }, { source: "healthkit" }])).toEqual({
      ok: true,
      dataClass: "wearable_sleep",
    });
    expect(uniformRowDataClass([])).toMatchObject({ ok: false, code: "empty_batch" });
    expect(uniformRowDataClass([{ source: "evil_connector" }])).toMatchObject({
      ok: false,
      code: "unknown_source",
    });
    expect(
      uniformRowDataClass([{ source: "healthkit" }, { source: "airview" }])
    ).toMatchObject({ ok: false, code: "mixed_batch" });
  });

  it("guardedImportRowsWrite refuses unknown-source, mixed, and class-mismatched rows before any persistence", async () => {
    const subject = await createParticipant();
    await grantConsent(subject, "LANE_A", { grantedAt: SIM_TODAY });

    const row = (source: string) => ({
      participantId: subject,
      source,
      concept: "sleep_duration_min",
      valueNumeric: 400,
      effectiveDate: SIM_TODAY,
      grain: "day",
      qualityFlags: "[]",
    });
    const write = async (tx: Prisma.TransactionClient, rows: ReturnType<typeof row>[]) =>
      (await tx.observation.createMany({ data: rows })).count;

    // Unknown source: refused whole (no quarantine writes to primary tables).
    await expect(
      guardedImportRowsWrite(subject, "wearable_sleep", [row("evil_connector")], write)
    ).rejects.toThrow(LineageError);

    // Mixed classes: refused whole.
    await expect(
      guardedImportRowsWrite(subject, "wearable_sleep", [row("healthkit"), row("airview")], write)
    ).rejects.toThrow(/mixed_batch/);

    // Lineage disagrees with the class the connector claims to admit.
    await expect(
      guardedImportRowsWrite(subject, "wearable_sleep", [row("airview")], write)
    ).rejects.toThrow(/class_mismatch/);

    expect(await prisma.observation.count({ where: { participantId: subject } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Happy paths through the real server actions + provenance receipts
// ---------------------------------------------------------------------------

describe("legitimate imports still work end-to-end, with provenance receipts", () => {
  it("AirView CSV: upload action → token → confirm; receipt links rows, digest, consent revision", async () => {
    const subject = await createParticipant();
    await grantConsent(subject, "LANE_A", { grantedAt: SIM_TODAY });

    const csvBytes = await readFile(path.join(FIXTURES, "airview-sample.csv"));
    const formData = new FormData();
    formData.set("file", new File([csvBytes], "airview-sample.csv", { type: "text/csv" }));

    const preview = await previewImportUpload(subject, formData);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.summary.kind).toBe("airview");
    expect(preview.impact.dataClass).toBe("cpap_telemetry");
    expect(preview.impact.authority).toMatchObject({ instrumentType: "LANE_A", revision: 1 });
    // digest is the SHA-256 of the exact uploaded bytes
    expect(preview.impact.fileDigest).toBe(
      createHash("sha256").update(csvBytes).digest("hex")
    );

    const result = await confirmPendingImport(preview.token, subject);
    expect(result.blocked).toBe(false);
    if (result.blocked) return;
    expect(result.observationsWritten).toBeGreaterThan(0);
    expect(result.dataClass).toBe("cpap_telemetry");
    expect(result.source).toBe("airview");
    expect(result.parserVersion).toBe("airview-csv-v1");
    expect(result.fileDigest).toBe(preview.impact.fileDigest);
    expect(result.consentInstrument).toBe("LANE_A");
    expect(result.consentRevision).toBe(1);

    // The receipt row exists, carries the consumed token id and final counts.
    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: result.batchId } });
    expect(batch.participantId).toBe(subject);
    expect(batch.observationCount).toBe(result.observationsWritten);
    expect(batch.sessionCount).toBe(0);
    const pending = await prisma.pendingImport.findUniqueOrThrow({
      where: { token: preview.token },
    });
    expect(batch.tokenId).toBe(pending.id);
    expect(pending.consumedAt).not.toBeNull();

    // Every imported row links back to the receipt, with canonical lineage.
    const rows = await prisma.observation.findMany({ where: { participantId: subject } });
    expect(rows.length).toBe(result.observationsWritten);
    expect(rows.every((r) => r.batchId === result.batchId && r.source === "airview")).toBe(true);
  });

  it("Apple Health sample: stage → confirm writes sessions too, all linked to the batch; expiry is sim-clock-agnostic", async () => {
    const subject = await createParticipant();
    await grantConsent(subject, "LANE_B", { grantedAt: SIM_TODAY });

    const preview = await loadSampleImport(subject, "apple_health");
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.impact.dataClass).toBe("wearable_sleep");
    expect(preview.impact.authority).toMatchObject({ instrumentType: "LANE_B", revision: 1 });
    expect(preview.impact.rowCount).toBe(70 + 14);
    const xmlBytes = await readFile(path.join(FIXTURES, "apple-health-export.xml"));
    expect(preview.impact.fileDigest).toBe(
      createHash("sha256").update(xmlBytes).digest("hex")
    );

    // Sim-clock jumps must not expire (or resurrect) staging tokens: the
    // TTL is wall-clock. Leap the demo clock a year ahead before confirming.
    await setSimClock(new Date(Date.UTC(2027, 5, 30)));

    const result = await confirmPendingImport(preview.token, subject);
    expect(result.blocked).toBe(false);
    if (result.blocked) return;
    expect(result.observationsWritten).toBe(70);
    expect(result.sessionsWritten).toBe(14);
    expect(result.consentInstrument).toBe("LANE_B");

    const sessions = await prisma.sleepSession.findMany({ where: { participantId: subject } });
    expect(sessions.length).toBe(14);
    expect(sessions.every((s) => s.batchId === result.batchId && s.source === "healthkit")).toBe(
      true
    );
    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: result.batchId } });
    expect(batch.observationCount).toBe(70);
    expect(batch.sessionCount).toBe(14);
    expect(batch.parserVersion).toBe("apple-health-xml-v1");
  });

  it("participant deletion hard-deletes staged payloads and provenance receipts too", async () => {
    const subject = await createParticipant();
    await grantConsent(subject, "LANE_A", { grantedAt: SIM_TODAY });

    // One confirmed import (receipt) + one still-staged payload.
    const confirmed = await stagePendingImport(subject, payloadFor("airview", "airview"));
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    const result = await confirmPendingImport(confirmed.token, subject);
    expect(result.blocked).toBe(false);
    const staged = await stagePendingImport(subject, payloadFor("apple_health", "healthkit"));
    expect(staged.ok).toBe(true);
    expect(await prisma.importBatch.count({ where: { participantId: subject } })).toBe(1);
    expect(await prisma.pendingImport.count({ where: { participantId: subject } })).toBe(2);

    const filed = await requestDeletion(subject);
    expect(filed.ok).toBe(true);
    if (!filed.ok) return;
    const executed = await executeDeletion(filed.request.id);
    expect(executed.ok).toBe(true);
    if (!executed.ok) return;
    expect(executed.report.counts.importBatches).toBe(1);
    expect(executed.report.counts.pendingImports).toBe(2);
    await expectNothingPersisted(subject);

    // The surviving staged token is gone too — confirming it is refused.
    if (staged.ok) {
      const afterDeath = await confirmPendingImport(staged.token, subject);
      expect(afterDeath.blocked).toBe(true);
      if (afterDeath.blocked) expect(afterDeath.reason).toMatch(/not_found/);
    }
  });

  it("non-import rows keep a null batchId (provenance only marks imports)", async () => {
    const subject = await createParticipant();
    await grantConsent(subject, "LANE_A", { grantedAt: SIM_TODAY });
    await prisma.observation.create({
      data: {
        participantId: subject,
        source: "airview",
        concept: "cpap_usage_minutes",
        valueNumeric: 300,
        unit: "min",
        effectiveDate: SIM_TODAY,
        grain: "day",
        qualityFlags: "[]",
      },
    });
    const row = await prisma.observation.findFirstOrThrow({
      where: { participantId: subject },
    });
    expect(row.batchId).toBeNull();
  });
});
