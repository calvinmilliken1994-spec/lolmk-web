import type { Metadata } from "next";
import { getMayhemVenueState } from "@/lib/mayhem-db";
import { MayhemLiveScreen } from "@/components/mayhem/mayhem-live-screen";
import { mayhemParseScene } from "@/components/mayhem/mayhem-deck-model";

export const metadata: Metadata = {
  title: "ARAM Mayhem — Live",
  description: "Live venue screen for LoLMK ARAM Mayhem tournaments.",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

type Query = { scene?: string; preview?: string };

/**
 * `?scene=<id>&preview=1` renders that scene over the live data instead of
 * the one on air: the desk's Preview monitor. Read-only; nothing is
 * written. `scene` without `preview=1` is ignored, so a stray query string
 * can't change what the room sees.
 */
export default async function MayhemLivePage({ searchParams }: { searchParams: Promise<Query> }) {
  const q = await searchParams;
  const sceneOverride = q.preview === "1" ? mayhemParseScene(q.scene) : null;
  const data = await getMayhemVenueState();
  return <MayhemLiveScreen initial={data} sceneOverride={sceneOverride} />;
}
