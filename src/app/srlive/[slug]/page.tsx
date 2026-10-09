import type { Metadata } from "next";
import { SrLiveScreen } from "@/components/sr/sr-live-screen";
import { getPublicTournamentBySlug } from "@/lib/sr-db";
import { SR_SCENES, type SrMatchScene } from "@/types/sr-tournament";

export const metadata: Metadata = {
  title: "Summoner's Rift — Live",
  description: "Live venue screen for LoLMK Summoner's Rift tournaments.",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

type Query = { muted?: string; scene?: string; preview?: string };

function parseScene(value: string | undefined): SrMatchScene | null {
  return SR_SCENES.find((s) => s === value) ?? null;
}

/**
 * `?scene=<id>&preview=1` renders that scene over the live data instead of
 * the one on air: the desk's Preview monitor. Read-only, and always muted so
 * the preview never plays the reveal cue. `scene` without `preview=1` is
 * ignored, so a stray query string can't change what the room sees.
 */
export default async function SrLivePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Query>;
}) {
  const { slug } = await params;
  const q = await searchParams;
  const preview = q.preview === "1";
  const data = await getPublicTournamentBySlug(slug);
  return (
    <SrLiveScreen
      initial={data}
      slug={slug}
      muted={preview || q.muted === "1"}
      sceneOverride={preview ? parseScene(q.scene) : null}
    />
  );
}
