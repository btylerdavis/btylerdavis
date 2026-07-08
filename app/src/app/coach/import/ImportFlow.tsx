"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { FlowProgress } from "@/components/Stepper";
import { formatDay } from "@/lib/format";
import type { ImportResult } from "@/lib/imports/ingest";
import type { IdentityMatchWithDoor } from "@/lib/identity";
import {
  confirmImport,
  loadSampleImport,
  previewImportUpload,
  searchImportParticipants,
  type ImportPreview,
} from "./actions";

const STEPS = ["Choose patient", "Add the file", "Review & confirm"] as const;

const KIND_LABELS = {
  apple_health: "Apple Health export (wearable sleep)",
  airview: "AirView nightly compliance (CPAP telemetry)",
} as const;

const RECORD_LABELS: Record<string, string> = {
  HKCategoryTypeIdentifierSleepAnalysis: "Sleep analysis segments",
  HKQuantityTypeIdentifierHeartRate: "Heart-rate samples",
  HKQuantityTypeIdentifierRestingHeartRate: "Resting heart rate",
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: "HRV (SDNN)",
  HKQuantityTypeIdentifierOxygenSaturation: "Oxygen saturation",
  nightly_rows: "Nightly compliance rows",
};

export function ImportFlow() {
  const [step, setStep] = useState(0);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<IdentityMatchWithDoor[] | null>(null);
  const [patient, setPatient] = useState<IdentityMatchWithDoor | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [align, setAlign] = useState(true);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = (fn: () => Promise<void>) => {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    });
  };

  const search = () =>
    run(async () => {
      setMatches(await searchImportParticipants(query));
    });

  const acceptPreview = (loaded: ImportPreview | { ok: false; error: string }) => {
    if (!loaded.ok) {
      setError(loaded.error);
      return;
    }
    setPreview(loaded);
    setResult(null);
    setStep(2);
  };

  const uploadFile = () =>
    run(async () => {
      const file = fileRef.current?.files?.[0];
      if (!file) {
        setError("Choose a file first");
        return;
      }
      const formData = new FormData();
      formData.set("file", file);
      acceptPreview(await previewImportUpload(formData));
    });

  const pickSample = (kind: "apple_health" | "airview") =>
    run(async () => {
      acceptPreview(await loadSampleImport(kind));
    });

  const commit = () =>
    run(async () => {
      if (!patient || !preview) return;
      setResult(await confirmImport(patient.participantId, preview.parsed, align));
    });

  return (
    <Card className="p-6 sm:p-8">
      <FlowProgress steps={STEPS} current={step} eyebrow="Device data import" />

      {error && (
        <p className="mt-4 rounded-card border border-danger/30 bg-danger/5 px-4 py-2.5 text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      {/* Step 1: participant */}
      {step === 0 && (
        <div className="mt-6 space-y-4">
          <p className="text-sm text-body">
            Whose data is this? Search by name — retail and clinic enrollees both appear.
          </p>
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && search()}
              placeholder="e.g. Marcus Reed"
              className="w-full rounded-full border border-pale-blue px-4 py-2 text-sm outline-none focus:border-brand-blue"
            />
            <Button size="sm" onClick={search} disabled={pending || query.trim().length < 2}>
              {pending ? "Searching…" : "Search"}
            </Button>
          </div>
          {matches !== null && matches.length === 0 && (
            <p className="text-sm text-muted">
              No matches — try the first or last name on its own.
            </p>
          )}
          {matches !== null && matches.length > 0 && (
            <ul className="space-y-2">
              {matches.map((match) => (
                <li key={match.participantId}>
                  <button
                    type="button"
                    onClick={() => {
                      setPatient(match);
                      setStep(1);
                    }}
                    className="flex w-full items-center justify-between gap-3 rounded-card bg-pale-blue/60 px-4 py-2.5 text-left text-sm hover:bg-pale-blue"
                  >
                    <span className="font-semibold text-navy">{match.displayName}</span>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-muted uppercase">
                      {match.enrollmentTouchpoint} door
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Step 2: file */}
      {step === 1 && patient && (
        <div className="mt-6 space-y-4">
          <p className="text-sm text-body">
            Importing for <span className="font-semibold text-navy">{patient.displayName}</span>.
            Two formats are understood: an Apple Health <code>export.xml</code> and an AirView
            nightly compliance CSV. Big exports are fine — the file streams through the parser.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".xml,.csv,.txt"
            className="block w-full text-sm text-body file:mr-3 file:rounded-full file:border-0 file:bg-brand-blue file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-navy"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={uploadFile} disabled={pending}>
              {pending ? "Parsing…" : "Parse file"}
            </Button>
            <span className="text-xs text-muted">or use a bundled sample:</span>
            <Button size="sm" variant="outline" onClick={() => pickSample("apple_health")} disabled={pending}>
              Apple Health sample
            </Button>
            <Button size="sm" variant="outline" onClick={() => pickSample("airview")} disabled={pending}>
              AirView sample
            </Button>
          </div>
          <button
            type="button"
            onClick={() => setStep(0)}
            className="text-xs font-semibold text-muted underline-offset-4 hover:underline"
          >
            ← different patient
          </button>
        </div>
      )}

      {/* Step 3: review + confirm */}
      {step === 2 && patient && preview && (
        <div className="mt-6 space-y-4">
          <div className="rounded-card bg-pale-blue/60 p-4">
            <p className="text-sm font-semibold text-navy">
              {KIND_LABELS[preview.summary.kind]} · {preview.sourceName}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <SummaryStat label="Nights found" value={String(preview.summary.nights)} />
              <SummaryStat
                label="Date range"
                value={
                  preview.summary.firstDay && preview.summary.lastDay
                    ? `${formatDay(preview.summary.firstDay)} – ${formatDay(preview.summary.lastDay)}`
                    : "—"
                }
              />
              <SummaryStat
                label="Rows to write"
                value={`${preview.summary.observationCount + preview.summary.sessionCount}`}
              />
            </dl>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {Object.entries(preview.summary.recordCounts).map(([type, count]) => (
                <li
                  key={type}
                  className="rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-body"
                >
                  {RECORD_LABELS[type] ?? type}: {count.toLocaleString("en-US")}
                </li>
              ))}
            </ul>
          </div>

          {result === null && (
            <>
              <label className="flex items-start gap-2.5 text-sm text-body">
                <input
                  type="checkbox"
                  checked={align}
                  onChange={(event) => setAlign(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-brand-blue"
                />
                <span>
                  Align to the demo clock — shift the nights so the newest lands on sim
                  &ldquo;today&rdquo; and shows up in the 90-day trend window right away
                  (rows are flagged <code>date_shifted</code>).
                </span>
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={commit} disabled={pending}>
                  {pending ? "Writing through the gate…" : `Import for ${patient.displayName}`}
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setPreview(null);
                    setStep(1);
                  }}
                  className="text-xs font-semibold text-muted underline-offset-4 hover:underline"
                >
                  ← different file
                </button>
              </div>
            </>
          )}

          {result?.blocked && (
            <div className="rounded-card border border-danger/30 bg-danger/5 p-4">
              <span className="rounded-full border border-danger/40 bg-white px-2.5 py-0.5 text-xs font-semibold text-danger">
                Blocked by consent
              </span>
              <p className="mt-2 text-sm text-body">{result.reason}</p>
              <p className="mt-1 text-xs text-muted">
                Nothing was written. That&rsquo;s the ingest gate doing its job — record the
                right consent and try again.
              </p>
            </div>
          )}

          {result && !result.blocked && (
            <div className="rounded-card border border-success/30 bg-success/5 p-4">
              <p className="text-sm font-semibold text-success">
                Imported: {result.observationsWritten.toLocaleString("en-US")} observations
                {result.sessionsWritten > 0 &&
                  ` and ${result.sessionsWritten.toLocaleString("en-US")} sleep sessions`}{" "}
                ({formatDay(result.firstDayIso)} – {formatDay(result.lastDayIso)}
                {result.shiftedDays !== 0 && `, shifted ${result.shiftedDays} days`}).
              </p>
              <p className="mt-2 text-sm text-body">
                The nights are live on the charts already.{" "}
                <Link
                  href={`/participant/${patient.participantId}/trends`}
                  className="font-semibold text-brand-blue underline-offset-4 hover:underline"
                >
                  View {patient.displayName}&rsquo;s trends →
                </Link>
              </p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-navy">{value}</dd>
    </div>
  );
}
