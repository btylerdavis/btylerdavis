import Image from "next/image";
import Link from "next/link";

/**
 * Site chrome mirroring sleeptopia.com's header: a utilityBar-colored top
 * strip (Submit Rx / Pay My Bill / Reorder Supplies + purple "Sleeptopia
 * Direct" pill — inert, for authenticity) over a white nav band with the
 * logo top-left, plus a slim console strip linking the Research and
 * Compliance screens (DEMO.md Acts 5–6).
 *
 * Variants:
 * - "site":       consumer chrome with the shop nav links (inert).
 * - "retail":     consumer chrome co-branded "× The Mattress Hub".
 * - "coach":      the sleep-coach console chrome (clinic door).
 * - "research":   the registry research-mart console chrome.
 * - "compliance": the consent/compliance console chrome.
 * - "partner":    the Tempur-Sealy partner console (DUA-gated, de-id only).
 * - "exec":       the executive business-layer console.
 */
const RESEARCH_LINKS = [
  { href: "/research", label: "Cohort explorer" },
  { href: "/research/positional", label: "Positional study" },
  { href: "/research/compare", label: "Comparisons" },
  { href: "/research/robustness", label: "Robustness" },
  { href: "/research/power", label: "Power" },
  { href: "/research/deid", label: "De-identification" },
  { href: "/research/abstract", label: "Abstract" },
];

const COMPLIANCE_LINKS = [
  { href: "/compliance/revocation", label: "Revocation" },
  { href: "/compliance/deletions", label: "Deletions" },
  { href: "/compliance/model-log", label: "Model log" },
];

const BUSINESS_LINKS = [
  { href: "/partner", label: "Partner portal" },
  { href: "/exec", label: "Exec dashboard" },
];

const UTILITY_HEADLINES: Record<string, string> = {
  coach: "Sleep Coach Console — Wichita",
  research: "Research Console — de-identified mart, DUA-gated",
  compliance: "Compliance Console — consent enforcement, audited",
  partner: "Partner console — de-identified, DUA-gated",
  exec: "Executive Console — funnel, growth, and the data asset",
};

export function SiteHeader({
  variant = "site",
}: {
  variant?: "site" | "retail" | "coach" | "research" | "compliance" | "partner" | "exec";
}) {
  const utilityLinks = ["Submit Rx", "Pay My Bill", "Reorder Supplies"];
  const navLinks = [
    "Home Sleep Tests (HST)",
    "CPAP Machines",
    "CPAP Masks",
    "CPAP Supplies",
    "Resources",
  ];

  return (
    <header className="w-full">
      {/* Utility bar */}
      <div className="bg-utility-bar text-hero-navy">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-1.5 text-xs sm:px-6">
          <span className="truncate font-medium">
            {UTILITY_HEADLINES[variant] ?? "Better Sleep Starts with Sleeptopia."}
          </span>
          <nav aria-label="Utility" className="flex items-center gap-3 sm:gap-4">
            {utilityLinks.map((label) => (
              <a
                key={label}
                href="#"
                aria-disabled="true"
                className="hidden whitespace-nowrap hover:underline sm:inline"
              >
                {label}
              </a>
            ))}
            <span className="rounded-full bg-accent-purple px-3 py-0.5 font-semibold whitespace-nowrap text-white">
              Sleeptopia Direct
            </span>
          </nav>
        </div>
      </div>

      {/* Nav band */}
      <div className="border-b border-pale-blue bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/" className="flex shrink-0 items-center gap-3">
            <Image
              src="/brand/sleeptopia-logo.svg"
              alt="Sleeptopia"
              width={175}
              height={40}
              priority
            />
            {variant === "retail" && (
              <span className="hidden border-l border-pale-blue pl-3 text-sm font-semibold text-muted sm:inline">
                × The Mattress Hub
              </span>
            )}
          </Link>

          {variant === "site" && (
            <nav
              aria-label="Site"
              className="hidden items-center gap-5 text-sm font-semibold text-navy lg:flex"
            >
              {navLinks.map((label) => (
                <a key={label} href="#" aria-disabled="true" className="hover:text-brand-blue">
                  {label}
                </a>
              ))}
            </nav>
          )}
          {variant === "retail" && (
            <span className="rounded-full bg-pale-blue px-3 py-1 text-xs font-semibold text-navy sm:text-sm">
              In-store enrollment
            </span>
          )}
          {variant === "coach" && (
            <span className="rounded-full bg-hero-navy px-3 py-1 text-xs font-semibold text-white sm:text-sm">
              Coach portal
            </span>
          )}
          {variant === "research" && (
            <span className="rounded-full bg-brand-blue px-3 py-1 text-xs font-semibold text-white sm:text-sm">
              Research
            </span>
          )}
          {variant === "compliance" && (
            <span className="rounded-full bg-accent-purple px-3 py-1 text-xs font-semibold text-white sm:text-sm">
              Compliance
            </span>
          )}
          {variant === "partner" && (
            <span className="rounded-full bg-navy px-3 py-1 text-xs font-semibold text-white sm:text-sm">
              Partner · Tempur-Sealy
            </span>
          )}
          {variant === "exec" && (
            <span className="rounded-full bg-hero-navy px-3 py-1 text-xs font-semibold text-white sm:text-sm">
              Executive
            </span>
          )}
        </div>
      </div>

      {/* Console strip — compact second-row links to the Act 5–6 screens */}
      <div className="border-b border-pale-blue bg-surface">
        <nav
          aria-label="Consoles"
          className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 text-xs sm:px-6"
        >
          <span className="font-semibold tracking-[0.12em] text-sky-blue uppercase">
            Research
          </span>
          {RESEARCH_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="font-medium text-body hover:text-brand-blue"
            >
              {link.label}
            </Link>
          ))}
          <span
            aria-hidden
            className="mx-1 hidden h-3.5 border-l border-pale-blue sm:inline-block"
          />
          <span className="font-semibold tracking-[0.12em] text-accent-purple uppercase">
            Compliance
          </span>
          {COMPLIANCE_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="font-medium text-body hover:text-brand-blue"
            >
              {link.label}
            </Link>
          ))}
          <span
            aria-hidden
            className="mx-1 hidden h-3.5 border-l border-pale-blue sm:inline-block"
          />
          <span className="font-semibold tracking-[0.12em] text-navy uppercase">
            Business
          </span>
          {BUSINESS_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="font-medium text-body hover:text-brand-blue"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
