import type { Metadata } from "next";
import { SrLiveScreen } from "@/components/sr/sr-live-screen";
import { getPublicTournamentBySlug } from "@/lib/sr-db";

export const metadata: Metadata = {
  title: "Summoner's Rift — Live",
  description: "Live venue screen for LoLMK Summoner's Rift tournaments.",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function SrLivePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ muted?: string }>;
}) {
  const { slug } = await params;
  const { muted } = await searchParams;
  const data = await getPublicTournamentBySlug(slug);
  return <SrLiveScreen initial={data} slug={slug} muted={muted === "1"} />;
}
