"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DUA_COOKIE, DUA_VERSION } from "./dua";

/**
 * The DUA gate (DEMO.md Act 7; SPEC §12.3): partners sign before they see
 * anything. Acceptance is a session cookie — close the browser and the next
 * demo run starts back at the agreement, which is the point.
 */

export async function acceptDua(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(DUA_COOKIE, DUA_VERSION, {
    httpOnly: true,
    sameSite: "lax",
    // no maxAge/expires: session cookie — the gate re-arms next browser session
  });
  redirect("/partner/dashboard");
}

export async function leaveDua(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(DUA_COOKIE);
  redirect("/partner");
}
