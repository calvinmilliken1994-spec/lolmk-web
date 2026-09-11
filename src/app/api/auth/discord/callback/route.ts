import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import {
  handleCallback,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_MAX_AGE,
  STATE_COOKIE_NAME,
} from "@/lib/discord-auth";

export const dynamic = "force-dynamic";

/** GET /api/auth/discord/callback — Discord redirects here after the user approves/denies. */
export async function GET(req: NextRequest) {
  const params = {
    code: req.nextUrl.searchParams.get("code") ?? undefined,
    state: req.nextUrl.searchParams.get("state") ?? undefined,
    error: req.nextUrl.searchParams.get("error") ?? undefined,
  };
  const store = await cookies();
  const stateCookie = store.get(STATE_COOKIE_NAME)?.value;

  const result = await handleCallback(params, stateCookie);

  if (!result.ok) {
    const loginUrl = new URL("/tools/login", req.url);
    loginUrl.searchParams.set("error", result.reason);
    const res = NextResponse.redirect(loginUrl);
    // Always clear the state cookie once consumed/attempted, success or not
    // — it's single-use by design and shouldn't linger for a retry.
    res.cookies.delete({ name: STATE_COOKIE_NAME, path: "/" });
    return res;
  }

  const res = NextResponse.redirect(new URL(result.nextPath, req.url));
  res.headers.set("Cache-Control", "no-store");
  res.cookies.delete({ name: STATE_COOKIE_NAME, path: "/" });
  res.cookies.set(SESSION_COOKIE_NAME, result.sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE,
  });
  return res;
}
