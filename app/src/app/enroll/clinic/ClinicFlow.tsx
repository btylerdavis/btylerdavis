"use client";

import { useState, useTransition } from "react";
import { Button, ButtonLink } from "@/components/Button";
import { Card } from "@/components/Card";
import { FlowProgress } from "@/components/Stepper";
import { CPAP_MODELS, type CpapModelKey } from "@/lib/enrollOptions";
import { formatDay } from "@/lib/format";
import type { IdentityMatch } from "@/lib/identity";
import {
  confirmHstIntake,
  enrollClinicPatient,
  grantLinkage,
  linkedView,
  loadSampleHst,
  lookupRetailParticipants,
  parseHstUpload,
  recordCpapSetup,
  type ClinicEnrollmentResult,
  type CpapSetupResult,
  type HstFailure,
  type HstIntakeResult,
  type HstPreview,
  type LinkedView,
} from "./actions";

import { SignaturePad } from "./SignaturePad";

const STEPS = [
  "Patient intake",
  "Consent & authorization",
  "Home sleep test",
  "CPAP setup",
  "Record linkage",
] as const;

export function ClinicFlow({ simDateIso }: { simDateIso: string }) {
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Step 1 — intake
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [newName, setNewName] = useState("");
  const [newYob, setNewYob] = useState("");
  const [newSex, setNewSex] = useState<"male" | "female" | "">("");
  const [lookupQuery, setLookupQuery] = useState("");
  const [matches, setMatches] = useState<IdentityMatch[] | null>(null);
  const [selectedMatch, setSelectedMatch] = useState<IdentityMatch | null>(null);

  // Step 2 — Lane A
  const [signed, setSigned] = useState(false);
  const [enrollment, setEnrollment] = useState<ClinicEnrollmentResult | null>(null);

  // Step 3 — HST
  const [preview, setPreview] = useState<HstPreview | null>(null);
  const [hstResult, setHstResult] = useState<HstIntakeResult | null>(null);

  // Step 4 — CPAP
  const [cpapChoice, setCpapChoice] = useState<CpapModelKey | null>(null);
  const [cpap, setCpap] = useState<Extract<CpapSetupResult, { blocked: false }> | null>(null);

  // Step 5 — Lane C
  const [refusal, setRefusal] = useState<LinkedView | null>(null);
  const [joined, setJoined] = useState<LinkedView | null>(null);

  const patientName =
    mode === "existing" ? (selectedMatch?.displayName ?? "") : newName.trim();

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

  const applyPreview = (result: HstPreview | HstFailure) => {
    if (result.ok) {
      setPreview(result);
      setError(null);
    } else {
      setPreview(null);
      setError(result.error);
    }
  };

  const intakeReady =
    mode === "existing"
      ? selectedMatch !== null
      : newName.trim().length >= 2 && newYob.length === 4 && newSex !== "";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FlowProgress steps={STEPS} current={step} eyebrow="Sleep coach enrollment" />
      </div>
      {patientName && step > 0 && (
        <p className="text-sm text-muted">
          Patient: <span className="font-semibold text-navy">{patientName}</span>
          {" · "}visit date {formatDay(simDateIso)}
        </p>
      )}

      {/* ---------------------------------------------- Step 1: intake */}
      {step === 0 && (
        <Card className="p-6 sm:p-8">
          <h1 className="text-2xl font-semibold text-navy">Patient intake</h1>
          <p className="mt-2 text-sm text-muted">
            New referral, or someone who already screened at The Mattress Hub?
          </p>

          <div className="mt-4 flex gap-2">
            {(
              [
                ["new", "New patient"],
                ["existing", "Existing retail participant"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setMode(key)}
                className={`rounded-full px-4 py-2 font-heading text-sm font-semibold transition-colors ${
                  mode === key
                    ? "bg-hero-navy text-white"
                    : "bg-pale-blue text-navy hover:bg-utility-bar"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === "new" ? (
            <div className="mt-5 space-y-4">
              <div>
                <label className="text-sm font-semibold text-navy" htmlFor="newName">
                  Patient name
                </label>
                <input
                  id="newName"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="First and last name"
                  className="mt-1.5 w-full rounded-full border border-pale-blue bg-white px-5 py-2.5 text-sm outline-none focus:border-brand-blue"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-semibold text-navy" htmlFor="newYob">
                    Year of birth
                  </label>
                  <input
                    id="newYob"
                    value={newYob}
                    onChange={(e) => setNewYob(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    inputMode="numeric"
                    placeholder="1974"
                    className="mt-1.5 w-full rounded-full border border-pale-blue bg-white px-5 py-2.5 text-sm outline-none focus:border-brand-blue"
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-navy" htmlFor="newSex">
                    Sex
                  </label>
                  <select
                    id="newSex"
                    value={newSex}
                    onChange={(e) => setNewSex(e.target.value as typeof newSex)}
                    className="mt-1.5 w-full rounded-full border border-pale-blue bg-white px-4 py-2.5 text-sm outline-none focus:border-brand-blue"
                  >
                    <option value="">Select…</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-5">
              <label className="text-sm font-semibold text-navy" htmlFor="lookup">
                Find their retail record
              </label>
              <div className="mt-1.5 flex gap-2">
                <input
                  id="lookup"
                  value={lookupQuery}
                  onChange={(e) => setLookupQuery(e.target.value)}
                  placeholder="Display name, e.g. Marcus Reed"
                  className="w-full rounded-full border border-pale-blue bg-white px-5 py-2.5 text-sm outline-none focus:border-brand-blue"
                />
                <Button
                  size="sm"
                  disabled={pending || lookupQuery.trim().length < 2}
                  onClick={() =>
                    run(async () => {
                      setSelectedMatch(null);
                      setMatches(await lookupRetailParticipants(lookupQuery));
                    })
                  }
                >
                  {pending ? "…" : "Search"}
                </Button>
              </div>
              <p className="mt-1.5 text-xs text-muted">
                Identity match only — their retail <em>data</em> stays sealed
                until linkage consent (step 5).
              </p>
              {matches !== null && (
                <div className="mt-3 space-y-2">
                  {matches.length === 0 && (
                    <p className="text-sm text-muted">
                      No retail participant by that name.
                    </p>
                  )}
                  {matches.map((match) => (
                    <button
                      key={match.participantId}
                      type="button"
                      onClick={() => setSelectedMatch(match)}
                      className={`w-full rounded-card border p-3 text-left text-sm transition-colors ${
                        selectedMatch?.participantId === match.participantId
                          ? "border-brand-blue bg-pale-blue"
                          : "border-pale-blue bg-white hover:bg-pale-blue/50"
                      }`}
                    >
                      <span className="font-semibold text-navy">{match.displayName}</span>
                      <span className="ml-2 text-xs text-muted">
                        retail participant · {match.participantId.slice(0, 8)}…
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && <p className="mt-3 text-sm font-semibold text-danger">{error}</p>}

          <div className="mt-6">
            <Button size="lg" disabled={!intakeReady} onClick={() => setStep(1)}>
              Continue to consent
            </Button>
          </div>
        </Card>
      )}

      {/* ------------------------------------- Step 2: Lane A consent */}
      {step === 1 && (
        <Card className="relative overflow-hidden p-6 sm:p-8">
          <span className="absolute top-4 right-4 rounded-full border border-watermark/50 px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-watermark uppercase">
            Draft instrument — pre-counsel
          </span>
          <h1 className="max-w-lg text-2xl font-semibold text-navy">
            Research consent &amp; HIPAA authorization
          </h1>
          <p className="mt-2 text-sm text-muted">
            Combined ICF + authorization, read together with the patient.
          </p>

          <div className="mt-5 space-y-4 text-sm leading-relaxed text-body">
            <section>
              <h2 className="font-heading text-base font-semibold text-navy">
                What we collect
              </h2>
              <p>
                Your home sleep test results, CPAP or oral-appliance therapy
                data, wearable and under-mattress sleep readings, and short
                questionnaires — connected to your sleep care record.
              </p>
            </section>
            <section>
              <h2 className="font-heading text-base font-semibold text-navy">
                How research uses it
              </h2>
              <p>
                Your information joins a registry studying which treatments and
                sleep environments actually improve sleep apnea. For research
                reports, your name and identifying details are removed first.
              </p>
            </section>
            <section>
              <h2 className="font-heading text-base font-semibold text-navy">
                Your rights
              </h2>
              <p>
                Taking part is voluntary and never affects your care. You may
                revoke this authorization at any time — collection stops
                immediately and your record is quarantined from research use.
              </p>
            </section>
          </div>

          <div className="mt-6">
            <p className="text-sm font-semibold text-navy">Patient signature</p>
            <div className="mt-2">
              <SignaturePad onChange={setSigned} />
            </div>
          </div>

          {error && <p className="mt-3 text-sm font-semibold text-danger">{error}</p>}

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              size="lg"
              disabled={!signed || pending}
              onClick={() =>
                run(async () => {
                  const intake =
                    mode === "existing" && selectedMatch
                      ? ({ mode: "existing", participantId: selectedMatch.participantId } as const)
                      : ({
                          mode: "new",
                          displayName: newName,
                          yearOfBirth: Number(newYob),
                          sex: newSex as "male" | "female",
                        } as const);
                  const result = await enrollClinicPatient(intake, signed);
                  setEnrollment(result);
                  setStep(2);
                })
              }
            >
              {pending ? "Recording consent…" : "Record consent & authorization"}
            </Button>
            <Button variant="quiet" onClick={() => setStep(0)}>
              Back
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted">
            Recorded to the consent engine as Lane A (clinical scope). Demo
            signature pad — e-signature vendor integration in reserve.
          </p>
        </Card>
      )}

      {/* ---------------------------------------------- Step 3: HST */}
      {step === 2 && enrollment && (
        <Card className="p-6 sm:p-8">
          <h1 className="text-2xl font-semibold text-navy">Home sleep test intake</h1>
          <p className="mt-2 text-sm text-muted">
            Upload the HST export — structured CSV or the interpretation
            report. The system parses it; you confirm before anything is
            written.
          </p>

          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => run(async () => applyPreview(await loadSampleHst("csv")))}
            >
              Use sample CSV export
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => run(async () => applyPreview(await loadSampleHst("report")))}
            >
              Use sample text report
            </Button>
          </div>

          <form
            className="mt-3"
            action={(formData) =>
              run(async () => applyPreview(await parseHstUpload(formData)))
            }
          >
            <label
              className="block text-xs font-semibold tracking-wide text-muted uppercase"
              htmlFor="hstFile"
            >
              Or upload a file
            </label>
            <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                id="hstFile"
                name="file"
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                className="w-full rounded-full border border-pale-blue bg-white px-4 py-2 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-pale-blue file:px-3 file:py-1 file:font-semibold file:text-navy"
              />
              <Button type="submit" size="sm" disabled={pending}>
                Parse
              </Button>
            </div>
          </form>

          {error && <p className="mt-3 text-sm font-semibold text-danger">{error}</p>}

          {preview && (
            <div className="mt-5 rounded-card bg-pale-blue/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-navy">
                  Extracted from {preview.sourceName}{" "}
                  <span className="font-normal text-muted">
                    ({preview.format === "csv" ? "structured CSV" : "text report"})
                  </span>
                </p>
                {preview.supinePredominant && (
                  <span className="rounded-full bg-accent-purple px-3 py-1 text-xs font-semibold text-white">
                    Positional OSA — supine ≥ 2× non-supine
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted">
                Study date: {formatDay(preview.parsed.studyDate)}
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[420px] text-sm">
                  <tbody>
                    {preview.rows.map((row) => (
                      <tr key={row.concept} className="border-b border-white last:border-0">
                        <td className="py-1.5 pr-4 text-muted">{row.label}</td>
                        <td
                          className={`py-1.5 font-semibold ${
                            (row.concept === "supine_ahi" || row.concept === "nonsupine_ahi") &&
                            preview.supinePredominant
                              ? "text-accent-purple"
                              : "text-navy"
                          }`}
                        >
                          {row.value} {row.unit}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!hstResult && (
                <Button
                  className="mt-4"
                  disabled={pending}
                  onClick={() =>
                    run(async () => {
                      const result = await confirmHstIntake(
                        enrollment.participantId,
                        preview.parsed
                      );
                      if (result.blocked) {
                        setError(result.reason);
                      } else {
                        setHstResult(result);
                      }
                    })
                  }
                >
                  {pending ? "Writing…" : "Values look right — write to record"}
                </Button>
              )}
              {hstResult && !hstResult.blocked && (
                <p className="mt-3 text-sm font-semibold text-success">
                  ✓ {hstResult.observationsWritten} observations written through
                  the ingest gate (hst_clinical).
                </p>
              )}
            </div>
          )}

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              size="lg"
              disabled={pending || !hstResult}
              onClick={() => setStep(3)}
            >
              Continue to CPAP setup
            </Button>
            <Button variant="quiet" onClick={() => setStep(3)}>
              Skip for now
            </Button>
          </div>
        </Card>
      )}

      {/* --------------------------------------------- Step 4: CPAP */}
      {step === 3 && enrollment && (
        <Card className="p-6 sm:p-8">
          <h1 className="text-2xl font-semibold text-navy">CPAP setup</h1>
          <p className="mt-2 text-sm text-muted">
            Record the machine going home with the patient.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {CPAP_MODELS.map((model) => (
              <button
                key={model.key}
                type="button"
                onClick={() => setCpapChoice(model.key)}
                disabled={cpap !== null}
                className={`rounded-card border p-4 text-left transition-colors disabled:opacity-60 ${
                  cpapChoice === model.key
                    ? "border-brand-blue bg-pale-blue"
                    : "border-pale-blue bg-white hover:bg-pale-blue/50"
                }`}
              >
                <p className="text-xs font-semibold tracking-wide text-sky-blue uppercase">
                  {model.make}
                </p>
                <p className="mt-1 font-heading text-sm font-semibold text-navy">
                  {model.model}
                </p>
              </button>
            ))}
          </div>

          {error && <p className="mt-3 text-sm font-semibold text-danger">{error}</p>}

          {cpap ? (
            <div className="mt-4 rounded-card bg-pale-blue/60 p-4 text-sm text-body">
              <p className="font-semibold text-success">
                ✓ CPAP setup recorded — {cpap.make} {cpap.model},{" "}
                {formatDay(cpap.setupDateIso)}.
              </p>
              <p className="mt-1 text-muted">
                Nightly telemetry (usage hours, residual AHI, mask leak) starts
                flowing as the time machine advances.
              </p>
            </div>
          ) : null}

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
            {!cpap ? (
              <>
                <Button
                  size="lg"
                  disabled={!cpapChoice || pending}
                  onClick={() => {
                    const choice = cpapChoice;
                    if (!choice) return;
                    run(async () => {
                      const result = await recordCpapSetup(enrollment.participantId, choice);
                      if (result.blocked) {
                        setError(result.reason);
                        return;
                      }
                      setCpap(result);
                    });
                  }}
                >
                  {pending ? "Recording…" : "Record CPAP setup"}
                </Button>
                <Button variant="quiet" onClick={() => setStep(4)}>
                  Skip — no CPAP today
                </Button>
              </>
            ) : (
              <Button size="lg" onClick={() => setStep(4)}>
                Continue to record linkage
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* --------------------------------------- Step 5: Lane C linkage */}
      {step === 4 && enrollment && (
        <div className="space-y-4">
          {!enrollment.fromRetail ? (
            <Card className="p-6 sm:p-8">
              <h1 className="text-2xl font-semibold text-navy">Record linkage</h1>
              <p className="mt-2 text-sm text-body">
                {patientName} enrolled directly through the clinic door — there’s
                no Mattress Hub retail record to link today. If they screen at
                the store later, the linkage consent happens then.
              </p>
              <div className="mt-6">
                <ButtonLink href={`/participant/${enrollment.participantId}`} size="lg">
                  Open participant snapshot
                </ButtonLink>
              </div>
            </Card>
          ) : (
            <>
              <Card className="p-6 sm:p-8">
                <h1 className="text-2xl font-semibold text-navy">
                  Link the retail and clinical records
                </h1>
                <p className="mt-2 text-sm text-body">
                  {patientName} screened at The Mattress Hub before this visit.
                  Their retail record (purchase, screener) and today’s clinical
                  record live apart until the patient authorizes the join —
                  watch the platform refuse it first.
                </p>
                {!refusal && (
                  <Button
                    className="mt-5"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      run(async () => {
                        setRefusal(await linkedView(enrollment.participantId));
                      })
                    }
                  >
                    {pending ? "Querying…" : "Attempt joined view"}
                  </Button>
                )}
              </Card>

              {refusal && refusal.blocked && (
                <Card className="border-l-4 border-danger p-5">
                  <p className="text-xs font-semibold tracking-wide text-danger uppercase">
                    Join refused {joined ? "— before linkage consent" : ""}
                  </p>
                  <p className="mt-1.5 font-mono text-sm text-body">
                    {refusal.blockedReason}
                  </p>
                  <p className="mt-2 text-xs text-muted">
                    Not a UI rule — the query itself is consent-gated. No Lane C
                    grant, no join.
                  </p>
                </Card>
              )}

              {refusal && !joined && (
                <Card className="relative overflow-hidden p-6 sm:p-8">
                  <span className="absolute top-4 right-4 rounded-full border border-watermark/50 px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-watermark uppercase">
                    Draft instrument — pre-counsel
                  </span>
                  <h2 className="text-xl font-semibold text-navy">
                    Linkage consent (Lane C)
                  </h2>
                  <p className="mt-2 max-w-lg text-sm leading-relaxed text-body">
                    &ldquo;Connect my Mattress Hub shopping record with my
                    Sleeptopia clinical record, so my care team and the research
                    registry can see my whole sleep story. I can undo this at
                    any time.&rdquo;
                  </p>
                  {error && (
                    <p className="mt-3 text-sm font-semibold text-danger">{error}</p>
                  )}
                  <Button
                    className="mt-5"
                    variant="purple"
                    size="lg"
                    disabled={pending}
                    onClick={() =>
                      run(async () => {
                        await grantLinkage(enrollment.participantId);
                        setJoined(await linkedView(enrollment.participantId));
                      })
                    }
                  >
                    {pending ? "Linking…" : "Patient agrees — record Lane C consent"}
                  </Button>
                </Card>
              )}

              {joined && !joined.blocked && (
                <Card className="p-6 sm:p-8">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-success/10 px-3 py-1 text-xs font-semibold text-success">
                      ✓ Lane C granted — join open
                    </span>
                    {joined.identity && (
                      <span className="rounded-full bg-pale-blue px-3 py-1 text-xs font-semibold text-navy">
                        {joined.identity.displayName}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    Rendered by the same query that was refused above —
                    getLinkedProfile, identified tier.
                  </p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div className="rounded-card bg-pale-blue/60 p-4">
                      <p className="text-xs font-semibold tracking-wide text-sky-blue uppercase">
                        Retail record — The Mattress Hub
                      </p>
                      {joined.retail.purchases.length === 0 ? (
                        <p className="mt-2 text-sm text-muted">No purchase on file.</p>
                      ) : (
                        joined.retail.purchases.map((purchase) => (
                          <div key={purchase.sku} className="mt-2 text-sm text-body">
                            <p className="font-semibold text-navy">
                              {purchase.brand} {purchase.model}
                            </p>
                            <p className="text-xs text-muted">
                              Firmness {purchase.firmnessRating}/10 · purchased{" "}
                              {formatDay(purchase.purchaseDateIso)}
                              {purchase.deliveryDateIso &&
                                ` · delivery ${formatDay(purchase.deliveryDateIso)}`}
                            </p>
                          </div>
                        ))
                      )}
                      <div className="mt-3 border-t border-white pt-3 text-sm">
                        {joined.retail.stopBang ? (
                          <p className="text-body">
                            STOP-BANG{" "}
                            <span className="font-semibold text-navy">
                              {joined.retail.stopBang.score}/8
                            </span>{" "}
                            ({joined.retail.stopBang.band}) ·{" "}
                            {formatDay(joined.retail.stopBang.administeredAtIso)}
                          </p>
                        ) : (
                          <p className="text-muted">
                            {joined.retail.stopBangBlocked
                              ? "STOP-BANG blocked — no questionnaire consent."
                              : "No screener on file."}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="rounded-card bg-pale-blue/60 p-4">
                      <p className="text-xs font-semibold tracking-wide text-accent-purple uppercase">
                        Clinical record — Sleeptopia
                      </p>
                      {joined.clinical.hst.length === 0 ? (
                        <p className="mt-2 text-sm text-muted">No HST on file.</p>
                      ) : (
                        <table className="mt-2 w-full text-sm">
                          <tbody>
                            {joined.clinical.hst.map((row) => (
                              <tr key={`${row.concept}-${row.dateIso}`}>
                                <td className="py-0.5 pr-2 text-muted">{row.label}</td>
                                <td className="py-0.5 font-semibold text-navy">
                                  {row.value} {row.unit}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      {joined.clinical.events.length > 0 && (
                        <div className="mt-3 border-t border-white pt-3 text-xs text-muted">
                          {joined.clinical.events.map((event) => (
                            <p key={`${event.type}-${event.dateIso}`}>
                              {event.type.replace(/_/g, " ")} · {formatDay(event.dateIso)}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                    <ButtonLink href={`/participant/${enrollment.participantId}`} size="lg">
                      Open participant snapshot
                    </ButtonLink>
                    <ButtonLink href="/" variant="quiet">
                      Back to start
                    </ButtonLink>
                  </div>
                </Card>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
