import { NextResponse } from "next/server";
import { isToolsSession } from "@/lib/tools-auth";
import { getMayhemVenueState } from "@/lib/mayhem-db";
import { memoizedLoad } from "@/lib/venue-memo";

export const dynamic = "force-dynamic";

/** See rb/state: memoize the public read so open venue screens share DB hits. */
const MEMO_TTL_MS = 5000;

/** Polled by /mayhemlive every ~1.5s. Public read-only state — venue-safe projection, no Discord identities. */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const preview = q.get("preview") === "1";
  if (preview && !await isToolsSession()) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const tid = q.get("t") ?? undefined;
  // Preview stays live (an admin is watching their own edits); the public
  // screen reads share one DB hit per window.
  const data = preview
    ? await getMayhemVenueState(tid, preview).catch(() => null)
    : await memoizedLoad(`mayhem:state:${tid ?? "latest"}`, MEMO_TTL_MS, () =>
        getMayhemVenueState(tid, preview),
      ).catch(() => null);
  if (!data) return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
