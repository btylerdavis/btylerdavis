import type { Metadata } from "next";
import Image from "next/image";
import { cookies } from "next/headers";
import { Card } from "@/components/Card";
import {
  AREA_LABELS,
  STATUS_LABELS,
  phaseProgress,
  roadmap,
  type Area,
  type ItemStatus,
  type Phase,
} from "@/lib/roadmap";
import { ACCESS_COOKIE, hasDashboardAccess } from "@/lib/roadmap/access";

/**
 * Program dashboard (Ben, Oct 13): the shared tracker Kevin and Ben both
 * use, from where the platform is today through each phase to finished.
 * Reads only the roadmap file, never the patient database, so it can run
 * on its own before the rest of the app is live. Access is a private link
 * (see ./access/route.ts) when DASHBOARD_KEY is set.
 */
export const metadata: Metadata = { title: "Program dashboard" };

export const dynamic = "force-dynamic";

const STATUS_CHIP: Record<ItemStatus, string> = {
  planned: "bg-cream text-graphite border border-hairline",
  "in-progress": "bg-sun text-ink",
  live: "bg-success text-white",
  done: "bg-success text-white",
  future: "bg-vellum text-watermark border border-hairline",
};

const AREA_ORDER: Area[] = ["real", "smart", "trust"];

function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function StatusChip({ status }: { status: ItemStatus }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide ${STATUS_CHIP[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function ProgressBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-2 flex-1 overflow-hidden rounded-full bg-hairline"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-full bg-sky" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 text-right text-xs font-semibold text-navy">{pct}%</span>
    </div>
  );
}

/** The horizontal "you are here" rail across every stage. */
function PhaseRail({ phases }: { phases: Phase[] }) {
  const stops = [
    { key: "today", label: "Today", sub: "Prototype", state: "done" as const },
    ...phases.map((p) => ({
      key: p.id,
      label: `Phase ${p.number}`,
      sub: p.name,
      state: p.status === "proposed" || p.status === "active" ? ("next" as const) : ("later" as const),
    })),
    { key: "complete", label: "Complete", sub: "Finished & successful", state: "later" as const },
  ];
  return (
    <ol className="grid grid-cols-3 gap-y-5 sm:grid-cols-6">
      {stops.map((s, i) => (
        <li key={s.key} className="relative flex flex-col items-center text-center">
          {i > 0 && (
            <span
              aria-hidden
              className="absolute top-[11px] right-1/2 hidden h-0.5 w-full bg-white/25 sm:block"
            />
          )}
          <span
            className={`relative z-10 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
              s.state === "done"
                ? "bg-skylight text-navy"
                : s.state === "next"
                  ? "bg-sun text-ink ring-4 ring-sun/30"
                  : "border border-white/40 bg-navy text-white/70"
            }`}
          >
            {i === 0 ? "✓" : i === stops.length - 1 ? "★" : i}
          </span>
          <span className="mt-2 text-xs font-semibold text-white">{s.label}</span>
          <span className="mt-0.5 px-1 text-[11px] leading-tight text-skylight">{s.sub}</span>
        </li>
      ))}
    </ol>
  );
}

function AccessGate() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-cream px-4">
      <Card className="max-w-md p-8 text-center">
        <Image
          src="/brand/sleeptopia-logo.svg"
          alt="Sleeptopia"
          width={180}
          height={40}
          className="mx-auto h-9 w-auto"
        />
        <h1 className="mt-6 text-2xl text-navy">Program dashboard</h1>
        <p className="mt-3 text-sm text-graphite">
          This page opens from the private link Ben sent you. If the link isn&apos;t working,
          email ben@catoconsultinggroup.com for a fresh one.
        </p>
      </Card>
    </main>
  );
}

export default async function DashboardPage() {
  const jar = await cookies();
  if (!hasDashboardAccess(jar.get(ACCESS_COOKIE)?.value)) return <AccessGate />;

  const { phases, today, complete, decisions, updates, garmin, video } = roadmap;
  const phase1 = phases[0];
  const later = phases.slice(1);
  const openDecisions = decisions.filter((d) => d.status === "open");
  const p1Live = phase1.items.filter((i) => i.status === "live" || i.status === "done").length;

  return (
    <div className="flex min-h-screen flex-col bg-cream">
      {/* Night band: brand, title, and the stage rail */}
      <header className="bg-navy text-white">
        <div className="mx-auto w-full max-w-6xl px-4 pt-6 pb-10 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Image
              src="/brand/sleeptopia-logo-dark-bg.svg"
              alt="Sleeptopia"
              width={170}
              height={38}
              priority
              className="h-8 w-auto"
            />
            <span className="rounded-full border border-white/25 px-3 py-1 text-[11px] font-semibold tracking-[0.14em] text-skylight uppercase">
              Updated {formatDate(roadmap.updated)}
            </span>
          </div>
          <p className="mt-10 text-xs font-semibold tracking-[0.16em] text-skylight uppercase">
            Program dashboard · Kevin &amp; Ben
          </p>
          <h1 className="mt-3 max-w-3xl text-3xl leading-tight sm:text-5xl">
            From prototype to <span className="text-sky italic">finished</span>, one phase at a
            time.
          </h1>
          <p className="mt-4 max-w-2xl text-sm text-white/75 sm:text-base">
            {roadmap.product}: where it stands today, what each phase adds, and what is waiting on a
            decision. This page updates as the work lands.
          </p>
          <div className="mt-10">
            <PhaseRail phases={phases} />
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-8 sm:px-6 sm:py-10">
          {/* The narrated walkthrough */}
          {video && (
            <Card className="overflow-hidden">
              <video
                className="block aspect-video w-full bg-navy"
                src={video.url}
                poster={video.poster}
                controls
                playsInline
                preload="none"
              />
              <div className="p-4 sm:px-6">
                <h2 className="text-xl text-navy">{video.title}</h2>
                <p className="mt-1 text-sm text-graphite">{video.caption}</p>
              </div>
            </Card>
          )}

          {/* Decisions waiting */}
          {openDecisions.length > 0 && (
            <Card className="border-sun/60 bg-white p-5 sm:p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-xl text-navy">Waiting on a decision</h2>
                <span className="text-xs font-semibold text-graphite">
                  {openDecisions.length} open
                </span>
              </div>
              <ul className="mt-4 divide-y divide-hairline">
                {openDecisions.map((d) => (
                  <li key={d.id} className="flex items-start justify-between gap-4 py-3">
                    <span className="text-sm text-ink">{d.question}</span>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                        d.owner === "Kevin" ? "bg-sun text-ink" : "bg-navy text-white"
                      }`}
                    >
                      {d.owner}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Today */}
          <Card tone="wash" className="p-5 sm:p-6">
            <p className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">
              {today.label}
            </p>
            <h2 className="mt-1 text-2xl text-navy">{today.headline}</h2>
            <div className="mt-4 grid gap-5 sm:grid-cols-2">
              <div>
                <h3 className="font-sans text-sm font-semibold text-success">Built and working</h3>
                <ul className="mt-2 space-y-1.5 text-sm text-ink">
                  {today.built.map((b) => (
                    <li key={b} className="flex gap-2">
                      <span aria-hidden className="text-success">✓</span>
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="font-sans text-sm font-semibold text-warning">Why it isn&apos;t usable yet</h3>
                <ul className="mt-2 space-y-1.5 text-sm text-ink">
                  {today.gaps.map((g) => (
                    <li key={g} className="flex gap-2">
                      <span aria-hidden className="text-warning">–</span>
                      {g}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Card>

          {/* Phase 1, expanded */}
          <Card className="p-5 sm:p-7">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">
                Phase {phase1.number} · {phase1.status === "proposed" ? "Proposed" : "Active"}
              </p>
              <h2 className="mt-1 text-3xl text-navy">{phase1.name}</h2>
              <p className="mt-2 text-sm text-graphite">{phase1.tagline}</p>
            </div>
            {phase1.status === "proposed" ? (
              <p className="mt-5 text-sm text-graphite">
                Waiting on Kevin&apos;s go-ahead. Nothing below is being built yet; only this dashboard
                is live.
              </p>
            ) : (
              <div className="mt-5">
                <p className="mb-2 text-xs text-graphite">
                  {p1Live} of {phase1.items.length} live
                </p>
                <ProgressBar value={phaseProgress(phase1)} />
              </div>
            )}

            <div className="mt-6 grid gap-5 lg:grid-cols-3">
              {AREA_ORDER.map((area) => (
                <section key={area}>
                  <h3 className="font-sans border-b border-hairline pb-2 text-sm font-semibold text-navy">
                    {AREA_LABELS[area]}
                  </h3>
                  <ul className="mt-3 space-y-3">
                    {phase1.items
                      .filter((i) => i.area === area)
                      .map((item) => (
                        <li key={item.id} className="rounded-xl border border-hairline bg-vellum p-3">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-sm font-semibold text-ink">{item.title}</span>
                            <StatusChip status={item.status} />
                          </div>
                          <p className="mt-1 text-xs leading-relaxed text-graphite">{item.detail}</p>
                        </li>
                      ))}
                  </ul>
                </section>
              ))}
            </div>

            <div className="mt-6 rounded-xl bg-skylight/25 p-4">
              <h3 className="font-sans text-sm font-semibold text-navy">Phase 1 is done when</h3>
              <ul className="mt-2 grid gap-1.5 text-sm text-ink sm:grid-cols-2">
                {phase1.exit.map((e) => (
                  <li key={e} className="flex gap-2">
                    <span aria-hidden className="text-lake">○</span>
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          </Card>

          {/* Later phases */}
          <div className="grid gap-5 lg:grid-cols-3">
            {later.map((p) => (
              <Card key={p.id} className="flex flex-col p-5">
                <p className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">
                  Phase {p.number}
                </p>
                <h2 className="mt-1 text-xl text-navy">{p.name}</h2>
                <p className="mt-1 text-sm text-graphite">{p.tagline}</p>
                <ul className="mt-3 flex-1 space-y-2">
                  {p.items.map((item) => (
                    <li key={item.id} className="text-sm text-ink">
                      <span className="font-semibold">{item.title}.</span>{" "}
                      <span className="text-graphite">{item.detail}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 border-t border-hairline pt-3">
                  <p className="text-xs font-semibold text-navy">Done when</p>
                  <ul className="mt-1 space-y-1 text-xs text-graphite">
                    {p.exit.map((e) => (
                      <li key={e}>○ {e}</li>
                    ))}
                  </ul>
                </div>
              </Card>
            ))}
          </div>

          {/* The Garmin thread */}
          <Card tone="dark" className="p-5 sm:p-6">
            <p className="text-xs font-semibold tracking-[0.14em] text-skylight uppercase">
              The Garmin thread
            </p>
            <h2 className="mt-1 text-2xl">How wearable data grows, phase by phase</h2>
            <ol className="mt-5 grid gap-4 sm:grid-cols-5">
              {garmin.map((g) => (
                <li key={g.phase} className="border-t-2 border-sky pt-3">
                  <p className="text-xs font-semibold text-sun">{g.phase}</p>
                  <p className="mt-1 text-sm text-white/85">{g.text}</p>
                </li>
              ))}
            </ol>
          </Card>

          {/* Complete */}
          <Card className="p-5 sm:p-7">
            <p className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">
              ★ {complete.label}
            </p>
            <h2 className="mt-1 text-2xl text-navy">What &ldquo;finished and successful&rdquo; means</h2>
            <blockquote className="mt-3 border-l-4 border-sun pl-4 font-display text-lg leading-relaxed text-ink italic">
              {complete.sentence}
            </blockquote>
            <ul className="mt-4 grid gap-2 text-sm text-ink sm:grid-cols-3">
              {complete.targets.map((t) => (
                <li key={t} className="rounded-xl border border-hairline bg-vellum p-3">
                  {t}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm font-semibold text-warning">{complete.kevinDefinition}</p>
          </Card>

          {/* Updates log */}
          <Card className="p-5 sm:p-6">
            <h2 className="text-xl text-navy">Updates</h2>
            <ul className="mt-3 divide-y divide-hairline">
              {[...updates].reverse().map((u, i) => (
                <li key={`${u.date}-${i}`} className="flex gap-4 py-3 text-sm">
                  <span className="w-24 shrink-0 text-xs font-semibold text-graphite">
                    {formatDate(u.date)}
                  </span>
                  <span className="text-ink">{u.text}</span>
                </li>
              ))}
            </ul>
          </Card>

          <p className="pb-4 text-center text-xs text-watermark">
            Sleeptopia × The Mattress Hub · Built by Cato Consulting Group · No patient data on this
            page
          </p>
        </div>
      </main>
    </div>
  );
}
