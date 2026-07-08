import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/**
 * Pill buttons matching the site's shape language (tokens.json shape):
 * full-radius, solid brandBlue with white text; accentPurple variant for
 * portal/external-style actions (the "Sleeptopia Direct" pattern).
 */
export type ButtonVariant = "primary" | "purple" | "outline" | "quiet" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-blue text-white hover:bg-navy focus-visible:outline-brand-blue",
  purple:
    "bg-accent-purple text-white hover:bg-hero-navy focus-visible:outline-accent-purple",
  outline:
    "border border-brand-blue/60 bg-white text-navy hover:bg-pale-blue focus-visible:outline-brand-blue",
  quiet:
    "bg-transparent text-navy underline-offset-4 hover:underline focus-visible:outline-brand-blue",
  danger:
    "bg-danger text-white hover:bg-hero-navy focus-visible:outline-danger",
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
    "inline-flex items-center justify-center gap-2 rounded-full font-heading font-semibold transition-colors",
    "focus-visible:outline-2 focus-visible:outline-offset-2",
    "disabled:cursor-not-allowed disabled:opacity-45",
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
