import { NextResponse, type NextRequest } from "next/server";

/**
 * Dashboard-only deployments (DASHBOARD_ONLY=1): until Phase 1 puts the
 * full platform on a hosted database, the public deployment serves just
 * /dashboard. Every other page redirects there instead of failing without
 * a database. Unset, the app behaves exactly as before.
 */
export function proxy(request: NextRequest) {
  if (process.env.DASHBOARD_ONLY !== "1") return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/dashboard")) return NextResponse.next();
  return NextResponse.redirect(new URL("/dashboard", request.url));
}

export const config = {
  matcher: ["/((?!_next/|brand/|video/|favicon.ico).*)"],
};
