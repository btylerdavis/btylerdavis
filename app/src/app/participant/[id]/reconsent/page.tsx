import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/Card";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { dataClassConsentStates } from "@/lib/compliance/revocation";
import type { DataClass } from "@/lib/consent";
import { getParticipant, isWritableLifecycle } from "@/lib/consent/policyRepo";
import { shortId } from "@/lib/format";
import { ReconsentForm } from "./ReconsentForm";

/**
 * Participant-facing re-consent (audit F-02, level-up 2): the ONLY way to
 * enable a data class that was never in a signed scope. Lists every
 * never-authorized class with an explicit agreement + signature step; each
 * submission records a fresh SIGNED grant event, which is what extends the
 * authorized ceiling. The compliance console's Restore buttons are
 * ceiling-bounded and link here instead.
 */
export const metadata: Metadata = { title: "Expand data sharing" };

export const dynamic = "force-dynamic";

const CLASS_COPY: Record<DataClass, { label: string; description: string }> = {
  wearable_sleep: {
    label: "Wearable sleep data",
    description: "Nightly sleep, heart rate, and oxygen readings from a watch or ring.",
  },
  cpap_telemetry: {
    label: "CPAP telemetry",
    description: "Nightly usage, residual AHI and mask-leak readings from a CPAP machine.",
  },
  hst_clinical: {
    label: "Clinical home sleep test",
    description: "Home sleep test results and clinical treatment records.",
  },
  mattress_purchase: {
    label: "Mattress purchase details",
    description: "The model and firmness you buy, for mattress-and-sleep research.",
  },
  sleep_mat: {
    label: "Under-mattress sensor",
    description: "Sleep position and restlessness from a thin under-mattress sensor.",
  },
  pro_responses: {
    label: "Questionnaires",
    description: "Short check-ins like the sleep screener, plus 30- and 90-day follow-ups.",
  },
  linkage: {
    label: "Record linkage",
    description: "Joining your store-side and clinic-side records into one journey.",
  },
  registry_demographics: {
    label: "Registry demographics",
    description: "Your birth year, sex, and enrollment details in the registry record.",
  },
};

export default async function ReconsentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const participant = await getParticipant(id);
  if (!participant) notFound();

  const deleted = !isWritableLifecycle(participant);
  const states = deleted ? [] : await dataClassConsentStates(id);
  const neverAuthorized = states.filter((state) => state.state === "never_authorized");

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader variant="site" />
      <main className="flex-1 bg-pale-blue">
        <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-8 sm:px-6 sm:py-10">
          <Card className="p-6 sm:p-8">
            <p className="text-xs font-semibold tracking-[0.14em] text-sky-blue uppercase">
              Expand data sharing · re-consent
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-navy sm:text-3xl">
              Participant {shortId(id)}
            </h1>
            <p className="mt-2 text-sm text-muted">
              These data types were <span className="font-semibold">never part of a consent
              you signed</span>. Nobody can switch them on for you — not even the compliance
              console. Enabling one records a brand-new signed consent in your ledger; you can
              revoke it again at any time.{" "}
              <Link href={`/participant/${id}`} className="font-semibold underline underline-offset-4">
                Back to your record
              </Link>
            </p>
          </Card>

          {deleted ? (
            <Card className="border border-danger/30 p-6">
              <p className="text-sm font-semibold text-danger">
                This record was deleted. Deletion is terminal — no new consent can be recorded.
              </p>
            </Card>
          ) : neverAuthorized.length === 0 ? (
            <Card className="p-6">
              <p className="text-sm text-muted">
                Every data class has been covered by a signed consent at some point. Anything
                currently off can be restored from the{" "}
                <Link
                  href={`/compliance/revocation?participant=${id}`}
                  className="font-semibold underline underline-offset-4"
                >
                  revocation console
                </Link>{" "}
                — no new signature needed.
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              {neverAuthorized.map((state) => (
                <ReconsentForm
                  key={state.dataClass}
                  participantId={id}
                  dataClass={state.dataClass}
                  label={CLASS_COPY[state.dataClass].label}
                  description={CLASS_COPY[state.dataClass].description}
                />
              ))}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
