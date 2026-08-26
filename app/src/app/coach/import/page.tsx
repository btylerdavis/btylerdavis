import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { ImportTabs } from "./ImportTabs";

/**
 * Real-file import screen (DEMO.md Act 3-4 reserve-turned-working beat):
 * Apple Health export.xml and AirView-format CSV, parsed for real, written
 * through the consent ingest gates, visible on the trends charts
 * immediately. The DentiTrac tab (DEMO.md §3 pilot integration) parses a
 * plausible wear-time export for PREVIEW only — no writes.
 */
export const metadata: Metadata = { title: "Device import" };

export const dynamic = "force-dynamic";

export default function CoachImportPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader variant="coach" />
      <main className="flex-1 bg-cream">
        <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-8 sm:px-6 sm:py-10">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold text-navy sm:text-3xl">Import device data</h1>
            <Link
              href="/coach"
              className="text-sm font-semibold text-brand underline-offset-4 hover:underline"
            >
              ← Coach portal
            </Link>
          </div>
          <ImportTabs />
        </div>
      </main>
      <Footer />
    </div>
  );
}
