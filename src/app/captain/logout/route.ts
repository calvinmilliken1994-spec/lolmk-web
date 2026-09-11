import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { CAPTAIN_SESSION_COOKIE_NAME, endCaptainSession } from "@/lib/discord-auth";

export const dynamic = "force-dynamic";

/**
 * POST /captain/logout. POST rather than GET for the same reason the admin
 * logout is: a GET logout is trivially triggerable cross-site and gets
 * fired by Next.js's <Link> prefetching before anyone clicks it.
 */
export async function POST(req: NextRequest) {
  const store = await cookies();
  const token = store.get(CAPTAIN_SESSION_COOKIE_NAME)?.value;
  if (token) await endCaptainSession(token);

  const res = NextResponse.redirect(new URL("/captain/login", req.url), { status: 303 });
  res.cookies.delete({ name: CAPTAIN_SESSION_COOKIE_NAME, path: "/" });
  return res;
}
