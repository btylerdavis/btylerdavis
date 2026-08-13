"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Floating "Demo map" navigator — a rehearsal aid pinned bottom-right on
 * every page via the root layout (it sits just above the DEMO DATA chip).
 * Collapsed by default; expands upward to the eight acts of DEMO.md §2 with
 * the current act highlighted by pathname. Pure UI: client component, no
 * data fetching, collapses on navigation, Escape closes.
 */

/**
 * Marcus Reed's seeded participant id, inlined exactly as DEMO-SCRIPT.md
 * inlines it (it mirrors MARCUS_REED_PARTICIPANT_ID in
 * lib/synthetic/profiles.ts, which stays out of the client bundle).
 */
const MARCUS = "d81a5f64-9c3e-4b7a-8f21-6e0a4c9b5d17";

const ACTS: { title: string; links: { label: string; href: string }[] }[] = [
  { title: "Retail door", links: [{ label: "Retail door", href: "/enroll/retail" }] },
  { title: "Clinic door", links: [{ label: "Clinic door", href: "/enroll/clinic" }] },
  { title: "Time machine", links: [{ label: "Time machine", href: "/timemachine" }] },
  {
    title: "Marcus + coach",
    links: [
      { label: "Marcus's trends", href: `/participant/${MARCUS}/trends` },
      { label: "Coach portal", href: "/coach" },
    ],
  },
  { title: "Research", links: [{ label: "Research", href: "/research/positional" }] },
  {
    title: "Compliance",
    links: [
      { label: "De-id", href: "/research/deid" },
      { label: "Revocation", href: "/compliance/revocation" },
    ],
  },
  {
    title: "Business",
    links: [
      { label: "Partner", href: "/partner" },
      { label: "Exec", href: "/exec" },
    ],
  },
  { title: "Reveal", links: [{ label: "Reveal", href: "/dev/status" }] },
];

/** True when the current pathname lives under this act's link. */
function linkIsCurrent(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DemoNavigator() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Collapse whenever navigation lands on a new page (guarded render-time
  // state adjustment — the React-endorsed alternative to a setState effect).
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setOpen(false);
  }

  // Escape closes the expanded map and hands focus back to the pill.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const currentAct = ACTS.findIndex((act) =>
    act.links.some((link) => linkIsCurrent(link.href, pathname ?? ""))
  );

  return (
    <div className="fixed right-3 bottom-11 z-50 flex flex-col items-end print:hidden">
      {open && (
        <nav
          id="demo-navigator-acts"
          aria-label="Demo map — the eight acts"
          className="mb-2 w-64 rounded-card border border-white/10 bg-hero-navy/95 p-3 text-white shadow-card-lg backdrop-blur-sm"
        >
          <p className="px-1 text-[10px] font-semibold tracking-[0.18em] text-sky-blue uppercase">
            The eight acts
          </p>
          <ol className="mt-1.5 space-y-0.5">
            {ACTS.map((act, index) => {
              const isCurrentAct = index === currentAct;
              return (
                <li
                  key={act.title}
                  className={`flex items-baseline gap-2 rounded-lg px-1.5 py-1 text-sm ${
                    isCurrentAct ? "bg-white/10" : ""
                  }`}
                >
                  <span
                    className={`font-heading text-xs font-semibold ${
                      isCurrentAct ? "text-sky-blue" : "text-white/40"
                    }`}
                    aria-hidden
                  >
                    {index + 1}
                  </span>
                  <span className="flex flex-wrap gap-x-2">
                    {act.links.map((link, linkIndex) => (
                      <span key={link.href} className="whitespace-nowrap">
                        {linkIndex > 0 && (
                          <span aria-hidden className="mr-2 text-white/30">
                            ·
                          </span>
                        )}
                        <Link
                          href={link.href}
                          aria-current={
                            linkIsCurrent(link.href, pathname ?? "") ? "page" : undefined
                          }
                          className={`font-semibold underline-offset-4 hover:underline ${
                            linkIsCurrent(link.href, pathname ?? "")
                              ? "text-sky-blue"
                              : "text-white/85 hover:text-white"
                          }`}
                        >
                          {link.label}
                        </Link>
                      </span>
                    ))}
                  </span>
                </li>
              );
            })}
          </ol>
        </nav>
      )}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={open ? "demo-navigator-acts" : undefined}
        className="flex items-center gap-1.5 rounded-full border border-white/10 bg-hero-navy/95 px-3.5 py-1.5 font-heading text-xs font-semibold text-white shadow-card-lg backdrop-blur-sm transition-colors hover:bg-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
      >
        Demo map
        <span aria-hidden className="text-[9px] text-sky-blue">
          {open ? "▼" : "▲"}
        </span>
      </button>
    </div>
  );
}
