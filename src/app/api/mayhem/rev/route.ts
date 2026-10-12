import { NextResponse } from "next/server";
import { isToolsSession } from "@/lib/tools-auth";
import { mayhemRevision } from "@/lib/live-revision";
import { memoizedLoad } from "@/lib/venue-memo";

export const dynamic = "force-dynamic";

/**
 * GET /api/mayhem/rev?t=<event id>[&admin=1 | &preview=1] → { rev }
 *
 * The cheap poll behind /mayhemlive and the Mayhem desk; they fetch full
 * state only when this changes (see live-revision.ts). Admin and preview mode
 * see unpublished events and need a tools session. A 1s memo lets several
 * screens share one query.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const t = (q.get("t") ?? "").trim();
  if (!t) return NextResponse.json({ error: "Select a tournament." }, { status: 400 });
  const admin = q.get("admin") === "1" || q.get("preview") === "1";
  if (admin && !(await isToolsSession())) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  const rev = await memoizedLoad(`mayhem:rev:${admin ? "a" : "p"}:${t}`, 1000, () =>
    mayhemRevision(t, admin),
  ).catch(() => undefined);
  if (rev === undefined) return NextResponse.json({ error: "Unavailable." }, { status: 503 });
  if (rev === null) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ rev }, { headers: { "Cache-Control": "no-store" } });
}
