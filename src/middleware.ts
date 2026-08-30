import { NextResponse, type NextRequest } from "next/server";

/**
 * Login wall for the admin tools area. Everything under /tools is protected
 * except the landing page itself, the login form, and the logout endpoint.
 *
 * The cookie value is sha256("username:password"); we recompute the expected
 * hash from the env credentials and compare. Unset credentials fail closed —
 * visitors get the login page, never the tools.
 */

const COOKIE_NAME = "lolmk-tools";

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public by design: the landing page is the front door, login/logout are
  // how you go through it.
  if (
    pathname === "/tools" ||
    pathname === "/tools/" ||
    pathname.startsWith("/tools/login") ||
    pathname.startsWith("/tools/logout")
  ) {
    return NextResponse.next();
  }

  const username = (process.env.TOOLS_ADMIN_USERNAME ?? "").trim();
  const password = (process.env.TOOLS_ADMIN_PASSWORD ?? "").trim();
  const loginUrl = new URL("/tools/login", req.url);

  if (!username || !password) {
    return NextResponse.redirect(loginUrl);
  }

  const expected = await sha256Hex(`${username}:${password}`);
  const value = req.cookies.get(COOKIE_NAME)?.value;
  if (value && value === expected) {
    return NextResponse.next();
  }

  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/tools/:path*"],
};
