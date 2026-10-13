import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Private-link access for /dashboard. When DASHBOARD_KEY is set, the page
 * opens only after a visit to /dashboard/access?k=<key>, which stores a
 * hash of the key in a cookie. Unset (local dev), the page is open. The
 * dashboard holds the plan, never patient data, so a private link
 * is the right weight; real logins arrive with Phase 1.
 */
export const ACCESS_COOKIE = "stp_dash";

const digest = (value: string) => createHash("sha256").update(value).digest();

export function accessToken(key: string): string {
  return digest(`stp-dashboard:${key}`).toString("hex");
}

export function keyMatches(candidate: string | null | undefined): boolean {
  const key = process.env.DASHBOARD_KEY;
  if (!key) return true;
  if (!candidate) return false;
  return timingSafeEqual(digest(candidate), digest(key));
}

export function hasDashboardAccess(cookieValue: string | undefined): boolean {
  const key = process.env.DASHBOARD_KEY;
  if (!key) return true;
  if (!cookieValue) return false;
  const expected = Buffer.from(accessToken(key));
  const given = Buffer.from(cookieValue);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
