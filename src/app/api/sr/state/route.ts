import { NextResponse } from "next/server";
import { getPublicTournamentBySlug } from "@/lib/sr-db";
import { memoizedLoad } from "@/lib/venue-memo";
import { srRevision } from "@/lib/live-revision";

export const dynamic = "force-dynamic";

/** See rb/state: memoize the public read so open venue screens share DB hits. */
const MEMO_TTL_MS = 5000;

/**
 * Polled by /srlive/[slug] every ~2s. Public, unauthenticated, read-only.
 *
 * The projection is getPublicTournamentBySlug's and nothing else — the same
 * one the public bracket page already serves. That matters more here than
 * convenience: it means the venue screen physically cannot leak
 * captain_discord_id, player discord_ids, seed_locked, pending/rejected
 * teams, or any application data, because none of those survive
 * toPublicTournament/toPublicTeam/toPublicPlayer. Adding a field to the wire
 * format would require editing those mappers, where the decision is
 * documented.
 *
 * A draft tournament returns 404, identically to one that doesn't exist. The
 * live screen renders a neutral holding card for that, so an admin previewing
 * a tournament they haven't published yet sees a blank stage rather than an
 * error — and a stranger guessing slugs learns nothing either way.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const slug = (q.get("slug") ?? "").trim();
  if (!slug) {
    return NextResponse.json({ error: "Missing slug." }, { status: 400 });
  }

  // See rb/state: memo keyed by the revision the screen saw; `rev` in the
  // body is read before the data.
  const seen = q.get("rev") ?? "";
  const data = await memoizedLoad(`sr:state:${slug.toLowerCase()}:${seen}`, MEMO_TTL_MS, async () => {
    const rev = await srRevision({ slug }, false).catch(() => null);
    const full = await getPublicTournamentBySlug(slug, { includeTest: true });
    return full ? { ...full, rev } : null;
  });
  if (!data) {
    return NextResponse.json(
      { error: "Not found." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
