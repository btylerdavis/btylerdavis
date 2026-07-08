import { prisma } from "@/lib/db";
import {
  getConsentStates,
  getLinkedProfile,
  getObservations,
} from "@/lib/consent";
import { MARCUS_REED_PARTICIPANT_ID } from "@/lib/synthetic/profiles";

/**
 * Foundation verification page: eyeball that the data model, seed, sim clock
 * and consent gates all work. Read-only — never mutates state on render.
 */
export const dynamic = "force-dynamic";

export default async function DevStatusPage() {
  const [participants, observations, sleepSessions, proResponses, simClock, marcusConsents] =
    await Promise.all([
      prisma.participant.count(),
      prisma.observation.count(),
      prisma.sleepSession.count(),
      prisma.proResponse.count(),
      prisma.simClock.findUnique({ where: { id: "singleton" } }),
      getConsentStates(MARCUS_REED_PARTICIPANT_ID),
    ]);

  // Consent-gate probes (both read-only):
  // 1. ALLOWED — Marcus holds LANE_A, so an identified-tier CPAP read returns rows.
  const allowedProbe = await getObservations(MARCUS_REED_PARTICIPANT_ID, {
    use: "view_identified",
    concepts: ["cpap_usage_minutes"],
  });

  // 2. BLOCKED — a participant without Lane C: the linkage join is refused.
  const noLaneC = await prisma.participant.findFirst({
    where: { consentRecords: { none: { instrumentType: "LANE_C" } } },
    select: { id: true },
  });
  const blockedProbe = noLaneC
    ? await getLinkedProfile(noLaneC.id, { use: "view_identified" })
    : null;

  const marcusLinked = await getLinkedProfile(MARCUS_REED_PARTICIPANT_ID, {
    use: "view_identified",
  });

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 font-mono text-sm">
      <p className="mb-6 inline-block rounded bg-amber-100 px-2 py-1 text-xs font-semibold tracking-wide text-amber-800">
        DEMO DATA — synthetic cohort
      </p>
      <h1 className="mb-8 text-2xl font-bold">/dev/status — foundation check</h1>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">Database</h2>
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
        <h2 className="mb-2 text-lg font-semibold">Marcus Reed — consent states</h2>
        <p className="mb-2 text-xs text-gray-500">{MARCUS_REED_PARTICIPANT_ID}</p>
        <table className="w-full border-collapse">
          <tbody>
            {marcusConsents.length === 0 && <Row label="(none)" value="NOT SEEDED" />}
            {marcusConsents.map((c) => (
              <Row
                key={c.instrumentType}
                label={c.instrumentType}
                value={`${c.status} · granted ${c.grantedAt.toISOString().slice(0, 10)}${
                  c.revokedAt ? ` · revoked ${c.revokedAt.toISOString().slice(0, 10)}` : ""
                } · ${c.historyCount} record(s)`}
                ok={c.status === "granted"}
              />
            ))}
          </tbody>
        </table>
        {marcusLinked.blocked ? (
          <p className="mt-2 text-red-600">Lane C join: BLOCKED — {marcusLinked.blockedReason}</p>
        ) : (
          <p className="mt-2 text-emerald-700">
            Lane C join: OK — identity {marcusLinked.identity?.displayName ?? "n/a"}, mattress{" "}
            {marcusLinked.retail?.mattressPurchases[0]?.model ?? "none"}, HST obs{" "}
            {marcusLinked.clinical?.hstObservations.length ?? 0}
          </p>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">Consent-gate probes</h2>
        <table className="w-full border-collapse">
          <tbody>
            <Row
              label="ALLOWED read (Marcus, cpap_usage_minutes, view_identified)"
              value={
                allowedProbe.blocked
                  ? `UNEXPECTEDLY BLOCKED (${allowedProbe.blockedDataClasses.join(", ")})`
                  : `${allowedProbe.data.length} rows`
              }
              ok={!allowedProbe.blocked && allowedProbe.data.length > 0}
            />
            <Row
              label={`BLOCKED read (no-Lane-C participant ${noLaneC ? noLaneC.id.slice(0, 8) : "?"}…, linkage join)`}
              value={
                blockedProbe === null
                  ? "NO PROBE PARTICIPANT FOUND"
                  : blockedProbe.blocked
                    ? `refused as expected — ${blockedProbe.blockedReason}`
                    : "UNEXPECTEDLY ALLOWED"
              }
              ok={blockedProbe?.blocked === true}
            />
          </tbody>
        </table>
      </section>

      <p className="text-xs text-gray-400">
        Foundation build (Week 1). Seed via <code>npm run seed</code>; advance the time machine via{" "}
        <code>advanceDays(n)</code> in <code>src/lib/simclock.ts</code>.
      </p>
    </main>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <tr className="border-b border-gray-200 last:border-0">
      <td className="py-1.5 pr-4 text-gray-600">{label}</td>
      <td className={`py-1.5 font-semibold ${ok === undefined ? "" : ok ? "text-emerald-700" : "text-red-600"}`}>
        {value}
      </td>
    </tr>
  );
}
