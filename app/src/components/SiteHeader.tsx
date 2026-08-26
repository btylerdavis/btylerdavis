import Image from "next/image";
import Link from "next/link";

/**
 * Site chrome in the new Sleeptopia design language (sleeptopia-site
 * design/DIRECTION.md): a navy utility strip (the site's "night band"
 * surface) with the service-desk links (Submit Rx / Pay My Bill / Reorder
 * Supplies — inert, for authenticity), a white nav band with the logo over
 * a 1px hairline, and a slim console strip linking the Research and
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

/** Variant badge chips — one palette family, surface-contrast identity. */
const VARIANT_BADGES: Record<string, { label: string; classes: string }> = {
  retail: {
    label: "In-store enrollment",
    classes: "border border-hairline bg-cream text-navy",
  },
  coach: { label: "Coach portal", classes: "bg-navy text-white" },
  research: { label: "Research", classes: "bg-brand text-white" },
  compliance: { label: "Compliance", classes: "bg-lake text-white" },
  partner: { label: "Partner · Tempur-Sealy", classes: "bg-ink text-white" },
  exec: { label: "Executive", classes: "border border-navy text-navy" },
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
  const badge = VARIANT_BADGES[variant];

  return (
    <header className="w-full">
      {/* Utility strip — the navy service-desk band */}
      <div className="bg-navy text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-1.5 text-xs sm:px-6">
          <span className="truncate font-medium text-skylight">
            {UTILITY_HEADLINES[variant] ?? "Better Sleep Starts with Sleeptopia."}
          </span>
          <nav aria-label="Utility" className="flex items-center gap-3 sm:gap-4">
            {utilityLinks.map((label) => (
              <a
                key={label}
                href="#"
                aria-disabled="true"
                className="hidden whitespace-nowrap text-white/75 hover:text-white hover:underline sm:inline"
              >
                {label}
              </a>
            ))}
            <span className="rounded-full border border-white/40 px-3 py-0.5 font-semibold whitespace-nowrap text-white">
              Sleeptopia Direct
            </span>
          </nav>
        </div>
      </div>

      {/* Nav band — white bar over a hairline */}
      <div className="border-b border-hairline bg-white">
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
              <span className="hidden border-l border-hairline pl-3 text-sm font-semibold text-graphite sm:inline">
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
                <a key={label} href="#" aria-disabled="true" className="hover:text-brand">
                  {label}
                </a>
              ))}
            </nav>
          )}
          {badge && (
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold sm:text-sm ${badge.classes}`}
            >
              {badge.label}
            </span>
          )}
        </div>
      </div>

      {/* Console strip — compact second-row links to the Act 5–6 screens */}
      <div className="border-b border-hairline bg-white">
        <nav
          aria-label="Consoles"
          className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 text-xs sm:px-6"
        >
          <span className="font-semibold tracking-[0.14em] text-brand uppercase">
            Research
          </span>
          {RESEARCH_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="font-medium text-graphite hover:text-brand"
            >
              {link.label}
            </Link>
          ))}
          <span
            aria-hidden
            className="mx-1 hidden h-3.5 border-l border-hairline sm:inline-block"
          />
          <span className="font-semibold tracking-[0.14em] text-lake uppercase">
            Compliance
          </span>
          {COMPLIANCE_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="font-medium text-graphite hover:text-brand"
            >
              {link.label}
            </Link>
          ))}
          <span
            aria-hidden
            className="mx-1 hidden h-3.5 border-l border-hairline sm:inline-block"
          />
          <span className="font-semibold tracking-[0.14em] text-navy uppercase">
            Business
          </span>
          {BUSINESS_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="font-medium text-graphite hover:text-brand"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
