import type { Metadata } from "next";
import { getMayhemVenueState } from "@/lib/mayhem-db";
import { MayhemLiveScreen } from "@/components/mayhem/mayhem-live-screen";

export const metadata: Metadata = {
  title: "ARAM Mayhem — Live",
  description: "Live venue screen for LoLMK ARAM Mayhem tournaments.",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function MayhemLivePage() {
  const data = await getMayhemVenueState();
  return <MayhemLiveScreen initial={data} />;
}
