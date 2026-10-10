import { NextResponse } from "next/server";
import { isToolsSession } from "@/lib/tools-auth";
import { getMayhemFull, listMayhemAudit } from "@/lib/mayhem-db";
import type { MayhemAdminState } from "@/types/mayhem";

export const dynamic = "force-dynamic";

/**
 * Admin-only full state, including member_discord_id/captain_discord_id —
 * the fields getMayhemVenueState() (served at /api/mayhem/state) strips
 * for the public venue screen. Polled by the admin dashboard, which needs
 * the "verified member" checkmark and (future) captain tooling that reads
 * these identities, plus the newest audit rows for the desk's activity log.
 * Never cached (no-store) since it reflects live
 * roster/team state the admin is actively acting on.
 */
export async function GET(request: Request) {
  const signedIn = await isToolsSession();
  if (!signedIn) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const t = new URL(request.url).searchParams.get("t");
  if (!t) return NextResponse.json({ error: "Select a tournament." }, { status: 400 });
  const full = await getMayhemFull(t).catch(() => null);
  if (!full) return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
  const audit = await listMayhemAudit(t);
  const data: MayhemAdminState = { ...full, audit };
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
