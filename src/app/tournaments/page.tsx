import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { HallOfChampions } from "@/components/sections/hall-of-champions";
import { getChampions } from "@/lib/champions";

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
  emblem: string;
  emblemAlt: string;
  emblemDims: { width: number; height: number };
  status: { label: string; variant: "red" | "blue" | "outline" };
}

const GAMES: GameEntry[] = [
  {
    name: "Summoner's Rift",
    href: "/tournaments/summoners-rift",
    kicker: "5v5 · Full draft",
    description:
      "The main event. Fixed rosters, random seeding, single or double elimination played out over a week or a month on the KR server.",
    emblem: "/images/formats/summoners-rift-badge-new.png",
    emblemAlt: "Summoner's Rift badge: rounded gold-framed navy crest",
    emblemDims: { width: 493, height: 488 },
    status: { label: "Running", variant: "red" },
  },
  {
    name: "ARAM Mayhem",
    href: "/tournaments/aram",
    kicker: "5v5 · Howling Abyss",
    description:
      "The meetup tournament. Turn up solo, get randomised into a team on the venue screen, and play the whole bracket the same night.",
    emblem: "/images/formats/aram-badge-new.png",
    emblemAlt: "ARAM badge: elongated gold-framed navy gem crest matching the Summoner's Rift palette",
    emblemDims: { width: 469, height: 472 },
    status: { label: "At meetups", variant: "blue" },
  },
  {
    name: "Riftbound",
    href: "/tournaments/riftbound",
    kicker: "Card game",
    description:
      "Nothing scheduled yet. If there's appetite for a Riftbound event, it starts as a conversation in the Discord.",
    emblem: "/images/formats/riftbound-badge-new-cropped.png",
    emblemAlt:
      "Riftbound badge: fanned trading cards in gold-framed navy panels matching the other two badges",
    emblemDims: { width: 1077, height: 640 },
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
      <section className="container-wide pt-12 pb-24 md:pt-16">
        {/*
          Hub header stays deliberately small: the formats grid is the page.
          Entry (Discord) and the event calendar live in the header CTA and
          the home page, so they only get a one-line pointer here.
        */}
        <div className="mb-12 flex flex-wrap items-end justify-between gap-x-12 gap-y-4 border-b border-line pb-8">
          <div>
            <p className="text-label uppercase text-ink-muted mb-2">
              Tournaments
            </p>
            <h1 className="font-heading text-display-sm text-ink">
              Pick your format.
            </h1>
          </div>
          <p className="text-body-sm text-ink-secondary max-w-[45ch]">
            Three ways to play, one community. Each format has its own page
            with the live bracket, the field, and how to get in.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {GAMES.map((game) => (
            <Link
              key={game.href}
              href={game.href}
              className="group flex flex-col border border-line bg-surface p-6 transition-all duration-200 ease-out-soft hover:-translate-y-0.5 hover:border-line-strong hover:bg-elevated/40"
            >
              <div className="flex items-start justify-between">
                <span className="flex h-20 w-24 shrink-0 items-center justify-start">
                  <Image
                    src={game.emblem}
                    alt={game.emblemAlt}
                    width={game.emblemDims.width}
                    height={game.emblemDims.height}
                    className="h-20 w-auto"
                  />
                </span>
                <Badge variant={game.status.variant}>{game.status.label}</Badge>
              </div>
              <div className="mt-6 flex-1">
                <p className="text-caption font-mono uppercase tracking-wider text-ink-muted">
                  {game.kicker}
                </p>
                <p className="mt-1 font-heading text-heading-lg text-ink group-hover:text-brand-red-bright transition-colors">
                  {game.name}
                </p>
                <p className="mt-3 text-body-sm text-ink-secondary">
                  {game.description}
                </p>
              </div>
              <span className="mt-6 inline-flex items-center gap-1.5 text-body-sm font-medium text-brand-red-bright">
                Open
                <ArrowRight strokeWidth={2} className="h-4 w-4" />
              </span>
            </Link>
          ))}
        </div>

        <p className="mt-8 text-body-sm text-ink-muted">
          Signups open in the{" "}
          <a
            href="https://discord.gg/lolmk"
            target="_blank"
            rel="noreferrer"
            className="text-brand-blue-bright underline underline-offset-4 hover:text-ink"
          >
            Discord
          </a>
          . Full event calendar on the{" "}
          <Link
            href="/#events"
            className="text-brand-blue-bright underline underline-offset-4 hover:text-ink"
          >
            home page
          </Link>
          .
        </p>
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
