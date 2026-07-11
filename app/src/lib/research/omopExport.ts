import type { Device } from "@prisma/client";
import { grantSetHas, sourceToDataClass, storedDataClass, type DataClass } from "../consent";
import { ageBandFromYearOfBirth, pseudonym, shiftDate } from "../deid";
import { toIsoDay } from "../format";
import type { ExportEpisodeRow, ResearchMember } from "./cohort";
import { csvField } from "./deidExport";

/**
 * OMOP CDM bundle builders (TECHNICAL.md §T2.5, demo cut) — reserve →
 * working. Maps the de-identified research tier into four OMOP tables:
 *
 *   participant → PERSON, episode → OBSERVATION_PERIOD,
 *   numeric observations → MEASUREMENT, devices → DEVICE_EXPOSURE.
 *
 * Rules of engagement (same as the row-level extract):
 * - DE-IDENTIFIED DATA ONLY: every person_id is the deterministic research
 *   pseudonym, every date carries the participant's constant deid shift
 *   (intervals preserved), ages are 5-year bands. No names, no emails, no
 *   internal UUIDs, no raw dates leave this module.
 * - CONSENT-SCOPED: only research-cohort members appear (a revoked
 *   participant is simply absent), and each measurement/device row requires
 *   a current research_deid grant on its data class.
 * - VOCABULARY: gender uses the standard OMOP concepts (8507/8532); every
 *   concept with no standard code (mattress/position/therapy metrics, T2.5)
 *   uses the documented custom 2-billion range below, with the canonical
 *   concept name in the *_source_value column. therapy_gap is contextual
 *   (→ OBSERVATION per T2.5), so it is not exported in MEASUREMENT.
 *
 * Everything here is pure — the route streams MEASUREMENT through
 * measurementCsvRows page by page; tests run the same builders.
 */

export const OMOP_VOCAB_VERSION = "sleeptopia-omop-demo-v1";

/** Standard OMOP gender concepts. */
export const OMOP_GENDER_CONCEPTS: Record<string, number> = {
  male: 8507,
  female: 8532,
};

/**
 * Custom (2-billion range, OMOP local-concept convention) measurement
 * concepts for the canonical Observation vocabulary (T2.3). Versioned with
 * OMOP_VOCAB_VERSION; published with the methods paper in production.
 */
export const OMOP_MEASUREMENT_CONCEPTS: Record<string, number> = {
  ahi: 2000000001,
  supine_ahi: 2000000002,
  nonsupine_ahi: 2000000003,
  odi: 2000000004,
  spo2_mean: 2000000005,
  spo2_nadir: 2000000006,
  supine_time_pct: 2000000007,
  cpap_usage_minutes: 2000000008,
  residual_ahi: 2000000009,
  mask_leak_p95: 2000000010,
  pressure_p95: 2000000011,
  sleep_efficiency: 2000000012,
  sleep_duration_min: 2000000013,
  resting_hr: 2000000014,
  hrv_sdnn: 2000000015,
  snore_minutes: 2000000016,
};

/** Custom device concepts per device class (T2.2 device table). */
export const OMOP_DEVICE_CONCEPTS: Record<string, number> = {
  wearable: 2000000101,
  cpap: 2000000102,
  sleep_mat: 2000000103,
  appliance: 2000000104,
};

/** Custom type concept: "registry pipeline" provenance for every row. */
export const OMOP_REGISTRY_TYPE_CONCEPT = 2000000201;

export const PERSON_HEADER = [
  "person_id",
  "gender_concept_id",
  "gender_source_value",
  "age_band",
].join(",");

export const OBSERVATION_PERIOD_HEADER = [
  "observation_period_id",
  "person_id",
  "observation_period_start_date",
  "observation_period_end_date",
  "period_type_concept_id",
  "period_source_value",
].join(",");

export const MEASUREMENT_HEADER = [
  "measurement_id",
  "person_id",
  "measurement_concept_id",
  "measurement_source_value",
  "measurement_date",
  "value_as_number",
  "unit_source_value",
  "measurement_type_concept_id",
].join(",");

export const DEVICE_EXPOSURE_HEADER = [
  "device_exposure_id",
  "person_id",
  "device_concept_id",
  "device_source_value",
  "device_exposure_start_date",
  "device_exposure_end_date",
  "device_type_concept_id",
].join(",");

const byPseudonym = (a: string, b: string) => pseudonym(a).localeCompare(pseudonym(b));

/**
 * PERSON: one row per research-cohort member (pseudonym anchor). Gender and
 * age band are registry_demographics-class fields (audit F-11): a member
 * without a current research_deid grant on that class exports an anchor row
 * with NO demographics (gender concept 0, empty source value / age band) —
 * a linkage-only grant no longer carries demographics into the mart.
 */
export function buildPersonCsv(members: ResearchMember[]): string {
  const rows = [...members]
    .sort((a, b) => byPseudonym(a.id, b.id))
    .map((member) => {
      const demographics =
        grantSetHas(member.grants, "registry_demographics", "research_deid") &&
        member.sex !== null &&
        member.yearOfBirth !== null &&
        member.enrollmentDate !== null;
      return (
        demographics
          ? [
              pseudonym(member.id),
              OMOP_GENDER_CONCEPTS[member.sex as string] ?? 0,
              member.sex,
              ageBandFromYearOfBirth(member.yearOfBirth as number, member.enrollmentDate as Date),
            ]
          : [pseudonym(member.id), 0, "", ""]
      )
        .map(csvField)
        .join(",");
    });
  return [PERSON_HEADER, ...rows].join("\n") + "\n";
}

/**
 * OBSERVATION_PERIOD: one row per episode of a research-cohort member,
 * date-shifted. Open-ended episodes close at the (shifted) sim clock.
 *
 * Per-row consent (audit F-09): every episode carries its lineage data
 * class, and the row is emitted only when `isExportable` confirms a current
 * research_deid grant on that class — exactly like MEASUREMENT. An episode
 * with no/unknown lineage is never exported (fail closed).
 */
export function buildObservationPeriodCsv(
  episodes: ExportEpisodeRow[],
  memberIds: ReadonlySet<string>,
  clock: Date,
  isExportable: (participantId: string, dataClass: DataClass) => boolean
): string {
  const rows = episodes
    .filter((episode) => {
      if (!memberIds.has(episode.participantId)) return false;
      const dataClass = storedDataClass(episode.dataClass);
      if (dataClass === null) return false; // unclassified: quarantined
      return isExportable(episode.participantId, dataClass);
    })
    .sort(
      (a, b) =>
        byPseudonym(a.participantId, b.participantId) ||
        a.startDate.getTime() - b.startDate.getTime()
    )
    .map((episode, index) =>
      [
        index + 1,
        pseudonym(episode.participantId),
        toIsoDay(shiftDate(episode.participantId, episode.startDate)),
        toIsoDay(shiftDate(episode.participantId, episode.endDate ?? clock)),
        OMOP_REGISTRY_TYPE_CONCEPT,
        episode.protocolPhase,
      ]
        .map(csvField)
        .join(",")
    );
  return [OBSERVATION_PERIOD_HEADER, ...rows].join("\n") + "\n";
}

export interface MeasurementSourceRow {
  participantId: string;
  source: string;
  concept: string;
  valueNumeric: number | null;
  unit: string | null;
  effectiveDate: Date;
}

/**
 * MEASUREMENT rows (no header) for one page of observations. Consent applies
 * per row: the observation's source maps to its data class, and the row is
 * exported only when `isExportable` confirms a current research_deid grant.
 * Returns the next measurement_id so the route can stream page after page.
 */
export function measurementCsvRows(
  observations: MeasurementSourceRow[],
  isExportable: (participantId: string, dataClass: DataClass) => boolean,
  startId: number
): { lines: string[]; nextId: number } {
  const lines: string[] = [];
  let id = startId;
  for (const obs of observations) {
    if (obs.valueNumeric === null) continue;
    const conceptId = OMOP_MEASUREMENT_CONCEPTS[obs.concept];
    if (conceptId === undefined) continue; // contextual / unmapped concepts stay home
    const dataClass = sourceToDataClass(obs.source);
    if (dataClass === null) continue; // unknown source: quarantined (F-10)
    if (!isExportable(obs.participantId, dataClass)) continue;
    lines.push(
      [
        id,
        pseudonym(obs.participantId),
        conceptId,
        obs.concept,
        toIsoDay(shiftDate(obs.participantId, obs.effectiveDate)),
        obs.valueNumeric,
        obs.unit ?? "",
        OMOP_REGISTRY_TYPE_CONCEPT,
      ]
        .map(csvField)
        .join(",")
    );
    id += 1;
  }
  return { lines, nextId: id };
}

/** Convenience for tests / small cohorts: the whole MEASUREMENT CSV at once. */
export function buildMeasurementCsv(
  observations: MeasurementSourceRow[],
  isExportable: (participantId: string, dataClass: DataClass) => boolean
): string {
  const { lines } = measurementCsvRows(observations, isExportable, 1);
  return [MEASUREMENT_HEADER, ...lines].join("\n") + "\n";
}

type DeviceRow = Pick<
  Device,
  "participantId" | "deviceClass" | "make" | "model" | "assignedAt" | "returnedAt"
>;

/**
 * DEVICE_EXPOSURE: one row per consent-granted device row (callers pass the
 * output of getAllGrantedDevices({ use: "research_deid" }), so the consent
 * filtering is the reader's, not re-implemented here) for cohort members.
 */
export function buildDeviceExposureCsv(
  devices: DeviceRow[],
  memberIds: ReadonlySet<string>
): string {
  const rows = devices
    .filter((device) => memberIds.has(device.participantId))
    .sort(
      (a, b) =>
        byPseudonym(a.participantId, b.participantId) ||
        a.deviceClass.localeCompare(b.deviceClass) ||
        a.assignedAt.getTime() - b.assignedAt.getTime()
    )
    .map((device, index) =>
      [
        index + 1,
        pseudonym(device.participantId),
        OMOP_DEVICE_CONCEPTS[device.deviceClass] ?? 0,
        `${device.deviceClass}: ${device.make} ${device.model}`,
        toIsoDay(shiftDate(device.participantId, device.assignedAt)),
        device.returnedAt ? toIsoDay(shiftDate(device.participantId, device.returnedAt)) : "",
        OMOP_REGISTRY_TYPE_CONCEPT,
      ]
        .map(csvField)
        .join(",")
    );
  return [DEVICE_EXPOSURE_HEADER, ...rows].join("\n") + "\n";
}

/** README.txt shipped inside the bundle — labels the release and its rules. */
export function omopBundleReadme(clockIso: string): string {
  return [
    `Sleeptopia registry — OMOP CDM research bundle (demo), as of ${clockIso}`,
    "",
    "DE-IDENTIFIED ROW-LEVEL DATA — released only under a signed Data Use",
    "Agreement (DUA). Re-identification of, or contact with, any individual is",
    "prohibited (SPEC §12.3). Synthetic demonstration cohort — no real patient data.",
    "",
    "Tables (TECHNICAL.md §T2.5 mapping, demo cut):",
    "  PERSON.csv              participant → PERSON (pseudonym ids, 5-year age bands)",
    "  OBSERVATION_PERIOD.csv  episode → OBSERVATION_PERIOD (date-shifted)",
    "  MEASUREMENT.csv         numeric observations → MEASUREMENT (date-shifted)",
    "  DEVICE_EXPOSURE.csv     devices → DEVICE_EXPOSURE (date-shifted)",
    "",
    "De-identification: person_id is a deterministic research pseudonym; every",
    "date carries that participant's constant ±30-day shift (intervals are",
    "preserved exactly); ages are 5-year bands. Consent: only research-consented",
    "participants appear, and every row in every table — including",
    "OBSERVATION_PERIOD — requires a current research_deid grant on its own",
    "data class; PERSON demographics require the registry_demographics grant.",
    "A revoked participant is absent from every table; rows whose data class",
    "cannot be established are quarantined and never exported.",
    "",
    `Vocabulary: ${OMOP_VOCAB_VERSION}. Gender uses standard OMOP concepts`,
    "(8507/8532). Concepts with no standard code (position, therapy and mattress",
    "metrics) use the documented custom 2-billion concept range with the",
    "canonical concept name in the *_source_value column; contextual concepts",
    "(e.g. therapy_gap) map to OBSERVATION and are not part of this bundle.",
    "Production adds full LOINC/SNOMED alignment and the versioned vocabulary",
    "publication (TECHNICAL.md §T2.5).",
    "",
  ].join("\n");
}
