import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/Card";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { internalStorageCounts } from "@/lib/consent";
import { runConsentGateProbes } from "@/lib/consent/statusProbes";

/**
 * Build-status page: INTERNAL STORAGE counts (raw physical rows, explicitly
 * labeled — deliberately not consent-filtered, unlike every product
 * surface), the sim-clock date, and pass/fail consent-gate indicators. No
 * cohort participant ids, no identity-linked reads, no raw probe internals —
 * the consent gates are exercised against a throwaway synthetic probe
 * participant that is created and deleted within this request.
 *
 * Linked from every footer ("Build status"), so it wears the same
 * Sleeptopia design language as every other route: site chrome, cream
 * ground, white hairline cards, eyebrow labels, serif headings.
 */
export const metadata: Metadata = { title: "Build status" };

export const dynamic = "force-dynamic";

export default async function DevStatusPage() {
  // Counts run BEFORE the probe participant exists, so they stay honest.
  const { participants, observations, sleepSessions, proResponses, simClockDate } =
    await internalStorageCounts();

  const probes = await runConsentGateProbes();

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1 bg-cream">
        <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-8 sm:px-6 sm:py-10">
          {/* Header */}
          <Card className="p-6 sm:p-8">
            <p className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">
              Demo internals · build status
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-navy sm:text-3xl">Build status</h1>
            <p className="mt-2 max-w-2xl text-sm text-graphite">
              Internal storage counts, the sim clock, and live pass/fail probes of the
              consent gates — the plumbing check behind every product surface.
            </p>
            <p className="mt-4 inline-block rounded-full border border-watermark/50 px-3 py-1 text-[10px] font-semibold tracking-[0.18em] text-watermark uppercase">
              Demo data — synthetic cohort
            </p>
          </Card>

          {/* Internal storage counts */}
          <Card className="p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-navy">
              Database — internal storage counts
            </h2>
            <p className="mt-1 text-xs text-graphite">
              Raw physical row counts (storage metric) — deliberately NOT consent-filtered;
              every product surface uses consent-gated counts.
            </p>
            <table className="mt-3 w-full border-collapse text-sm">
              <tbody>
                <Row label="Participants" value={participants.toLocaleString("en-US")} />
                <Row label="Observations" value={observations.toLocaleString("en-US")} />
                <Row label="Sleep sessions" value={sleepSessions.toLocaleString("en-US")} />
                <Row label="PRO responses" value={proResponses.toLocaleString("en-US")} />
                <Row
                  label="Sim clock"
                  value={simClockDate ? simClockDate.toISOString().slice(0, 10) : "NOT SEEDED"}
                />
              </tbody>
            </table>
          </Card>

          {/* Consent-gate probes */}
          <Card className="p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-navy">Consent-gate checks</h2>
            <p className="mt-1 text-xs text-graphite">
              Exercised on a throwaway synthetic probe participant, created and deleted for
              this request — no cohort participant is read or shown here.
            </p>
            <ul className="mt-3">
              {probes.map((probe) => (
                <li
                  key={probe.label}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline/60 py-2 text-sm last:border-0"
                >
                  <span className="text-graphite">{probe.label}</span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 font-mono text-xs font-semibold ${
                      probe.pass ? "bg-success/10 text-success" : "bg-danger/10 text-danger"
                    }`}
                  >
                    {probe.pass ? "✓ PASS" : "✗ FAIL"} · {probe.detail}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <p className="pb-2 text-center text-xs text-graphite">
            Seed via{" "}
            <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-navy">
              npm run seed
            </code>{" "}
            · advance the demo clock at the{" "}
            <Link href="/timemachine" className="underline underline-offset-4 hover:text-brand">
              time machine
            </Link>
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b border-hairline/60 last:border-0">
      <td className="py-2 pr-4 text-graphite">{label}</td>
      <td className="py-2 text-right font-mono text-sm font-semibold text-navy tabular-nums">
        {value}
      </td>
    </tr>
  );
}
