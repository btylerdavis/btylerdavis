"use server";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  ConsentError,
  getLinkedProfile,
  getProResponses,
  grantConsent,
  LifecycleError,
  loadGrants,
} from "@/lib/consent";
import {
  createEnrolledParticipant,
  getParticipant,
  guardedSubjectWriteOrBlocked,
  isWritableLifecycle,
} from "@/lib/consent/policyRepo";
import { CPAP_MODELS, type CpapModelKey } from "@/lib/enrollOptions";
import { toIsoDay } from "@/lib/format";
import {
  assertValidParsedHst,
  HST_CONCEPTS,
  HST_LABELS,
  HST_UNITS,
  HstParseError,
  isSupinePredominant,
  parseHst,
  type ParsedHst,
} from "@/lib/hst/parse";
import { matchRetailParticipants, type IdentityMatch } from "@/lib/identity";
import { getSimClock } from "@/lib/simclock";
import { stopBangRiskBand, type StopBangRiskBand } from "@/lib/stopbang";

/**
 * Clinic-door (sleep coach) server actions (DEMO.md Act 2). Domain dates
 * come from the sim clock; EVERY subject-data write goes through the policy
 * repository (lifecycle + collect grant re-checked inside the write
 * transaction — audit F-03/F-04); the Lane C join goes through
 * getLinkedProfile only. A tombstoned participant is refused everywhere.
 */

// ---------------------------------------------------------------------------
// Step 1: patient intake
// ---------------------------------------------------------------------------

export async function lookupRetailParticipants(
  query: string
): Promise<IdentityMatch[]> {
  return matchRetailParticipants(query);
}

export type ClinicIntake =
  | { mode: "new"; displayName: string; yearOfBirth: number; sex: "male" | "female" }
  | { mode: "existing"; participantId: string };

export interface ClinicEnrollmentResult {
  participantId: string;
  /** true when this patient walked in from the retail door (Lane C candidate) */
  fromRetail: boolean;
  laneAGrantedAtIso: string;
}

// ---------------------------------------------------------------------------
// Step 2: combined ICF + HIPAA authorization (Lane A)
// ---------------------------------------------------------------------------

export async function enrollClinicPatient(
  intake: ClinicIntake,
  signatureCaptured: boolean
): Promise<ClinicEnrollmentResult> {
  if (!signatureCaptured) {
    throw new Error("A signature is required to record consent");
  }
  const now = await getSimClock();

  let participantId: string;
  let fromRetail = false;

  if (intake.mode === "existing") {
    const participant = await getParticipant(intake.participantId);
    if (!participant) throw new Error("Participant not found");
    // Terminal lifecycle (audit F-01): a deleted record can never be
    // re-enrolled — the consent engine would refuse the grant below too,
    // but we fail with a clear message before touching anything.
    if (!isWritableLifecycle(participant)) {
      throw new Error("This record was deleted and cannot be re-enrolled");
    }
    participantId = participant.id;
    fromRetail = participant.enrollmentTouchpoint === "retail";
  } else {
    const displayName = intake.displayName.trim();
    if (displayName.length < 2 || displayName.length > 60) {
      throw new Error("Please enter the patient's name (2-60 characters)");
    }
    const maxYear = now.getUTCFullYear() - 18;
    if (
      !Number.isInteger(intake.yearOfBirth) ||
      intake.yearOfBirth < 1930 ||
      intake.yearOfBirth > maxYear
    ) {
      throw new Error(`Year of birth must be between 1930 and ${maxYear}`);
    }
    if (intake.sex !== "male" && intake.sex !== "female") {
      throw new Error("Please select a sex");
    }

    participantId = randomUUID();
    const slug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, ".");
    await createEnrolledParticipant({
      id: participantId,
      yearOfBirth: intake.yearOfBirth,
      sex: intake.sex,
      enrollmentTouchpoint: "clinic",
      createdAt: now,
      displayName,
      email: `${slug}.${participantId.slice(0, 6)}@example.com`,
    });
  }

  // Combined ICF + HIPAA authorization → Lane A (full clinical scope). This
  // is a SIGNED grant event: it extends the participant's authorized-scope
  // ceiling. The signature bitmap itself is not persisted in the demo
  // (document vault / e-signature vendor held in reserve); the consent event
  // is real, and the engine re-checks lifecycle inside the same transaction.
  await grantConsent(participantId, "LANE_A", { grantedAt: now });

  return { participantId, fromRetail, laneAGrantedAtIso: toIsoDay(now) };
}

// ---------------------------------------------------------------------------
// Step 3: HST intake — parse, preview, confirm
// ---------------------------------------------------------------------------

export interface HstPreview {
  ok: true;
  sourceName: string;
  format: "csv" | "report";
  parsed: ParsedHst;
  supinePredominant: boolean;
  rows: { concept: string; label: string; value: number; unit: string }[];
}

export interface HstFailure {
  ok: false;
  error: string;
}

function toPreview(parsed: ParsedHst, sourceName: string): HstPreview {
  return {
    ok: true,
    sourceName,
    format: parsed.format,
    parsed,
    supinePredominant: isSupinePredominant(parsed.values),
    rows: HST_CONCEPTS.map((concept) => ({
      concept,
      label: HST_LABELS[concept],
      value: parsed.values[concept],
      unit: HST_UNITS[concept],
    })),
  };
}

export async function parseHstUpload(
  formData: FormData
): Promise<HstPreview | HstFailure> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a file to upload" };
  }
  if (file.size > 512 * 1024) {
    return { ok: false, error: "File too large — HST exports are small text files" };
  }
  try {
    const parsed = parseHst(await file.text());
    return toPreview(parsed, file.name);
  } catch (error) {
    if (error instanceof HstParseError) return { ok: false, error: error.message };
    throw error;
  }
}

const FIXTURES: Record<"csv" | "report", string> = {
  csv: "hst-sample.csv",
  report: "hst-sample-report.txt",
};

/** One-click demo path: parse a bundled sample report, no file dance. */
export async function loadSampleHst(
  format: "csv" | "report"
): Promise<HstPreview | HstFailure> {
  const fileName = FIXTURES[format];
  const filePath = path.join(process.cwd(), "public", "demo-fixtures", fileName);
  try {
    const parsed = parseHst(await readFile(filePath, "utf8"));
    return toPreview(parsed, fileName);
  } catch (error) {
    if (error instanceof HstParseError) return { ok: false, error: error.message };
    throw error;
  }
}

export type HstIntakeResult =
  | {
      blocked: false;
      observationsWritten: number;
      studyDateIso: string;
      supinePredominant: boolean;
    }
  | { blocked: true; reason: string };

export async function confirmHstIntake(
  participantId: string,
  parsed: ParsedHst
): Promise<HstIntakeResult> {
  const valid = assertValidParsedHst(parsed);
  const studyDate = new Date(`${valid.studyDate}T00:00:00Z`);

  // hst_clinical-class write — lifecycle + collect grant checked INSIDE the
  // same transaction as the insert (policy repository).
  const outcome = await guardedSubjectWriteOrBlocked(
    participantId,
    ["hst_clinical"],
    async (tx) => {
      await tx.observation.createMany({
        data: HST_CONCEPTS.map((concept) => ({
          participantId,
          source: "hst",
          concept,
          valueNumeric: valid.values[concept],
          unit: HST_UNITS[concept],
          effectiveDate: studyDate,
          grain: "session",
          qualityFlags: "[]",
        })),
      });
      return HST_CONCEPTS.length;
    }
  );
  if (!outcome.ok) {
    return {
      blocked: true,
      reason:
        "No current hst_clinical collect grant — record the Lane A consent first.",
    };
  }

  return {
    blocked: false,
    observationsWritten: outcome.value,
    studyDateIso: valid.studyDate,
    supinePredominant: isSupinePredominant(valid.values),
  };
}

// ---------------------------------------------------------------------------
// Step 4: CPAP setup
// ---------------------------------------------------------------------------

export type CpapSetupResult =
  | {
      blocked: false;
      deviceId: string;
      make: string;
      model: string;
      setupDateIso: string;
    }
  | { blocked: true; reason: string };

export async function recordCpapSetup(
  participantId: string,
  modelKey: CpapModelKey
): Promise<CpapSetupResult> {
  const spec = CPAP_MODELS.find((m) => m.key === modelKey);
  if (!spec) throw new Error(`Unknown CPAP model: ${modelKey}`);

  const participant = await getParticipant(participantId);
  if (!participant) throw new Error("Participant not found");

  const now = await getSimClock();
  const deviceId = randomUUID();

  // Device + treatment event + episodes are cpap_telemetry-class rows
  // (audit F-03/F-06): the whole setup is one policy-guarded transaction —
  // lifecycle + collect grant re-checked inside it, lineage stamped on
  // every row.
  const outcome = await guardedSubjectWriteOrBlocked(
    participantId,
    ["cpap_telemetry"],
    async (tx) => {
      await tx.device.create({
        data: {
          id: deviceId,
          participantId,
          deviceClass: "cpap",
          make: spec.make,
          model: spec.model,
          assignedAt: now,
          dataClass: "cpap_telemetry",
        },
      });
      await tx.treatmentEvent.create({
        data: {
          participantId,
          type: "cpap_setup",
          eventDate: now,
          detail: JSON.stringify({ make: spec.make, model: spec.model, mode: "APAP" }),
          dataClass: "cpap_telemetry",
        },
      });
      // CPAP setup is the treatment anchor when no episode structure exists
      // yet — mirror enrollmentRows(): baseline enrollment→anchor, then
      // open-ended intervention.
      const existing = await tx.episode.count({ where: { participantId } });
      if (existing === 0) {
        await tx.episode.createMany({
          data: [
            {
              participantId,
              protocolPhase: "baseline",
              startDate: participant.createdAt,
              endDate: now,
              dataClass: "cpap_telemetry",
            },
            {
              participantId,
              protocolPhase: "intervention",
              startDate: now,
              endDate: null,
              dataClass: "cpap_telemetry",
            },
          ],
        });
      }
    }
  );
  if (!outcome.ok) return { blocked: true, reason: outcome.reason };

  return {
    blocked: false,
    deviceId,
    make: spec.make,
    model: spec.model,
    setupDateIso: toIsoDay(now),
  };
}

// ---------------------------------------------------------------------------
// Step 5: Lane C linkage — the scripted blocked → linked beat
// ---------------------------------------------------------------------------

export interface LinkedViewBlocked {
  blocked: true;
  blockedReason: string;
}

export interface LinkedViewOpen {
  blocked: false;
  identity: { displayName: string; email: string } | null;
  retail: {
    purchases: {
      sku: string;
      brand: string;
      model: string;
      firmnessRating: number;
      materialClass: string;
      purchaseDateIso: string;
      deliveryDateIso: string | null;
    }[];
    stopBang: { score: number; band: StopBangRiskBand; administeredAtIso: string } | null;
    stopBangBlocked: boolean;
  };
  clinical: {
    hst: { concept: string; label: string; value: number | null; unit: string; dateIso: string }[];
    events: { type: string; dateIso: string }[];
  };
}

export type LinkedView = LinkedViewBlocked | LinkedViewOpen;

/**
 * The joined view via getLinkedProfile — refused (blocked: true) without a
 * current Lane C grant, complete with identity + retail + clinical data
 * after one. The clinic flow calls this twice on purpose: once to show the
 * refusal, once after grantLinkage to prove the join works.
 */
export async function linkedView(participantId: string): Promise<LinkedView> {
  const grants = await loadGrants(participantId);
  const profile = await getLinkedProfile(participantId, {
    use: "view_identified",
    grants,
  });

  if (profile.blocked) {
    return { blocked: true, blockedReason: profile.blockedReason ?? "linkage refused" };
  }

  // STOP-BANG for the retail column (gated read on pro_responses).
  const pros = await getProResponses(participantId, {
    use: "view_identified",
    instruments: ["STOP_BANG"],
    grants,
  });
  const latest = pros.data.at(-1);

  return {
    blocked: false,
    identity: profile.identity ?? null,
    retail: {
      purchases: (profile.retail?.mattressPurchases ?? []).map((p) => ({
        sku: p.sku,
        brand: p.brand,
        model: p.model,
        firmnessRating: p.firmnessRating,
        materialClass: p.materialClass,
        purchaseDateIso: toIsoDay(p.purchaseDate),
        deliveryDateIso: p.deliveryDate ? toIsoDay(p.deliveryDate) : null,
      })),
      stopBang: latest
        ? {
            score: latest.totalScore,
            band: stopBangRiskBand(Math.round(latest.totalScore)),
            administeredAtIso: toIsoDay(latest.administeredAt),
          }
        : null,
      stopBangBlocked: pros.blocked,
    },
    clinical: {
      hst: (profile.clinical?.hstObservations ?? []).map((o) => ({
        concept: o.concept,
        label: HST_LABELS[o.concept as keyof typeof HST_LABELS] ?? o.concept,
        value: o.valueNumeric,
        unit: HST_UNITS[o.concept as keyof typeof HST_UNITS] ?? "",
        dateIso: toIsoDay(o.effectiveDate),
      })),
      events: (profile.clinical?.treatmentEvents ?? []).map((e) => ({
        type: e.type,
        dateIso: toIsoDay(e.eventDate),
      })),
    },
  };
}

export async function grantLinkage(
  participantId: string
): Promise<{ grantedAtIso: string }> {
  const now = await getSimClock();
  try {
    // Signed grant event; the engine re-checks lifecycle inside the tx.
    await grantConsent(participantId, "LANE_C", { grantedAt: now });
  } catch (error) {
    if (error instanceof LifecycleError) {
      throw new Error("This record was deleted — linkage cannot be granted");
    }
    if (error instanceof ConsentError) throw new Error(error.message);
    throw error;
  }
  return { grantedAtIso: toIsoDay(now) };
}
