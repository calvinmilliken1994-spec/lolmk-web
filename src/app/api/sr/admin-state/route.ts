import { NextResponse } from "next/server";
import { isToolsSession } from "@/lib/tools-auth";
import { getTournamentFull, listAudit, listTournamentApplications } from "@/lib/sr-db";

export const dynamic = "force-dynamic";

/**
 * Admin-only full state for one tournament, polled by the dashboard so the
 * desk keeps up with results reported in another tab (or by another admin)
 * without a full RSC round-trip.
 *
 * This is the counterpart to /api/sr/state and the two must not be confused:
 * this one carries captain_discord_id, player discord_ids, pending and
 * rejected teams, in-flight applications, and the audit log — everything the
 * public projection deliberately drops. Hence the isToolsSession() gate
 * before any read happens, and no-store on the way out.
 *
 * The tournament id comes from `?t=`, matching the dashboard's own entry
 * point. It is only ever a lookup key: an admin session is authorized for
 * every tournament, so there is no per-row ownership to check.
 */
export async function GET(req: Request) {
  const signedIn = await isToolsSession();
  if (!signedIn) return NextResponse.json({ error: "Not authorized." }, { status: 401 });

  const tournamentId = (new URL(req.url).searchParams.get("t") ?? "").trim();
  if (!tournamentId) return NextResponse.json({ error: "Missing tournament id." }, { status: 400 });

  const full = await getTournamentFull(tournamentId);
  if (!full) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const [audit, applications] = await Promise.all([
    listAudit(tournamentId),
    listTournamentApplications(tournamentId),
  ]);

  return NextResponse.json(
    { ...full, audit, applications },
    { headers: { "Cache-Control": "no-store" } },
  );
}
