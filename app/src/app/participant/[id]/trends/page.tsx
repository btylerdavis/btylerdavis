import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/Card";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { TimeMachineWidget } from "@/components/TimeMachineWidget";
import { ChartCard } from "@/components/charts/ChartCard";
import { eventLabel, EVENT_SHORT_LABELS } from "@/components/charts/eventStyles";
import {
  CpapAdherenceChart,
  HrHrvChart,
  ProScoresChart,
  SleepChart,
  SpO2Chart,
  SupineChart,
  type NightValue,
} from "@/components/charts/TrendCharts";
import { TreatmentTimeline } from "@/components/charts/TreatmentTimeline";
import type { ChartEvent } from "@/components/charts/ChartKit";
import {
  getLinkedProfile,
  getObservations,
  getProResponses,
  getTreatmentEvents,
  grantSetHas,
  loadGrants,
  sourceToDataClass,
  type DataClass,
} from "@/lib/consent";
import { GuardrailBadge } from "@/components/RecommendationCard";
import { getParticipant } from "@/lib/consent/policyRepo";
import { formatDay, shortId, toIsoDay } from "@/lib/format";
import { loadRecommendations } from "@/lib/recommendations/queries";
import { getSimClock, MAX_SIM_DAYS, simDayNumber } from "@/lib/simclock";
import { addDays } from "@/lib/synthetic/profiles";

/**
 * Participant trends — the "three views of Marcus" centerpiece (DEMO.md
 * Act 4). Server component; every read goes through the consent-gated
 * readers with use "view_identified" (grants preloaded once). Sections whose
 * data class lacks a grant render the same red-chip blocked pattern as the
 * snapshot page — consent visibility is a feature.
 */
export const metadata: Metadata = { title: "Sleep trends" };

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 90;

const CLASS_LABELS: Record<DataClass, string> = {
  wearable_sleep: "Wearable sleep",
  cpap_telemetry: "CPAP telemetry",
  hst_clinical: "Clinical records",
  mattress_purchase: "Mattress purchase",
  sleep_mat: "Under-mattress sensor",
  pro_responses: "Questionnaires",
  linkage: "Record linkage",
  registry_demographics: "Registry demographics",
};

const ARM_BADGES: Record<string, string> = {
  cpap_setup: "CPAP",
  appliance_delivery: "Oral appliance",
  mattress_delivery: "New mattress",
};

export default async function ParticipantTrendsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const participant = await getParticipant(id);
  if (!participant) notFound();

  const [simDate, grants] = await Promise.all([getSimClock(), loadGrants(id)]);
  const windowFrom = addDays(simDate, -(WINDOW_DAYS - 1));

  const [observations, pros, events, linked, recommendations] = await Promise.all([
    getObservations(id, { use: "view_identified", grants, from: windowFrom, to: simDate }),
    getProResponses(id, { use: "view_identified", grants, instruments: ["ESS", "ISI"] }),
    getTreatmentEvents(id, { use: "view_identified", grants }),
    getLinkedProfile(id, { use: "view_identified", grants }),
    loadRecommendations(id, { grants }),
  ]);

  // --- day scaffold: every night in the window, missing nights stay null ---
  const days: string[] = [];
  for (let d = windowFrom; d <= simDate; d = addDays(d, 1)) days.push(toIsoDay(d));

  const buckets = new Map<string, number[]>(); // "concept|day" -> values
  const gapDays = new Set<string>();
  for (const obs of observations.data) {
    const klass = sourceToDataClass(obs.source);
    const day = toIsoDay(obs.effectiveDate);
    if (obs.concept === "therapy_gap" && klass === "cpap_telemetry") {
      gapDays.add(day);
      continue;
    }
    if (obs.valueNumeric === null) continue;
    // Wearable-class series must not absorb same-named HST session values.
    const key = `${klass}:${obs.concept}|${day}`;
    const list = buckets.get(key) ?? [];
    list.push(obs.valueNumeric);
    buckets.set(key, list);
  }

  const series = (
    klass: DataClass,
    concept: string,
    transform: (value: number) => number = (value) => value
  ): NightValue[] =>
    days.map((day) => {
      const values = buckets.get(`${klass}:${concept}|${day}`);
      if (!values || values.length === 0) return { day, value: null };
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      return { day, value: Math.round(transform(mean) * 10) / 10 };
    });

  const duration = series("wearable_sleep", "sleep_duration_min", (minutes) => minutes / 60);
  const efficiency = series("wearable_sleep", "sleep_efficiency");
  const restingHr = series("wearable_sleep", "resting_hr");
  const hrv = series("wearable_sleep", "hrv_sdnn");
  const spo2 = series("wearable_sleep", "spo2_mean");
  const supine = series("sleep_mat", "supine_time_pct");
  const usage = series("cpap_telemetry", "cpap_usage_minutes", (minutes) => minutes / 60);
  const cpapNights = days.map((day, index) => ({
    day,
    usageH: usage[index].value,
    gap: gapDays.has(day),
  }));

  const hasValues = (points: NightValue[]) => points.some((point) => point.value !== null);

  // --- consent gate state per section ---------------------------------------
  const canView = (klass: DataClass) => grantSetHas(grants, klass, "view_identified");
  const wearableBlocked = !canView("wearable_sleep");
  const cpapBlocked = !canView("cpap_telemetry");
  const matBlocked = !canView("sleep_mat");
  const prosBlocked = pros.blocked;
  const eventsBlocked = events.blocked;

  // --- treatment timeline + shared chart reference lines --------------------
  const timelineEvents = events.data.map((event) => ({
    day: toIsoDay(event.eventDate),
    type: event.type,
    label: eventLabel(event.type),
  }));
  const chartEvents: ChartEvent[] = timelineEvents.map((event) => ({
    ...event,
    label: EVENT_SHORT_LABELS[event.type] ?? event.label,
  }));
  const armBadges = [
    ...new Set(
      events.data
        .filter((event) => ARM_BADGES[event.type])
        .map((event) => ARM_BADGES[event.type])
    ),
  ];

  const hasCpapStory =
    events.data.some((event) => event.type === "cpap_setup") || hasValues(usage) || gapDays.size > 0;

  // --- PRO buckets at baseline / day 30 / day 90 ----------------------------
  const proPoints = buildProPoints(
    pros.data.map((pro) => ({
      instrument: pro.instrument,
      administeredAt: pro.administeredAt,
      totalScore: pro.totalScore,
    })),
    participant.createdAt
  );

  // --- identity (Lane C gated, identified tier only) -------------------------
  const displayName = !linked.blocked ? (linked.identity?.displayName ?? null) : null;
  const mattress = !linked.blocked ? (linked.retail?.mattressPurchases[0] ?? null) : null;

  const dayNumber = simDayNumber(simDate);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader variant="site" />
      <main className="flex-1 bg-cream">
        <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-8 sm:px-6 sm:py-10">
          {/* Header */}
          <Card className="p-6 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">
                  Sleep trends · last {WINDOW_DAYS} nights
                </p>
                <h1 className="mt-2 text-2xl font-semibold text-navy sm:text-3xl">
                  {displayName ?? `Participant ${shortId(id)}`}
                </h1>
                <p className="mt-2 text-sm text-graphite">
                  {displayName
                    ? "Identified view via Lane C linkage"
                    : "Pseudonymous — identity stays sealed without a Lane C grant"}{" "}
                  {grantSetHas(grants, "registry_demographics", "view_identified") ? (
                    <>
                      {" "}· enrolled through the{" "}
                      <span className="font-semibold text-navy">
                        {participant.enrollmentTouchpoint}
                      </span>{" "}
                      door {formatDay(participant.createdAt)}
                    </>
                  ) : (
                    <> · registry demographics sealed by consent</>
                  )}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {armBadges.map((badge) => (
                    <span
                      key={badge}
                      className="rounded-full bg-cream px-2.5 py-0.5 text-xs font-semibold text-navy"
                    >
                      {badge}
                    </span>
                  ))}
                  {eventsBlocked && (
                    <span className="rounded-full border border-danger/40 bg-danger/5 px-2.5 py-0.5 text-xs font-semibold text-danger">
                      Blocked: {CLASS_LABELS.hst_clinical}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-start gap-2 sm:items-end">
                <TimeMachineWidget
                  simDateIso={toIsoDay(simDate)}
                  dayNumber={dayNumber}
                  daysRemaining={Math.max(0, MAX_SIM_DAYS - dayNumber)}
                />
                <Link
                  href={`/participant/${id}`}
                  className="text-sm font-semibold text-brand underline-offset-4 hover:underline"
                >
                  View snapshot →
                </Link>
              </div>
            </div>
          </Card>

          {/* AI recommendations preview (Act 7) — identified-tier, guardrail-labeled */}
          {!recommendations.blocked && recommendations.recommendations.length > 0 && (
            <Card className="p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-navy">
                    {recommendations.recommendations.length === 1
                      ? "1 recommendation for you"
                      : `${recommendations.recommendations.length} recommendations for you`}
                  </h2>
                  <ul className="mt-2 space-y-1.5">
                    {recommendations.recommendations.map((rec) => (
                      <li key={rec.ruleId} className="flex flex-wrap items-center gap-2 text-sm">
                        <GuardrailBadge guardrail={rec.guardrail} />
                        <span className="text-ink">{rec.title}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <Link
                  href={`/participant/${id}/recommendations`}
                  className="text-sm font-semibold text-brand underline-offset-4 hover:underline"
                >
                  See why →
                </Link>
              </div>
              <p className="mt-3 border-t border-hairline pt-2 text-[11px] text-graphite">
                Wellness guidance, not medical advice — runs on your identified data under your
                consent (SPEC §10.2)
              </p>
            </Card>
          )}

          {/* Treatment timeline — the before/after anchor */}
          <ChartCard
            title="Treatment timeline"
            subtitle="every chart below shares these markers"
            blockedLabel={eventsBlocked ? CLASS_LABELS.hst_clinical : null}
            isEmpty={timelineEvents.length === 0}
            emptyMessage="No treatment events yet — they appear here the moment a coach records one."
          >
            <TreatmentTimeline
              startIso={toIsoDay(participant.createdAt)}
              endIso={toIsoDay(simDate)}
              events={timelineEvents}
            />
          </ChartCard>

          {/* Sleep */}
          <ChartCard
            title="Sleep"
            subtitle="nightly duration and efficiency from the connected wearable"
            blockedLabel={wearableBlocked ? CLASS_LABELS.wearable_sleep : null}
            isEmpty={!hasValues(duration) && !hasValues(efficiency)}
          >
            <SleepChart duration={duration} efficiency={efficiency} events={chartEvents} />
          </ChartCard>

          {/* CPAP adherence */}
          {(hasCpapStory || cpapBlocked) && (
            <ChartCard
              title="CPAP adherence"
              subtitle="hollow red columns are therapy-gap nights — abandonment is an outcome, not missing data"
              blockedLabel={cpapBlocked ? CLASS_LABELS.cpap_telemetry : null}
              isEmpty={!hasValues(usage) && gapDays.size === 0}
              emptyMessage="CPAP is set up, but the first night of telemetry hasn't arrived yet."
            >
              <CpapAdherenceChart nights={cpapNights} events={chartEvents} />
            </ChartCard>
          )}

          {/* Supine time — flagship signal */}
          {(hasValues(supine) || matBlocked) && (
            <ChartCard
              title="Time sleeping on the back"
              subtitle={
                mattress
                  ? `under-mattress sensor · ${mattress.brand} ${mattress.model} delivered ${
                      mattress.deliveryDate ? formatDay(mattress.deliveryDate) : "soon"
                    }`
                  : "under-mattress sensor, nightly supine share"
              }
              blockedLabel={matBlocked ? CLASS_LABELS.sleep_mat : null}
              isEmpty={!hasValues(supine)}
            >
              <SupineChart points={supine} events={chartEvents} />
            </ChartCard>
          )}

          {/* Resting HR + HRV */}
          <ChartCard
            title="Resting heart rate & HRV"
            subtitle="overnight recovery markers from the wearable"
            blockedLabel={wearableBlocked ? CLASS_LABELS.wearable_sleep : null}
            isEmpty={!hasValues(restingHr) && !hasValues(hrv)}
          >
            <HrHrvChart restingHr={restingHr} hrv={hrv} events={chartEvents} />
          </ChartCard>

          {/* SpO2 */}
          <ChartCard
            title="Overnight oxygen"
            subtitle="mean SpO2 per night"
            blockedLabel={wearableBlocked ? CLASS_LABELS.wearable_sleep : null}
            isEmpty={!hasValues(spo2)}
          >
            <SpO2Chart points={spo2} events={chartEvents} />
          </ChartCard>

          {/* PRO scores */}
          <ChartCard
            title="How the days feel"
            subtitle="ESS & ISI at baseline / day 30 / day 90 — lower is better"
            blockedLabel={prosBlocked ? CLASS_LABELS.pro_responses : null}
            isEmpty={proPoints.every((point) => point.ess === null && point.isi === null)}
            emptyMessage="Questionnaires are scheduled for day 30 and day 90 — advance the clock to collect them."
          >
            <ProScoresChart points={proPoints} />
          </ChartCard>

          <p className="pb-2 text-center text-xs text-graphite">
            As of {formatDay(simDate)} · every series read through the consent gate ·{" "}
            <Link href={`/participant/${id}`} className="underline underline-offset-4">
              participant snapshot
            </Link>
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}

/** Bucket ESS/ISI totals to baseline / day 30 / day 90 (nearest, ±10 days). */
function buildProPoints(
  responses: { instrument: string; administeredAt: Date; totalScore: number }[],
  enrollmentDate: Date
): { point: string; ess: number | null; isi: number | null }[] {
  const buckets: { offset: number; point: string; ess: number | null; isi: number | null }[] = [
    { offset: 0, point: "Baseline", ess: null, isi: null },
    { offset: 30, point: "Day 30", ess: null, isi: null },
    { offset: 90, point: "Day 90", ess: null, isi: null },
  ];
  for (const response of responses) {
    const offsetDays = Math.round(
      (response.administeredAt.getTime() - enrollmentDate.getTime()) / 86_400_000
    );
    let best: (typeof buckets)[number] | null = null;
    for (const bucket of buckets) {
      if (Math.abs(offsetDays - bucket.offset) <= 10) {
        if (!best || Math.abs(offsetDays - bucket.offset) < Math.abs(offsetDays - best.offset)) {
          best = bucket;
        }
      }
    }
    if (!best) continue;
    if (response.instrument === "ESS") best.ess = response.totalScore;
    if (response.instrument === "ISI") best.isi = response.totalScore;
  }
  return buckets.map(({ point, ess, isi }) => ({ point, ess, isi }));
}
