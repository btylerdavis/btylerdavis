import type { ReactNode } from "react";

/**
 * White 16px-radius card with a soft navy-tinted shadow — the site's card
 * pattern (tokens.json shape.cardRadius). `tone` variants cover the two
 * other panel styles seen on sleeptopia.com: pale-blue washes and the dark
 * heroNavy overlay card.
 */
export function Card({
  children,
  className = "",
  tone = "surface",
}: {
  children: ReactNode;
  className?: string;
  tone?: "surface" | "wash" | "dark";
}) {
  const tones = {
    surface: "bg-surface text-body shadow-card",
    wash: "bg-pale-blue text-body",
    dark: "bg-hero-navy text-white shadow-card-lg",
  } as const;
  return (
    <div className={`rounded-card ${tones[tone]} ${className}`}>{children}</div>
  );
}
