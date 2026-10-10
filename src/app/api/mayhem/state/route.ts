import { NextResponse } from "next/server";
import { isToolsSession } from "@/lib/tools-auth";
import { getMayhemVenueState } from "@/lib/mayhem-db";

export const dynamic = "force-dynamic";

/** Polled by /mayhemlive every ~1.5s. Public read-only state — venue-safe projection, no Discord identities. */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const preview = q.get("preview") === "1";
  if (preview && !await isToolsSession()) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const data = await getMayhemVenueState(q.get("t") ?? undefined, preview).catch(() => null);
  if (!data) return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
