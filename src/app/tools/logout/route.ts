import { NextRequest, NextResponse } from "next/server";
import { TOOLS_COOKIE_NAME } from "@/lib/tools-auth";

export const dynamic = "force-dynamic";

/**
 * GET /tools/logout — clears the admin-tools session cookie and returns to the
 * landing page. A route handler (not a page): Server Components can't write
 * cookies, only Server Actions, Route Handlers, and middleware can.
 */
export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/tools", req.url));
  res.cookies.delete({ name: TOOLS_COOKIE_NAME, path: "/tools" });
  return res;
}
