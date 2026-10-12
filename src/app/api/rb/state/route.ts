import { NextResponse } from "next/server";
import { getPublicTournament, getTournamentFull } from "@/lib/rb-db";
import { rbChampionSummary } from "@/lib/rb-cut";
import { computeRbStandings } from "@/lib/rb-service";
import { memoizedLoad } from "@/lib/venue-memo";
import { rbRevision } from "@/lib/live-revision";

export const dynamic = "force-dynamic";

/**
 * Public reads are memoized for a few seconds so N venue screens polling
 * this route cost one DB read per window instead of N — Neon egress is a
 * monthly quota and every one of those reads used to meter against it.
 * Admin desks use /api/rb/admin-state, which is not memoized, so admin
 * actions stay instant where it matters.
 */
const MEMO_TTL_MS = 5000;

/**
 * Polled by the venue screen (/rblive/[slug]) and the public tournament
 * page. Public, unauthenticated, read-only.
 *
 * The tournament payload is getPublicTournament's projection and nothing
 * else, so Discord ids, flags, reporters, idempotency keys, seeds, the audit
 * log and draft-round pairings cannot reach this response (see the toPublic*
 * mappers in rb-db.ts).
 *
 * Standings are added because they can only be computed server-side: the
 * random tiebreak needs the private tiebreak seed. A standing row is player
 * id, rank, record and percentages, all public; `dropped` already folds dq
 * in, matching toPublicPlayer. Draft rounds don't count toward them.
 *
 * A draft tournament returns 404, identically to one that doesn't exist.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const slug = (q.get("slug") ?? "").trim();
  if (!slug) {
    return NextResponse.json({ error: "Missing slug." }, { status: 400 });
  }

  // Both DB reads memoized together under the slug; serverNow stays per-request
  // so the venue clock never inherits another poll's timestamp.
  // Screens that poll /api/rb/rev pass the revision they saw (`rev`), so a
  // memoized body is never older than the change that prompted the fetch.
  // `rev` in the body is read before the data, so it's never newer than it.
  const seen = q.get("rev") ?? "";
  const body = await memoizedLoad(`rb:state:${slug.toLowerCase()}:${seen}`, MEMO_TTL_MS, async () => {
    const rev = await rbRevision(slug, false).catch(() => null);
    const data = await getPublicTournament(slug);
    if (!data) return null;
    const full = await getTournamentFull(slug);
    const standings = full ? computeRbStandings(full) : [];
    // The champion's Legend, seed and records are only published once the event is over.
    const champion = full ? rbChampionSummary(full, standings) : null;
    return { ...data, standings, champion, rev };
  });

  if (!body) {
    return NextResponse.json(
      { error: "Not found." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json({ ...body, serverNow: Date.now() }, { headers: { "Cache-Control": "no-store" } });
}
