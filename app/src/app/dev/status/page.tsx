import type { Metadata } from "next";
import { internalStorageCounts } from "@/lib/consent";
import { runConsentGateProbes } from "@/lib/consent/statusProbes";

/**
 * Build-status page: INTERNAL STORAGE counts (raw physical rows, explicitly
 * labeled — deliberately not consent-filtered, unlike every product
 * surface), the sim-clock date, and pass/fail consent-gate indicators. No
 * cohort participant ids, no identity-linked reads, no raw probe internals —
 * the consent gates are exercised against a throwaway synthetic probe
 * participant that is created and deleted within this request.
 */
export const metadata: Metadata = { title: "Build status" };

export const dynamic = "force-dynamic";

export default async function DevStatusPage() {
  // Counts run BEFORE the probe participant exists, so they stay honest.
  const { participants, observations, sleepSessions, proResponses, simClockDate } =
    await internalStorageCounts();

  const probes = await runConsentGateProbes();

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 font-mono text-sm">
      <p className="mb-6 inline-block rounded bg-amber-100 px-2 py-1 text-xs font-semibold tracking-wide text-amber-800">
        DEMO DATA — synthetic cohort
      </p>
      <h1 className="mb-8 text-2xl font-bold">Build status</h1>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">Database (internal storage counts)</h2>
        <p className="mb-3 text-xs text-gray-500">
          Raw physical row counts (storage metric) — deliberately NOT
          consent-filtered; every product surface uses consent-gated counts.
        </p>
        <table className="w-full border-collapse">
          <tbody>
            <Row label="participants" value={participants.toLocaleString()} />
            <Row label="observations" value={observations.toLocaleString()} />
            <Row label="sleep sessions" value={sleepSessions.toLocaleString()} />
            <Row label="PRO responses" value={proResponses.toLocaleString()} />
            <Row
              label="sim clock"
              value={simClockDate ? simClockDate.toISOString().slice(0, 10) : "NOT SEEDED"}
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
