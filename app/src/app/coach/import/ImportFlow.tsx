"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { FlowProgress } from "@/components/Stepper";
import { CLASS_LABELS } from "@/lib/consent/classCopy";
import type { DataClass } from "@/lib/consent/types";
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

/** "LANE_B" + 1 → "Lane B grant (revision 1)" */
function grantLabel(instrumentType: string, revision: number): string {
  return `${instrumentType.replace("LANE_", "Lane ")} grant (revision ${revision})`;
}

function classLabel(dataClass: string): string {
  return CLASS_LABELS[dataClass as DataClass] ?? dataClass;
}

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
      if (!patient) return;
      const formData = new FormData();
      formData.set("file", file);
      acceptPreview(await previewImportUpload(patient.participantId, formData));
    });

  const pickSample = (kind: "apple_health" | "airview") =>
    run(async () => {
      if (!patient) return;
      acceptPreview(await loadSampleImport(patient.participantId, kind));
    });

  const commit = () =>
    run(async () => {
      if (!patient || !preview) return;
      // Server-owned confirmation: only the single-use token, the
      // participant, and the align flag travel back — never the payload.
      setResult(await confirmImport(preview.token, patient.participantId, align));
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
          <p className="text-sm text-ink">
            Whose data is this? Search by name — retail and clinic enrollees both appear.
          </p>
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && search()}
              placeholder="e.g. Marcus Reed"
              className="w-full rounded-full border border-hairline px-4 py-2 text-sm outline-none focus:border-brand"
            />
            <Button size="sm" onClick={search} disabled={pending || query.trim().length < 2}>
              {pending ? "Searching…" : "Search"}
            </Button>
          </div>
          {matches !== null && matches.length === 0 && (
            <p className="text-sm text-graphite">
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
                    className="flex w-full items-center justify-between gap-3 rounded-card bg-cream/60 px-4 py-2.5 text-left text-sm hover:bg-cream"
                  >
                    <span className="font-semibold text-navy">{match.displayName}</span>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-graphite uppercase">
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
          <p className="text-sm text-ink">
            Importing for <span className="font-semibold text-navy">{patient.displayName}</span>.
            Two formats are understood: an Apple Health <code>export.xml</code> and an AirView
            nightly compliance CSV. Big exports are fine — the file streams through the parser.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".xml,.csv,.txt"
            className="block w-full text-sm text-ink file:mr-3 file:rounded-full file:border-0 file:bg-brand file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-navy"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={uploadFile} disabled={pending}>
              {pending ? "Parsing…" : "Parse file"}
            </Button>
            <span className="text-xs text-graphite">or use a bundled sample:</span>
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
            className="text-xs font-semibold text-graphite underline-offset-4 hover:underline"
          >
            ← different patient
          </button>
        </div>
      )}

      {/* Step 3: review + confirm */}
      {step === 2 && patient && preview && (
        <div className="mt-6 space-y-4">
          <div className="rounded-card bg-cream/60 p-4">
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
                  className="rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-ink"
                >
                  {RECORD_LABELS[type] ?? type}: {count.toLocaleString("en-US")}
                </li>
              ))}
            </ul>
          </div>

          {result === null && (
            <>
              {/* Consent-impact preview (audit v2 fix 11): what class this
                  writes and which grant admits it, BEFORE confirmation. */}
              {preview.impact.authority ? (
                <p className="rounded-card border border-brand/25 bg-brand/5 px-4 py-2.5 text-sm text-ink">
                  This will write{" "}
                  <span className="font-semibold text-navy">
                    {preview.impact.rowCount.toLocaleString("en-US")}{" "}
                    {classLabel(preview.impact.dataClass)} ({preview.impact.dataClass}) rows
                  </span>{" "}
                  for {patient.displayName} under their{" "}
                  <span className="font-semibold text-navy">
                    {grantLabel(
                      preview.impact.authority.instrumentType,
                      preview.impact.authority.revision
                    )}
                  </span>
                  . The grant is re-checked inside every write transaction at confirmation.
                </p>
              ) : (
                <p className="rounded-card border border-danger/30 bg-danger/5 px-4 py-2.5 text-sm text-ink">
                  {patient.displayName} has{" "}
                  <span className="font-semibold text-danger">
                    no current {classLabel(preview.impact.dataClass)} (
                    {preview.impact.dataClass}) collect grant
                  </span>{" "}
                  — the ingest gate will refuse this import if you confirm it.
                </p>
              )}
              <label className="flex items-start gap-2.5 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={align}
                  onChange={(event) => setAlign(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-brand"
                />
                <span>
                  Align to the demo clock — shift the nights so the newest lands on sim
                  “today” and shows up in the 90-day trend window right away
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
                  className="text-xs font-semibold text-graphite underline-offset-4 hover:underline"
                >
                  ← different file
                </button>
              </div>
            </>
          )}

          {result?.blocked && (
            <div className="rounded-card border border-danger/30 bg-danger/5 p-4">
              <span className="rounded-full border border-danger/40 bg-white px-2.5 py-0.5 text-xs font-semibold text-danger">
                Refused
              </span>
              <p className="mt-2 text-sm text-ink">{result.reason}</p>
              <p className="mt-1 text-xs text-graphite">
                That’s the import trust boundary doing its job — fix the consent (or
                re-preview the file) and try again.
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
              {/* Provenance receipt (audit v2 fix 6): what was admitted, from
                  which file, by which parser, under which consent event. */}
              <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
                <ReceiptRow label="Import batch" value={result.batchId} mono />
                <ReceiptRow
                  label="Written as"
                  value={`${classLabel(result.dataClass)} (source "${result.source}")`}
                />
                <ReceiptRow
                  label="Admitted under"
                  value={grantLabel(result.consentInstrument, result.consentRevision)}
                />
                <ReceiptRow label="Parser" value={result.parserVersion} />
                <ReceiptRow
                  label="File digest (SHA-256)"
                  value={`${result.fileDigest.slice(0, 16)}…`}
                  mono
                />
              </dl>
              <p className="mt-3 text-sm text-ink">
                The nights are live on the charts already.{" "}
                <Link
                  href={`/participant/${patient.participantId}/trends`}
                  className="font-semibold text-brand underline-offset-4 hover:underline"
                >
                  View {patient.displayName}’s trends →
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
      <dt className="text-xs font-medium text-graphite">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-navy">{value}</dd>
    </div>
  );
}

function ReceiptRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="shrink-0 font-medium text-graphite">{label}:</dt>
      <dd className={`truncate text-ink ${mono ? "font-mono" : "font-semibold"}`}>{value}</dd>
    </div>
  );
}
