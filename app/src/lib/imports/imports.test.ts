import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { getObservations, grantConsent, revokeConsent } from "../consent";
import { prisma } from "../db";
import { setSimClock } from "../simclock";
import { parseAirViewCsv } from "./airview";
import {
  ImportParseError,
  nightOf,
  parseAppleDate,
  parseAppleHealthXml,
} from "./appleHealth";
import { parseDentiTracCsv } from "./dentitrac";
import { ingestParsedImport } from "./ingest";

/**
 * Real-import pipeline tests: both parsers against the bundled demo
 * fixtures, plus the gated ingest path — imports write only through
 * assertIngestAllowed and land where the trends page reads.
 */

const FIXTURES = path.join(process.cwd(), "public", "demo-fixtures");
const SIM_TODAY = new Date(Date.UTC(2026, 5, 30)); // 2026-06-30

async function fixture(name: string): Promise<string> {
  return readFile(path.join(FIXTURES, name), "utf8");
}

describe("Apple Health export parser", () => {
  it("parses the fixture to nightly-grain canonical rows", async () => {
    const parsed = await parseAppleHealthXml(await fixture("apple-health-export.xml"));

    expect(parsed.kind).toBe("apple_health");
    expect(parsed.source).toBe("healthkit");
    expect(parsed.nights).toBe(14);
    expect(parsed.firstDay).toBe("2026-06-16");
    expect(parsed.lastDay).toBe("2026-06-29");

    // 14 nights × (duration + efficiency + resting_hr + hrv + spo2) = 70
    expect(parsed.observations).toHaveLength(70);
    const concepts = new Set(parsed.observations.map((row) => row.concept));
    expect(concepts).toEqual(
      new Set(["sleep_duration_min", "sleep_efficiency", "resting_hr", "hrv_sdnn", "spo2_mean"])
    );

    // Sessions: stages sum to the asleep duration; efficiency is sane.
    expect(parsed.sessions).toHaveLength(14);
    for (const session of parsed.sessions) {
      const { deep, rem, core } = session.summary.stages;
      expect(deep + rem + core).toBe(session.summary.durationMin);
      expect(session.summary.efficiency).toBeGreaterThan(60);
      expect(session.summary.efficiency).toBeLessThanOrEqual(100);
    }

    // SpO2 arrives as an HK fraction (0.97) and is normalized to %.
    const spo2 = parsed.observations.filter((row) => row.concept === "spo2_mean");
    for (const row of spo2) {
      expect(row.value).toBeGreaterThan(85);
      expect(row.value).toBeLessThanOrEqual(100);
    }

    expect(parsed.recordCounts.HKCategoryTypeIdentifierSleepAnalysis).toBe(70);
  });

  it("stream-parses chunk-by-chunk to the identical result", async () => {
    const xml = await fixture("apple-health-export.xml");
    async function* chunks() {
      for (let i = 0; i < xml.length; i += 512) yield xml.slice(i, i + 512);
    }
    const whole = await parseAppleHealthXml(xml);
    const streamed = await parseAppleHealthXml(chunks());
    expect(streamed).toEqual(whole);
  });

  it("assigns pre-midnight segments to the morning-after night", () => {
    expect(nightOf(new Date("2026-06-29T23:50:00Z"))).toBe("2026-06-30");
    expect(nightOf(new Date("2026-06-30T06:12:00Z"))).toBe("2026-06-30");
    expect(parseAppleDate("2026-06-29 22:41:12 -0500")?.toISOString()).toBe(
      "2026-06-30T03:41:12.000Z"
    );
  });

  it("rejects files that are not an Apple Health export", async () => {
    await expect(parseAppleHealthXml("Date,Usage Hours\n2026-06-01,7.2")).rejects.toThrow(
      ImportParseError
    );
    await expect(parseAppleHealthXml("<workouts></workouts>")).rejects.toThrow(/HealthData/);
  });
});

describe("AirView CSV parser", () => {
  it("parses the fixture's nightly compliance rows", async () => {
    const parsed = parseAirViewCsv(await fixture("airview-sample.csv"));

    expect(parsed.kind).toBe("airview");
    expect(parsed.source).toBe("airview");
    expect(parsed.nights).toBe(30);
    expect(parsed.firstDay).toBe("2026-05-31");
    expect(parsed.lastDay).toBe("2026-06-29");

    const usage = parsed.observations.filter((row) => row.concept === "cpap_usage_minutes");
    expect(usage).toHaveLength(30);

    // The two zero-usage nights carry only the usage row.
    const zeroNights = usage.filter((row) => row.value === 0).map((row) => row.day);
    expect(zeroNights).toHaveLength(2);
    for (const day of zeroNights) {
      expect(parsed.observations.filter((row) => row.day === day)).toHaveLength(1);
    }

    const concepts = new Set(parsed.observations.map((row) => row.concept));
    expect(concepts).toEqual(
      new Set(["cpap_usage_minutes", "residual_ahi", "mask_leak_p95", "pressure_p95"])
    );
  });

  it("accepts US dates and clock-style durations", () => {
    const parsed = parseAirViewCsv(
      "Date,Usage,AHI\n6/12/2026,6:30,2.1\n6/13/2026,0,\n"
    );
    expect(parsed.firstDay).toBe("2026-06-12");
    const usage = parsed.observations.find(
      (row) => row.day === "2026-06-12" && row.concept === "cpap_usage_minutes"
    );
    expect(usage?.value).toBe(390);
  });

  it("rejects wrong headers, junk values, and duplicate nights", () => {
    expect(() => parseAirViewCsv("Name,Score\nBob,3")).toThrow(/Date/);
    expect(() =>
      parseAirViewCsv("Date,Usage Hours,AHI\n2026-06-01,99,2")
    ).toThrow(/out of range/);
    expect(() =>
      parseAirViewCsv("Date,Usage Hours\n2026-06-01,7\n2026-06-01,6")
    ).toThrow(/duplicate/);
  });
});

describe("gated import ingest", () => {
  beforeEach(async () => {
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
    await setSimClock(SIM_TODAY);
  });

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

  it("writes an Apple Health import through the gate and it reads back gated", async () => {
    const id = await createParticipant();
    await grantConsent(id, "LANE_B", { grantedAt: SIM_TODAY }); // wearable_sleep: collect ✓

    const parsed = await parseAppleHealthXml(await fixture("apple-health-export.xml"));
    const result = await ingestParsedImport(id, parsed);

    expect(result.blocked).toBe(false);
    if (result.blocked) return;
    expect(result.observationsWritten).toBe(70);
    expect(result.sessionsWritten).toBe(14);
    expect(result.shiftedDays).toBe(0);

    // Immediately visible through the gated reader the trends page uses.
    const gated = await getObservations(id, {
      use: "view_identified",
      concepts: ["sleep_duration_min"],
    });
    expect(gated.blocked).toBe(false);
    expect(gated.data).toHaveLength(14);
    expect(gated.data[0].source).toBe("healthkit");
    expect(JSON.parse(gated.data[0].qualityFlags)).toContain("imported");
  });

  it("aligns to the sim clock when asked, flagging the shift", async () => {
    const id = await createParticipant();
    await grantConsent(id, "LANE_B", { grantedAt: SIM_TODAY });

    const parsed = await parseAppleHealthXml(await fixture("apple-health-export.xml"));
    const result = await ingestParsedImport(id, parsed, { alignToSimClock: true });

    expect(result.blocked).toBe(false);
    if (result.blocked) return;
    // fixture ends 2026-06-29; sim today is 2026-06-30 → +1 day
    expect(result.shiftedDays).toBe(1);
    expect(result.lastDayIso).toBe("2026-06-30");

    const latest = await prisma.observation.findFirst({
      where: { participantId: id },
      orderBy: { effectiveDate: "desc" },
    });
    expect(latest?.effectiveDate.toISOString().slice(0, 10)).toBe("2026-06-30");
    expect(JSON.parse(latest?.qualityFlags ?? "[]")).toContain("date_shifted");
  });

  it("blocks an AirView import without a cpap_telemetry collect grant — zero rows", async () => {
    const id = await createParticipant();
    await grantConsent(id, "LANE_B", { grantedAt: SIM_TODAY }); // Lane B has NO cpap scope

    const parsed = parseAirViewCsv(await fixture("airview-sample.csv"));
    const result = await ingestParsedImport(id, parsed);

    expect(result.blocked).toBe(true);
    if (!result.blocked) return;
    expect(result.reason).toMatch(/cpap_telemetry/);
    expect(await prisma.observation.count({ where: { participantId: id } })).toBe(0);
  });

  it("blocks after revocation — the gate re-evaluates current consent", async () => {
    const id = await createParticipant();
    await grantConsent(id, "LANE_A", { grantedAt: SIM_TODAY });

    const parsed = parseAirViewCsv(await fixture("airview-sample.csv"));
    const first = await ingestParsedImport(id, parsed);
    expect(first.blocked).toBe(false);

    await revokeConsent(id, "LANE_A");
    const second = await ingestParsedImport(id, parsed);
    expect(second.blocked).toBe(true);
    // Only the first import's rows exist.
    expect(
      await prisma.observation.count({
        where: { participantId: id, concept: "cpap_usage_minutes" },
      })
    ).toBe(30);
  });
});

describe("DentiTrac wear-time parser (pilot preview — no ingest path)", () => {
  it("parses the bundled fixture to nights + mean wear hours", async () => {
    const parsed = parseDentiTracCsv(await fixture("dentitrac-sample.csv"));

    expect(parsed.kind).toBe("dentitrac");
    expect(parsed.nights).toBe(28);
    expect(parsed.wornNights).toBe(26); // two 0:00 nights
    expect(parsed.firstDay).toBe("2026-06-01");
    expect(parsed.lastDay).toBe("2026-06-28");
    expect(parsed.deviceSerial).toBe("BRB-2214077");
    // 10,647 wear minutes over 28 nights (zeros included) / 26 worn nights.
    expect(parsed.meanWearHoursAllNights).toBe(6.3);
    expect(parsed.meanWearHoursWornNights).toBe(6.8);

    const june8 = parsed.rows.find((row) => row.day === "2026-06-08");
    expect(june8).toMatchObject({ wearMinutes: 0, verified: false });
    const june1 = parsed.rows.find((row) => row.day === "2026-06-01");
    expect(june1).toMatchObject({ wearMinutes: 444, verified: true }); // 7:24
  });

  it("reads h:mm and decimal-hour wear values, ISO and US dates", () => {
    const parsed = parseDentiTracCsv(
      ["Date,Wear Time", "2026-06-01,7:30", "06/02/2026,6.5"].join("\n")
    );
    expect(parsed.nights).toBe(2);
    expect(parsed.rows.map((row) => row.wearMinutes)).toEqual([450, 390]);
    expect(parsed.rows.every((row) => row.verified === null)).toBe(true);
  });

  it("rejects duplicates, out-of-range wear, and non-DentiTrac files", () => {
    expect(() =>
      parseDentiTracCsv(["Date,Wear Time", "2026-06-01,7:00", "2026-06-01,6:00"].join("\n"))
    ).toThrow(/duplicate night/);
    expect(() =>
      parseDentiTracCsv(["Date,Wear Time", "2026-06-01,26:00"].join("\n"))
    ).toThrow(/out of range/);
    expect(() => parseDentiTracCsv("Nights,Usage\n1,2")).toThrow(/Date.*Wear Time/);
  });
});
