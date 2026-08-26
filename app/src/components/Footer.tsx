import Image from "next/image";
import Link from "next/link";

/** Navy footer (the site's night surface) with the co-brand line. */
export function Footer() {
  return (
    <footer className="mt-auto bg-navy text-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="space-y-3">
          <Image
            src="/brand/sleeptopia-logo-dark-bg.svg"
            alt="Sleeptopia"
            width={175}
            height={40}
          />
          <p className="font-display text-sm font-semibold text-skylight">
            Sleeptopia × The Mattress Hub
          </p>
          <p className="max-w-xs text-sm text-white/70">
            Your end-to-end sleep apnea service provider — now measuring what
            better sleep actually looks like.
          </p>
        </div>
        <div className="space-y-1 text-sm text-white/70">
          <p className="font-display font-semibold text-white">Visit us</p>
          <p>411 S Pattie St, Wichita, KS 67211</p>
          <p>(316) 573-5699</p>
          <p>
            <Link href="/dev/status" className="underline underline-offset-4 hover:text-white">
              Build status
            </Link>
          </p>
        </div>
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-6xl px-4 py-4 text-xs text-white/50 sm:px-6">
          Demonstration environment — synthetic cohort, no real patient data.
          Consent instruments are drafts, pre-counsel. © 2026 Sleeptopia, Inc.
        </p>
      </div>
    </footer>
  );
}
