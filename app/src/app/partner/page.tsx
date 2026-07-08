import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { Card } from "@/components/Card";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { buttonClasses } from "@/components/Button";
import { acceptDua } from "./actions";
import { DUA_COOKIE } from "./dua";

/**
 * Partner portal landing (DEMO.md Act 7): the DUA gate IS the demo beat —
 * Tempur-Sealy signs a Data Use Agreement before seeing a single number.
 * Accepting sets a session cookie (server action) and opens the dashboard;
 * SPEC §12.3's rules of engagement are on the card, not in fine print.
 */
export const metadata: Metadata = { title: "Partner portal" };

export const dynamic = "force-dynamic";

export default async function PartnerLandingPage() {
  const cookieStore = await cookies();
  const accepted = cookieStore.has(DUA_COOKIE);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader variant="partner" />
      <main className="flex-1 bg-pale-blue">
        <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-8 sm:px-6 sm:py-10">
          <Card tone="dark" className="p-6 sm:p-10">
            <p className="text-xs font-semibold tracking-[0.16em] text-sky-blue uppercase">
              Partner portal · Tempur-Sealy view
            </p>
            <h1 className="mt-3 text-3xl leading-tight font-semibold sm:text-4xl">
              De-identified outcomes for your models — behind an agreement, not a login
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-white/80 sm:text-base">
              Partners receive analyses and de-identified access under a Data Use Agreement —
              never identified data, never raw resale (SPEC §12.3). The agreement below is what
              stands between you and the dashboard.
            </p>
          </Card>

          {/* The DUA card */}
          <Card className="p-6 sm:p-8">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-xl font-semibold text-navy">Data Use Agreement — Demo</h2>
              <span className="rounded-full bg-pale-blue px-2.5 py-0.5 text-xs font-semibold text-navy">
                dua-demo-v1 · illustrative instrument
              </span>
            </div>

            <dl className="mt-4 space-y-4 text-sm">
              <div>
                <dt className="text-xs font-semibold tracking-[0.12em] text-sky-blue uppercase">
                  Parties
                </dt>
                <dd className="mt-1 text-body">
                  The Sleeptopia × Mattress Hub sleep outcomes registry (&ldquo;Data
                  Provider&rdquo;) and Tempur-Sealy International, Inc. (&ldquo;Data
                  Recipient&rdquo;), for demonstration purposes only.
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold tracking-[0.12em] text-sky-blue uppercase">
                  Permitted use
                </dt>
                <dd className="mt-1 text-body">
                  De-identified <span className="font-semibold text-navy">aggregates only</span>:
                  outcome summaries for the Recipient&apos;s product lines against category
                  averages, with small-cell suppression (k&nbsp;&lt;&nbsp;11) applied to every
                  released count. Internal product and outcomes evaluation only.
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold tracking-[0.12em] text-sky-blue uppercase">
                  Prohibitions
                </dt>
                <dd className="mt-1">
                  <ul className="list-disc space-y-1 pl-5 text-body">
                    <li>
                      <span className="font-semibold text-navy">No re-identification</span> —
                      no attempt to identify any participant, alone or combined with other data.
                    </li>
                    <li>
                      <span className="font-semibold text-navy">No onward transfer</span> — no
                      sharing of received data or derivatives outside the Recipient.
                    </li>
                    <li>
                      <span className="font-semibold text-navy">
                        No participant-level marketing use
                      </span>{" "}
                      — aggregates never target, score, or contact any individual.
                    </li>
                  </ul>
                </dd>
              </div>
            </dl>

            <div className="mt-6 flex flex-wrap items-center gap-4 border-t border-pale-blue pt-5">
              <form action={acceptDua}>
                <button type="submit" className={buttonClasses("primary", "lg")}>
                  Accept &amp; enter (demo)
                </button>
              </form>
              {accepted && (
                <Link
                  href="/partner/dashboard"
                  className="text-sm font-semibold text-brand-blue underline-offset-4 hover:underline"
                >
                  Already accepted this session — open the dashboard →
                </Link>
              )}
            </div>
            <p className="mt-3 text-xs text-muted">
              Demo instrument, pre-counsel. Production DUAs are counsel-executed contracts with
              audit rights; the enforcement you are about to see (de-identified tier only,
              suppression everywhere) is the same either way.
            </p>
          </Card>
        </div>
      </main>
      <Footer />
    </div>
  );
}
