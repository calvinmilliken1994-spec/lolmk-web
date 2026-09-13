import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { MEMBER_SESSION_COOKIE_NAME, endMemberSession } from "@/lib/discord-auth";

export const dynamic = "force-dynamic";

/**
 * POST /members/logout — ends the member session. POST, not GET, for the
 * same logout-CSRF/prefetch reasons as /tools/logout and /captain/logout.
 */
export async function POST(req: NextRequest) {
  const store = await cookies();
  const token = store.get(MEMBER_SESSION_COOKIE_NAME)?.value;
  if (token) await endMemberSession(token);

  const res = NextResponse.redirect(new URL("/", req.url), { status: 303 });
  res.cookies.delete({ name: MEMBER_SESSION_COOKIE_NAME, path: "/" });
  return res;
}
