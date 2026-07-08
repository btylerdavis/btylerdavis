"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { formatDay } from "@/lib/format";
import { chunkAdvance } from "@/lib/timemachineOptions";
import { advanceSim, type AdvanceOk } from "./actions";

/**
 * The time machine console (DEMO.md Act 3). Long jumps run as a sequence of
 * ≤7-day server-action chunks so the room sees real progress — advanced
 * days, a moving date — instead of a spinner that may run for minutes.
 * Each chunk calls refresh() server-side, so the page's big date (and every
 * other open dashboard) walks forward chunk by chunk.
 */

interface RunState {
  totalDays: number;
  daysDone: number;
  currentDateIso: string;
}

interface Delta {
  fromIso: string;
  toIso: string;
  daysAdvanced: number;
  nightsGenerated: number;
  observationsAdded: number;
  proResponsesAdded: number;
  participantsActiveLast7: number;
  participantsConsentLimited: number;
  seconds: number;
}

function accumulate(prev: Delta | null, chunk: AdvanceOk): Delta {
  return {
    fromIso: prev?.fromIso ?? chunk.fromIso,
    toIso: chunk.toIso,
    daysAdvanced: (prev?.daysAdvanced ?? 0) + chunk.daysAdvanced,
    nightsGenerated: (prev?.nightsGenerated ?? 0) + chunk.nightsGenerated,
    observationsAdded: (prev?.observationsAdded ?? 0) + chunk.observationsAdded,
    proResponsesAdded: (prev?.proResponsesAdded ?? 0) + chunk.proResponsesAdded,
    participantsActiveLast7: chunk.participantsActiveLast7,
    participantsConsentLimited: chunk.participantsConsentLimited,
    seconds: (prev?.seconds ?? 0) + chunk.tookMs / 1000,
  };
}

export function TimeMachineControl({
  simDateIso,
  dayNumber,
  daysRemaining,
}: {
  simDateIso: string;
  dayNumber: number;
  daysRemaining: number;
}) {
  const [run, setRun] = useState<RunState | null>(null);
  const [delta, setDelta] = useState<Delta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);

  const daysToMarcusDay90 = Math.max(0, 90 - dayNumber);

  const advance = async (totalDays: number) => {
    if (runningRef.current) return;
    runningRef.current = true;
    setError(null);
    setDelta(null);
    setRun({ totalDays, daysDone: 0, currentDateIso: simDateIso });

    let accumulated: Delta | null = null;
    try {
      let done = 0;
      for (const chunk of chunkAdvance(totalDays)) {
        const outcome = await advanceSim(chunk);
        if (!outcome.ok) {
          setError(outcome.error);
          return;
        }
        done += outcome.daysAdvanced;
        accumulated = accumulate(accumulated, outcome);
        setRun({ totalDays, daysDone: done, currentDateIso: outcome.toIso });
      }
      setDelta(accumulated);
    } catch {
      setError("Something went wrong while generating — the clock stopped safely. Try again.");
    } finally {
      runningRef.current = false;
      setRun(null);
    }
  };

  const running = run !== null;
  const jumpDisabled = running || daysToMarcusDay90 === 0;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
        {[1, 7, 30].map((days) => (
          <Button
            key={days}
            onClick={() => advance(days)}
            disabled={running || days > daysRemaining}
            title={
              days > daysRemaining
                ? `Only ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} left before the day-400 rail`
                : undefined
            }
          >
            +{days} day{days === 1 ? "" : "s"}
          </Button>
        ))}
        <Button
          variant="purple"
          onClick={() => advance(daysToMarcusDay90)}
          disabled={jumpDisabled}
          title={
            daysToMarcusDay90 === 0
              ? `Marcus is on day ${dayNumber} — already at or past day 90`
              : undefined
          }
        >
          Jump to day 90 of Marcus&apos;s journey
        </Button>
      </div>
      {daysToMarcusDay90 === 0 && (
        <p className="text-center text-xs text-muted">
          Marcus is on day {dayNumber} of his journey — day 90 is already behind him.
        </p>
      )}

      {/* Progress */}
      {running && (
        <Card tone="wash" className="p-5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold text-navy">
              Generating night data — {run.daysDone} of {run.totalDays} days
            </p>
            <p className="text-xs text-muted">
              ~2,000 participants per night · clock at {formatDay(run.currentDateIso)}
            </p>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
            <div
              className="h-full rounded-full bg-brand-blue transition-all duration-500"
              style={{ width: `${Math.max(4, (run.daysDone / run.totalDays) * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted">
            Every write passes the consent ingest gate — a revoked participant accrues nothing.
          </p>
        </Card>
      )}

      {/* Error */}
      {error && (
        <Card tone="wash" className="border border-danger/30 p-4">
          <p className="text-sm font-semibold text-danger">{error}</p>
        </Card>
      )}

      {/* Delta card */}
      {delta && !running && (
        <Card className="p-5 sm:p-6">
          <p className="text-xs font-semibold tracking-[0.14em] text-sky-blue uppercase">
            What just happened
          </p>
          <p className="mt-1 text-sm text-body">
            Advanced <span className="font-semibold text-navy">{delta.daysAdvanced} days</span>{" "}
            ({formatDay(delta.fromIso)} → {formatDay(delta.toIso)}) in {delta.seconds.toFixed(1)}s.
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <DeltaStat label="Nights generated" value={delta.nightsGenerated} />
            <DeltaStat label="Observations added" value={delta.observationsAdded} />
            <DeltaStat label="Active last 7 days" value={delta.participantsActiveLast7} />
            <DeltaStat
              label="Consent-limited"
              value={delta.participantsConsentLimited}
              hint="participants with classes dropped at the ingest gate"
            />
          </dl>
        </Card>
      )}
    </div>
  );
}

function DeltaStat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-card bg-pale-blue/60 px-4 py-3" title={hint}>
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="mt-0.5 text-xl font-semibold text-navy">{value.toLocaleString("en-US")}</dd>
    </div>
  );
}
