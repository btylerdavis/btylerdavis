import { MATTRESS_CATALOG, MARCUS_SKU, isMediumFirmHybrid, type CatalogEntry } from "./catalog";
import { Rng } from "./prng";

/**
 * Deterministic participant profiles.
 *
 * A profile is a pure function of the participant id (buildProfile), so any
 * consumer that has only DB rows — the time machine advancing nights, a
 * future ingestion simulator — re-derives the exact latent profile the seed
 * used. Participant ids themselves derive from the cohort seed, so the whole
 * cohort is reproducible run-to-run.
 */

export const COHORT_SEED = "sleep-registry-demo-v1";
export const COHORT_SIZE = 2000;

/** Marcus Reed's enrollment day — the demo timeline's epoch (UTC midnight). */
export const DEMO_EPOCH = new Date(Date.UTC(2026, 3, 1)); // 2026-04-01

/** Seed sets SimClock to 90 days after Marcus's enrollment. */
export const INITIAL_CLOCK_OFFSET_DAYS = 90;

/** Fully-scripted persona for the demo script. */
export const MARCUS_REED_PARTICIPANT_ID = "d81a5f64-9c3e-4b7a-8f21-6e0a4c9b5d17";

/**
 * Effect-size scenario switcher (DEMO.md §3 — "what if mattresses do
 * nothing?", the selection-bias conversation). `SCENARIO=null npm run seed`
 * re-derives the SAME cohort — identical ids, demographics, arms, adherence,
 * consent history, and RNG draw sequence — with the mattress supine effect
 * ≈ 0: flagship (supine-predominant × medium-firm-hybrid) buyers get their
 * effect draw remapped from the 8–15-point band into the 0–3-point noise
 * band every other purchase already gets, so the medium firmness band reads
 * FLAT on the positional dashboard. Deterministic per scenario. Downstream,
 * a supine drop ≤ 6 also stops driving ESS/ISI improvements for
 * mattress-only responders (same rule as the default cohort).
 *
 * The scenario is read from the environment at profile-build time, so the
 * time machine stays consistent with the seed as long as the server runs
 * with the same SCENARIO value.
 */
export type SeedScenario = "default" | "null";

export function seedScenario(
  env: string | undefined = process.env.SCENARIO
): SeedScenario {
  if (env === undefined || env === "" || env === "default") return "default";
  if (env === "null") return "null";
  throw new Error(`Unknown SCENARIO "${env}" — use "default" or "null"`);
}

export type TreatmentArm =
  | "cpap"
  | "appliance"
  | "mattress_only"
  | "cpap_mattress"
  | "appliance_mattress";

export type OsaSeverity = "mild" | "moderate" | "severe";

export interface WearableSpec {
  make: string;
  model: string;
  source: string; // "healthkit" | "aggregator:<provider>"
}

export interface ParticipantProfile {
  id: string;
  displayName: string;
  email: string;
  yearOfBirth: number;
  sex: "male" | "female";
  enrollmentTouchpoint: "clinic" | "retail";
  /** enrollment date, UTC midnight */
  enrollmentDate: Date;
  /** days after enrollment the HST study happens (and LANE_A for retail) */
  hstOffsetDays: number;
  laneC: boolean;

  // OSA phenotype
  severity: OsaSeverity;
  ahi: number;
  supineAhi: number;
  nonsupineAhi: number;
  supinePredominant: boolean;
  odi: number;
  spo2MeanBaseline: number;
  spo2Nadir: number;
  /** baseline % of sleep time supine */
  baselineSupinePct: number;

  // Treatment
  arm: TreatmentArm;
  hasCpap: boolean;
  hasAppliance: boolean;
  hasMattress: boolean;
  /** days after enrollment for cpap_setup / appliance_delivery */
  treatmentStartOffsetDays: number;
  mattressPurchaseOffsetDays: number;
  mattressDeliveryOffsetDays: number;
  mattressSku: string | null;
  /** true when the purchased SKU is a medium-firm hybrid (flagship-effect combo) */
  mattressIsMediumFirmHybrid: boolean;
  /** flagship signal: points of supine-time drop post-delivery (0 when n/a) */
  supineDropPoints: number;

  // CPAP adherence
  cpapAdherent: boolean;
  cpapMeanUsageMin: number;
  cpapSkipNightP: number;
  /** non-adherent only: nights from setup until abandonment (therapy_gap after) */
  cpapAbandonAfterDays: number;
  applianceAdherent: boolean;

  // Wearables & instrumentation
  wearable: WearableSpec;
  hasSleepMat: boolean;
  /** deterministic device row ids (referenced by nightly observations) */
  wearableDeviceId: string;
  cpapDeviceId: string;
  sleepMatDeviceId: string;
  applianceDeviceId: string;
  cpapMake: string;
  cpapModel: string;
  applianceMake: string;
  applianceModel: string;

  // Nightly physiology baselines
  restingHrBase: number;
  hrvSdnnBase: number;
  sleepEfficiencyBase: number;
  sleepDurationBase: number;

  // PRO baselines & responses
  essBaseline: number;
  isiBaseline: number;
  /** total ESS improvement reached by day 90 */
  essImprovement: number;
  isiImprovement: number;
  stopBangScore: number;
}

const WEARABLES: readonly (readonly [WearableSpec[], number])[] = [
  [
    [
      { make: "Apple", model: "Apple Watch Series 9", source: "healthkit" },
      { make: "Apple", model: "Apple Watch Series 10", source: "healthkit" },
      { make: "Apple", model: "Apple Watch Ultra 2", source: "healthkit" },
    ],
    40,
  ],
  [
    [
      { make: "Garmin", model: "Venu 3", source: "aggregator:garmin" },
      { make: "Garmin", model: "Forerunner 265", source: "aggregator:garmin" },
      { make: "Garmin", model: "Fenix 7", source: "aggregator:garmin" },
    ],
    20,
  ],
  [
    [
      { make: "Fitbit", model: "Charge 6", source: "aggregator:fitbit" },
      { make: "Fitbit", model: "Sense 2", source: "aggregator:fitbit" },
    ],
    20,
  ],
  [
    [
      { make: "Samsung", model: "Galaxy Watch 6", source: "aggregator:samsung" },
      { make: "Samsung", model: "Galaxy Watch 7", source: "aggregator:samsung" },
    ],
    10,
  ],
  [
    [
      { make: "Oura", model: "Oura Ring Gen3", source: "aggregator:oura" },
      { make: "Oura", model: "Oura Ring 4", source: "aggregator:oura" },
    ],
    10,
  ],
];

const FIRST_NAMES = [
  "James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael", "Linda",
  "David", "Elizabeth", "William", "Barbara", "Richard", "Susan", "Joseph", "Jessica",
  "Thomas", "Karen", "Carlos", "Nancy", "Daniel", "Lisa", "Miguel", "Sandra",
  "Anthony", "Ashley", "Mark", "Emily", "Steven", "Michelle", "Andrew", "Amanda",
  "Kenneth", "Melissa", "Paul", "Deborah", "Joshua", "Stephanie", "Kevin", "Rebecca",
];

const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
  "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson",
  "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson",
  "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson", "Walker",
  "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores",
];

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function dayIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Deterministic participant id for cohort index i (Marcus is index 0). */
export function participantIdForIndex(index: number): string {
  if (index === 0) return MARCUS_REED_PARTICIPANT_ID;
  return new Rng(`${COHORT_SEED}:pid:${index}`).uuid();
}

export function catalogBySku(sku: string): CatalogEntry {
  const entry = MATTRESS_CATALOG.find((e) => e.sku === sku);
  if (!entry) throw new Error(`Unknown mattress SKU: ${sku}`);
  return entry;
}

/**
 * Derives the full latent profile for a participant id. Pure and
 * deterministic — the seed and the time machine both call this.
 */
export function buildProfile(participantId: string): ParticipantProfile {
  if (participantId === MARCUS_REED_PARTICIPANT_ID) return marcusProfile();

  const rng = new Rng(`${COHORT_SEED}:profile:${participantId}`);
  const deviceRng = new Rng(`${COHORT_SEED}:devices:${participantId}`);

  const enrollmentTouchpoint = rng.chance(0.6) ? "clinic" : "retail";
  const sex = rng.chance(0.55) ? "male" : "female";

  // Ages 30-75 skewed toward 45-65.
  const age = rng.chance(0.65)
    ? rng.int(45, 65)
    : rng.chance(0.5)
      ? rng.int(30, 44)
      : rng.int(66, 75);
  const yearOfBirth = DEMO_EPOCH.getUTCFullYear() - age;

  // Enrollment spread: 30 days before the epoch to 75 days after, so at the
  // initial clock (epoch + 90d) everyone has 15-120 nights of history.
  const enrollmentDate = addDays(DEMO_EPOCH, rng.int(-30, 75));
  const hstOffsetDays = enrollmentTouchpoint === "clinic" ? rng.int(1, 4) : rng.int(5, 9);

  // OSA phenotype: mild 35% / moderate 40% / severe 25%.
  const severity = rng.weighted<OsaSeverity>([
    ["mild", 35],
    ["moderate", 40],
    ["severe", 25],
  ]);
  const ahi =
    severity === "mild"
      ? rng.uniform(5, 14.9)
      : severity === "moderate"
        ? rng.uniform(15, 29.9)
        : rng.uniform(30, 60);

  const supinePredominant = rng.chance(0.5);
  const baselineSupinePct = rng.clampedNormal(supinePredominant ? 50 : 38, 12, 10, 90);
  const supineFraction = baselineSupinePct / 100;
  // supine/nonsupine split honoring total AHI; supine-predominant ⇒ ratio ≥ 2.
  const ratio = supinePredominant ? rng.uniform(2.2, 4.5) : rng.uniform(0.8, 1.7);
  const nonsupineAhi = ahi / (supineFraction * ratio + (1 - supineFraction));
  const supineAhi = nonsupineAhi * ratio;

  const odi = ahi * rng.uniform(0.7, 0.95);
  const spo2MeanBaseline = rng.clampedNormal(
    96 - (severity === "mild" ? 0.8 : severity === "moderate" ? 1.6 : 2.6),
    0.8,
    88,
    98
  );
  const spo2Nadir = rng.clampedNormal(89 - ahi * 0.2, 2.5, 68, 92);

  // Treatment arms: CPAP 45 / appliance 15 / mattress-only 20 / CPAP+mattress 15 / appliance+mattress 5.
  const arm = rng.weighted<TreatmentArm>([
    ["cpap", 45],
    ["appliance", 15],
    ["mattress_only", 20],
    ["cpap_mattress", 15],
    ["appliance_mattress", 5],
  ]);
  const hasCpap = arm === "cpap" || arm === "cpap_mattress";
  const hasAppliance = arm === "appliance" || arm === "appliance_mattress";
  const hasMattress = arm === "mattress_only" || arm === "cpap_mattress" || arm === "appliance_mattress";

  const treatmentStartOffsetDays = rng.int(10, 18);
  const mattressPurchaseOffsetDays = rng.int(1, 5);
  const mattressDeliveryOffsetDays = mattressPurchaseOffsetDays + rng.int(8, 12);

  let mattressSku: string | null = null;
  if (hasMattress) {
    if (supinePredominant && rng.chance(0.6)) {
      const mediumFirmHybrids = MATTRESS_CATALOG.filter(isMediumFirmHybrid);
      mattressSku = rng.pick(mediumFirmHybrids).sku;
    } else {
      mattressSku = rng.pick(MATTRESS_CATALOG).sku;
    }
  }
  const mattressIsMediumFirmHybrid =
    mattressSku !== null && isMediumFirmHybrid(catalogBySku(mattressSku));

  // Flagship signal: supine-time drops 8-15 points post-delivery for
  // supine-predominant participants on medium-firm hybrids. The RNG draw is
  // identical in every scenario (one call per mattress owner) — the null
  // scenario only REMAPS the flagship band 8–15 onto the 0–3 noise band, so
  // the rest of the profile (and every later draw) is byte-identical.
  const flagshipCombo = hasMattress && supinePredominant && mattressIsMediumFirmHybrid;
  const drawnDropPoints = flagshipCombo
    ? rng.uniform(8, 15)
    : hasMattress
      ? rng.uniform(0, 3)
      : 0;
  const supineDropPoints =
    seedScenario() === "null" && flagshipCombo
      ? ((drawnDropPoints - 8) / 7) * 3 // 8–15 → 0–3: mattress effect ≈ 0
      : drawnDropPoints;

  // CPAP adherence: ~70% adherent (mean 6.2h), ~30% decline to abandonment.
  const cpapAdherent = rng.chance(0.7);
  const cpapMeanUsageMin = cpapAdherent
    ? rng.clampedNormal(372, 45, 290, 480)
    : rng.clampedNormal(300, 50, 180, 400);
  const cpapSkipNightP = cpapAdherent ? rng.uniform(0.03, 0.1) : rng.uniform(0.1, 0.25);
  const cpapAbandonAfterDays = rng.int(21, 70);
  const applianceAdherent = rng.chance(0.75);

  const wearable = rng.pick(rng.weighted(WEARABLES));
  const hasSleepMat = rng.chance(0.25);

  const cpapMake = rng.chance(0.7) ? "ResMed" : "Philips Respironics";
  const cpapModel =
    cpapMake === "ResMed" ? rng.pick(["AirSense 10 AutoSet", "AirSense 11 AutoSet"]) : "DreamStation 2 Auto";
  const applianceMake = rng.pick(["SomnoMed", "ProSomnus", "Panthera"]);
  const applianceModel =
    applianceMake === "SomnoMed" ? "SomnoDent Avant" : applianceMake === "ProSomnus" ? "EVO" : "D-SAD";

  const restingHrBase = rng.clampedNormal(64, 7, 48, 88);
  const hrvSdnnBase = rng.clampedNormal(38, 12, 12, 90);
  const sleepEfficiencyBase = rng.clampedNormal(82, 5, 62, 95);
  const sleepDurationBase = rng.clampedNormal(420, 45, 300, 540);

  const essBaseline = Math.round(
    rng.clampedNormal(severity === "mild" ? 9 : severity === "moderate" ? 12 : 16, 3, 2, 24)
  );
  const isiBaseline = Math.round(rng.clampedNormal(14, 4, 3, 27));
  // ESS improves 3-5 points on adherent CPAP; smaller elsewhere.
  const essImprovement =
    hasCpap && cpapAdherent
      ? rng.uniform(3, 5)
      : hasAppliance && applianceAdherent
        ? rng.uniform(2, 4)
        : hasMattress && supineDropPoints > 6
          ? rng.uniform(1, 3)
          : rng.uniform(-0.5, 1.5);
  const isiImprovement = Math.max(0, essImprovement * rng.uniform(0.6, 1.1));

  const stopBangScore = Math.min(
    8,
    Math.max(2, Math.round(2 + (severity === "mild" ? 1 : severity === "moderate" ? 2.5 : 4) + rng.uniform(-1, 1)))
  );

  const nameRng = new Rng(`${COHORT_SEED}:name:${participantId}`);
  const first = nameRng.pick(FIRST_NAMES);
  const last = nameRng.pick(LAST_NAMES);
  const displayName = `${first} ${last}`;
  const email = `${first.toLowerCase()}.${last.toLowerCase()}.${participantId.slice(0, 6)}@example.com`;

  return {
    id: participantId,
    displayName,
    email,
    yearOfBirth,
    sex,
    enrollmentTouchpoint,
    enrollmentDate,
    hstOffsetDays,
    laneC: rng.chance(0.3),
    severity,
    ahi: round1(ahi),
    supineAhi: round1(supineAhi),
    nonsupineAhi: round1(nonsupineAhi),
    supinePredominant,
    odi: round1(odi),
    spo2MeanBaseline: round1(spo2MeanBaseline),
    spo2Nadir: round1(spo2Nadir),
    baselineSupinePct: round1(baselineSupinePct),
    arm,
    hasCpap,
    hasAppliance,
    hasMattress,
    treatmentStartOffsetDays,
    mattressPurchaseOffsetDays,
    mattressDeliveryOffsetDays,
    mattressSku,
    mattressIsMediumFirmHybrid,
    supineDropPoints,
    cpapAdherent,
    cpapMeanUsageMin,
    cpapSkipNightP,
    cpapAbandonAfterDays,
    applianceAdherent,
    wearable,
    hasSleepMat,
    wearableDeviceId: deviceRng.uuid(),
    cpapDeviceId: deviceRng.uuid(),
    sleepMatDeviceId: deviceRng.uuid(),
    applianceDeviceId: deviceRng.uuid(),
    cpapMake,
    cpapModel,
    applianceMake,
    applianceModel,
    restingHrBase,
    hrvSdnnBase,
    sleepEfficiencyBase,
    sleepDurationBase,
    essBaseline,
    isiBaseline,
    essImprovement,
    isiImprovement,
    stopBangScore,
  };
}

/**
 * Marcus Reed — the demo script's scripted persona. 52, retail→clinic linked
 * (Lane B + A + C), supine-predominant positional OSA (AHI 24, supine 41),
 * CPAP+mattress arm with a Tempur-Pedic ProAdapt Medium Hybrid, strong
 * responder on every endpoint.
 */
function marcusProfile(): ParticipantProfile {
  const deviceRng = new Rng(`${COHORT_SEED}:devices:${MARCUS_REED_PARTICIPANT_ID}`);
  return {
    id: MARCUS_REED_PARTICIPANT_ID,
    displayName: "Marcus Reed",
    email: "marcus.reed@example.com",
    yearOfBirth: DEMO_EPOCH.getUTCFullYear() - 52,
    sex: "male",
    enrollmentTouchpoint: "retail",
    enrollmentDate: DEMO_EPOCH,
    hstOffsetDays: 7,
    laneC: true,
    severity: "moderate",
    ahi: 24,
    supineAhi: 41,
    nonsupineAhi: 9.8,
    supinePredominant: true,
    odi: 19.2,
    spo2MeanBaseline: 93.8,
    spo2Nadir: 84,
    baselineSupinePct: 52,
    arm: "cpap_mattress",
    hasCpap: true,
    hasAppliance: false,
    hasMattress: true,
    treatmentStartOffsetDays: 14,
    mattressPurchaseOffsetDays: 3,
    mattressDeliveryOffsetDays: 13,
    mattressSku: MARCUS_SKU,
    mattressIsMediumFirmHybrid: true,
    // Null scenario: even the scripted persona's mattress does nothing.
    supineDropPoints: seedScenario() === "null" ? 0 : 14,
    cpapAdherent: true,
    cpapMeanUsageMin: 408, // 6.8 h — strong responder
    cpapSkipNightP: 0.03,
    cpapAbandonAfterDays: 9999,
    applianceAdherent: false,
    wearable: { make: "Apple", model: "Apple Watch Series 10", source: "healthkit" },
    hasSleepMat: true,
    wearableDeviceId: deviceRng.uuid(),
    cpapDeviceId: deviceRng.uuid(),
    sleepMatDeviceId: deviceRng.uuid(),
    applianceDeviceId: deviceRng.uuid(),
    cpapMake: "ResMed",
    cpapModel: "AirSense 11 AutoSet",
    applianceMake: "SomnoMed",
    applianceModel: "SomnoDent Avant",
    restingHrBase: 66,
    hrvSdnnBase: 34,
    sleepEfficiencyBase: 80,
    sleepDurationBase: 415,
    essBaseline: 14,
    isiBaseline: 15,
    essImprovement: 5,
    isiImprovement: 4,
    stopBangScore: 6,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
