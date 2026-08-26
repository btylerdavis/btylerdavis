"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { advanceSim } from "@/app/timemachine/actions";
import { Button } from "@/components/Button";
import { formatDay } from "@/lib/format";
import { ADVANCE_CHUNK_DAYS } from "@/lib/timemachineOptions";

/**
 * Compact sim-clock widget for page headers: current sim date + a quick
 * +7 days. The full console lives at /timemachine. The advance action calls
 * refresh(), so the hosting server page re-renders with the new nights.
 */
export function TimeMachineWidget({
  simDateIso,
  dayNumber,
  daysRemaining,
}: {
  simDateIso: string;
  dayNumber: number;
  daysRemaining: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const canAdvance = daysRemaining >= ADVANCE_CHUNK_DAYS;

  const advance = () => {
    setError(null);
    startTransition(async () => {
      const outcome = await advanceSim(ADVANCE_CHUNK_DAYS);
      if (!outcome.ok) setError(outcome.error);
    });
  };

  return (
    <div className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 rounded-full border border-hairline bg-white py-1.5 pr-2 pl-4">
      <Link href="/timemachine" className="group">
        <p className="text-[10px] font-semibold tracking-[0.14em] text-brand uppercase">
          Sim clock · day {dayNumber}
        </p>
        <p className="font-sans text-sm leading-tight font-semibold text-navy group-hover:text-brand">
          {formatDay(simDateIso)}
        </p>
      </Link>
      <Button
        size="sm"
        variant="outline"
        onClick={advance}
        disabled={pending || !canAdvance}
        title={canAdvance ? "Generate the next 7 nights" : "The demo timeline ends at day 400"}
        className="px-3 py-1 text-xs"
      >
        {pending ? "Generating…" : "+7 days"}
      </Button>
      {error && <span className="text-xs font-semibold text-danger">{error}</span>}
    </div>
  );
}
