import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import {
  handleCaptainCallback,
  CAPTAIN_SESSION_COOKIE_NAME,
  CAPTAIN_SESSION_COOKIE_MAX_AGE,
  CAPTAIN_STATE_COOKIE_NAME,
} from "@/lib/discord-auth";

export const dynamic = "force-dynamic";

/** GET /api/auth/captain/callback — Discord returns here after the captain approves/denies. */
export async function GET(req: NextRequest) {
  const params = {
    code: req.nextUrl.searchParams.get("code") ?? undefined,
    state: req.nextUrl.searchParams.get("state") ?? undefined,
    error: req.nextUrl.searchParams.get("error") ?? undefined,
  };
  const store = await cookies();
  const stateCookie = store.get(CAPTAIN_STATE_COOKIE_NAME)?.value;

  const result = await handleCaptainCallback(params, stateCookie);

  if (!result.ok) {
    const loginUrl = new URL("/captain/login", req.url);
    loginUrl.searchParams.set("error", result.reason);
    const res = NextResponse.redirect(loginUrl);
    res.cookies.delete({ name: CAPTAIN_STATE_COOKIE_NAME, path: "/" });
    return res;
  }

  const res = NextResponse.redirect(new URL(result.nextPath, req.url));
  res.headers.set("Cache-Control", "no-store");
  res.cookies.delete({ name: CAPTAIN_STATE_COOKIE_NAME, path: "/" });
  // A DIFFERENT cookie name from the admin session. A captain holding this
  // cookie satisfies no admin check anywhere in the app.
  res.cookies.set(CAPTAIN_SESSION_COOKIE_NAME, result.sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CAPTAIN_SESSION_COOKIE_MAX_AGE,
  });
  return res;
}
