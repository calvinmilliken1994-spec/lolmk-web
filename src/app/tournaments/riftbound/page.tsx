import { buttonVariants } from "@/components/ui/button";
import { DiscordIcon } from "@/components/ui/brand-icons";
import { FormatStatus } from "@/components/ds/format-status";
import { PageHeader } from "@/components/ds/page-header";
import { statCells } from "@/components/ds/stat-strip";
import { cn } from "@/lib/utils";
import { pageMetadata } from "@/lib/metadata";
import { getTournamentOverview } from "@/lib/tournament-status";

export const metadata = pageMetadata({
  title: "Riftbound",
  description:
    "Riftbound at LoLMK: in-person cups at Gen.G GGX and a weekly online night anyone can join.",
  path: "/tournaments/riftbound",
});

export const revalidate = 300;

/**
 * Riftbound format page. Cups are run through /tools/riftbound
 * (rb_tournaments) and announced as Discord scheduled events; both feed the
 * status bar. The weekly online night is fixed copy from the handover.
 */
export default async function RiftboundPage() {
  const overview = await getTournamentOverview();
  const state = overview.states.rb;
  const weekly = { k: "Weekly online night", v: "Wed 8:30 PM KST, tcg-arena.fr" };

  return (
    <>
      <PageHeader
        tag="Riftbound"
        title="Riftbound."
        deck="The card game. In-person cups at Gen.G GGX, plus a weekly online night anyone can join for free on tcg-arena.fr."
        stats={statCells([
          { k: "Where", v: "Gen.G GGX and online" },
          { k: "Players at the last cup", v: state.lastResult?.teams ? String(state.lastResult.teams) : null },
        ])}
        actions={
          <a
            href="https://discord.gg/lolmk"
            target="_blank"
            rel="noreferrer"
            className={cn(buttonVariants({ variant: "discord", size: "md" }))}
          >
            <DiscordIcon className="h-5 w-5" />
            Join the Discord
          </a>
        }
      />
      <FormatStatus overview={overview} format="rb" weekly={weekly} />
    </>
  );
}
