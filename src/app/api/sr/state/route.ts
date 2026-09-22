import { NextResponse } from "next/server";
import { getPublicTournamentBySlug } from "@/lib/sr-db";

export const dynamic = "force-dynamic";

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
  const slug = (new URL(req.url).searchParams.get("slug") ?? "").trim();
  if (!slug) {
    return NextResponse.json({ error: "Missing slug." }, { status: 400 });
  }

  const data = await getPublicTournamentBySlug(slug);
  if (!data) {
    return NextResponse.json(
      { error: "Not found." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
