import { beforeEach, describe, expect, it } from "vitest";
import { revokeDataClass } from "../compliance/revocation";
import {
  getAllGrantedDevices,
  grantConsent,
  grantSetHas,
  revokeConsent,
  type DataClass,
} from "../consent";
import { prisma } from "../db";
import { dateShiftDays, pseudonym, shiftDate } from "../deid";
import { toIsoDay } from "../format";
import { registerIdentity } from "../identity";
import { setSimClock } from "../simclock";
import { addDays } from "../synthetic/profiles";
import { loadResearchCohort } from "./cohort";
import {
  buildDeviceExposureCsv,
  buildMeasurementCsv,
  buildObservationPeriodCsv,
  buildPersonCsv,
  DEVICE_EXPOSURE_HEADER,
  MEASUREMENT_HEADER,
  OMOP_MEASUREMENT_CONCEPTS,
  OMOP_REGISTRY_TYPE_CONCEPT,
  omopBundleReadme,
  PERSON_HEADER,
} from "./omopExport";
import { crc32, zipBytes } from "./zip";

/**
 * OMOP bundle tests (TECHNICAL.md §T2.5 mapping): the four tables built from
 * a fixture cohort — mapping correctness, per-row consent scoping (revoked
 * participants absent; a partially revoked class absent), a leakage scan
 * (no names / emails / UUIDs / raw dates in any CSV), and the
 * zero-dependency ZIP writer round-tripped byte-for-byte.
 */

// Fixed fixture ids: deterministic deid shifts (SUBJECT: −23 days). The raw
// fixture dates below are chosen so that NO raw date, once shifted, collides
// with another raw date — which lets the leakage scan assert raw-date
// absence globally.
const SUBJECT = "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa";
const REVOKED = "bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb";

const ENROLLED = new Date(Date.UTC(2026, 3, 1)); // 2026-04-01
const SIM_TODAY = new Date(Date.UTC(2026, 5, 30)); // 2026-06-30

/** Day offsets (from enrollment) of every dated fixture row. */
const HST_OFFSET = 7;
const EPISODE_ANCHOR_OFFSET = 14;
const NIGHT_OFFSETS = [40, 41, 42];
const DEVICE_OFFSETS = { wearable: 0, sleep_mat: 2, cpap: 14, appliance: 14 } as const;

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

async function seedOmopParticipant(id: string, name: string, email: string): Promise<void> {
  await prisma.participant.create({
    data: {
      id,
      yearOfBirth: 1974,
      sex: "male",
      enrollmentTouchpoint: "retail",
      createdAt: ENROLLED,
    },
  });
  await registerIdentity(id, name, email);
  await grantConsent(id, "LANE_B", { grantedAt: ENROLLED });
  await grantConsent(id, "LANE_A", { grantedAt: addDays(ENROLLED, HST_OFFSET) });
  await grantConsent(id, "LANE_C", { grantedAt: addDays(ENROLLED, HST_OFFSET) });

  await prisma.episode.createMany({
    data: [
      {
        participantId: id,
        protocolPhase: "baseline",
        startDate: ENROLLED,
        endDate: addDays(ENROLLED, EPISODE_ANCHOR_OFFSET),
        dataClass: "hst_clinical", // consent lineage (audit F-09)
      },
      {
        participantId: id,
        protocolPhase: "intervention",
        startDate: addDays(ENROLLED, EPISODE_ANCHOR_OFFSET),
        endDate: null,
        dataClass: "hst_clinical",
      },
    ],
  });

  await prisma.device.createMany({
    data: [
      { participantId: id, deviceClass: "wearable", make: "Apple", model: "Watch S10", assignedAt: addDays(ENROLLED, DEVICE_OFFSETS.wearable) },
      { participantId: id, deviceClass: "sleep_mat", make: "Withings", model: "Sleep Analyzer", assignedAt: addDays(ENROLLED, DEVICE_OFFSETS.sleep_mat) },
      { participantId: id, deviceClass: "cpap", make: "ResMed", model: "AirSense 11", assignedAt: addDays(ENROLLED, DEVICE_OFFSETS.cpap) },
      { participantId: id, deviceClass: "appliance", make: "SomnoMed", model: "SomnoDent Avant", assignedAt: addDays(ENROLLED, DEVICE_OFFSETS.appliance) },
    ],
  });

  const hstDate = addDays(ENROLLED, HST_OFFSET);
  await prisma.observation.createMany({
    data: [
      { concept: "ahi", valueNumeric: 24, unit: "events/h" },
      { concept: "supine_ahi", valueNumeric: 41, unit: "events/h" },
      { concept: "nonsupine_ahi", valueNumeric: 9.8, unit: "events/h" },
    ].map((row) => ({
      participantId: id,
      source: "hst",
      effectiveDate: hstDate,
      grain: "session",
      qualityFlags: "[]",
      ...row,
    })),
  });

  await prisma.observation.createMany({
    data: NIGHT_OFFSETS.flatMap((offset) => [
      { source: "airview", concept: "cpap_usage_minutes", valueNumeric: 380, unit: "min" },
      { source: "healthkit", concept: "sleep_duration_min", valueNumeric: 420, unit: "min" },
      { source: "sleep_mat", concept: "supine_time_pct", valueNumeric: 50, unit: "%" },
    ].map((row) => ({
      participantId: id,
      effectiveDate: addDays(ENROLLED, offset),
      grain: "day",
      qualityFlags: "[]",
      ...row,
    }))),
  });

  // Contextual concept: maps to OBSERVATION per T2.5, must NOT be exported.
  await prisma.observation.create({
    data: {
      participantId: id,
      source: "airview",
      concept: "therapy_gap",
      valueNumeric: 1,
      effectiveDate: addDays(ENROLLED, NIGHT_OFFSETS[2]),
      grain: "day",
      qualityFlags: "[]",
    },
  });
}

/** Builds all four CSVs exactly the way the route does. */
async function buildBundle() {
  const cohort = await loadResearchCohort();
  const memberIds = new Set(cohort.members.map((member) => member.id));
  const isExportable = (participantId: string, dataClass: DataClass) => {
    const member = cohort.byId.get(participantId);
    return member !== undefined && grantSetHas(member.grants, dataClass, "research_deid");
  };
  const [episodes, devices, observations] = await Promise.all([
    prisma.episode.findMany({
      select: {
        participantId: true,
        protocolPhase: true,
        startDate: true,
        endDate: true,
        dataClass: true,
      },
    }),
    getAllGrantedDevices({ use: "research_deid" }),
    prisma.observation.findMany({ orderBy: { id: "asc" } }),
  ]);
  return {
    cohort,
    person: buildPersonCsv(cohort.members),
    // Per-row class predicate, exactly like MEASUREMENT (audit F-09).
    period: buildObservationPeriodCsv(episodes, memberIds, cohort.clock, isExportable),
    measurement: buildMeasurementCsv(observations, isExportable),
    device: buildDeviceExposureCsv(devices, memberIds),
  };
}

beforeEach(async () => {
  await wipe();
  await setSimClock(SIM_TODAY);
  await seedOmopParticipant(SUBJECT, "Omop Kept", "omop.kept@example.com");
  await seedOmopParticipant(REVOKED, "Omop Gone", "omop.gone@example.com");
  for (const instrument of ["LANE_A", "LANE_B", "LANE_C"] as const) {
    await revokeConsent(REVOKED, instrument);
  }
});

describe("OMOP bundle mapping (T2.5)", () => {
  it("maps PERSON / OBSERVATION_PERIOD / MEASUREMENT / DEVICE_EXPOSURE from de-identified data; revoked participants absent", async () => {
    const { person, period, measurement, device } = await buildBundle();
    const subjectPseudonym = pseudonym(SUBJECT);
    const shift = dateShiftDays(SUBJECT);
    expect(shift).not.toBe(0);
    expect(Math.abs(shift)).toBeLessThanOrEqual(30);
    const shifted = (offset: number) => toIsoDay(shiftDate(SUBJECT, addDays(ENROLLED, offset)));

    // PERSON: exactly the consented member, standard gender concept, age band.
    const personLines = person.trimEnd().split("\n");
    expect(personLines[0]).toBe(PERSON_HEADER);
    expect(personLines).toHaveLength(2);
    expect(personLines[1]).toBe(`${subjectPseudonym},8507,male,50–54`);

    // OBSERVATION_PERIOD: both episodes, dates shifted, open episode closes
    // at the shifted clock, intervals preserved.
    const periodLines = period.trimEnd().split("\n");
    expect(periodLines).toHaveLength(3);
    const baseline = periodLines[1].split(",");
    const intervention = periodLines[2].split(",");
    expect(baseline).toEqual([
      "1",
      subjectPseudonym,
      shifted(0),
      shifted(EPISODE_ANCHOR_OFFSET),
      String(OMOP_REGISTRY_TYPE_CONCEPT),
      "baseline",
    ]);
    expect(intervention[2]).toBe(shifted(EPISODE_ANCHOR_OFFSET)); // interval preserved
    expect(intervention[3]).toBe(toIsoDay(shiftDate(SUBJECT, SIM_TODAY)));
    expect(intervention[5]).toBe("intervention");

    // MEASUREMENT: 3 HST + 3×3 nightly rows; therapy_gap (contextual) absent.
    const measurementLines = measurement.trimEnd().split("\n");
    expect(measurementLines[0]).toBe(MEASUREMENT_HEADER);
    expect(measurementLines).toHaveLength(1 + 12);
    expect(measurement).not.toContain("therapy_gap");
    expect(measurementLines.slice(1).map((line) => line.split(",")[0])).toEqual(
      Array.from({ length: 12 }, (_, i) => String(i + 1)) // sequential ids
    );
    const ahiLine = measurementLines.find((line) => line.includes(",ahi,"));
    expect(ahiLine).toBe(
      [
        ahiLine!.split(",")[0],
        subjectPseudonym,
        OMOP_MEASUREMENT_CONCEPTS.ahi,
        "ahi",
        shifted(HST_OFFSET),
        24,
        "events/h",
        OMOP_REGISTRY_TYPE_CONCEPT,
      ].join(",")
    );
    // Nightly intervals preserved: three consecutive shifted CPAP nights.
    const cpapDates = measurementLines
      .filter((line) => line.includes(",cpap_usage_minutes,"))
      .map((line) => line.split(",")[4])
      .sort();
    expect(cpapDates).toEqual(NIGHT_OFFSETS.map(shifted));

    // DEVICE_EXPOSURE: all four device classes, shifted assignment dates,
    // open-ended exposures blank.
    const deviceLines = device.trimEnd().split("\n");
    expect(deviceLines[0]).toBe(DEVICE_EXPOSURE_HEADER);
    expect(deviceLines).toHaveLength(1 + 4);
    const cpapDevice = deviceLines.find((line) => line.includes("cpap: ResMed AirSense 11"));
    expect(cpapDevice).toBeDefined();
    const cpapFields = cpapDevice!.split(",");
    expect(cpapFields[1]).toBe(subjectPseudonym);
    expect(cpapFields[4]).toBe(shifted(DEVICE_OFFSETS.cpap));
    expect(cpapFields[5]).toBe(""); // returnedAt null → open exposure

    // The revoked participant is absent from EVERY table.
    const all = person + period + measurement + device;
    expect(all).not.toContain(pseudonym(REVOKED));
  });

  it("revoking the episode's class removes its OBSERVATION_PERIOD rows while other tables keep flowing (audit F-09)", async () => {
    // Keep unrelated research grants (cohort membership survives), revoke
    // only hst_clinical — the class the fixture episodes belong to.
    await revokeDataClass(SUBJECT, "hst_clinical");
    const { person, period, measurement } = await buildBundle();
    const periodLines = period.trimEnd().split("\n");
    expect(periodLines).toHaveLength(1); // header only — the audit's exact repro
    expect(period).not.toContain(pseudonym(SUBJECT));
    // Still a member: PERSON row and non-clinical measurements remain.
    expect(person).toContain(pseudonym(SUBJECT));
    expect(measurement).toContain("cpap_usage_minutes");
    expect(measurement).not.toContain(",ahi,"); // hst measurements sealed too
  });

  it("an episode with no/unknown lineage is quarantined from OBSERVATION_PERIOD (fail closed)", async () => {
    await prisma.episode.create({
      data: {
        participantId: SUBJECT,
        protocolPhase: "followup",
        startDate: addDays(ENROLLED, 60),
        endDate: null,
        dataClass: null, // unclassified
      },
    });
    await prisma.episode.create({
      data: {
        participantId: SUBJECT,
        protocolPhase: "followup",
        startDate: addDays(ENROLLED, 61),
        endDate: null,
        dataClass: "not_a_real_class",
      },
    });
    const { period } = await buildBundle();
    expect(period).not.toContain("followup");
    expect(period.trimEnd().split("\n")).toHaveLength(3); // header + 2 classified episodes
  });

  it("gates PERSON demographics on registry_demographics: a linkage-only member exports no sex/age (audit F-11)", async () => {
    // Reduce the subject to a linkage-only research grant: revoke A and B
    // entirely; Lane C (linkage) remains → still a cohort member.
    await revokeConsent(SUBJECT, "LANE_A");
    await revokeConsent(SUBJECT, "LANE_B");
    const { cohort, person, period, measurement, device } = await buildBundle();
    expect(cohort.byId.has(SUBJECT)).toBe(true); // member via linkage grant
    const line = person
      .trimEnd()
      .split("\n")
      .find((row) => row.startsWith(pseudonym(SUBJECT)));
    expect(line).toBe(`${pseudonym(SUBJECT)},0,,`); // anchor row, NO demographics
    expect(person).not.toContain("male");
    // And no data rows anywhere else either (no data-class grants remain).
    expect(period).not.toContain(pseudonym(SUBJECT));
    expect(measurement).not.toContain(pseudonym(SUBJECT));
    expect(device).not.toContain(pseudonym(SUBJECT));
  });

  it("quarantines unknown observation sources from MEASUREMENT (audit F-10 repro: 'airveiw')", async () => {
    await prisma.observation.create({
      data: {
        participantId: SUBJECT,
        source: "airveiw", // misspelled connector
        concept: "residual_ahi",
        valueNumeric: 9.9,
        unit: "events/h",
        effectiveDate: addDays(ENROLLED, 44),
        grain: "day",
        qualityFlags: "[]",
      },
    });
    // Even revoking CPAP leaves wearable granted — the typo'd source must
    // not fail open into the wearable class.
    await revokeDataClass(SUBJECT, "cpap_telemetry");
    const { measurement } = await buildBundle();
    expect(measurement).not.toContain("9.9");
    expect(measurement).not.toContain("residual_ahi");
  });

  it("partial revocation drops exactly that class from MEASUREMENT", async () => {
    await revokeDataClass(SUBJECT, "wearable_sleep");
    const { measurement, device } = await buildBundle();
    expect(measurement).not.toContain("sleep_duration_min"); // wearable gone
    expect(measurement).toContain("cpap_usage_minutes"); // CPAP still flows
    expect(measurement).toContain("supine_time_pct"); // sleep mat still flows
    expect(measurement).toContain(",ahi,"); // clinical still flows
    expect(device).not.toContain("wearable:"); // wearable device sealed too
    expect(device).toContain("cpap:");
  });
});

describe("OMOP bundle leakage scan", () => {
  it("no names, emails, internal UUIDs, or raw dates in any CSV", async () => {
    const { person, period, measurement, device } = await buildBundle();
    const csvs = person + period + measurement + device;

    // Identity: display names and emails never leave.
    expect(csvs).not.toMatch(/omop/i);
    expect(csvs).not.toContain("@");
    // Internal ids: no UUID anywhere (person_id is the research pseudonym).
    expect(csvs).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    );

    // Raw dates: every dated fixture row's REAL date must be absent — the
    // constant per-participant shift (here −23 days, never 0) moves them
    // all, and the fixture offsets are chosen so no shifted date collides
    // with a different raw date.
    const rawOffsets = [
      0,
      DEVICE_OFFSETS.sleep_mat,
      HST_OFFSET,
      EPISODE_ANCHOR_OFFSET,
      ...NIGHT_OFFSETS,
    ];
    for (const offset of rawOffsets) {
      expect(csvs, `raw date at enrollment+${offset}d leaked`).not.toContain(
        toIsoDay(addDays(ENROLLED, offset))
      );
    }
    expect(csvs).not.toContain(toIsoDay(SIM_TODAY)); // raw clock date shifted too

    // The readme (which may name the as-of clock) still carries no identity.
    const readme = omopBundleReadme(toIsoDay(SIM_TODAY));
    expect(readme).not.toMatch(/@[a-z]/i);
    expect(readme).toContain("DUA");
  });
});

describe("stored-zip writer", () => {
  /** Minimal reader for the writer's own output: EOCD → central dir → entries. */
  function parseStoredZip(bytes: Uint8Array) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocdAt = bytes.length - 22;
    expect(view.getUint32(eocdAt, true)).toBe(0x06054b50);
    const count = view.getUint16(eocdAt + 10, true);
    let at = view.getUint32(eocdAt + 16, true); // central directory offset
    const entries: { name: string; crc: number; size: number; content: Uint8Array }[] = [];
    for (let i = 0; i < count; i++) {
      expect(view.getUint32(at, true)).toBe(0x02014b50);
      const crc = view.getUint32(at + 16, true);
      const size = view.getUint32(at + 24, true);
      const nameLen = view.getUint16(at + 28, true);
      const localOffset = view.getUint32(at + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
      // Local header: skip 30 bytes + name, then `size` stored bytes.
      expect(view.getUint32(localOffset, true)).toBe(0x04034b50);
      const dataAt = localOffset + 30 + nameLen;
      entries.push({ name, crc, size, content: bytes.subarray(dataAt, dataAt + size) });
      at += 46 + nameLen;
    }
    return entries;
  }

  it("round-trips string and streamed entries with correct CRCs and sizes", async () => {
    const { person, measurement } = await buildBundle();
    async function* chunked(): AsyncIterable<string> {
      for (let i = 0; i < measurement.length; i += 97) yield measurement.slice(i, i + 97);
    }
    const bytes = await zipBytes(
      [
        { name: "PERSON.csv", data: person },
        { name: "MEASUREMENT.csv", data: () => chunked() }, // streaming rail
      ],
      { modified: SIM_TODAY }
    );

    const entries = parseStoredZip(bytes);
    expect(entries.map((entry) => entry.name)).toEqual(["PERSON.csv", "MEASUREMENT.csv"]);
    const decoder = new TextDecoder();
    expect(decoder.decode(entries[0].content)).toBe(person);
    expect(decoder.decode(entries[1].content)).toBe(measurement);
    for (const entry of entries) {
      expect(entry.size).toBe(entry.content.length);
      expect(entry.crc).toBe(crc32(entry.content));
    }
  });
});
