"use server";

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  assertIngestAllowed,
  ConsentError,
  CONSENT_USES,
  grantConsent,
  grantSetHas,
  loadGrants,
  type ConsentScope,
  type DataClass,
} from "@/lib/consent";
import {
  LANE_B_TOGGLEABLE_CLASSES,
  WEARABLE_PROVIDERS,
  type LaneBToggles,
  type WearableProviderKey,
} from "@/lib/enrollOptions";
import { registerIdentity } from "@/lib/identity";
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
 * sim clock; all class-gated writes go through assertIngestAllowed, exactly
 * like prisma/seed.ts.
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

  // Custom Lane B scope from the toggles: all uses for each toggled class.
  const scope: ConsentScope = grantedClasses.flatMap((dataClass) =>
    CONSENT_USES.map((use) => ({ dataClass, use }))
  );

  // Demo identity: the QR flow only asks for a display name, so demographics
  // are approximated from the screener's age/gender items (production
  // collects them properly at clinical intake).
  const sex = input.answers.gender ? "male" : "female";
  const yearOfBirth = now.getUTCFullYear() - (input.answers.age ? 57 : 42);

  const participantId = randomUUID();
  const slug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, ".");
  const email = `${slug}.${participantId.slice(0, 6)}@example.com`;

  let screenerStored = false;
  await prisma.$transaction(async (tx) => {
    await tx.participant.create({
      data: {
        id: participantId,
        yearOfBirth,
        sex,
        enrollmentTouchpoint: "retail",
        createdAt: now,
      },
    });
    await registerIdentity(participantId, displayName, email, tx);
    await grantConsent(participantId, "LANE_B", {
      grantedAt: now,
      scope,
      db: tx,
    });

    // The STOP-BANG response is pro_responses-class data: it must pass the
    // ingest gate. When the participant declined questionnaires, the gate
    // drops the payload (T2.6 semantics) — the screener still routed them,
    // but nothing is stored.
    try {
      await assertIngestAllowed(participantId, "pro_responses", { db: tx });
      await tx.proResponse.create({
        data: {
          participantId,
          instrument: "STOP_BANG",
          instrumentVersion: "1.0",
          administeredAt: now,
          itemScores: JSON.stringify(stopBangItemScores(input.answers)),
          totalScore: score,
        },
      });
      screenerStored = true;
    } catch (error) {
      if (!(error instanceof ConsentError)) throw error;
    }
  });

  return { participantId, score, band, screenerStored, grantedClasses };
}

// ---------------------------------------------------------------------------
// Step 4: wearable connect (stub — live OAuth in reserve)
// ---------------------------------------------------------------------------

export async function connectWearable(
  participantId: string,
  provider: WearableProviderKey
): Promise<{ deviceId: string; dataConsented: boolean }> {
  const spec = WEARABLE_PROVIDERS.find((p) => p.key === provider);
  if (!spec) throw new Error(`Unknown wearable provider: ${provider}`);

  const now = await getSimClock();
  const device = await prisma.device.create({
    data: {
      participantId,
      deviceClass: "wearable",
      make: spec.make,
      model: spec.model,
      assignedAt: now,
    },
  });

  // Device registration itself isn't class-gated (matching seed semantics);
  // the nightly wearable_sleep payloads are — surface whether they'll flow.
  const grants = await loadGrants(participantId);
  return {
    deviceId: device.id,
    dataConsented: grantSetHas(grants, "wearable_sleep", "collect"),
  };
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
  const catalogItem = await prisma.mattressCatalog.findUnique({ where: { sku } });
  if (!catalogItem) throw new Error(`Unknown mattress SKU: ${sku}`);

  const participant = await prisma.participant.findUnique({
    where: { id: participantId },
  });
  if (!participant) throw new Error("Participant not found");

  const now = await getSimClock();
  const deliveryDate = addDays(now, DELIVERY_DEFAULT_DAYS);

  // Purchase rows are mattress_purchase-class data — gate before writing,
  // exactly like the seed's purchase pass.
  const grants = await loadGrants(participantId);
  try {
    await assertIngestAllowed(participantId, "mattress_purchase", { grants });
  } catch (error) {
    if (error instanceof ConsentError) {
      return {
        blocked: true,
        reason:
          "No current consent for mattress purchase details — the record was not stored.",
      };
    }
    throw error;
  }

  await prisma.$transaction(async (tx) => {
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
          },
          {
            participantId,
            protocolPhase: "intervention",
            startDate: deliveryDate,
            endDate: null,
          },
        ],
      });
    }
  });

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
