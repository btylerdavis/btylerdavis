import { notFound } from "next/navigation";
import { Card } from "@/components/Card";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import {
  getConsentStates,
  getLinkedProfile,
  getObservations,
  getProResponses,
  grantSetHas,
  loadGrants,
  type DataClass,
} from "@/lib/consent";
import { prisma } from "@/lib/db";
import { formatDay, shortId } from "@/lib/format";
import { getSimClock } from "@/lib/simclock";

/**
 * Participant snapshot — minimal read-only view (foundation for week 2's
 * full participant view). Every data read goes through the consent-gated
 * readers with use "view_identified"; blocked classes are shown plainly.
 * The display name appears ONLY when the identified-tier linkage join
 * (getLinkedProfile) permits it — otherwise the page shows the pseudonymous
 * participant id, demonstrating the identity split.
 */
export const dynamic = "force-dynamic";

const LANE_LABELS: Record<string, string> = {
  LANE_A: "Lane A — clinical consent + HIPAA authorization",
  LANE_B: "Lane B — consumer consent",
  LANE_C: "Lane C — record linkage",
};

const CLASS_LABELS: Record<DataClass, string> = {
  wearable_sleep: "Wearable sleep",
  cpap_telemetry: "CPAP telemetry",
  hst_clinical: "Home sleep test",
  mattress_purchase: "Mattress purchase",
  sleep_mat: "Under-mattress sensor",
  pro_responses: "Questionnaires",
  linkage: "Record linkage",
};

export default async function ParticipantPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const participant = await prisma.participant.findUnique({ where: { id } });
  if (!participant) notFound();

  const [simDate, consents, devices, grants] = await Promise.all([
    getSimClock(),
    getConsentStates(id),
    prisma.device.findMany({ where: { participantId: id }, orderBy: { assignedAt: "asc" } }),
    loadGrants(id),
  ]);

  const purchasesAllowed = grantSetHas(grants, "mattress_purchase", "view_identified");
  const [purchases, observations, pros, linked] = await Promise.all([
    purchasesAllowed
      ? prisma.mattressPurchase.findMany({
          where: { participantId: id },
          include: { catalogItem: true },
          orderBy: { purchaseDate: "asc" },
        })
      : Promise.resolve([]),
    getObservations(id, { use: "view_identified", grants }),
    getProResponses(id, { use: "view_identified", grants }),
    getLinkedProfile(id, { use: "view_identified", grants }),
  ]);

  // Summarize observations per concept: count, latest value, date range.
  const byConcept = new Map<
    string,
    { count: number; latest: { value: number | null; unit: string | null; date: Date }; first: Date }
  >();
  for (const obs of observations.data) {
    const entry = byConcept.get(obs.concept);
    if (!entry) {
      byConcept.set(obs.concept, {
        count: 1,
        latest: { value: obs.valueNumeric, unit: obs.unit, date: obs.effectiveDate },
        first: obs.effectiveDate,
      });
    } else {
      entry.count += 1;
      if (obs.effectiveDate >= entry.latest.date) {
        entry.latest = { value: obs.valueNumeric, unit: obs.unit, date: obs.effectiveDate };
      }
      if (obs.effectiveDate < entry.first) entry.first = obs.effectiveDate;
    }
  }
  const conceptRows = [...byConcept.entries()].sort(([a], [b]) => a.localeCompare(b));

  // Latest PRO per instrument.
  const latestPro = new Map<string, (typeof pros.data)[number]>();
  for (const pro of pros.data) latestPro.set(pro.instrument, pro);

  const blockedClasses = [
    ...new Set([
      ...observations.blockedDataClasses,
      ...pros.blockedDataClasses,
      ...(purchasesAllowed ? [] : (["mattress_purchase"] as DataClass[])),
    ]),
  ];

  const displayName = !linked.blocked ? linked.identity?.displayName : null;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader variant="site" />
      <main className="flex-1 bg-pale-blue">
        <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-8 sm:px-6 sm:py-10">
          {/* Header */}
          <Card className="p-6 sm:p-8">
            <p className="text-xs font-semibold tracking-[0.14em] text-sky-blue uppercase">
              Participant snapshot
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-navy sm:text-3xl">
              {displayName ?? `Participant ${shortId(id)}`}
            </h1>
            <p className="mt-2 text-sm text-muted">
              {displayName ? (
                <>Identified view via Lane C linkage · </>
              ) : (
                <>Pseudonymous — identity stays sealed without a Lane C grant · </>
              )}
              enrolled through the{" "}
              <span className="font-semibold text-navy">
                {participant.enrollmentTouchpoint}
              </span>{" "}
              door · born {participant.yearOfBirth} · as of{" "}
              {formatDay(simDate)}
            </p>
            {blockedClasses.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {blockedClasses.map((dataClass) => (
                  <span
                    key={dataClass}
                    className="rounded-full border border-danger/40 bg-danger/5 px-2.5 py-0.5 text-xs font-semibold text-danger"
                  >
                    Blocked: {CLASS_LABELS[dataClass]}
                  </span>
                ))}
              </div>
            )}
          </Card>

          {/* Consent states */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-navy">Consent</h2>
            {consents.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No consent records.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {consents.map((consent) => (
                  <li
                    key={consent.instrumentType}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-pale-blue/60 px-4 py-2.5 text-sm"
                  >
                    <span className="font-medium text-body">
                      {LANE_LABELS[consent.instrumentType] ?? consent.instrumentType}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        consent.status === "granted"
                          ? "bg-success/10 text-success"
                          : "bg-danger/10 text-danger"
                      }`}
                    >
                      {consent.status} · {formatDay(consent.grantedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Devices */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-navy">Devices</h2>
            {devices.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No devices connected yet.</p>
            ) : (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {devices.map((device) => (
                  <li key={device.id} className="rounded-card bg-pale-blue/60 px-4 py-2.5 text-sm">
                    <p className="font-semibold text-navy">
                      {device.make} {device.model}
                    </p>
                    <p className="text-xs text-muted">
                      {device.deviceClass.replace(/_/g, " ")} · since{" "}
                      {formatDay(device.assignedAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Purchases */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-navy">Mattress purchases</h2>
            {!purchasesAllowed ? (
              <p className="mt-2 text-sm font-semibold text-danger">
                Blocked — no current view consent for mattress purchase details.
              </p>
            ) : purchases.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No purchases on file.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {purchases.map((purchase) => (
                  <li key={purchase.id} className="rounded-card bg-pale-blue/60 px-4 py-2.5 text-sm">
                    <p className="font-semibold text-navy">
                      {purchase.catalogItem.brand} {purchase.catalogItem.model} (
                      {purchase.catalogItem.size})
                    </p>
                    <p className="text-xs text-muted">
                      Firmness {purchase.catalogItem.firmnessRating}/10 · purchased{" "}
                      {formatDay(purchase.purchaseDate)}
                      {purchase.deliveryDate &&
                        ` · delivery ${formatDay(purchase.deliveryDate)}`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Observations summary */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-navy">Nightly data</h2>
            {conceptRows.length === 0 ? (
              <p className="mt-2 text-sm text-muted">
                {observations.blocked
                  ? "Some data classes are blocked by consent; nothing viewable yet."
                  : "No observations yet — data accrues as the time machine advances."}
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm">
                  <thead>
                    <tr className="border-b border-pale-blue text-left text-xs tracking-wide text-muted uppercase">
                      <th className="py-2 pr-4 font-semibold">Concept</th>
                      <th className="py-2 pr-4 font-semibold">Nights</th>
                      <th className="py-2 pr-4 font-semibold">Latest</th>
                      <th className="py-2 font-semibold">Range</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conceptRows.map(([concept, summary]) => (
                      <tr key={concept} className="border-b border-pale-blue/60 last:border-0">
                        <td className="py-2 pr-4 font-medium text-body">
                          {concept.replace(/_/g, " ")}
                        </td>
                        <td className="py-2 pr-4 text-muted">{summary.count}</td>
                        <td className="py-2 pr-4 font-semibold text-navy">
                          {summary.latest.value ?? "—"}
                          {summary.latest.unit ? ` ${summary.latest.unit}` : ""}
                        </td>
                        <td className="py-2 text-xs text-muted">
                          {formatDay(summary.first)} – {formatDay(summary.latest.date)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Questionnaires */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-navy">Questionnaires</h2>
            {pros.blocked ? (
              <p className="mt-2 text-sm font-semibold text-danger">
                Blocked — no current view consent for questionnaires.
              </p>
            ) : latestPro.size === 0 ? (
              <p className="mt-2 text-sm text-muted">No responses yet.</p>
            ) : (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {[...latestPro.values()].map((pro) => (
                  <li key={pro.instrument} className="rounded-card bg-pale-blue/60 px-4 py-2.5 text-sm">
                    <p className="font-semibold text-navy">
                      {pro.instrument.replace(/_/g, "-")}:{" "}
                      <span className="text-brand-blue">{pro.totalScore}</span>
                    </p>
                    <p className="text-xs text-muted">
                      latest {formatDay(pro.administeredAt)} ·{" "}
                      {pros.data.filter((p) => p.instrument === pro.instrument).length}{" "}
                      response(s)
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </main>
      <Footer />
    </div>
  );
}
