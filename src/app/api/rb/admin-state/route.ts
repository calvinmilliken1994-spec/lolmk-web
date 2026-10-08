import { NextResponse } from "next/server";
import { isToolsSession } from "@/lib/tools-auth";
import { getTournamentFull, listAudit } from "@/lib/rb-db";
import { computeRbStandings } from "@/lib/rb-service";

export const dynamic = "force-dynamic";

/** How many audit entries the desk receives with each poll. */
const AUDIT_LIMIT = 50;

/**
 * Admin-only full state for one Riftbound tournament, polled by the desk and
 * the judges' floor view so they keep up with results reported elsewhere.
 *
 * The counterpart to /api/rb/state and not to be confused with it: this
 * carries Discord ids, flags, reporters, idempotency keys, the tiebreak seed
 * and the latest audit entries. Hence the isToolsSession() gate before any
 * read happens, and no-store on the way out.
 *
 * Looked up by `?slug=` (case-insensitive), like the public route.
 */
export async function GET(req: Request) {
  const signedIn = await isToolsSession();
  if (!signedIn) return NextResponse.json({ error: "Not authorized." }, { status: 401 });

  const slug = (new URL(req.url).searchParams.get("slug") ?? "").trim();
  if (!slug) return NextResponse.json({ error: "Missing slug." }, { status: 400 });

  const full = await getTournamentFull(slug);
  if (!full) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const audit = await listAudit(full.tournament.id, AUDIT_LIMIT);
  return NextResponse.json(
    { ...full, standings: computeRbStandings(full), audit, serverNow: Date.now() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
