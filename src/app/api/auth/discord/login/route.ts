import { NextResponse, type NextRequest } from "next/server";
import { buildAuthorize, STATE_COOKIE_NAME, STATE_COOKIE_MAX_AGE } from "@/lib/discord-auth";

export const dynamic = "force-dynamic";

/** GET /api/auth/discord/login?next=/tools/xyz — kicks off the OAuth redirect. */
export async function GET(req: NextRequest) {
  const next = req.nextUrl.searchParams.get("next") ?? "/tools";
  const result = await buildAuthorize(next);
  if (!result) {
    return NextResponse.redirect(new URL("/tools/login?error=config", req.url));
  }
  const res = NextResponse.redirect(result.url);
  res.cookies.set(STATE_COOKIE_NAME, result.stateCookieValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: STATE_COOKIE_MAX_AGE,
  });
  return res;
}
