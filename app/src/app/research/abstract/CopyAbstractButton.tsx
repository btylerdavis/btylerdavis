"use client";

import { useState } from "react";
import { Button } from "@/components/Button";

/** Copies the abstract's plain-text rendering to the clipboard. */
export function CopyAbstractButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2500);
  };

  return (
    <Button variant="outline" size="sm" onClick={copy}>
      {state === "copied"
        ? "Copied ✓"
        : state === "failed"
          ? "Copy blocked — select & copy manually"
          : "Copy as text"}
    </Button>
  );
}
