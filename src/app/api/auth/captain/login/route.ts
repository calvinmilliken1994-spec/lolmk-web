import { NextResponse, type NextRequest } from "next/server";
import {
  buildCaptainAuthorize,
  CAPTAIN_STATE_COOKIE_NAME,
  STATE_COOKIE_MAX_AGE,
} from "@/lib/discord-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/captain/login?next=/captain — starts the CAPTAIN OAuth
 * round-trip. Deliberately a separate endpoint from the admin one at
 * /api/auth/discord/login: it writes a different state cookie and its
 * callback mints a row in `captain_sessions`, which no admin check reads.
 */
export async function GET(req: NextRequest) {
  const next = req.nextUrl.searchParams.get("next") ?? "/captain";
  const result = await buildCaptainAuthorize(next);
  if (!result) {
    // CAPTAIN_ROLE_ID (or the shared Discord app config) isn't set. Fail
    // closed: there is no fallback that grants a captain session.
    return NextResponse.redirect(new URL("/captain/login?error=config", req.url));
  }
  const res = NextResponse.redirect(result.url);
  res.cookies.set(CAPTAIN_STATE_COOKIE_NAME, result.stateCookieValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: STATE_COOKIE_MAX_AGE,
  });
  return res;
}
