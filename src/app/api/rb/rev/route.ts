import { NextResponse } from "next/server";
import { isToolsSession } from "@/lib/tools-auth";
import { rbRevision } from "@/lib/live-revision";
import { memoizedLoad } from "@/lib/venue-memo";

export const dynamic = "force-dynamic";

/**
 * GET /api/rb/rev?slug=…[&admin=1] → { rev }
 *
 * The cheap poll behind the Riftbound venue screen, desk and floor view.
 * They fetch the full state only when this changes (see live-revision.ts).
 * Admin mode also covers the audit log and needs a tools session. A 1s memo
 * lets several screens share one query.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const slug = (q.get("slug") ?? "").trim();
  if (!slug) return NextResponse.json({ error: "Missing slug." }, { status: 400 });
  const admin = q.get("admin") === "1";
  if (admin && !(await isToolsSession())) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  const rev = await memoizedLoad(`rb:rev:${admin ? "a" : "p"}:${slug.toLowerCase()}`, 1000, () =>
    rbRevision(slug, admin),
  ).catch(() => undefined);
  if (rev === undefined) return NextResponse.json({ error: "Unavailable." }, { status: 503 });
  if (rev === null) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ rev }, { headers: { "Cache-Control": "no-store" } });
}
