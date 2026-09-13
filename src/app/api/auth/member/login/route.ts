import { NextResponse, type NextRequest } from "next/server";
import {
  buildMemberAuthorize,
  MEMBER_STATE_COOKIE_NAME,
  STATE_COOKIE_MAX_AGE,
} from "@/lib/discord-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/member/login?next=/members — starts the MEMBER OAuth
 * round-trip. Separate endpoint from admin/captain login: writes its own
 * state cookie and its callback mints a row in `member_sessions`, which no
 * admin or captain check reads.
 */
export async function GET(req: NextRequest) {
  const next = req.nextUrl.searchParams.get("next") ?? "/members";
  const result = await buildMemberAuthorize(next);
  if (!result) {
    return NextResponse.redirect(new URL("/members?authError=config", req.url));
  }
  const res = NextResponse.redirect(result.url);
  res.cookies.set(MEMBER_STATE_COOKIE_NAME, result.stateCookieValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: STATE_COOKIE_MAX_AGE,
  });
  return res;
}
