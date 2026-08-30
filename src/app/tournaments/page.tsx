import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { DiscordIcon } from "@/components/ui/brand-icons";
import { HallOfChampions } from "@/components/sections/hall-of-champions";
import { getChampions } from "@/lib/champions";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Tournaments",
  description:
    "League of Legends tournaments run by LoLMK on the Korean server: champions, format, and how to enter.",
};

const FORMAT_POINTS = [
  "Team registration and rosters are managed through LoLMK.",
  "Formats vary by event: 5v5 Summoner's Rift, ARAM, and custom modes.",
  "Seasonal tournaments run Swiss into a Top 8 bracket, best-of-5 finals.",
];

export default async function TournamentsPage() {
  const champions = await getChampions();
  const latest = champions[0] ?? null;
  const past = champions.slice(1);

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
              5v5 Summoner's Rift, ARAM, and custom modes on the KR server.
              See who's holding the crown, then come take a shot at it.
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

      <HallOfChampions latest={latest} past={past} />

      <section className="container-wide py-24 border-t border-line-subtle">
        <div className="grid lg:grid-cols-2 gap-12 items-start">
          <div>
            <p className="text-label uppercase text-ink-muted mb-4">How it works</p>
            <h2 className="font-heading text-display-sm text-ink">
              Two ways to play.
            </h2>
            <p className="mt-4 text-body-md text-ink-secondary max-w-[52ch]">
              Everything is organized in Discord today: signups, brackets, and
              standings. On-site signups and live brackets are coming to this
              page next.
            </p>
          </div>
          <ul className="space-y-4">
            {FORMAT_POINTS.map((point) => (
              <li
                key={point}
                className="flex gap-3 text-body-md text-ink-secondary border-b border-line-subtle pb-4 last:border-b-0"
              >
                <span aria-hidden className="text-brand-red mt-1">
                  ▸
                </span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
