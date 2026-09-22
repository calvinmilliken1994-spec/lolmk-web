import { NextResponse } from "next/server";
import { getCaptainSession } from "@/lib/discord-auth";
import {
  isBotSearchConfigured,
  isVerifiedMemberCandidate,
  searchGuildMembers,
} from "@/lib/discord-bot";

export const dynamic = "force-dynamic";

/** Captain-only, verified-member guild search for the SR premade roster builder. */
export async function GET(req: Request) {
  const captain = await getCaptainSession();
  if (!captain) return NextResponse.json({ error: "Captain sign-in required." }, { status: 401 });
  if (!isBotSearchConfigured()) {
    return NextResponse.json({ error: "Member search isn't configured yet." }, { status: 503 });
  }

  const query = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (query.length < 2) return NextResponse.json({ results: [] });

  const results = await searchGuildMembers(query, 10);
  if (results === null) {
    return NextResponse.json({ error: "Search is temporarily unavailable — try again shortly." }, { status: 503 });
  }

  return NextResponse.json({
    results: results
      .filter(isVerifiedMemberCandidate)
      .slice(0, 8)
      .map(({ discordUserId, displayName, avatarUrl }) => ({ discordUserId, displayName, avatarUrl })),
  });
}
