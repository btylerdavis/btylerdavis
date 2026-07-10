"use client";

import { useState } from "react";
import { DentiTracPanel } from "./DentiTracPanel";
import { ImportFlow } from "./ImportFlow";

/**
 * Tab shell for /coach/import: the real, consent-gated device import flow
 * (Apple Health / AirView — writes through the ingest gate) beside the
 * DentiTrac pilot tab (parse + preview only, no writes; DEMO.md §3).
 */

const TABS = [
  { key: "devices", label: "Device files (Apple Health · AirView)" },
  { key: "dentitrac", label: "DentiTrac (pilot preview)" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function ImportTabs() {
  const [tab, setTab] = useState<TabKey>("devices");

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Import source" className="flex flex-wrap gap-1.5">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            role="tab"
            type="button"
            aria-selected={tab === entry.key}
            onClick={() => setTab(entry.key)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
              tab === entry.key
                ? "bg-navy text-white"
                : "bg-white text-navy hover:bg-utility-bar"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {tab === "devices" ? <ImportFlow /> : <DentiTracPanel />}
    </div>
  );
}
