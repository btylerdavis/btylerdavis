"use server";

import { randomUUID } from "node:crypto";
import { CONSENT_USES, type ConsentScope, type DataClass } from "@/lib/consent";
import {
  createRetailEnrollment,
  findCatalogItem,
  getParticipant,
  guardedSubjectWriteOrBlocked,
} from "@/lib/consent/policyRepo";
import {
  LANE_B_TOGGLEABLE_CLASSES,
  WEARABLE_PROVIDERS,
  type LaneBToggles,
  type WearableProviderKey,
} from "@/lib/enrollOptions";
import { getSimClock } from "@/lib/simclock";
import { addDays } from "@/lib/synthetic/profiles";
import { toIsoDay } from "@/lib/format";
import {
  isCompleteAnswers,
  scoreStopBang,
  stopBangItemScores,
  stopBangRiskBand,
  type StopBangAnswers,
  type StopBangRiskBand,
} from "@/lib/stopbang";

/**
 * Retail-door server actions (DEMO.md Act 1). All domain dates come from the
 * sim clock; EVERY subject-data write goes through the policy repository —
 * lifecycle + the class's collect grant re-checked inside the write
 * transaction (audit F-03/F-04). Device registration is consent-owned data:
 * without a wearable_sleep grant NO device row is created.
 */

// ---------------------------------------------------------------------------
// Step 2: STOP-BANG scoring (server-side)
// ---------------------------------------------------------------------------

export interface ScreenerResult {
  score: number;
  band: StopBangRiskBand;
}

export async function scoreScreener(
  answers: StopBangAnswers
): Promise<ScreenerResult> {
  if (!isCompleteAnswers(answers)) {
    throw new Error("Please answer all 8 questions");
  }
  const score = scoreStopBang(answers);
  return { score, band: stopBangRiskBand(score) };
}

// ---------------------------------------------------------------------------
// Step 3: consumer consent (Lane B) — creates the participant
// ---------------------------------------------------------------------------

export interface RetailEnrollmentResult {
  participantId: string;
  score: number;
  band: StopBangRiskBand;
  /** false when pro_responses was not consented — the ingest gate dropped it */
  screenerStored: boolean;
  grantedClasses: DataClass[];
}

export async function enrollRetail(input: {
  displayName: string;
  answers: StopBangAnswers;
  toggles: LaneBToggles;
}): Promise<RetailEnrollmentResult> {
  const displayName = input.displayName.trim();
  if (displayName.length < 2 || displayName.length > 60) {
    throw new Error("Please enter a display name (2-60 characters)");
  }
  if (!isCompleteAnswers(input.answers)) {
    throw new Error("Please answer all 8 screener questions");
  }

  const grantedClasses = LANE_B_TOGGLEABLE_CLASSES.filter(
    (dataClass) => input.toggles[dataClass]
  );
  if (grantedClasses.length === 0) {
    throw new Error("Select at least one data type to take part in the study");
  }

  const now = await getSimClock();
  const score = scoreStopBang(input.answers);
  const band = stopBangRiskBand(score);

  // Custom Lane B scope from the toggles: all uses for each toggled class,
  // plus the base registry record (registry_demographics — audit F-11: the
  // signed instrument names the demographic fields explicitly). What is NOT
  // toggled on is NEVER signed: it stays outside the authorized ceiling and
  // can only be added later through the re-consent flow.
  const scope: ConsentScope = [...grantedClasses, "registry_demographics" as const].flatMap(
    (dataClass) => CONSENT_USES.map((use) => ({ dataClass, use }))
  );

  // Demo identity: the QR flow only asks for a display name, so demographics
  // are approximated from the screener's age/gender items (production
  // collects them properly at clinical intake).
  const sex = input.answers.gender ? "male" : "female";
  const yearOfBirth = now.getUTCFullYear() - (input.answers.age ? 57 : 42);

  const participantId = randomUUID();
  const slug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, ".");
  const email = `${slug}.${participantId.slice(0, 6)}@example.com`;

  // One policy-repository transaction: participant + identity + the SIGNED
  // Lane B grant event, then the STOP-BANG screener gated against the
  // consent just recorded (T2.6 semantics: a declined questionnaire class
  // drops the payload — the screener still routed them, nothing is stored).
  const { screenerStored } = await createRetailEnrollment({
    id: participantId,
    yearOfBirth,
    sex,
    createdAt: now,
    displayName,
    email,
    laneBScope: scope,
    screener: {
      instrument: "STOP_BANG",
      instrumentVersion: "1.0",
      administeredAt: now,
      itemScores: JSON.stringify(stopBangItemScores(input.answers)),
      totalScore: score,
    },
  });

  return { participantId, score, band, screenerStored, grantedClasses };
}

// ---------------------------------------------------------------------------
// Step 4: wearable connect (stub — live OAuth in reserve)
// ---------------------------------------------------------------------------

export type ConnectWearableResult =
  | { connected: true; deviceId: string; dataConsented: true }
  | { connected: false; deviceId: null; dataConsented: false; reason: string };

/**
 * Registers a wearable device — consent-owned data (audit F-03): without a
 * current wearable_sleep collect grant NO device row is created (the old
 * behavior registered the device anyway, which left rows behind the gate).
 */
export async function connectWearable(
  participantId: string,
  provider: WearableProviderKey
): Promise<ConnectWearableResult> {
  const spec = WEARABLE_PROVIDERS.find((p) => p.key === provider);
  if (!spec) throw new Error(`Unknown wearable provider: ${provider}`);

  const now = await getSimClock();
  const outcome = await guardedSubjectWriteOrBlocked(
    participantId,
    ["wearable_sleep"],
    async (tx) => {
      const device = await tx.device.create({
        data: {
          participantId,
          deviceClass: "wearable",
          make: spec.make,
          model: spec.model,
          assignedAt: now,
          dataClass: "wearable_sleep",
        },
      });
      return device.id;
    }
  );
  if (!outcome.ok) {
    return { connected: false, deviceId: null, dataConsented: false, reason: outcome.reason };
  }
  return { connected: true, deviceId: outcome.value, dataConsented: true };
}

// ---------------------------------------------------------------------------
// Step 5: mattress purchase (POS mini-form)
// ---------------------------------------------------------------------------

export type PurchaseResult =
  | {
      blocked: false;
      sku: string;
      brand: string;
      model: string;
      size: string;
      firmnessRating: number;
      purchaseDateIso: string;
      deliveryDateIso: string;
    }
  | { blocked: true; reason: string };

const DELIVERY_DEFAULT_DAYS = 10;
const STORE_ID = "MH-WICHITA-01";

export async function recordMattressPurchase(
  participantId: string,
  sku: string
): Promise<PurchaseResult> {
  const catalogItem = await findCatalogItem(sku);
  if (!catalogItem) throw new Error(`Unknown mattress SKU: ${sku}`);

  const participant = await getParticipant(participantId);
  if (!participant) throw new Error("Participant not found");

  const now = await getSimClock();
  const deliveryDate = addDays(now, DELIVERY_DEFAULT_DAYS);

  // Purchase + delivery event + episodes are mattress_purchase-class rows
  // (audit F-06: the delivery event's lineage is the purchase, NOT the
  // clinical lane). One policy-guarded transaction: lifecycle + collect
  // grant re-checked inside it.
  const outcome = await guardedSubjectWriteOrBlocked(
    participantId,
    ["mattress_purchase"],
    async (tx) => {
      await tx.mattressPurchase.create({
        data: {
          participantId,
          sku,
          purchaseDate: now,
          deliveryDate,
          storeId: STORE_ID,
        },
      });
      await tx.treatmentEvent.create({
        data: {
          participantId,
          type: "mattress_delivery",
          eventDate: deliveryDate,
          detail: JSON.stringify({ sku }),
          dataClass: "mattress_purchase",
        },
      });
      // First exposure change known → set up the baseline/intervention
      // episodes the way enrollmentRows() does (delivery is the anchor).
      const existing = await tx.episode.count({ where: { participantId } });
      if (existing === 0) {
        await tx.episode.createMany({
          data: [
            {
              participantId,
              protocolPhase: "baseline",
              startDate: participant.createdAt,
              endDate: deliveryDate,
              dataClass: "mattress_purchase",
            },
            {
              participantId,
              protocolPhase: "intervention",
              startDate: deliveryDate,
              endDate: null,
              dataClass: "mattress_purchase",
            },
          ],
        });
      }
    }
  );
  if (!outcome.ok) {
    return {
      blocked: true,
      reason:
        "No current consent for mattress purchase details — the record was not stored.",
    };
  }

  return {
    blocked: false,
    sku,
    brand: catalogItem.brand,
    model: catalogItem.model,
    size: catalogItem.size,
    firmnessRating: catalogItem.firmnessRating,
    purchaseDateIso: toIsoDay(now),
    deliveryDateIso: toIsoDay(deliveryDate),
  };
}
