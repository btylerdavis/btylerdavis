import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, accessToken, keyMatches } from "@/lib/roadmap/access";

/** Private-link entry: /dashboard/access?k=<key> → cookie → /dashboard. */
export function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/dashboard", request.url));
  const key = process.env.DASHBOARD_KEY;
  if (key && keyMatches(request.nextUrl.searchParams.get("k"))) {
    response.cookies.set(ACCESS_COOKIE, accessToken(key), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 180,
    });
  }
  return response;
}
