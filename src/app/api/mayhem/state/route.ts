import { NextResponse } from "next/server";
import { getMayhemVenueState } from "@/lib/mayhem-db";

export const dynamic = "force-dynamic";

/** Polled by /mayhemlive every ~1.5s. Public read-only state — venue-safe projection, no Discord identities. */
export async function GET() {
  const data = await getMayhemVenueState();
  return NextResponse.json(data);
}
