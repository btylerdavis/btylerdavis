import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../db";
import {
  assertIngestAllowed,
  ConsentError,
  getConsentStates,
  getLinkedProfile,
  getObservations,
  grantConsent,
  hasGrant,
  revokeConsent,
} from "./index";

async function wipe() {
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

async function makeParticipant(touchpoint: "clinic" | "retail" = "retail"): Promise<string> {
  const participant = await prisma.participant.create({
    data: {
      id: randomUUID(),
      yearOfBirth: 1975,
      sex: "male",
      enrollmentTouchpoint: touchpoint,
    },
  });
  return participant.id;
}

async function insertWearableObservation(participantId: string) {
  return prisma.observation.create({
    data: {
      participantId,
      source: "healthkit",
      concept: "sleep_efficiency",
      valueNumeric: 84.5,
      unit: "%",
      effectiveDate: new Date("2026-05-01"),
      grain: "day",
      qualityFlags: "[]",
    },
  });
}

describe("consent engine", () => {
  beforeEach(wipe);

  it("grant → ingest allowed and reads return data", async () => {
    const pid = await makeParticipant();
    await grantConsent(pid, "LANE_B");

    await expect(assertIngestAllowed(pid, "wearable_sleep")).resolves.toBeUndefined();
    await insertWearableObservation(pid);

    const result = await getObservations(pid, { use: "view_identified" });
    expect(result.blocked).toBe(false);
    expect(result.blockedDataClasses).toEqual([]);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].concept).toBe("sleep_efficiency");
  });

  it("no consent at all → ingest throws and reads return blocked marker", async () => {
    const pid = await makeParticipant();
    await expect(assertIngestAllowed(pid, "wearable_sleep")).rejects.toThrow(ConsentError);

    const result = await getObservations(pid, { use: "view_identified" });
    expect(result.data).toEqual([]);
    expect(result.blocked).toBe(true);
  });

  it("revoke → ingest throws and reads are blocked", async () => {
    const pid = await makeParticipant();
    await grantConsent(pid, "LANE_B");
    await insertWearableObservation(pid);

    const revoked = await revokeConsent(pid, "LANE_B");
    expect(revoked?.status).toBe("revoked");
    expect(revoked?.revokedAt).toBeInstanceOf(Date);

    await expect(assertIngestAllowed(pid, "wearable_sleep")).rejects.toThrow(ConsentError);

    const result = await getObservations(pid, { use: "view_identified" });
    expect(result.data).toEqual([]);
    expect(result.blocked).toBe(true);
    expect(result.blockedDataClasses).toContain("wearable_sleep");
  });

  // UPDATED for audit F-14: revocation is an APPENDED immutable event, not a
  // status flip — the original signed grant record is never mutated.
  it("revocation appends an immutable revoke event; the signed grant is untouched", async () => {
    const pid = await makeParticipant();
    const grant = await grantConsent(pid, "LANE_B", { grantedAt: new Date("2026-04-01") });
    await revokeConsent(pid, "LANE_B", { revokedAt: new Date("2026-05-01") });

    const records = await prisma.consentRecord.findMany({
      where: { participantId: pid },
      orderBy: { revision: "asc" },
    });
    expect(records).toHaveLength(2);
    // The signed grant event: byte-for-byte immutable.
    expect(records[0].id).toBe(grant.id);
    expect(records[0].eventType).toBe("grant");
    expect(records[0].status).toBe("granted");
    expect(records[0].revokedAt).toBeNull();
    expect(records[0].revision).toBe(1);
    // The revoke event: carries the revoked scope and the revocation time.
    expect(records[1].eventType).toBe("revoke");
    expect(records[1].status).toBe("revoked");
    expect(records[1].revision).toBe(2);
    expect(records[1].revokedAt?.toISOString().slice(0, 10)).toBe("2026-05-01");
    expect(JSON.parse(records[1].scope)).toEqual(JSON.parse(records[0].scope));
  });

  it("re-grant after revoke works via a new record, history preserved", async () => {
    const pid = await makeParticipant();
    await grantConsent(pid, "LANE_B", { grantedAt: new Date("2026-04-01") });
    await revokeConsent(pid, "LANE_B", { revokedAt: new Date("2026-05-01") });
    expect(await hasGrant(pid, "wearable_sleep", "collect")).toBe(false);

    await grantConsent(pid, "LANE_B", { grantedAt: new Date("2026-06-01"), instrumentVersion: "1.1-demo" });

    expect(await hasGrant(pid, "wearable_sleep", "collect")).toBe(true);
    await expect(assertIngestAllowed(pid, "wearable_sleep")).resolves.toBeUndefined();

    const records = await prisma.consentRecord.findMany({
      where: { participantId: pid },
      orderBy: { revision: "asc" },
    });
    // Consent v2 (audit F-14): grant, revoke EVENT, re-grant — three
    // immutable records; the whole history stays intact.
    expect(records).toHaveLength(3);
    expect(records.map((record) => record.eventType)).toEqual(["grant", "revoke", "grant"]);
    expect(records[0].status).toBe("granted"); // original grant untouched
    expect(records[1].status).toBe("revoked");
    expect(records[2].status).toBe("granted");

    const states = await getConsentStates(pid);
    expect(states).toEqual([
      expect.objectContaining({ instrumentType: "LANE_B", status: "granted", historyCount: 3 }),
    ]);
  });

  it("expired grants fail", async () => {
    const pid = await makeParticipant();
    const record = await grantConsent(pid, "LANE_B");
    await prisma.consentRecord.update({ where: { id: record.id }, data: { status: "expired" } });

    expect(await hasGrant(pid, "wearable_sleep", "collect")).toBe(false);
    await expect(assertIngestAllowed(pid, "wearable_sleep")).rejects.toThrow(ConsentError);
  });

  it("Lane C absent → linkage join refused; granting Lane C opens it", async () => {
    const pid = await makeParticipant();
    await grantConsent(pid, "LANE_A");
    await grantConsent(pid, "LANE_B");
    await prisma.demoIdentity.create({
      data: { participantId: pid, displayName: "Test Person", email: "test@example.com" },
    });

    const refused = await getLinkedProfile(pid, { use: "view_identified" });
    expect(refused.blocked).toBe(true);
    expect(refused.blockedReason).toMatch(/linkage join refused/);
    expect(refused.identity).toBeUndefined();

    await grantConsent(pid, "LANE_C");
    const linked = await getLinkedProfile(pid, { use: "view_identified" });
    expect(linked.blocked).toBe(false);
    expect(linked.identity?.displayName).toBe("Test Person");

    // De-identified use never exposes identity, even with Lane C.
    const deid = await getLinkedProfile(pid, { use: "research_deid" });
    expect(deid.blocked).toBe(false);
    expect(deid.identity).toBeNull();
  });

  it("revoking one instrument keeps classes covered by another still-granted instrument", async () => {
    const pid = await makeParticipant();
    await grantConsent(pid, "LANE_A"); // covers wearable_sleep too
    await grantConsent(pid, "LANE_B"); // covers wearable_sleep + mattress_purchase

    await revokeConsent(pid, "LANE_B");

    expect(await hasGrant(pid, "wearable_sleep", "collect")).toBe(true); // via LANE_A
    expect(await hasGrant(pid, "mattress_purchase", "collect")).toBe(false); // only LANE_B had it
    await expect(assertIngestAllowed(pid, "mattress_purchase")).rejects.toThrow(ConsentError);
  });
});
