import { NextResponse } from "next/server";
import { isToolsSession } from "@/lib/tools-auth";
import { defaultMayhemPublicId, getMayhemVenueState } from "@/lib/mayhem-db";
import { mayhemRevision } from "@/lib/live-revision";
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
  // `rev` is read before the data (see rb/state). Preview stays unmemoized
  // (an admin is watching their own edits); public screens share one DB hit
  // per window, keyed by the revision they saw.
  const load = async () => {
    const id = tid ?? (await defaultMayhemPublicId());
    const rev = id ? await mayhemRevision(id, preview).catch(() => null) : null;
    return { ...(await getMayhemVenueState(id, preview)), rev };
  };
  const data = preview
    ? await load().catch(() => null)
    : await memoizedLoad(`mayhem:state:${tid ?? "latest"}:${q.get("rev") ?? ""}`, MEMO_TTL_MS, load).catch(() => null);
  if (!data) return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
