import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ComingSoon } from "@/components/sections/coming-soon";

export const metadata: Metadata = {
  title: "Riftbound",
  description:
    "Riftbound events at LoLMK — nothing scheduled yet. Interest is being gauged in the Discord.",
};

/**
 * Honest placeholder. There is no Riftbound tournament, no Riftbound data
 * source and no Riftbound admin tool — this page says exactly that rather
 * than inventing a schedule or a fake bracket. It exists because
 * /tournaments links to it as one of the three games, and a link to nothing
 * is worse than a link to a straight answer.
 */
export default function RiftboundPage() {
  return (
    <>
      <div className="container-wide pt-10">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/tournaments" className="text-body-sm text-ink-muted hover:text-ink">
            Tournaments
          </Link>
          <span className="text-ink-muted">/</span>
          <Badge variant="outline">Riftbound</Badge>
        </div>
      </div>
      <ComingSoon
        kicker="Riftbound"
        title="Nothing scheduled yet."
        description="LoLMK hasn't run a Riftbound event. If enough people want one, that's where it starts — say so in the Discord and it'll get organised. When there is something real to show, it goes here."
        bullets={[
          "No Riftbound tournament has been announced or scheduled.",
          "Interest is being gauged in the LoLMK Discord first.",
          "This page will carry the format, signups and results once an event exists.",
        ]}
      />
    </>
  );
}
