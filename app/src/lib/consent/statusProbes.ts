import { randomUUID } from "node:crypto";
import { prisma } from "../db";
import { grantConsent, revokeConsent } from "./engine";
import { getLinkedProfile, getObservations } from "./gatedQueries";

/**
 * Consent-gate probes for the /dev/status page. The gates are exercised
 * against a throwaway synthetic probe participant (anonymous by construction
 * — it never carries an identity record and its id is never rendered). All
 * probe rows are removed before the page renders; the immutable-ledger
 * convention is waived for this synthetic probe only.
 */

export interface ProbeResult {
  label: string;
  detail: string;
  pass: boolean;
}

export async function runConsentGateProbes(): Promise<ProbeResult[]> {
  const probeId = randomUUID();
  const probes: ProbeResult[] = [];
  try {
    await prisma.participant.create({
      data: {
        id: probeId,
        yearOfBirth: 1980,
        sex: "female",
        enrollmentTouchpoint: "clinic",
      },
    });
    await grantConsent(probeId, "LANE_A");
    await prisma.observation.create({
      data: {
        participantId: probeId,
        source: "airview",
        concept: "cpap_usage_minutes",
        valueNumeric: 300,
        unit: "min",
        effectiveDate: new Date(),
        grain: "day",
        qualityFlags: '["probe"]',
      },
    });

    const allowed = await getObservations(probeId, { use: "view_identified" });
    probes.push({
      label: "Identified-tier read with a current Lane A grant",
      pass: !allowed.blocked && allowed.data.length > 0,
      detail:
        !allowed.blocked && allowed.data.length > 0
          ? "rows returned, as expected"
          : "unexpectedly blocked",
    });

    const linkage = await getLinkedProfile(probeId, { use: "view_identified" });
    probes.push({
      label: "Linkage join without a Lane C grant",
      pass: linkage.blocked,
      detail: linkage.blocked ? "refused, as expected" : "unexpectedly allowed",
    });

    await revokeConsent(probeId, "LANE_A");
    const revoked = await getObservations(probeId, { use: "view_identified" });
    const revokedPass = revoked.blocked && revoked.data.length === 0;
    probes.push({
      label: "Identified-tier read after revocation",
      pass: revokedPass,
      detail: revokedPass ? "blocked, zero rows — as expected" : "unexpectedly allowed",
    });
  } finally {
    await prisma.observation.deleteMany({ where: { participantId: probeId } });
    await prisma.consentRecord.deleteMany({ where: { participantId: probeId } });
    await prisma.participant.deleteMany({ where: { id: probeId } });
  }
  return probes;
}
