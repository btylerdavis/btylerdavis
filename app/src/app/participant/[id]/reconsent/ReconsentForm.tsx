"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { signReconsent } from "./actions";

/**
 * Minimal participant-facing re-consent step (audit F-02): one class per
 * card, an explicit agreement checkbox standing in for the signature pad,
 * and a signed submission. Administrative restore can never do this.
 */
export function ReconsentForm({
  participantId,
  dataClass,
  label,
  description,
}: {
  participantId: string;
  dataClass: string;
  label: string;
  description: string;
}) {
  const [agreed, setAgreed] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (outcome) {
    return (
      <div className="rounded-card bg-success/10 px-4 py-3 text-sm">
        <p className="font-semibold text-success">✓ {outcome}</p>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-hairline bg-white p-4">
      <p className="text-sm font-semibold text-navy">{label}</p>
      <p className="mt-1 text-xs text-graphite">{description}</p>
      <label className="mt-3 flex items-start gap-2 text-xs text-ink">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(event) => setAgreed(event.target.checked)}
          className="mt-0.5"
        />
        <span>
          I agree to share <span className="font-semibold">{label}</span> with the registry —
          collection, my identified care view, and de-identified research use. I understand I
          can revoke this at any time.
        </span>
      </label>
      <div className="mt-3 flex items-center gap-3">
        <Button
          size="sm"
          disabled={!agreed || pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await signReconsent(participantId, dataClass, agreed);
              if (result.ok) {
                setOutcome(`New signed consent recorded (${result.instrument}).`);
              } else {
                setError(result.error);
              }
            })
          }
        >
          {pending ? "Recording…" : "Sign & enable"}
        </Button>
        {error && <span className="text-xs font-semibold text-danger">{error}</span>}
      </div>
    </div>
  );
}
