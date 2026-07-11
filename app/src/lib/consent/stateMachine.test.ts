import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { enrollRetail } from "@/app/enroll/retail/actions";
import {
  dataClassConsentStates,
  restoreAllConsents,
  restoreDataClass,
  revokeDataClass,
} from "../compliance/revocation";
import { prisma } from "../db";
import { setSimClock } from "../simclock";
import { MATTRESS_CATALOG } from "../synthetic/catalog";
import { addDays } from "../synthetic/profiles";
import { reconsentDataClass } from "./reconsent";
import {
  ConsentConflictError,
  DATA_CLASSES,
  evaluateGrants,
  grantConsent,
  grantSetHas,
  hasGrant,
  latestRecordsByInstrument,
  loadGrants,
  parseScopeJson,
  reviseConsentScope,
  revokeConsent,
  ScopeCeilingError,
  signedScopeCeiling,
  type ConsentScope,
} from "./index";
import type { StopBangAnswers } from "../stopbang";

/**
 * Consent state machine v2 (audit F-02/F-05/F-14, level-up 2):
 *
 * - the ledger is event-sourced and IMMUTABLE — every mutation appends, the
 *   database enforces monotonic unique revisions;
 * - concurrent partial revocations compare-and-swap instead of losing
 *   updates (the audit's exact Promise.all repro);
 * - the SIGNED-SCOPE CEILING: administrative restore can only re-enable
 *   grants proven in a signed scope — never-authorized classes are a
 *   distinct state and require the participant-facing re-consent flow.
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

async function wipe() {
  await prisma.deletionRequest.deleteMany();
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

async function makeParticipant(): Promise<string> {
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
  return id;
}

beforeEach(async () => {
  await wipe();
  await setSimClock(SIM_TODAY);
});

describe("immutable event stream + monotonic revisions", () => {
  it("every mutation appends; prior events are never touched; revisions are dense and unique", async () => {
    const pid = await makeParticipant();
    const grant = await grantConsent(pid, "LANE_B", { grantedAt: addDays(SIM_TODAY, -90) });
    const grantScope = grant.scope;

    const reduced: ConsentScope = parseScopeJson(grant.scope).filter(
      (entry) => entry.dataClass !== "wearable_sleep"
    );
    const revision = await reviseConsentScope(pid, "LANE_B", reduced);
    expect(revision?.eventType).toBe("scope_revision");
    const revoke = await revokeConsent(pid, "LANE_B");
    expect(revoke?.eventType).toBe("revoke");

    const events = await prisma.consentRecord.findMany({
      where: { participantId: pid },
      orderBy: { revision: "asc" },
    });
    expect(events.map((event) => event.revision)).toEqual([1, 2, 3]);
    expect(events.map((event) => event.eventType)).toEqual([
      "grant",
      "scope_revision",
      "revoke",
    ]);
    // The original signed grant is byte-for-byte untouched.
    expect(events[0].id).toBe(grant.id);
    expect(events[0].status).toBe("granted");
    expect(events[0].revokedAt).toBeNull();
    expect(events[0].scope).toBe(grantScope);
    // Projection: the highest revision defines current state.
    expect(evaluateGrants(events).size).toBe(0);

    // The DB enforces revision uniqueness — the CAS backstop.
    await expect(
      prisma.consentRecord.create({
        data: {
          participantId: pid,
          instrumentType: "LANE_B",
          instrumentVersion: "x",
          eventType: "revoke",
          revision: 3,
          status: "revoked",
          grantedAt: SIM_TODAY,
          scope: "[]",
        },
      })
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("reviseConsentScope compare-and-swaps: a stale expected revision is rejected", async () => {
    const pid = await makeParticipant();
    await grantConsent(pid, "LANE_B");
    const latest = latestRecordsByInstrument(
      await prisma.consentRecord.findMany({ where: { participantId: pid } })
    ).get("LANE_B")!;

    // A concurrent revision lands first…
    await reviseConsentScope(pid, "LANE_B", parseScopeJson(latest.scope), {
      expectedRevision: latest.revision,
    });
    // …so the second writer's derivation base is stale and must be refused.
    await expect(
      reviseConsentScope(pid, "LANE_B", [], { expectedRevision: latest.revision })
    ).rejects.toBeInstanceOf(ConsentConflictError);
  });

  it("AUDIT REPRO F-05: two simultaneous class revocations both stick — no lost update", async () => {
    const pid = await makeParticipant();
    await grantConsent(pid, "LANE_A", { grantedAt: addDays(SIM_TODAY, -90) });
    await grantConsent(pid, "LANE_B", { grantedAt: addDays(SIM_TODAY, -90) });

    const [first, second] = await Promise.all([
      revokeDataClass(pid, "wearable_sleep"),
      revokeDataClass(pid, "pro_responses"),
    ]);
    expect(first.action).toBe("revoke");
    expect(second.action).toBe("revoke");

    // The audit observed wearable_sleep silently re-granted; both must be off.
    const grants = await loadGrants(pid);
    expect(grantSetHas(grants, "wearable_sleep", "collect")).toBe(false);
    expect(grantSetHas(grants, "pro_responses", "collect")).toBe(false);
    // Everything else keeps flowing.
    expect(grantSetHas(grants, "hst_clinical", "collect")).toBe(true);
    expect(grantSetHas(grants, "sleep_mat", "collect")).toBe(true);

    // Revisions stayed dense + unique per instrument (no clobbered history).
    for (const instrument of ["LANE_A", "LANE_B"] as const) {
      const events = await prisma.consentRecord.findMany({
        where: { participantId: pid, instrumentType: instrument },
        orderBy: { revision: "asc" },
      });
      expect(events.map((event) => event.revision)).toEqual(
        events.map((_, index) => index + 1)
      );
    }
  });

  it("concurrent revoke + restore of the same class converge to the last event, never a mix", async () => {
    const pid = await makeParticipant();
    await grantConsent(pid, "LANE_B", { grantedAt: addDays(SIM_TODAY, -90) });
    await revokeDataClass(pid, "sleep_mat");

    await Promise.all([revokeDataClass(pid, "wearable_sleep"), restoreDataClass(pid, "sleep_mat")]);

    // Whatever the interleaving, the current state equals the projection of
    // the highest-revision event — no torn state between instruments.
    const records = await prisma.consentRecord.findMany({ where: { participantId: pid } });
    const latest = latestRecordsByInstrument(records).get("LANE_B")!;
    const projected = new Set(
      parseScopeJson(latest.scope).map((entry) => `${entry.dataClass}|${entry.use}`)
    );
    const grants = await loadGrants(pid);
    expect(new Set(grants)).toEqual(projected);
    // Both operations appended (retry resolved the race — nothing was lost).
    expect(grantSetHas(grants, "wearable_sleep", "collect")).toBe(false);
    expect(grantSetHas(grants, "sleep_mat", "collect")).toBe(true);
  });
});

describe("signed-scope ceiling (audit F-02)", () => {
  /** Retail enrollee who signed ONLY questionnaires (custom Lane B scope). */
  async function proOnlyEnrollee(): Promise<string> {
    await prisma.mattressCatalog.createMany({ data: MATTRESS_CATALOG });
    const result = await enrollRetail({
      displayName: "Pro Only Pat",
      answers: ANSWERS,
      toggles: {
        wearable_sleep: false,
        sleep_mat: false,
        mattress_purchase: false,
        pro_responses: true,
      },
    });
    return result.participantId;
  }

  it("AUDIT REPRO F-02: never-signed classes are never_authorized and Restore cannot enable them", async () => {
    const pid = await proOnlyEnrollee();

    const states = await dataClassConsentStates(pid);
    const byClass = new Map(states.map((state) => [state.dataClass, state]));
    expect(byClass.get("pro_responses")?.state).toBe("granted");
    expect(byClass.get("registry_demographics")?.state).toBe("granted");
    // The audit's repro classes: template-covered but NEVER signed.
    for (const dataClass of ["mattress_purchase", "wearable_sleep", "sleep_mat"] as const) {
      expect(byClass.get(dataClass)?.state).toBe("never_authorized");
      expect(byClass.get(dataClass)?.everAuthorized).toBe(false);
      expect(byClass.get(dataClass)?.revisableInstruments).toEqual([]);
    }

    // The exact escalation: restoring mattress_purchase must be refused…
    await expect(restoreDataClass(pid, "mattress_purchase")).rejects.toBeInstanceOf(
      ScopeCeilingError
    );
    // …and the ingest gate still refuses the class afterwards.
    expect(await hasGrant(pid, "mattress_purchase", "collect")).toBe(false);
    expect(await hasGrant(pid, "mattress_purchase", "research_deid")).toBe(false);

    // Direct engine-level expansion attempts are refused too.
    const scope = [
      { dataClass: "pro_responses", use: "collect" },
      { dataClass: "mattress_purchase", use: "collect" },
    ] as ConsentScope;
    await expect(reviseConsentScope(pid, "LANE_B", scope)).rejects.toBeInstanceOf(
      ScopeCeilingError
    );
  });

  it("restore-all restores the SIGNED custom scope, never the instrument template", async () => {
    const pid = await proOnlyEnrollee();
    await revokeConsent(pid, "LANE_B");
    expect((await loadGrants(pid)).size).toBe(0);

    const report = await restoreAllConsents(pid);
    expect(report.instruments).toEqual(["LANE_B"]);

    const grants = await loadGrants(pid);
    // Exactly what was signed comes back…
    expect(grantSetHas(grants, "pro_responses", "collect")).toBe(true);
    expect(grantSetHas(grants, "registry_demographics", "collect")).toBe(true);
    // …and NOTHING that wasn't (the old code restored the full template).
    expect(grantSetHas(grants, "wearable_sleep", "collect")).toBe(false);
    expect(grantSetHas(grants, "sleep_mat", "collect")).toBe(false);
    expect(grantSetHas(grants, "mattress_purchase", "collect")).toBe(false);
  });

  it("revoke → restore round-trip for a SIGNED class works; the ceiling itself never grows administratively", async () => {
    const pid = await proOnlyEnrollee();

    await revokeDataClass(pid, "pro_responses");
    expect(await hasGrant(pid, "pro_responses", "collect")).toBe(false);
    const midStates = await dataClassConsentStates(pid);
    expect(midStates.find((state) => state.dataClass === "pro_responses")?.state).toBe(
      "revoked" // authorized-then-revoked ≠ never_authorized
    );

    await restoreDataClass(pid, "pro_responses");
    expect(await hasGrant(pid, "pro_responses", "collect")).toBe(true);

    // After all that administration, the signed ceiling is unchanged.
    const records = await prisma.consentRecord.findMany({ where: { participantId: pid } });
    const ceiling = signedScopeCeiling(records);
    const ceilingClasses = new Set([...ceiling].map((key) => key.split("|")[0]));
    expect(ceilingClasses).toEqual(new Set(["pro_responses", "registry_demographics"]));
  });

  it("the re-consent flow records a fresh SIGNED grant and is the only path that expands the ceiling", async () => {
    const pid = await proOnlyEnrollee();

    // No signature, no expansion.
    expect(await reconsentDataClass(pid, "wearable_sleep", false)).toMatchObject({ ok: false });
    // Already-signed classes are not re-consent material.
    expect(await reconsentDataClass(pid, "pro_responses", true)).toMatchObject({ ok: false });

    const result = await reconsentDataClass(pid, "wearable_sleep", true);
    expect(result).toMatchObject({ ok: true, instrument: "LANE_B" });

    // The new event is a SIGNED grant, so the ceiling and the live grants
    // now cover the class…
    const records = await prisma.consentRecord.findMany({
      where: { participantId: pid },
      orderBy: { revision: "asc" },
    });
    expect(records.at(-1)?.eventType).toBe("grant");
    const grants = await loadGrants(pid);
    expect(grantSetHas(grants, "wearable_sleep", "collect")).toBe(true);
    // …the previously signed class kept flowing…
    expect(grantSetHas(grants, "pro_responses", "collect")).toBe(true);
    // …and the console now offers Restore (revoked), not re-consent.
    await revokeDataClass(pid, "wearable_sleep");
    const states = await dataClassConsentStates(pid);
    expect(states.find((state) => state.dataClass === "wearable_sleep")?.state).toBe("revoked");
    await restoreDataClass(pid, "wearable_sleep");
    expect(await hasGrant(pid, "wearable_sleep", "collect")).toBe(true);

    // Other never-signed classes are still sealed.
    expect(await hasGrant(pid, "sleep_mat", "collect")).toBe(false);
  });

  it("three-state grid is exhaustive over every data class", async () => {
    const pid = await proOnlyEnrollee();
    const states = await dataClassConsentStates(pid);
    expect(states.map((state) => state.dataClass).sort()).toEqual([...DATA_CLASSES].sort());
    for (const state of states) {
      expect(["granted", "revoked", "never_authorized"]).toContain(state.state);
      expect(state.granted).toBe(state.state === "granted");
    }
  });
});
