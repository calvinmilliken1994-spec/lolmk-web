import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import {
  handleMemberCallback,
  MEMBER_SESSION_COOKIE_NAME,
  MEMBER_SESSION_COOKIE_MAX_AGE,
  MEMBER_STATE_COOKIE_NAME,
} from "@/lib/discord-auth";

export const dynamic = "force-dynamic";

/** GET /api/auth/member/callback — Discord returns here after the member approves/denies. */
export async function GET(req: NextRequest) {
  const params = {
    code: req.nextUrl.searchParams.get("code") ?? undefined,
    state: req.nextUrl.searchParams.get("state") ?? undefined,
    error: req.nextUrl.searchParams.get("error") ?? undefined,
  };
  const store = await cookies();
  const stateCookie = store.get(MEMBER_STATE_COOKIE_NAME)?.value;

  const result = await handleMemberCallback(params, stateCookie);

  if (!result.ok) {
    // No dedicated /members/login page — errors surface as a query param on
    // the directory page itself, which is also where the login button lives.
    const errorUrl = new URL("/members", req.url);
    errorUrl.searchParams.set("authError", result.reason);
    const res = NextResponse.redirect(errorUrl);
    res.cookies.delete({ name: MEMBER_STATE_COOKIE_NAME, path: "/" });
    return res;
  }

  const res = NextResponse.redirect(new URL(result.nextPath, req.url));
  res.headers.set("Cache-Control", "no-store");
  res.cookies.delete({ name: MEMBER_STATE_COOKIE_NAME, path: "/" });
  res.cookies.set(MEMBER_SESSION_COOKIE_NAME, result.sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MEMBER_SESSION_COOKIE_MAX_AGE,
  });
  return res;
}
