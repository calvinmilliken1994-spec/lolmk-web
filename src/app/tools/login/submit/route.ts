import { NextRequest, NextResponse } from "next/server";
import {
  TOOLS_COOKIE_MAX_AGE,
  TOOLS_COOKIE_NAME,
  getToolsCredentials,
  hashToolsCredentials,
} from "@/lib/tools-auth";

export const dynamic = "force-dynamic";

async function handleLogin(username: unknown, password: unknown, wantsJson: boolean) {
  const creds = getToolsCredentials();
  if (!creds) {
    if (!wantsJson) return NextResponse.redirect(new URL("/tools/login?error=1", "http://x"));
    return NextResponse.json({ error: "Admin login is not configured." }, { status: 503 });
  }
  if (typeof username !== "string" || typeof password !== "string") {
    if (!wantsJson) return NextResponse.redirect(new URL("/tools/login?error=1", "http://x"));
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const expected = hashToolsCredentials(creds.username, creds.password);
  const actual = hashToolsCredentials(username.trim(), password);
  if (actual !== expected) {
    if (!wantsJson) return NextResponse.redirect(new URL("/tools/login?error=1", "http://x"));
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }

  const res = wantsJson
    ? NextResponse.json({ ok: true })
    : NextResponse.redirect(new URL("/tools", "http://x"));
  res.cookies.set(TOOLS_COOKIE_NAME, expected, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/tools",
    maxAge: TOOLS_COOKIE_MAX_AGE,
  });
  return res;
}

/**
 * POST /tools/login/submit — validates the base ID + password, sets the
 * session cookie. Accepts JSON (the normal fetch()-driven form) AND
 * application/x-www-form-urlencoded (the plain HTML <form method="post">
 * fallback for when JavaScript fails to load) so the login wall still works
 * without JS, without ever leaking credentials into a URL.
 */
export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";
  const isFormPost = contentType.includes("application/x-www-form-urlencoded");

  if (isFormPost) {
    const formData = await req.formData();
    const res = await handleLogin(formData.get("username"), formData.get("password"), false);
    // Redirect responses above use a placeholder origin; rewrite to the real one.
    if (res.headers.get("location")) {
      const loc = new URL(res.headers.get("location")!);
      const real = new URL(loc.pathname + loc.search, req.url);
      const redirected = NextResponse.redirect(real, { status: 303 });
      res.cookies.getAll().forEach((c) => redirected.cookies.set(c));
      return redirected;
    }
    return res;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const { username, password } = (body ?? {}) as { username?: string; password?: string };
  return handleLogin(username, password, true);
}
