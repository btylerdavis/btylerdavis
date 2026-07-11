import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClasses } from "@/components/Button";
import { Card } from "@/components/Card";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { getParticipantDeletionState } from "@/lib/compliance/deletion";
import {
  getConsentStates,
  getDevices,
  getLinkedProfile,
  getMattressPurchases,
  getObservations,
  getProResponses,
  grantSetHas,
  loadGrants,
  type DataClass,
} from "@/lib/consent";
import { getParticipant } from "@/lib/consent/policyRepo";
import { formatDay, shortId } from "@/lib/format";
import { getSimClock } from "@/lib/simclock";
import { fileDeletionRequest } from "./actions";

/**
 * Participant snapshot — minimal read-only view (foundation for week 2's
 * full participant view). Every data read goes through the consent-gated
 * readers with use "view_identified"; blocked classes are shown plainly.
 * The display name appears ONLY when the identified-tier linkage join
 * (getLinkedProfile) permits it — otherwise the page shows the pseudonymous
 * participant id, demonstrating the identity split.
 */
export const metadata: Metadata = { title: "Participant snapshot" };

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
  registry_demographics: "Registry demographics",
};

export default async function ParticipantPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const participant = await getParticipant(id);
  if (!participant) notFound();

  const [simDate, consents, grants, deletionState] = await Promise.all([
    getSimClock(),
    getConsentStates(id),
    loadGrants(id),
    getParticipantDeletionState(id),
  ]);

  // Tombstone: an executed deletion removed every identified-tier row; only
  // the append-only consent ledger and this participant row survive.
  if (participant.deletedAt !== null) {
    return (
      <div className="flex min-h-screen flex-col">
        <SiteHeader variant="site" />
        <main className="flex-1 bg-pale-blue">
          <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-8 sm:px-6 sm:py-10">
            <Card className="border border-danger/30 p-6 sm:p-8">
              <p className="text-xs font-semibold tracking-[0.14em] text-danger uppercase">
                Record deleted
              </p>
              <h1 className="mt-2 text-2xl font-semibold text-navy sm:text-3xl">
                Participant {shortId(id)}
              </h1>
              <p className="mt-2 text-sm text-muted">
                A deletion request was executed on {formatDay(participant.deletedAt)}: every
                identified-tier row was hard-deleted and all consents were revoked. This
                tombstone row and the append-only consent ledger below are all that remain —
                already-published de-identified mart releases are immutable and cannot be
                recalled (SPEC §9.4).
              </p>
              {deletionState.executed && (
                <Link
                  href={`/compliance/deletions/${deletionState.executed.id}/certificate`}
                  className={`${buttonClasses("outline", "sm")} mt-4`}
                >
                  View the deletion certificate
                </Link>
              )}
            </Card>

            <Card className="p-6">
              <h2 className="text-lg font-semibold text-navy">
                Consent ledger (retained, append-only)
              </h2>
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
                      <span className="rounded-full bg-danger/10 px-2.5 py-0.5 text-xs font-semibold text-danger">
                        {consent.status}
                        {consent.revokedAt ? ` · ${formatDay(consent.revokedAt)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-muted">
                The ledger is a legal record of what was consented, revoked and deleted — it is
                never deleted itself.
              </p>
            </Card>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const purchasesAllowed = grantSetHas(grants, "mattress_purchase", "view_identified");
  const demographicsAllowed = grantSetHas(grants, "registry_demographics", "view_identified");
  const [devices, purchaseRead, observations, pros, linked] = await Promise.all([
    // Consent-gated device read: revoked classes drop out and surface as
    // blocked chips exactly like observations/PROs.
    getDevices(id, { use: "view_identified", grants }),
    // Consent-gated purchase read (mattress_purchase class).
    getMattressPurchases(id, { use: "view_identified", grants }),
    getObservations(id, { use: "view_identified", grants }),
    getProResponses(id, { use: "view_identified", grants }),
    getLinkedProfile(id, { use: "view_identified", grants }),
  ]);
  const purchases = purchaseRead.data;

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
      ...devices.blockedDataClasses,
      ...(purchasesAllowed ? [] : (["mattress_purchase"] as DataClass[])),
      ...(demographicsAllowed ? [] : (["registry_demographics"] as DataClass[])),
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
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="text-xs font-semibold tracking-[0.14em] text-sky-blue uppercase">
                Participant snapshot
              </p>
              <Link
                href={`/participant/${id}/trends`}
                className="text-sm font-semibold text-brand-blue underline-offset-4 hover:underline"
              >
                View trends →
              </Link>
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-navy sm:text-3xl">
              {displayName ?? `Participant ${shortId(id)}`}
            </h1>
            <p className="mt-2 text-sm text-muted">
              {displayName ? (
                <>Identified view via Lane C linkage · </>
              ) : (
                <>Pseudonymous — identity stays sealed without a Lane C grant · </>
              )}
              {demographicsAllowed ? (
                <>
                  enrolled through the{" "}
                  <span className="font-semibold text-navy">
                    {participant.enrollmentTouchpoint}
                  </span>{" "}
                  door · born {participant.yearOfBirth} ·{" "}
                </>
              ) : (
                <>registry demographics sealed by consent · </>
              )}
              as of {formatDay(simDate)}
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
            {devices.data.length === 0 ? (
              devices.blocked ? (
                <p className="mt-2 text-sm font-semibold text-danger">
                  Blocked — no current view consent covers device registrations.
                </p>
              ) : (
                <p className="mt-2 text-sm text-muted">No devices connected yet.</p>
              )
            ) : (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {devices.data.map((device) => (
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

          {/* Data rights: the deletion request (SPEC §9.4) */}
          <Card className="border border-danger/20 p-6">
            <h2 className="text-lg font-semibold text-navy">Your data rights</h2>
            <p className="mt-2 text-sm text-muted">
              You can withdraw at any time, and you can request deletion — which is stronger:
              collection stops immediately and your identified data is deleted, not just sealed.
              The consent ledger is retained as a legal record, and research releases already
              published in de-identified form cannot be recalled — you were told this up front,
              in plain language (SPEC §9.4).
            </p>
            {deletionState.executing ? (
              <div className="mt-4 rounded-card bg-warning/10 px-4 py-3 text-sm">
                <p className="font-semibold text-navy">
                  Deletion requested on {formatDay(deletionState.executing.requestedAt)} — being
                  executed right now. This page will show the tombstone once it completes.
                </p>
              </div>
            ) : deletionState.pending ? (
              <div className="mt-4 rounded-card bg-warning/10 px-4 py-3 text-sm">
                <p className="font-semibold text-navy">
                  Deletion requested on {formatDay(deletionState.pending.requestedAt)} — pending
                  compliance review.
                </p>
                {deletionState.pending.note && (
                  <p className="mt-1 text-xs text-muted">
                    Your note: {deletionState.pending.note}
                  </p>
                )}
              </div>
            ) : (
              <form action={fileDeletionRequest} className="mt-4 space-y-3">
                <input type="hidden" name="participantId" value={id} />
                <label className="block text-sm">
                  <span className="font-semibold text-navy">Note</span>
                  <span className="text-muted"> · optional</span>
                  <textarea
                    name="note"
                    rows={2}
                    maxLength={500}
                    placeholder="Anything you want the compliance team to know"
                    className="mt-1 w-full rounded-card border border-pale-blue px-3 py-2 text-sm focus:ring-2 focus:ring-brand-blue focus:outline-none"
                  />
                </label>
                <button type="submit" className={buttonClasses("danger", "sm")}>
                  Request deletion
                </button>
              </form>
            )}
          </Card>
        </div>
      </main>
      <Footer />
    </div>
  );
}
