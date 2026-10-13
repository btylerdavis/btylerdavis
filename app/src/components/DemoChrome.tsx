"use client";

import { usePathname } from "next/navigation";
import { DemoNavigator } from "@/components/DemoNavigator";
import { DemoWatermark } from "@/components/DemoWatermark";

/** Demo navigator + "Demo data" chip on every demo screen, but not on the
 * program dashboard, which shows the real plan rather than synthetic data. */
export function DemoChrome() {
  const pathname = usePathname() ?? "";
  if (pathname.startsWith("/dashboard")) return null;
  return (
    <>
      <DemoNavigator />
      <DemoWatermark />
    </>
  );
}
