import { NextResponse } from "next/server";
import { getPublicTournament, getTournamentFull } from "@/lib/rb-db";
import { computeRbStandings } from "@/lib/rb-service";

export const dynamic = "force-dynamic";

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
  const slug = (new URL(req.url).searchParams.get("slug") ?? "").trim();
  if (!slug) {
    return NextResponse.json({ error: "Missing slug." }, { status: 400 });
  }

  const data = await getPublicTournament(slug);
  if (!data) {
    return NextResponse.json(
      { error: "Not found." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  const full = await getTournamentFull(slug);
  const standings = full ? computeRbStandings(full) : [];
  return NextResponse.json({ ...data, standings }, { headers: { "Cache-Control": "no-store" } });
}
