import type { Metadata } from "next";
import { isToolsSession } from "@/lib/tools-auth";
import { notFound } from "next/navigation";
import { getMayhemVenueState } from "@/lib/mayhem-db";
import { MayhemLiveScreen } from "@/components/mayhem/mayhem-live-screen";
import { mayhemParseScene } from "@/components/mayhem/mayhem-deck-model";

export const metadata: Metadata = {
  title: "ARAM Mayhem — Live",
  description: "Live venue screen for LoLMK ARAM Mayhem tournaments.",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

type Query = { t?: string; scene?: string; preview?: string };

/**
 * `?scene=<id>&preview=1` renders that scene over the live data instead of
 * the one on air: the desk's Preview monitor. Read-only; nothing is
 * written. `scene` without `preview=1` is ignored, so a stray query string
 * can't change what the room sees.
 */
export default async function MayhemLivePage({ searchParams }: { searchParams: Promise<Query> }) {
  const q = await searchParams;
  const sceneOverride = q.preview === "1" ? mayhemParseScene(q.scene) : null;
  const preview = q.preview === "1";
  if (preview && !await isToolsSession()) notFound();
  const data = await getMayhemVenueState(q.t, preview).catch(() => null);
  if (!data) return <p className="container-wide py-20 text-ink-muted">No public tournament is available.</p>;
  return <MayhemLiveScreen key={data.event.id} initial={data} sceneOverride={sceneOverride} preview={preview} />;
}
