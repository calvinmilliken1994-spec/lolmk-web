import { NextResponse } from "next/server";
import { isToolsSession } from "@/lib/tools-auth";
import { getMayhemFull } from "@/lib/mayhem-db";

export const dynamic = "force-dynamic";

/**
 * Admin-only full state, including member_discord_id/captain_discord_id —
 * the fields getMayhemVenueState() (served at /api/mayhem/state) strips
 * for the public venue screen. Polled by the admin dashboard, which needs
 * the "verified member" checkmark and (future) captain tooling that reads
 * these identities. Never cached (no-store) since it reflects live
 * roster/team state the admin is actively acting on.
 */
export async function GET() {
  const signedIn = await isToolsSession();
  if (!signedIn) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const data = await getMayhemFull();
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
