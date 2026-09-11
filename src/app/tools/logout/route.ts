import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, endSession } from "@/lib/discord-auth";

export const dynamic = "force-dynamic";

/**
 * POST /tools/logout — ends the Discord-backed admin session and clears
 * cookies. POST, not GET: a GET logout endpoint is a classic logout-CSRF
 * target (an attacker page can trivially trigger a cross-site GET via
 * <img src>), and it makes prefetching (Next.js prefetches same-origin
 * <Link> targets by default) a live footgun — a prefetched GET logout link
 * would silently kill the admin's session before they ever clicked it.
 *
 * Also clears the legacy `lolmk-tools` password-scheme cookie at both `/`
 * and `/tools` (the two paths it was ever set with across this app's
 * history) so anyone with a lingering pre-migration cookie is fully logged
 * out too, even though that cookie no longer authorizes anything on its
 * own.
 */
export async function POST(req: NextRequest) {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (token) await endSession(token);

  const res = NextResponse.redirect(new URL("/tools", req.url), { status: 303 });
  res.cookies.delete({ name: SESSION_COOKIE_NAME, path: "/" });
  res.cookies.delete({ name: "lolmk-tools", path: "/" });
  res.cookies.delete({ name: "lolmk-tools", path: "/tools" });
  return res;
}
