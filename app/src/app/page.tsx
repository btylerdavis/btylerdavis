import { ButtonLink } from "@/components/Button";
import { Card } from "@/components/Card";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { StepLabel } from "@/components/Stepper";
import { formatDay } from "@/lib/format";
import { prisma } from "@/lib/db";
import { MARCUS_REED_PARTICIPANT_ID } from "@/lib/synthetic/profiles";

export const dynamic = "force-dynamic";

/** DEMO.md §2 — the 8-act arc as act → route(s), for rehearsal navigation. */
const DEMO_ACTS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "The retail door",
    links: [{ label: "STOP-BANG + consumer enrollment", href: "/enroll/retail" }],
  },
  {
    title: "The clinic door",
    links: [{ label: "Coach enrollment + HST intake", href: "/enroll/clinic" }],
  },
  {
    title: "Time machine",
    links: [{ label: "Advance the clock", href: "/timemachine" }],
  },
  {
    title: "Three views of Marcus",
    links: [
      { label: "Snapshot", href: `/participant/${MARCUS_REED_PARTICIPANT_ID}` },
      { label: "Trends", href: `/participant/${MARCUS_REED_PARTICIPANT_ID}/trends` },
      { label: "Coach portal", href: "/coach" },
    ],
  },
  {
    title: "The research engine",
    links: [
      { label: "Cohort explorer", href: "/research" },
      { label: "Positional study", href: "/research/positional" },
      { label: "Comparisons", href: "/research/compare" },
    ],
  },
  {
    title: "The compliance spine",
    links: [
      { label: "De-identification", href: "/research/deid" },
      { label: "Revocation kill switch", href: "/compliance/revocation" },
    ],
  },
  {
    title: "The business layer",
    links: [
      { label: "Partner portal", href: "/partner" },
      { label: "Exec dashboard", href: "/exec" },
      {
        label: "AI recommendations",
        href: `/participant/${MARCUS_REED_PARTICIPANT_ID}/recommendations`,
      },
      { label: "Mock abstract", href: "/research/abstract" },
    ],
  },
  {
    title: "The reveal",
    links: [{ label: "What's real, what's simulated", href: "/dev/status" }],
  },
];

export default async function Home() {
  const simClock = await prisma.simClock.findUnique({
    where: { id: "singleton" },
  });

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader variant="site" />

      <main className="flex-1">
        {/* Hero — the site's dark-navy-card-over-light pattern */}
        <section className="bg-pale-blue">
          <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
            <Card tone="dark" className="px-6 py-10 sm:px-12 sm:py-14">
              <p className="text-xs font-semibold tracking-[0.16em] text-sky-blue uppercase">
                Sleeptopia × The Mattress Hub
              </p>
              <h1 className="mt-3 max-w-2xl text-4xl leading-tight font-semibold sm:text-5xl">
                Better Sleep Starts with Data.
              </h1>
              <p className="mt-4 max-w-xl text-base text-white/80 sm:text-lg">
                One platform follows real people from the mattress showroom to
                the sleep clinic — and measures what actually helps them sleep.
              </p>

              <h2 className="mt-10 font-heading text-xl font-semibold text-white sm:text-2xl">
                Where does the journey begin?
              </h2>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <ButtonLink href="/enroll/retail" size="lg">
                  At the mattress store
                </ButtonLink>
                <ButtonLink href="/enroll/clinic" variant="purple" size="lg">
                  At the sleep clinic
                </ButtonLink>
              </div>
              {simClock && (
                <p className="mt-6 text-xs text-white/50">
                  Demo clock: today is {formatDay(simClock.currentDate)}
                </p>
              )}
            </Card>
          </div>
        </section>

        {/* One. Two. Done. — the site's step pattern, retold for the study */}
        <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <p className="text-xs font-semibold tracking-[0.16em] text-sky-blue uppercase">
            One. Two. Done.
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-navy sm:text-3xl">
            Two doors, one sleep story
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <Card className="p-6">
              <StepLabel n={1} title="Screen in the store" />
              <p className="mt-2 text-sm text-muted">
                A QR code at The Mattress Hub, eight friendly questions, and a
                home sleep test offer for the people who need one.
              </p>
            </Card>
            <Card className="p-6">
              <StepLabel n={2} title="Confirm at the clinic" />
              <p className="mt-2 text-sm text-muted">
                The sleep coach reads the home sleep test, records consent, and
                sets up therapy — CPAP, appliance, or both.
              </p>
            </Card>
            <Card className="p-6">
              <StepLabel n={3} title="Watch outcomes accrue" />
              <p className="mt-2 text-sm text-muted">
                Wearables, CPAP telemetry, and an under-mattress sensor stream
                nightly — the before-and-after, measured.
              </p>
            </Card>
          </div>
        </section>

        {/* The two doors, described */}
        <section className="bg-pale-blue">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="flex flex-col p-6 sm:p-8">
                <p className="text-xs font-semibold tracking-[0.14em] text-sky-blue uppercase">
                  The retail door
                </p>
                <h3 className="mt-2 text-xl font-semibold text-navy">
                  Shopping for a mattress
                </h3>
                <p className="mt-2 flex-1 text-sm text-muted">
                  Take the STOP-BANG sleep screener on your phone, choose what
                  data you’re comfortable sharing, connect a wearable, and let
                  your new mattress join the study at checkout.
                </p>
                <div className="mt-5">
                  <ButtonLink href="/enroll/retail">Start in the showroom</ButtonLink>
                </div>
              </Card>
              <Card className="flex flex-col p-6 sm:p-8">
                <p className="text-xs font-semibold tracking-[0.14em] text-accent-purple uppercase">
                  The clinic door
                </p>
                <h3 className="mt-2 text-xl font-semibold text-navy">
                  Sitting with the sleep coach
                </h3>
                <p className="mt-2 flex-1 text-sm text-muted">
                  Coach-led enrollment: combined consent and authorization with
                  a real signature, home-sleep-test intake with automatic
                  positional-OSA flagging, CPAP setup, and record linkage.
                </p>
                <div className="mt-5">
                  <ButtonLink href="/enroll/clinic" variant="purple">
                    Open the coach screen
                  </ButtonLink>
                </div>
              </Card>
            </div>
            <p className="mt-6 text-sm text-muted">
              Under the hood:{" "}
              <a href="/dev/status" className="font-semibold text-navy underline underline-offset-4">
                foundation status
              </a>{" "}
              ·{" "}
              <a
                href={`/participant/${MARCUS_REED_PARTICIPANT_ID}`}
                className="font-semibold text-navy underline underline-offset-4"
              >
                Marcus Reed’s participant snapshot
              </a>
            </p>
          </div>
        </section>

        {/* Demo map — the 8 acts of DEMO.md §2, act → route, for rehearsal */}
        <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <p className="text-xs font-semibold tracking-[0.16em] text-sky-blue uppercase">
            Demo map
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-navy sm:text-3xl">
            The eight acts, in order
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            One narrative, two doors, one person — every act of the arc, with the screen it
            plays on.
          </p>
          <ol className="mt-6 grid gap-3 sm:grid-cols-2">
            {DEMO_ACTS.map((act, index) => (
              <li key={act.title} className="flex gap-4 rounded-card bg-pale-blue/60 p-4">
                <span className="font-heading text-2xl leading-none font-semibold text-accent-purple">
                  {index + 1}
                </span>
                <div>
                  <p className="font-heading font-semibold text-navy">{act.title}</p>
                  <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                    {act.links.map((link) => (
                      <a
                        key={link.href}
                        href={link.href}
                        className="font-semibold text-brand-blue underline-offset-4 hover:underline"
                      >
                        {link.label}
                      </a>
                    ))}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <Footer />
    </div>
  );
}
