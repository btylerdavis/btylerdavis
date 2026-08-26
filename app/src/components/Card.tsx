import type { ReactNode } from "react";

/**
 * The new design language's card (sleeptopia-site design/DIRECTION.md):
 * white 16px-radius surface with a 1px hairline — shadowless, elevation by
 * surface contrast (white ↔ cream ↔ navy). `tone` variants cover the two
 * other panel styles: the nested vellum wash and the dark navy proof panel.
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
    surface: "border border-hairline bg-white text-ink",
    wash: "border border-hairline bg-vellum text-ink",
    dark: "bg-navy text-white",
  } as const;
  return (
    <div className={`rounded-card ${tones[tone]} ${className}`}>{children}</div>
  );
}
