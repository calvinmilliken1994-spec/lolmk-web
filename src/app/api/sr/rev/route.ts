import { NextResponse } from "next/server";
import { isToolsSession } from "@/lib/tools-auth";
import { srRevision } from "@/lib/live-revision";
import { memoizedLoad } from "@/lib/venue-memo";

export const dynamic = "force-dynamic";

/**
 * GET /api/sr/rev?slug=…        → { rev }  (venue screen, as /api/sr/state)
 * GET /api/sr/rev?t=<id>&admin=1 → { rev }  (desk, as /api/sr/admin-state)
 *
 * The cheap poll behind the SR screens; they fetch full state only when this
 * changes (see live-revision.ts). A 1s memo lets several screens share one
 * query.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const admin = q.get("admin") === "1";
  const slug = (q.get("slug") ?? "").trim();
  const id = (q.get("t") ?? "").trim();
  if (admin ? !id : !slug) return NextResponse.json({ error: "Missing tournament." }, { status: 400 });
  if (admin && !(await isToolsSession())) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  const memoKey = admin ? `sr:rev:a:${id}` : `sr:rev:p:${slug.toLowerCase()}`;
  const rev = await memoizedLoad(memoKey, 1000, () =>
    srRevision(admin ? { id } : { slug }, admin),
  ).catch(() => undefined);
  if (rev === undefined) return NextResponse.json({ error: "Unavailable." }, { status: 503 });
  if (rev === null) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ rev }, { headers: { "Cache-Control": "no-store" } });
}
