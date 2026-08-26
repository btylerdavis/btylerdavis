"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { formatDay } from "@/lib/format";
import {
  loadDentiTracSample,
  previewDentiTracUpload,
  type DentiTracPreview,
} from "./actions";

/**
 * DentiTrac wear-time preview (DEMO.md §3 — pilot integration). Parse +
 * preview ONLY: the panel shows nights and mean wear hours from a bundled
 * (or uploaded) DentiTrac export, and deliberately has no confirm/write
 * step — turning objective appliance adherence into registry rows is the
 * vendor-agreement milestone, one more importer through the consent gate.
 */

const hmm = (minutes: number): string =>
  `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

export function DentiTracPanel() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<DentiTracPreview | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const accept = (loaded: DentiTracPreview | { ok: false; error: string }) => {
    if (!loaded.ok) {
      setError(loaded.error);
      return;
    }
    setPreview(loaded);
  };

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

  const loadSample = () => run(async () => accept(await loadDentiTracSample()));
  const uploadFile = () =>
    run(async () => {
      const file = fileRef.current?.files?.[0];
      if (!file) {
        setError("Choose a file first");
        return;
      }
      const formData = new FormData();
      formData.set("file", file);
      accept(await previewDentiTracUpload(formData));
    });

  const parsed = preview?.parsed ?? null;

  return (
    <Card className="p-6 sm:p-8">
      <div className="rounded-card border border-lake/40 bg-lake/5 px-4 py-3">
        <p className="text-sm font-semibold text-lake">
          Pilot integration — reserve; objective adherence per DEMO.md §3
        </p>
        <p className="mt-1 text-xs text-ink">
          DentiTrac is the micro-recorder inside the oral appliance: temperature-verified
          wear time, night by night. This tab parses a real-format export and previews it —{" "}
          <span className="font-semibold text-navy">nothing is written to the registry</span>;
          the ingest step lands with the vendor agreement.
        </p>
      </div>

      {error && (
        <p className="mt-4 rounded-card border border-danger/30 bg-danger/5 px-4 py-2.5 text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      <div className="mt-5 space-y-4">
        <p className="text-sm text-ink">
          Use the bundled sample export, or upload a DentiTrac wear-time CSV.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt"
          className="block w-full text-sm text-ink file:mr-3 file:rounded-full file:border-0 file:bg-brand file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-navy"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="navy" onClick={loadSample} disabled={pending}>
            {pending ? "Parsing…" : "Load bundled DentiTrac export"}
          </Button>
          <Button size="sm" variant="outline" onClick={uploadFile} disabled={pending}>
            Parse file
          </Button>
        </div>
      </div>

      {preview && parsed && (
        <div className="mt-6 space-y-4">
          <div className="rounded-card bg-cream/60 p-4">
            <p className="text-sm font-semibold text-navy">
              DentiTrac wear-time export · {preview.sourceName}
              {parsed.deviceSerial && (
                <span className="ml-2 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-graphite">
                  device {parsed.deviceSerial}
                </span>
              )}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Nights found" value={String(parsed.nights)} />
              <Stat
                label="Worn nights"
                value={`${parsed.wornNights} of ${parsed.nights}`}
              />
              <Stat
                label="Mean wear, all nights"
                value={
                  parsed.meanWearHoursAllNights !== null
                    ? `${parsed.meanWearHoursAllNights} h`
                    : "—"
                }
              />
              <Stat
                label="Mean wear, worn nights"
                value={
                  parsed.meanWearHoursWornNights !== null
                    ? `${parsed.meanWearHoursWornNights} h`
                    : "—"
                }
              />
            </dl>
            <p className="mt-2 text-xs text-graphite">
              {parsed.firstDay && parsed.lastDay
                ? `${formatDay(parsed.firstDay)} – ${formatDay(parsed.lastDay)}`
                : "No dated rows"}{" "}
              · self-report currently drives the appliance-arm charts; this preview is the
              objective replacement, shown side by side on request
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-xs tracking-wide text-graphite uppercase">
                  <th className="py-1.5 pr-4 font-semibold">Night</th>
                  <th className="py-1.5 pr-4 font-semibold">Wear time</th>
                  <th className="py-1.5 font-semibold">Temperature verified</th>
                </tr>
              </thead>
              <tbody>
                {parsed.rows.map((night) => (
                  <tr key={night.day} className="border-b border-hairline/60 last:border-0">
                    <td className="py-1.5 pr-4 whitespace-nowrap text-ink">
                      {formatDay(night.day)}
                    </td>
                    <td className="py-1.5 pr-4 font-semibold tabular-nums text-navy">
                      {hmm(night.wearMinutes)}
                    </td>
                    <td className="py-1.5">
                      {night.verified === null ? (
                        <span className="text-xs text-graphite">—</span>
                      ) : (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            night.verified
                              ? "bg-success/10 text-success"
                              : "bg-warning/10 text-warning"
                          }`}
                        >
                          {night.verified ? "verified" : "not verified"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-graphite">
            Preview only — no confirm button by design. The registry keeps running on the
            consented self-report PROs until the DentiTrac feed is under agreement.
          </p>
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-graphite">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-navy">{value}</dd>
    </div>
  );
}
