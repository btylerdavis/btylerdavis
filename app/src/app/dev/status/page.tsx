import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import {
  getLinkedProfile,
  getObservations,
  grantConsent,
  revokeConsent,
} from "@/lib/consent";

/**
 * Build-status page: sanitized aggregate counts, the sim-clock date, and
 * pass/fail consent-gate indicators. Deliberately NOT internal: no cohort
 * participant ids, no identity-linked reads, no raw probe internals — the
 * consent gates are exercised against a throwaway synthetic probe
 * participant that is created and deleted within this request.
 */
export const metadata: Metadata = { title: "Build status" };

export const dynamic = "force-dynamic";

interface ProbeResult {
  label: string;
  detail: string;
  pass: boolean;
}

/**
 * Exercises the consent gates end-to-end on a throwaway probe participant
 * (anonymous by construction — it never carries an identity record and its
 * id is never rendered). All probe rows are removed before the page renders;
 * the append-only consent convention is waived for this synthetic probe.
 */
async function runConsentGateProbes(): Promise<ProbeResult[]> {
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

export default async function DevStatusPage() {
  // Counts run BEFORE the probe participant exists, so they stay honest.
  const [participants, observations, sleepSessions, proResponses, simClock] =
    await Promise.all([
      prisma.participant.count(),
      prisma.observation.count(),
      prisma.sleepSession.count(),
      prisma.proResponse.count(),
      prisma.simClock.findUnique({ where: { id: "singleton" } }),
    ]);

  const probes = await runConsentGateProbes();

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 font-mono text-sm">
      <p className="mb-6 inline-block rounded bg-amber-100 px-2 py-1 text-xs font-semibold tracking-wide text-amber-800">
        DEMO DATA — synthetic cohort
      </p>
      <h1 className="mb-8 text-2xl font-bold">Build status</h1>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">Database (aggregate counts)</h2>
        <table className="w-full border-collapse">
          <tbody>
            <Row label="participants" value={participants.toLocaleString()} />
            <Row label="observations" value={observations.toLocaleString()} />
            <Row label="sleep sessions" value={sleepSessions.toLocaleString()} />
            <Row label="PRO responses" value={proResponses.toLocaleString()} />
            <Row
              label="sim clock"
              value={simClock ? simClock.currentDate.toISOString().slice(0, 10) : "NOT SEEDED"}
            />
          </tbody>
        </table>
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">Consent-gate checks</h2>
        <p className="mb-3 text-xs text-gray-500">
          Exercised on a throwaway synthetic probe participant, created and deleted for this
          request — no cohort participant is read or shown here.
        </p>
        <ul className="space-y-2">
          {probes.map((probe) => (
            <li
              key={probe.label}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 pb-2 last:border-0"
            >
              <span className="text-gray-600">{probe.label}</span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                  probe.pass
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-red-100 text-red-700"
                }`}
              >
                {probe.pass ? "PASS" : "FAIL"} · {probe.detail}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs text-gray-400">
        Seed via <code>npm run seed</code>; advance the demo clock at <code>/timemachine</code>.
      </p>
      <p className="mt-2 text-xs text-gray-400">
        Demonstration environment — synthetic cohort, no real patient data.
      </p>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b border-gray-200 last:border-0">
      <td className="py-1.5 pr-4 text-gray-600">{label}</td>
      <td className="py-1.5 font-semibold">{value}</td>
    </tr>
  );
}
