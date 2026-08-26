import type { Metadata } from "next";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { toIsoDay } from "@/lib/format";
import { getSimClock } from "@/lib/simclock";
import { ClinicFlow } from "./ClinicFlow";

/**
 * The clinic door (DEMO.md Act 2): the sleep-coach console. Coach-operated
 * enrollment — combined ICF + HIPAA (Lane A), HST intake with positional-OSA
 * flagging, CPAP setup, and the Lane C linkage beat.
 */
export const metadata: Metadata = { title: "Clinic enrollment" };

export const dynamic = "force-dynamic";

export default async function ClinicEnrollPage() {
  const simDate = await getSimClock();

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader variant="coach" />
      <main className="flex-1 bg-cream">
        <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
          <ClinicFlow simDateIso={toIsoDay(simDate)} />
        </div>
      </main>
      <Footer />
    </div>
  );
}
