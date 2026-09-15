import { NextResponse } from "next/server";
import { isToolsSession } from "@/lib/tools-auth";
import { getMemberSession } from "@/lib/discord-auth";
import { searchGuildMembers, isBotSearchConfigured } from "@/lib/discord-bot";

export const dynamic = "force-dynamic";

/**
 * Guild member search for premade-team invite UI. Requires a signed-in
 * caller (admin OR verified member — captains inviting teammates are
 * verified members, not admins) so this can never be hit anonymously.
 * Returns minimal candidate data only (id/displayName/avatarUrl) — no
 * roles, no full directory dump. Results are candidates only; every real
 * authorization check happens server-side again in inviteToApplication().
 */
export async function GET(req: Request) {
  const [admin, member] = await Promise.all([isToolsSession(), getMemberSession()]);
  if (!admin && !member) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!isBotSearchConfigured()) {
    return NextResponse.json({ error: "Member search isn't configured yet." }, { status: 503 });
  }

  const url = new URL(req.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  if (query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const results = await searchGuildMembers(query, 8);
  if (results === null) {
    return NextResponse.json({ error: "Search is temporarily unavailable — try again shortly." }, { status: 503 });
  }
  return NextResponse.json({
    results: results.map((r) => ({ discordUserId: r.discordUserId, displayName: r.displayName, avatarUrl: r.avatarUrl })),
  });
}
