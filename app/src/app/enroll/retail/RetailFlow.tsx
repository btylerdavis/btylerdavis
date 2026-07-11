"use client";

import { useMemo, useState, useTransition } from "react";
import { Button, ButtonLink } from "@/components/Button";
import { Card } from "@/components/Card";
import { FlowProgress } from "@/components/Stepper";
import {
  LANE_B_CLASS_COPY,
  LANE_B_TOGGLEABLE_CLASSES,
  WEARABLE_PROVIDERS,
  type LaneBToggles,
  type WearableProviderKey,
} from "@/lib/enrollOptions";
import { formatDay } from "@/lib/format";
import {
  STOP_BANG_ITEMS,
  type StopBangAnswers,
  type StopBangItemKey,
} from "@/lib/stopbang";
import {
  connectWearable,
  enrollRetail,
  recordMattressPurchase,
  scoreScreener,
  type PurchaseResult,
  type RetailEnrollmentResult,
  type ScreenerResult,
} from "./actions";

const STEPS = [
  "Welcome",
  "Sleep check",
  "Your data, your call",
  "Connect a wearable",
  "Your new mattress",
] as const;

interface CatalogRow {
  sku: string;
  brand: string;
  model: string;
  firmnessRating: number;
  materialClass: string;
  size: string;
}

const MATERIAL_LABELS: Record<string, string> = {
  memory_foam: "Memory foam",
  hybrid: "Hybrid",
  innerspring: "Innerspring",
  latex: "Latex",
};

const BAND_STYLES = {
  low: "bg-success/10 text-success",
  intermediate: "bg-warning/10 text-warning",
  high: "bg-danger/10 text-danger",
} as const;

const BAND_LABELS = {
  low: "Low risk",
  intermediate: "Intermediate risk",
  high: "High risk",
} as const;

export function RetailFlow({
  simDateIso,
  catalog,
}: {
  simDateIso: string;
  catalog: CatalogRow[];
}) {
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Step state
  const [displayName, setDisplayName] = useState("");
  const [answers, setAnswers] = useState<Partial<Record<StopBangItemKey, boolean>>>({});
  const [screener, setScreener] = useState<ScreenerResult | null>(null);
  const [toggles, setToggles] = useState<LaneBToggles>({
    wearable_sleep: true,
    sleep_mat: true,
    mattress_purchase: true,
    pro_responses: true,
  });
  const [enrollment, setEnrollment] = useState<RetailEnrollmentResult | null>(null);
  const [connected, setConnected] = useState<{
    provider: WearableProviderKey;
    dataConsented: boolean;
    reason?: string;
  } | null>(null);
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [purchase, setPurchase] = useState<PurchaseResult | null>(null);
  const [skippedPurchase, setSkippedPurchase] = useState(false);
  const [query, setQuery] = useState("");

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

  const allAnswered = STOP_BANG_ITEMS.every(
    (item) => typeof answers[item.key] === "boolean"
  );

  const filteredCatalog = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? catalog.filter((row) =>
          `${row.brand} ${row.model} ${row.size}`.toLowerCase().includes(q)
        )
      : catalog;
    const byBrand = new Map<string, CatalogRow[]>();
    for (const row of rows) {
      byBrand.set(row.brand, [...(byBrand.get(row.brand) ?? []), row]);
    }
    return [...byBrand.entries()];
  }, [catalog, query]);

  const done = purchase !== null || skippedPurchase;
  const progressStep = Math.min(step, STEPS.length - 1);

  return (
    <div className="space-y-5">
      {!done && (
        <FlowProgress
          steps={STEPS}
          current={progressStep}
          eyebrow="Join the sleep study"
        />
      )}

      {/* ------------------------------------------------ Step 1: Welcome */}
      {step === 0 && (
        <Card className="p-6 sm:p-8">
          <span className="inline-block rounded-full bg-pale-blue px-3 py-1 text-xs font-semibold text-navy">
            You’re at The Mattress Hub — Wichita
          </span>
          <h1 className="mt-4 text-2xl font-semibold text-navy sm:text-3xl">
            Curious how you actually sleep?
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-body sm:text-base">
            You scanned the code by the pillow wall — nice. Sleeptopia and The
            Mattress Hub are studying how mattresses, sleep positions, and
            therapy change real nights of sleep. It starts with a two-minute
            sleep check, and you decide what happens after that.
          </p>
          <label className="mt-6 block text-sm font-semibold text-navy" htmlFor="displayName">
            What should we call you?
          </label>
          <input
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="First and last name"
            autoComplete="name"
            className="mt-2 w-full rounded-full border border-pale-blue bg-white px-5 py-3 text-base text-body outline-none focus:border-brand-blue"
          />
          <p className="mt-2 text-xs text-muted">
            Demo identity — a display name is all we need today.
          </p>
          <div className="mt-6">
            <Button
              disabled={displayName.trim().length < 2}
              onClick={() => setStep(1)}
              size="lg"
              className="w-full sm:w-auto"
            >
              Start my sleep check
            </Button>
          </div>
        </Card>
      )}

      {/* -------------------------------------------- Step 2: STOP-BANG */}
      {step === 1 && (
        <div className="space-y-4">
          <Card className="p-6">
            <h1 className="text-xl font-semibold text-navy sm:text-2xl">
              The STOP-BANG sleep check
            </h1>
            <p className="mt-2 text-sm text-muted">
              Eight quick yes/no questions — a validated screener for sleep
              apnea. Answer honestly; nobody at the store sees this.
            </p>
          </Card>

          {STOP_BANG_ITEMS.map((item, index) => {
            const value = answers[item.key];
            return (
              <Card key={item.key} className="p-5">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-pale-blue font-heading text-sm font-semibold text-navy">
                    {item.letter}
                  </span>
                  <div className="flex-1">
                    <p className="text-xs font-semibold tracking-wide text-sky-blue uppercase">
                      {index + 1} of 8 · {item.label}
                    </p>
                    <p className="mt-1 text-sm font-medium text-body sm:text-base">
                      {item.question}
                    </p>
                    <div className="mt-3 flex gap-2">
                      {([true, false] as const).map((choice) => (
                        <button
                          key={String(choice)}
                          type="button"
                          onClick={() => {
                            setScreener(null);
                            setAnswers((a) => ({ ...a, [item.key]: choice }));
                          }}
                          className={`flex-1 rounded-full border px-4 py-2.5 font-heading text-sm font-semibold transition-colors sm:flex-none sm:px-8 ${
                            value === choice
                              ? "border-brand-blue bg-brand-blue text-white"
                              : "border-pale-blue bg-white text-navy hover:bg-pale-blue"
                          }`}
                        >
                          {choice ? "Yes" : "No"}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}

          {!screener && (
            <Button
              disabled={!allAnswered || pending}
              size="lg"
              className="w-full"
              onClick={() =>
                run(async () => {
                  setScreener(await scoreScreener(answers as StopBangAnswers));
                })
              }
            >
              {pending ? "Scoring…" : "See my result"}
            </Button>
          )}

          {screener && (
            <Card className="p-6">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-heading text-3xl font-semibold text-navy">
                  {screener.score}/8
                </span>
                <span
                  className={`rounded-full px-3 py-1 text-sm font-semibold ${BAND_STYLES[screener.band]}`}
                >
                  {BAND_LABELS[screener.band]}
                </span>
              </div>
              {screener.band === "low" ? (
                <p className="mt-3 text-sm text-body">
                  Good news — your answers suggest a low chance of sleep apnea.
                  You can still join the study and see your own sleep data.
                </p>
              ) : (
                <p className="mt-3 text-sm text-body">
                  Your answers suggest a{" "}
                  {screener.band === "high" ? "high" : "raised"} chance of
                  obstructive sleep apnea. Worth checking properly — and it’s
                  easier than you think.
                </p>
              )}
            </Card>
          )}

          {/* The referral-funnel moment — the site's "Don't Have A Doctor?" card */}
          {screener && screener.band !== "low" && (
            <Card tone="dark" className="p-6 sm:p-8">
              <p className="text-xs font-semibold tracking-[0.14em] text-sky-blue uppercase">
                Don’t have a sleep doctor?
              </p>
              <h2 className="mt-2 text-xl font-semibold text-white sm:text-2xl">
                Take a Sleeptopia home sleep test — in your own bed.
              </h2>
              <p className="mt-2 text-sm text-white/80">
                We mail you a small sensor, you sleep like you normally do, and
                Sleeptopia’s sleep team reviews the results with you. No lab, no
                wires-everywhere night.
              </p>
              <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                <Button onClick={() => setStep(2)} disabled={pending}>
                  Yes — set me up with a home sleep test
                </Button>
                <Button variant="quiet" className="text-white" onClick={() => setStep(2)}>
                  Maybe later — keep going
                </Button>
              </div>
            </Card>
          )}

          {screener && screener.band === "low" && (
            <Button size="lg" className="w-full" onClick={() => setStep(2)}>
              Continue
            </Button>
          )}
        </div>
      )}

      {/* --------------------------------- Step 3: consumer consent (Lane B) */}
      {step === 2 && (
        <Card className="relative overflow-hidden p-6 sm:p-8">
          <span className="absolute top-4 right-4 rounded-full border border-watermark/50 px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-watermark uppercase">
            Draft instrument — pre-counsel
          </span>
          <h1 className="max-w-md text-2xl font-semibold text-navy">
            Your data, your call
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-body">
            {displayName.trim().split(" ")[0]}, here’s the deal in plain
            English: you choose exactly what the study may collect. Everything
            below is optional, you can change your mind any time, and saying no
            never affects your care or your mattress warranty.
          </p>

          <div className="mt-5 space-y-3">
            {LANE_B_TOGGLEABLE_CLASSES.map((dataClass) => {
              const copy = LANE_B_CLASS_COPY[dataClass];
              const on = toggles[dataClass];
              return (
                <div
                  key={dataClass}
                  className="flex items-start justify-between gap-4 rounded-card bg-pale-blue/60 p-4"
                >
                  <div>
                    <p className="text-sm font-semibold text-navy">{copy.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted sm:text-sm">
                      {copy.description}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={copy.title}
                    onClick={() =>
                      setToggles((t) => ({ ...t, [dataClass]: !t[dataClass] }))
                    }
                    className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors ${
                      on ? "bg-brand-blue" : "bg-watermark/40"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                        on ? "translate-x-5" : ""
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>

          <p className="mt-4 text-xs leading-relaxed text-muted">
            What you allow is recorded as a consent record and enforced by the
            platform — data types you leave off are refused at the door, not
            just hidden. Revoking later stops collection immediately.
          </p>

          {error && <p className="mt-3 text-sm font-semibold text-danger">{error}</p>}

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              size="lg"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const result = await enrollRetail({
                    displayName,
                    answers: answers as StopBangAnswers,
                    toggles,
                  });
                  setEnrollment(result);
                  setStep(3);
                })
              }
            >
              {pending ? "Creating your profile…" : "I agree — create my profile"}
            </Button>
            <Button variant="quiet" onClick={() => setStep(1)}>
              Back
            </Button>
          </div>
        </Card>
      )}

      {/* ------------------------------------- Step 4: wearable connect */}
      {step === 3 && enrollment && (
        <div className="space-y-4">
          {!enrollment.screenerStored && (
            <Card tone="wash" className="p-4">
              <p className="text-sm text-body">
                <span className="font-semibold text-navy">Heads up:</span> you
                opted out of questionnaires, so tonight’s screener answers were{" "}
                <span className="font-semibold">not stored</span> — the consent
                gate dropped them.
              </p>
            </Card>
          )}
          <Card className="p-6 sm:p-8">
            <h1 className="text-2xl font-semibold text-navy">
              Bring your own sleep data
            </h1>
            <p className="mt-2 text-sm text-body">
              Already wear a watch or ring to bed? Connect it and your nightly
              sleep joins your study record automatically.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {WEARABLE_PROVIDERS.map((provider) => {
                const isConnected = connected?.provider === provider.key;
                return (
                  <button
                    key={provider.key}
                    type="button"
                    disabled={pending || (connected !== null && !isConnected)}
                    onClick={() =>
                      run(async () => {
                        const result = await connectWearable(
                          enrollment.participantId,
                          provider.key
                        );
                        setConnected({
                          provider: provider.key,
                          dataConsented: result.dataConsented,
                          ...(result.connected ? {} : { reason: result.reason }),
                        });
                      })
                    }
                    className={`rounded-card border p-4 text-left transition-colors disabled:opacity-40 ${
                      isConnected
                        ? "border-brand-blue bg-pale-blue"
                        : "border-pale-blue bg-white hover:bg-pale-blue/50"
                    }`}
                  >
                    <p className="font-heading text-sm font-semibold text-navy">
                      {provider.label}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {isConnected
                        ? connected?.dataConsented
                          ? "Connected ✓"
                          : "Refused by consent gate"
                        : "Tap to connect"}
                    </p>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-muted">
              Demo: simulated connection — live OAuth in reserve.
            </p>
            {connected && !connected.dataConsented && (
              <p className="mt-3 rounded-card bg-pale-blue/60 p-3 text-xs text-body">
                Not registered — you didn&rsquo;t opt into wearable sleep sharing, so
                the consent gate refused the device registration itself (no
                record was created). Opt in via re-consent to connect it.
              </p>
            )}
            {error && <p className="mt-3 text-sm font-semibold text-danger">{error}</p>}
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button size="lg" onClick={() => setStep(4)} disabled={pending}>
                {connected ? "Continue" : "Continue without connecting"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* ------------------------------------ Step 5: mattress purchase */}
      {step === 4 && enrollment && !done && (
        <Card className="p-6 sm:p-8">
          <h1 className="text-2xl font-semibold text-navy">
            Found the one?
          </h1>
          <p className="mt-2 text-sm text-body">
            When your new mattress rings up, it joins your study record too —
            model, firmness, and delivery date. That’s how the research
            connects mattresses to real sleep.
          </p>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the floor — brand or model"
            className="mt-5 w-full rounded-full border border-pale-blue bg-white px-5 py-3 text-sm text-body outline-none focus:border-brand-blue"
          />

          <div className="mt-4 max-h-80 space-y-4 overflow-y-auto pr-1">
            {filteredCatalog.length === 0 && (
              <p className="text-sm text-muted">No matches — try another search.</p>
            )}
            {filteredCatalog.map(([brand, rows]) => (
              <div key={brand}>
                <p className="text-xs font-semibold tracking-wide text-sky-blue uppercase">
                  {brand}
                </p>
                <div className="mt-2 space-y-2">
                  {rows.map((row) => (
                    <button
                      key={row.sku}
                      type="button"
                      onClick={() => setSelectedSku(row.sku)}
                      className={`w-full rounded-card border p-3 text-left transition-colors ${
                        selectedSku === row.sku
                          ? "border-brand-blue bg-pale-blue"
                          : "border-pale-blue bg-white hover:bg-pale-blue/50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-navy">
                          {row.model}{" "}
                          <span className="font-normal text-muted">· {row.size}</span>
                        </p>
                        <span className="shrink-0 rounded-full bg-pale-blue px-2.5 py-0.5 text-xs font-semibold text-navy">
                          Firmness {row.firmnessRating}/10
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted">
                        {MATERIAL_LABELS[row.materialClass] ?? row.materialClass}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-card bg-pale-blue/60 p-4 text-sm text-body">
            <p>
              <span className="font-semibold text-navy">Purchase date:</span>{" "}
              {formatDay(simDateIso)} (today)
            </p>
            <p className="mt-1">
              <span className="font-semibold text-navy">Delivery:</span> about
              10 days out — set at checkout.
            </p>
          </div>

          {error && <p className="mt-3 text-sm font-semibold text-danger">{error}</p>}

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              size="lg"
              disabled={!selectedSku || pending}
              onClick={() => {
                const sku = selectedSku;
                if (!sku) return;
                run(async () => {
                  const result = await recordMattressPurchase(
                    enrollment.participantId,
                    sku
                  );
                  setPurchase(result);
                });
              }}
            >
              {pending ? "Recording…" : "Record my purchase"}
            </Button>
            <Button variant="quiet" onClick={() => setSkippedPurchase(true)}>
              Just browsing today
            </Button>
          </div>
        </Card>
      )}

      {/* --------------------------------------------- Confirmation */}
      {done && enrollment && (
        <div className="space-y-4">
          <Card className="p-6 sm:p-8">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-success/10 font-heading text-lg font-semibold text-success">
              ✓
            </span>
            <h1 className="mt-3 text-2xl font-semibold text-navy">
              You’re in, {displayName.trim().split(" ")[0]}.
            </h1>
            {purchase && !purchase.blocked ? (
              <p className="mt-2 text-sm text-body">
                {purchase.brand} {purchase.model} ({purchase.size}) — purchased{" "}
                {formatDay(purchase.purchaseDateIso)}, delivery{" "}
                {formatDay(purchase.deliveryDateIso)}.
              </p>
            ) : purchase?.blocked ? (
              <p className="mt-2 text-sm text-body">{purchase.reason}</p>
            ) : (
              <p className="mt-2 text-sm text-body">
                No purchase today — your study profile is live whenever the
                right mattress finds you.
              </p>
            )}
          </Card>

          {purchase && !purchase.blocked && (
            <Card tone="dark" className="p-6 sm:p-8">
              <p className="text-xs font-semibold tracking-[0.14em] text-sky-blue uppercase">
                Why the wait works for you
              </p>
              <h2 className="mt-2 text-xl font-semibold">
                Your “before” picture starts tonight.
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-white/80">
                Between now and delivery on{" "}
                <span className="font-semibold text-white">
                  {formatDay(purchase.deliveryDateIso)}
                </span>
                , your connected devices quietly capture how you sleep on your
                current mattress. When the new one arrives, you’ll see the
                before-and-after — measured, not guessed.
              </p>
            </Card>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <ButtonLink
              href={`/participant/${enrollment.participantId}`}
              size="lg"
            >
              View my participant profile
            </ButtonLink>
            <ButtonLink href="/" variant="quiet">
              Back to start
            </ButtonLink>
          </div>
        </div>
      )}
    </div>
  );
}
