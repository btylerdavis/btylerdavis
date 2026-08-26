"use client";

import { useState, useTransition } from "react";
import { markReviewedAction } from "./actions";

/** "Mark reviewed (demo)" — the clinician-review stub on queued rows. */
export function ReviewButton({ logId }: { logId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const outcome = await markReviewedAction(logId);
            if (!outcome.ok) setError(outcome.error ?? "Could not mark reviewed");
          })
        }
        className="rounded-full bg-lake px-3 py-1 text-xs font-semibold whitespace-nowrap text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Marking…" : "Mark reviewed (demo)"}
      </button>
      {error && <span className="text-[11px] text-danger">{error}</span>}
    </span>
  );
}
