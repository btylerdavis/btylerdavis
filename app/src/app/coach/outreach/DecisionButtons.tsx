"use client";

import { useState, useTransition } from "react";
import { PillGhostButton, PillSunButton } from "@/components/assistant/ui";
import type { OutreachSignal } from "@/lib/assistant/replies";
import { decideOutreachAction } from "./actions";

/** Approve / Skip pair for one queue item (new design language). */
export function DecisionButtons({
  participantId,
  signal,
}: {
  participantId: string;
  signal: OutreachSignal;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const decide = (status: "approved" | "skipped") =>
    startTransition(async () => {
      setError(null);
      const outcome = await decideOutreachAction(participantId, signal, status);
      if (!outcome.ok) setError(outcome.reason ?? "Decision failed");
    });

  return (
    <div className="flex flex-col items-stretch gap-2">
      <PillSunButton size="compact" disabled={pending} onClick={() => decide("approved")}>
        {pending ? "Working…" : "Approve"}
      </PillSunButton>
      <PillGhostButton size="compact" disabled={pending} onClick={() => decide("skipped")}>
        Skip
      </PillGhostButton>
      {error && <p className="max-w-[180px] text-[12px] text-graphite">{error}</p>}
    </div>
  );
}
