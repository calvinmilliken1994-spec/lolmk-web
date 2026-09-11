import Link from "next/link";
import { ArrowRight, Layers, Sparkles, Swords } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { DiscordIcon } from "@/components/ui/brand-icons";
import { HallOfChampions } from "@/components/sections/hall-of-champions";
import { getChampions } from "@/lib/champions";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Tournaments",
  description:
    "Tournaments run by LoLMK on the Korean server: 5v5 Summoner's Rift, ARAM Mayhem, and Riftbound.",
};

// The Hall of Champions below is DB-backed (completed Summoner's Rift
// tournaments merged with the legacy static file), so this page can't be
// fully static.
export const revalidate = 300;

interface GameEntry {
  name: string;
  href: string;
  kicker: string;
  description: string;
  icon: typeof Swords;
  status: { label: string; variant: "red" | "blue" | "outline" };
}

const GAMES: GameEntry[] = [
  {
    name: "Summoner's Rift",
    href: "/tournaments/summoners-rift",
    kicker: "5v5 · Full draft",
    description:
      "The main event. Fixed rosters, random seeding, single or double elimination played out over a week or a month on the KR server.",
    icon: Swords,
    status: { label: "Running", variant: "red" },
  },
  {
    name: "ARAM Mayhem",
    href: "/tournaments/aram",
    kicker: "5v5 · Howling Abyss",
    description:
      "The meetup tournament. Turn up solo, get randomised into a team on the venue screen, and play the whole bracket the same night.",
    icon: Sparkles,
    status: { label: "At meetups", variant: "blue" },
  },
  {
    name: "Riftbound",
    href: "/tournaments/riftbound",
    kicker: "Card game",
    description:
      "Nothing scheduled yet. If there's appetite for a Riftbound event, it starts as a conversation in the Discord.",
    icon: Layers,
    status: { label: "Not scheduled", variant: "outline" },
  },
];

export default async function TournamentsPage() {
  // Seeded sample data is split out rather than sorted in with the rest:
  // champions.json's demo row has a 2025 date and would otherwise sort to
  // the top and be presented as the reigning champion. Real results only in
  // latest/past; the sample is passed separately and only surfaces (badged)
  // when there is nothing real to show.
  const champions = await getChampions();
  const real = champions.filter((r) => !r.placeholder);
  const samples = champions.filter((r) => r.placeholder);
  const latest = real[0] ?? null;
  const past = real.slice(1);

  return (
    <>
      <section className="relative overflow-hidden border-b border-line-subtle">
        <div aria-hidden className="absolute inset-0 grain pointer-events-none" />
        <div
          aria-hidden
          className="absolute -top-40 left-1/2 h-[560px] w-[1100px] -translate-x-1/2 bg-gradient-to-br from-brand-red/15 via-transparent to-brand-blue/15 blur-3xl pointer-events-none"
        />
        <div className="container-wide relative py-20 md:py-28">
          <div className="max-w-3xl space-y-6">
            <Badge variant="red">Tournaments</Badge>
            <h1 className="font-display text-display-lg md:text-display-xl text-ink leading-[0.95]">
              League tournaments, played for keeps.
            </h1>
            <p className="text-body-lg text-ink-secondary max-w-[55ch]">
              Three formats, one community. Pick the one you want to play — each
              has its own page with the live bracket, the field, and how to get
              in.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <a
                href="https://discord.gg/lolmk"
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ variant: "discord", size: "lg" }))}
              >
                <DiscordIcon className="h-6 w-6" />
                Enter via Discord
              </a>
              <Link
                href="/#events"
                className={cn(buttonVariants({ variant: "secondary", size: "lg" }))}
              >
                Upcoming events
                <ArrowRight strokeWidth={1.5} className="h-5 w-5" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="container-wide py-24">
        <div className="max-w-2xl mb-12">
          <p className="text-label uppercase text-ink-muted mb-4">Pick your format</p>
          <h2 className="font-heading text-display-sm text-ink">Three ways to play.</h2>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {GAMES.map((game) => {
            const Icon = game.icon;
            return (
              <Link
                key={game.href}
                href={game.href}
                className="group flex flex-col gap-4 border border-line bg-surface p-6 transition-all duration-200 ease-out-soft hover:-translate-y-0.5 hover:border-line-strong hover:bg-elevated/40"
              >
                <div className="flex items-center justify-between">
                  <span className="flex h-12 w-12 items-center justify-center border border-line bg-elevated text-brand-red-bright">
                    <Icon strokeWidth={1.5} className="h-6 w-6" />
                  </span>
                  <Badge variant={game.status.variant}>{game.status.label}</Badge>
                </div>
                <div className="flex-1">
                  <p className="text-caption font-mono uppercase tracking-wider text-ink-muted">
                    {game.kicker}
                  </p>
                  <p className="mt-1 font-heading text-heading-lg text-ink group-hover:text-brand-red-bright transition-colors">
                    {game.name}
                  </p>
                  <p className="mt-3 text-body-sm text-ink-secondary">{game.description}</p>
                </div>
                <span className="inline-flex items-center gap-1.5 text-body-sm font-medium text-brand-red-bright">
                  Open
                  <ArrowRight strokeWidth={2} className="h-4 w-4" />
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/*
        Hall of Champions stays on the hub rather than moving to a per-game
        page: it spans every format LoLMK has ever run, and splitting it three
        ways would leave two near-empty halls and bury the one result that
        actually exists. Each record carries its own game label.
      */}
      <HallOfChampions latest={latest} past={past} samples={samples} />
    </>
  );
}
