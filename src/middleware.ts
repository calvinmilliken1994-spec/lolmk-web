import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@vercel/postgres";

/**
 * Login wall for the admin tools area, Discord OAuth-backed.
 *
 * CHEAP, Edge-compatible presence/expiry check only — @vercel/postgres's
 * tagged-template `sql` is fetch-based (verified: dist/index.js has no
 * TCP/net imports, unlike index-node.js which is the pg-Pool-based build
 * for real Node servers) so it's safe to call from the Edge middleware
 * runtime. This does NOT do full role re-verification against Discord —
 * that's isToolsSession() in discord-auth.ts, called from every protected
 * Node-runtime page/server action directly. Middleware is defense in
 * depth, not the only gate — server actions don't route through it at all.
 *
 * token_hash matches admin-session-db.ts / member-session-db.ts: the
 * cookie holds the raw token, only its SHA-256 digest is ever looked up
 * here or stored in Postgres. Hashing uses Web Crypto (crypto.subtle), NOT
 * node:crypto — Next.js middleware runs on the Edge runtime, which does
 * not have Node's crypto module. node:crypto here would fail at request
 * time even though it typechecks fine (tsc has no idea which runtime a
 * file executes under).
 *
 * TWO valid cookies, checked in order: the dedicated admin session
 * (lolmk-admin-session), or a verified-member session (lolmk-member-session)
 * whose CACHED is_admin column is true. This is a cheap presence check on
 * BOTH paths — just like the admin-only path always was, it does not prove
 * the role still holds on Discord right now. That authoritative check is
 * still isToolsSession() in discord-auth.ts, which re-verifies a member
 * session's admin role on the same REVERIFY_INTERVAL_MS cadence as a
 * dedicated admin session and denies access if it's gone. Middleware
 * merely decides whether a request is even worth letting through to that
 * real check; a stale is_admin=true row here can get a member as far as a
 * page render, but every server action and server component underneath
 * still calls isToolsSession() independently and will reject a role that
 * Discord no longer grants.
 */

const ADMIN_SESSION_COOKIE_NAME = "lolmk-admin-session";
const MEMBER_SESSION_COOKIE_NAME = "lolmk-member-session";

async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname === "/tools" ||
    pathname === "/tools/" ||
    pathname.startsWith("/tools/login") ||
    pathname.startsWith("/tools/logout")
  ) {
    return NextResponse.next();
  }

  const adminToken = req.cookies.get(ADMIN_SESSION_COOKIE_NAME)?.value;
  const memberToken = req.cookies.get(MEMBER_SESSION_COOKIE_NAME)?.value;
  const loginUrl = new URL("/tools/login", req.url);
  loginUrl.searchParams.set("next", pathname);

  if (!adminToken && !memberToken) {
    return NextResponse.redirect(loginUrl);
  }

  try {
    if (adminToken) {
      const tokenHash = await hashToken(adminToken);
      const { rows } = await sql`
        SELECT 1 FROM admin_sessions WHERE token_hash = ${tokenHash} AND expires_at > now()
      `;
      if (rows.length > 0) return NextResponse.next();
    }
    if (memberToken) {
      const tokenHash = await hashToken(memberToken);
      const { rows } = await sql`
        SELECT 1 FROM member_sessions
        WHERE token_hash = ${tokenHash} AND expires_at > now() AND is_admin = true
      `;
      if (rows.length > 0) return NextResponse.next();
    }
    return NextResponse.redirect(loginUrl);
  } catch {
    // DB unreachable from the Edge runtime: fail closed.
    return NextResponse.redirect(loginUrl);
  }
}

export const config = {
  matcher: ["/tools/:path*"],
};
