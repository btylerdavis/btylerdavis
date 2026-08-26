import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/**
 * New Sleeptopia design language primitives — ported from the new site's
 * src/components/ui.tsx with exact values (design/DIRECTION.md, approved
 * Aug 18 2026). This module sets the standard the rest of the app moves to:
 *
 * - cream ground, white cards with 1px hairlines, 14–20px radii;
 * - elevation by surface contrast (white ↔ cream ↔ night navy), no shadows
 *   except the soft sun-CTA glow;
 * - Playfair Display serif for display statements, Hanken Grotesk for
 *   everything functional;
 * - the sun pill (#F6C453, near-black text) as THE action color; ghost
 *   pills for secondary actions; brand-blue arrow links for "go deeper".
 *
 * The `compact` pill size is a console-scale addition (same shape, colors,
 * and weights; smaller type) — the site's 17.5px hero pill is oversized for
 * dense queue rows.
 */

/* Exact pill base from the new site (ui.tsx pillBase). */
export const pillBase =
  "inline-flex items-center justify-center rounded-full font-grotesk font-semibold text-[17.5px] px-8 py-4 transition-[transform,background-color] duration-150 active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100";

const pillCompact =
  "inline-flex items-center justify-center rounded-full font-grotesk font-semibold text-[15px] px-5 py-2.5 transition-[transform,background-color] duration-150 active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100";

const sunClasses =
  "bg-sun text-[#161616] shadow-[0_8px_26px_rgba(235,181,59,0.35)] hover:bg-sun2";
const ghostClasses = "border border-ink text-ink hover:bg-black/5";

type PillSize = "full" | "compact";

const base = (size: PillSize) => (size === "full" ? pillBase : pillCompact);

interface PillButtonProps extends ComponentProps<"button"> {
  size?: PillSize;
}

/** Sun pill as a <button> — the one loud action color. */
export function PillSunButton({ size = "compact", className = "", type = "button", ...props }: PillButtonProps) {
  return <button type={type} className={`${base(size)} ${sunClasses} ${className}`} {...props} />;
}

/** Ghost pill as a <button> — the quiet secondary action. */
export function PillGhostButton({ size = "compact", className = "", type = "button", ...props }: PillButtonProps) {
  return <button type={type} className={`${base(size)} ${ghostClasses} ${className}`} {...props} />;
}

export function PillSunLink({ href, children, size = "full", className = "" }: { href: string; children: ReactNode; size?: PillSize; className?: string }) {
  return (
    <Link href={href} className={`${base(size)} ${sunClasses} ${className}`}>
      {children}
    </Link>
  );
}

export function PillGhostLink({ href, children, size = "full", className = "" }: { href: string; children: ReactNode; size?: PillSize; className?: string }) {
  return (
    <Link href={href} className={`${base(size)} ${ghostClasses} ${className}`}>
      {children}
    </Link>
  );
}

/** The site's arrow-link affordance — brand-blue semibold, trailing arrow. */
export function ArrowLink({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={`inline-block text-[16.5px] font-semibold text-brand underline-offset-4 hover:text-night hover:underline ${className}`}
    >
      {children} →
    </Link>
  );
}

/** Uppercase eyebrow — 13.5px / 600 / 0.16em / brand (globals `.eyebrow`). */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`eyebrow font-grotesk ${className}`}>{children}</div>;
}

/** Serif display heading, exact clamp from the new site's H2. */
export function Display({ children, className = "", as: Tag = "h1" }: { children: ReactNode; className?: string; as?: "h1" | "h2" }) {
  return (
    <Tag
      className={`font-display font-medium text-[clamp(40px,4.8vw,60px)] leading-[1.12] tracking-[-0.004em] text-balance text-ink ${className}`}
    >
      {children}
    </Tag>
  );
}

/** Smaller serif heading for card/section titles (same family + weight). */
export function SerifTitle({ children, className = "", as: Tag = "h2" }: { children: ReactNode; className?: string; as?: "h2" | "h3" }) {
  return (
    <Tag className={`font-display font-medium text-[26px] leading-[1.2] tracking-[-0.004em] text-ink ${className}`}>
      {children}
    </Tag>
  );
}

/** One-phrase highlight inside a serif heading (site `Highlight`). */
export function Highlight({ children }: { children: ReactNode }) {
  return <em className="not-italic text-lake">{children}</em>;
}

/** Section sub-line — 19.5px graphite (site `SectionSub`). */
export function SectionSub({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`mt-4 max-w-[56ch] text-balance text-[19.5px] text-graphite ${className}`}>{children}</p>;
}

/**
 * Hairline card: white surface, 1px hairline, 16px radius — the new
 * direction's shadowless card (elevation by surface contrast).
 */
export function HairlineCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-hairline bg-white ${className}`}>{children}</div>;
}

/** Nested vellum surface inside a white card. */
export function VellumPanel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl bg-vellum ${className}`}>{children}</div>;
}

/** Night band — the dark proof-point surface (navy #16304E). */
export function NightBand({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-night text-white ${className}`}>{children}</div>;
}
