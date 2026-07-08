import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { prisma } from "@/lib/db";
import { toIsoDay } from "@/lib/format";
import { getSimClock } from "@/lib/simclock";
import { RetailFlow } from "./RetailFlow";

/**
 * The retail door (DEMO.md Act 1): the in-store QR landing at The Mattress
 * Hub. Multi-step client flow; all writes happen in server actions.
 */
export const dynamic = "force-dynamic";

export default async function RetailEnrollPage() {
  const [simDate, catalog] = await Promise.all([
    getSimClock(),
    prisma.mattressCatalog.findMany({
      orderBy: [{ brand: "asc" }, { model: "asc" }, { size: "asc" }],
    }),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader variant="retail" />
      <main className="flex-1 bg-pale-blue">
        <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
          <RetailFlow simDateIso={toIsoDay(simDate)} catalog={catalog} />
        </div>
      </main>
      <Footer />
    </div>
  );
}
