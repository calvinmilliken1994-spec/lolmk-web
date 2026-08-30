import { NextResponse } from "next/server";
import { getMayhemFull } from "@/lib/mayhem-db";

export const dynamic = "force-dynamic";

/** Polled by /mayhemlive every ~1.5s. Public read-only state. */
export async function GET() {
  const data = await getMayhemFull();
  return NextResponse.json(data);
}
