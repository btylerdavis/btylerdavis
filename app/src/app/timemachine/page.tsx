import { Card } from "@/components/Card";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { prisma } from "@/lib/db";
import { formatDay, toIsoDay } from "@/lib/format";
import { getSimClock, MAX_SIM_DAYS, simDayNumber } from "@/lib/simclock";
import { TimeMachineControl } from "./TimeMachineControl";

/**
 * The time machine (DEMO.md Act 3) — the demo's engine. The sim clock sits
 * front and center; advancing it generates every participant's newly-elapsed
 * nights through the consent ingest gates and every dashboard recomputes.
 */
export const dynamic = "force-dynamic";

export default async function TimeMachinePage() {
  const [simDate, participants, observations, nights, proResponses] = await Promise.all([
    getSimClock(),
    prisma.participant.count(),
    prisma.observation.count(),
    prisma.sleepSession.count(),
    prisma.proResponse.count(),
  ]);

  const dayNumber = simDayNumber(simDate);
  const daysRemaining = Math.max(0, MAX_SIM_DAYS - dayNumber);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader variant="site" />
      <main className="flex-1 bg-pale-blue">
        <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-8 sm:px-6 sm:py-12">
          {/* The clock */}
          <Card className="p-6 text-center sm:p-10">
            <p className="text-xs font-semibold tracking-[0.14em] text-sky-blue uppercase">
              The time machine
            </p>
            <h1 className="mt-3 text-4xl font-semibold text-navy sm:text-6xl">
              {formatDay(simDate)}
            </h1>
            <p className="mt-3 text-sm text-muted">
              Day <span className="font-semibold text-navy">{dayNumber}</span> of Marcus&apos;s
              journey · {daysRemaining.toLocaleString("en-US")} day
              {daysRemaining === 1 ? "" : "s"} left on the demo timeline (rail at day{" "}
              {MAX_SIM_DAYS})
            </p>
            <div className="mt-6">
              <TimeMachineControl
                simDateIso={toIsoDay(simDate)}
                dayNumber={dayNumber}
                daysRemaining={daysRemaining}
              />
            </div>
          </Card>

          {/* Registry totals — recompute after every advance */}
          <Card className="p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-navy">Registry right now</h2>
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Total label="Participants" value={participants} />
              <Total label="Observations" value={observations} />
              <Total label="Wearable nights" value={nights} />
              <Total label="Questionnaires" value={proResponses} />
            </dl>
          </Card>

          <Card tone="dark" className="p-5 sm:p-6">
            <p className="text-sm leading-relaxed text-white/85">
              Advancing the clock replays real ingestion: nightly CPAP telemetry, wearable
              sleep, under-mattress sensor readings and scheduled questionnaires stream in for
              ~2,000 synthetic participants — every row through the same consent gates
              production will use. About 20 seconds per 7 days generated.
            </p>
          </Card>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function Total({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-card bg-pale-blue/60 px-4 py-3">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="mt-0.5 text-xl font-semibold text-navy">{value.toLocaleString("en-US")}</dd>
    </div>
  );
}
