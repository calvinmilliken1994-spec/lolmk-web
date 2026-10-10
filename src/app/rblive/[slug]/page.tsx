import type { Metadata } from "next";
import { RbVenueScreen } from "@/components/riftbound/rb-venue";
import { rbParseScene } from "@/components/riftbound/rb-venue-model";
import { pageMetadata } from "@/lib/metadata";

export const metadata: Metadata = pageMetadata({
  title: "Riftbound live",
  description: "Live venue screen for LoLMK Riftbound tournaments.",
  noindex: true,
});
export const dynamic = "force-dynamic";

type Query = { scene?: string; preview?: string; text?: string; at?: string; muted?: string };

export default async function RbLivePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Query>;
}) {
  const { slug } = await params;
  const q = await searchParams;
  const at = q.at ? Date.parse(q.at) : NaN;
  return (
    <RbVenueScreen
      slug={slug}
      options={{
        scene: rbParseScene(q.scene),
        text: (q.text ?? "").slice(0, 120),
        at: Number.isNaN(at) ? null : at,
      }}
    />
  );
}
