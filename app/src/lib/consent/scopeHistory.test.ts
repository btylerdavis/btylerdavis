import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { restoreDataClass, revokeDataClass } from "../compliance/revocation";
import { prisma } from "../db";
import { setSimClock } from "../simclock";
import { addDays } from "../synthetic/profiles";
import { getConsentHistory, grantConsent, revokeConsent } from "./engine";
import { reconsentDataClass } from "./reconsent";
import { buildScopeHistory } from "./scopeHistory";
import type { ConsentScope, ConsentUse } from "./types";

/**
 * Participant scope history + consent receipt correctness (level-up 7):
 * buildScopeHistory replays the immutable ledger into per-class timelines —
 * signed / revoked / restored / revised with dates and instrument versions —
 * and the three-state answer must distinguish NEVER_AUTHORIZED from revoked
 * (audit F-02). These are the exact facts the participant page section and
 * the printable receipt render.
 */

const SIM_TODAY = new Date(Date.UTC(2026, 5, 30));
const ENROLLED = addDays(SIM_TODAY, -60);
const ALL_USES: ConsentUse[] = ["collect", "view_identified", "research_deid"];

const scopeFor = (dataClasses: string[]): ConsentScope =>
  dataClasses.flatMap((dataClass) =>
    ALL_USES.map((use) => ({ dataClass, use }) as ConsentScope[number])
  );

async function wipe() {
  await prisma.releaseLedgerEntry.deleteMany();
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

async function createParticipant(): Promise<string> {
  const id = randomUUID();
  await prisma.participant.create({
    data: {
      id,
      yearOfBirth: 1978,
      sex: "male",
      enrollmentTouchpoint: "retail",
      createdAt: ENROLLED,
    },
  });
  return id;
}

const historyFor = async (id: string) => buildScopeHistory(await getConsentHistory(id));

beforeEach(async () => {
  await wipe();
  await setSimClock(SIM_TODAY);
});

describe("buildScopeHistory", () => {
  it("custom Lane B signature: signed classes granted, unsigned classes NEVER_AUTHORIZED with empty timelines", async () => {
    const subject = await createParticipant();
    await grantConsent(subject, "LANE_B", {
      grantedAt: ENROLLED,
      scope: scopeFor(["pro_responses"]),
    });

    const history = await historyFor(subject);
    const pro = history.find((entry) => entry.dataClass === "pro_responses");
    expect(pro?.state).toBe("granted");
    expect(pro?.currentUses).toEqual(ALL_USES);
    expect(pro?.events).toHaveLength(1);
    expect(pro?.events[0]).toMatchObject({
      action: "signed",
      eventType: "grant",
      instrumentType: "LANE_B",
      instrumentVersion: "1.0-demo",
    });
    expect(pro?.events[0].date).toEqual(ENROLLED);

    // The Lane B template covers wearables — but this participant never
    // signed for them: never_authorized, NOT revoked (audit F-02).
    for (const dataClass of ["wearable_sleep", "sleep_mat", "mattress_purchase"] as const) {
      const entry = history.find((candidate) => candidate.dataClass === dataClass);
      expect(entry?.state).toBe("never_authorized");
      expect(entry?.everAuthorized).toBe(false);
      expect(entry?.events).toHaveLength(0);
    }
  });

  it("revoke → restore of one class: full timeline with dates, versions, and correct actions", async () => {
    const subject = await createParticipant();
    await grantConsent(subject, "LANE_A", { grantedAt: ENROLLED });

    const revokeDay = addDays(SIM_TODAY, -10);
    await setSimClock(revokeDay);
    await revokeDataClass(subject, "cpap_telemetry");

    const restoreDay = addDays(SIM_TODAY, -3);
    await setSimClock(restoreDay);
    await restoreDataClass(subject, "cpap_telemetry");

    const history = await historyFor(subject);
    const cpap = history.find((entry) => entry.dataClass === "cpap_telemetry");
    expect(cpap?.state).toBe("granted");
    expect(cpap?.everAuthorized).toBe(true);
    expect(cpap?.events.map((event) => event.action)).toEqual([
      "signed",
      "revoked",
      "restored",
    ]);
    expect(cpap?.events.map((event) => event.eventType)).toEqual([
      "grant",
      "scope_revision",
      "scope_revision",
    ]);
    expect(cpap?.events[1].date).toEqual(revokeDay);
    expect(cpap?.events[1].uses).toEqual([]); // nothing in force while revoked
    expect(cpap?.events[2].date).toEqual(restoreDay);
    expect(cpap?.events[2].uses).toEqual(ALL_USES);

    // The untouched classes saw exactly one event (the signature).
    const hst = history.find((entry) => entry.dataClass === "hst_clinical");
    expect(hst?.events.map((event) => event.action)).toEqual(["signed"]);
  });

  it("full instrument revocation marks every covered class revoked at the revokedAt date", async () => {
    const subject = await createParticipant();
    await grantConsent(subject, "LANE_A", { grantedAt: ENROLLED });
    const revokedAt = addDays(SIM_TODAY, -5);
    await revokeConsent(subject, "LANE_A", { revokedAt });

    const history = await historyFor(subject);
    for (const dataClass of ["cpap_telemetry", "hst_clinical", "wearable_sleep"] as const) {
      const entry = history.find((candidate) => candidate.dataClass === dataClass);
      expect(entry?.state).toBe("revoked"); // authorized-then-revoked ≠ never_authorized
      expect(entry?.everAuthorized).toBe(true);
      const last = entry?.events[entry.events.length - 1];
      expect(last).toMatchObject({ action: "revoked", eventType: "revoke" });
      expect(last?.date).toEqual(revokedAt);
    }
  });

  it("re-consent turns never_authorized into a SIGNED event carrying the fresh instrument version", async () => {
    const subject = await createParticipant();
    await grantConsent(subject, "LANE_B", {
      grantedAt: ENROLLED,
      scope: scopeFor(["pro_responses"]),
    });

    const reconsented = await reconsentDataClass(subject, "wearable_sleep", true, {
      grantedAt: SIM_TODAY,
    });
    expect(reconsented.ok).toBe(true);

    const history = await historyFor(subject);
    const wearable = history.find((entry) => entry.dataClass === "wearable_sleep");
    expect(wearable?.state).toBe("granted");
    expect(wearable?.events.map((event) => event.action)).toEqual(["signed"]);
    expect(wearable?.events[0]).toMatchObject({
      eventType: "grant",
      instrumentVersion: "1.1-reconsent",
    });
    expect(wearable?.events[0].date).toEqual(SIM_TODAY);

    // The previously signed class kept flowing through the re-consent event.
    const pro = history.find((entry) => entry.dataClass === "pro_responses");
    expect(pro?.state).toBe("granted");
  });

  it("multi-instrument overlap: a class stays granted while ANY covering instrument still grants it", async () => {
    const subject = await createParticipant();
    // wearable_sleep is covered by both lanes.
    await grantConsent(subject, "LANE_B", { grantedAt: ENROLLED });
    await grantConsent(subject, "LANE_A", { grantedAt: addDays(ENROLLED, 7) });

    // Revoking Lane B does NOT end wearable coverage (Lane A still grants it)
    // — so no per-class "revoked" event is recorded for it.
    await revokeConsent(subject, "LANE_B", { revokedAt: addDays(SIM_TODAY, -1) });
    const history = await historyFor(subject);
    const wearable = history.find((entry) => entry.dataClass === "wearable_sleep");
    expect(wearable?.state).toBe("granted");
    expect(wearable?.events.map((event) => event.action)).toEqual(["signed"]);

    // mattress_purchase was Lane-B-only: it IS revoked.
    const mattress = history.find((entry) => entry.dataClass === "mattress_purchase");
    expect(mattress?.state).toBe("revoked");
  });
});
