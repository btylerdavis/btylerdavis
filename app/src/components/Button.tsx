import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/**
 * Pill buttons in the new Sleeptopia design language (sleeptopia-site
 * src/components/ui.tsx): full-radius pills, the sun fill (#F6C453, near-
 * black text, soft gold glow) as THE action color, ink-outline ghosts for
 * secondary actions, solid navy for console/portal actions, and a quiet
 * brand-blue text-link variant. Sizes are console-scale — same shape,
 * colors, and weights as the site's pills, smaller type for dense screens.
 */
export type ButtonVariant =
  | "primary"
  | "navy"
  | "outline"
  | "light"
  | "quiet"
  | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-sun text-[#161616] shadow-[0_8px_26px_rgba(235,181,59,0.35)] hover:bg-sun2 focus-visible:outline-sun2",
  navy: "bg-navy text-white hover:bg-navy2 focus-visible:outline-navy",
  outline:
    "border border-ink bg-transparent text-ink hover:bg-black/5 focus-visible:outline-navy",
  light:
    "border border-white/70 bg-transparent text-white hover:bg-white/10 focus-visible:outline-white",
  quiet:
    "bg-transparent text-brand underline-offset-4 hover:text-navy hover:underline focus-visible:outline-brand",
  danger: "bg-danger text-white hover:bg-navy focus-visible:outline-danger",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "px-4 py-1.5 text-sm",
  md: "px-6 py-2.5 text-sm sm:text-base",
  lg: "px-8 py-3 text-base sm:text-lg",
};

export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  extra = ""
): string {
  return [
    "inline-flex items-center justify-center gap-2 rounded-full font-sans font-semibold transition-[transform,background-color,color] duration-150 active:scale-[.97]",
    "focus-visible:outline-2 focus-visible:outline-offset-2",
    "disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100",
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    extra,
  ].join(" ");
}

interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses(variant, size, className)}
      {...props}
    />
  );
}

interface ButtonLinkProps {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className = "",
  children,
}: ButtonLinkProps) {
  return (
    <Link href={href} className={buttonClasses(variant, size, className)}>
      {children}
    </Link>
  );
}
