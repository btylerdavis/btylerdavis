"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { deleteSavedCohortAction, saveCohortAction } from "./actions";

/**
 * Saved cohorts (client card): name the current URL-param filter set and
 * keep it as a demo-prep bookmark. The list links straight back into the
 * explorer; counts shown are the consent-filtered snapshot from save time —
 * opening the link re-runs the live query, so they can legitimately drift
 * (revocations, deletions, time-machine advances).
 */

export interface SavedCohortItem {
  id: string;
  name: string;
  href: string;
  summary: string;
  matched: number;
  clockLabel: string;
}

export function SavedCohortsCard({
  currentQuery,
  currentSummary,
  matched,
  items,
}: {
  /** validated query string of the filters currently applied (may be "") */
  currentQuery: string;
  currentSummary: string;
  matched: number;
  items: SavedCohortItem[];
}) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = () => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const outcome = await saveCohortAction(name, currentQuery);
      if (!outcome.ok) {
        setError(outcome.error);
        return;
      }
      setName("");
      setSaved(true);
    });
  };

  const remove = (id: string) => {
    setError(null);
    startTransition(async () => {
      await deleteSavedCohortAction(id);
    });
  };

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-navy">Saved cohorts</h2>
        <p className="text-xs text-muted">
          demo-prep bookmarks — a name on a filter URL, never participant ids
        </p>
      </div>

      {/* Save the current filter set */}
      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={60}
          placeholder={`Name this cohort (${currentSummary.toLowerCase()})`}
          className="w-full max-w-sm rounded-card border border-pale-blue px-3 py-1.5 text-sm focus:ring-2 focus:ring-brand-blue focus:outline-none"
        />
        <Button type="submit" size="sm" disabled={pending || name.trim().length === 0}>
          {pending ? "Saving…" : `Save this cohort (n = ${matched.toLocaleString("en-US")})`}
        </Button>
        {error && <span className="text-sm font-semibold text-danger">{error}</span>}
        {saved && !error && (
          <span className="text-sm font-semibold text-success">Saved.</span>
        )}
      </form>

      {/* The bookmark list */}
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          Nothing saved yet — set some filters above and give the cohort a name.
        </p>
      ) : (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-start justify-between gap-2 rounded-card bg-pale-blue/60 px-4 py-2.5"
            >
              <div className="min-w-0">
                <Link
                  href={item.href}
                  className="text-sm font-semibold text-brand-blue underline-offset-4 hover:underline"
                >
                  {item.name}
                </Link>
                <p className="mt-0.5 text-xs text-muted">
                  {item.summary} · n = {item.matched.toLocaleString("en-US")} at save (
                  {item.clockLabel})
                </p>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() => remove(item.id)}
                className="shrink-0 text-xs font-semibold text-muted underline-offset-4 hover:text-danger hover:underline disabled:opacity-45"
                aria-label={`Delete saved cohort ${item.name}`}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
