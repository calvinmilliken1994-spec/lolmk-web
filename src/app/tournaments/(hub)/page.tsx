import { buttonVariants } from "@/components/ui/button";
import { DiscordIcon } from "@/components/ui/brand-icons";
import { FormatPlate } from "@/components/ds/format-plate";
import { HallOfChampions } from "@/components/ds/hall-of-champions";
import { PageHeader } from "@/components/ds/page-header";
import { StatusBar } from "@/components/ds/status-bar";
import { cn } from "@/lib/utils";
import { pageMetadata } from "@/lib/metadata";
import {
  FORMAT_HREFS,
  deriveStatusBar,
  formatChip,
  formatKstWhen,
  getTournamentOverview,
  type FormatKey,
} from "@/lib/tournament-status";

export const metadata = pageMetadata({
  title: "Tournaments",
  description:
    "Tournaments run by LoLMK on the Korean server: 5v5 Summoner's Rift, ARAM Mayhem and Riftbound. Live brackets, the field, and how to get in.",
  path: "/tournaments",
});

// Status, chips and the Hall of champions are derived from the DB and Discord
// on every revalidation, so a change in a tournament record moves all three.
export const revalidate = 300;

interface PlateCopy {
  format: FormatKey;
  title: string;
  description: string;
  facts: { k: string; v: string }[];
  link: string;
}

const PLATES: PlateCopy[] = [
  {
    format: "sr",
    title: "Summoner's Rift",
    description:
      "The main event. Fixed rosters and full draft, played out on the KR server over a week or a month.",
    facts: [
      { k: "Teams", v: "5v5, fixed rosters" },
      { k: "Bracket", v: "Double elimination" },
      { k: "Where", v: "Online, KR server" },
    ],
    link: "Brackets and results",
  },
  {
    format: "aram",
    title: "ARAM Mayhem",
    description:
      "The meetup tournament. Turn up solo, get drawn into a random team on the venue screen, and play the whole bracket that night.",
    facts: [
      { k: "Teams", v: "Random, drawn on the night" },
      { k: "Length", v: "One evening" },
      { k: "Where", v: "In person, Gen.G GGX" },
    ],
    link: "Brackets and results",
  },
  {
    format: "rb",
    title: "Riftbound",
    description:
      "The card game. In-person cups at GGX, plus a weekly online night anyone can join for free on tcg-arena.fr.",
    facts: [
      // "Next cup" is prepended from data at render time when one exists.
      { k: "Weekly", v: "Online, Wed 8:30 PM KST" },
      { k: "Where", v: "Gen.G GGX and online" },
    ],
    link: "Events and results",
  },
];

export default async function TournamentsPage() {
  const overview = await getTournamentOverview();
  const now = new Date(overview.now);
  const status = deriveStatusBar(overview);

  const rbNext = overview.states.rb.next;
  const rbNextWhen = rbNext ? formatKstWhen(rbNext) : null;

  const soonest = (["sr", "aram", "rb"] as const)
    .map((k) => overview.states[k].next)
    .find(Boolean);

  return (
    <>
      <PageHeader
        tag="Tournaments"
        title="Pick your format."
        deck="Three ways to play, one community. Each format has its own page with the live bracket, the field, and how to get in."
      />

      <section aria-label="Tournament status" className="ds-container">
        <StatusBar data={status} />
      </section>

      <section aria-label="Formats" className="ds-container pt-14">
        <div className="flex flex-wrap gap-5">
          {PLATES.map((plate) => {
            const facts =
              plate.format === "rb" && rbNext
                ? [{ k: "Next cup", v: rbNextWhen ? `${rbNext.name}, ${rbNextWhen}` : rbNext.name }, ...plate.facts]
                : plate.facts;
            return (
              <FormatPlate
                key={plate.format}
                format={plate.format}
                title={plate.title}
                description={plate.description}
                facts={facts.slice(0, 3)}
                chip={formatChip(overview.states[plate.format], now)}
                link={{ label: plate.link, href: FORMAT_HREFS[plate.format] }}
              />
            );
          })}
        </div>
      </section>

      <HallOfChampions
        results={overview.results}
        next={soonest ? { name: soonest.name, when: formatKstWhen(soonest), href: soonest.href } : null}
      />

      <section aria-label="How to enter" className="ds-container pt-[clamp(80px,9vw,120px)]">
        <div className="flex flex-wrap items-center justify-between gap-7 border border-ds-line bg-ds-surface px-8 py-10 [clip-path:polygon(0_0,calc(100%-24px)_0,100%_24px,100%_100%,0_100%)] sm:px-11">
          <div className="min-w-0 flex-[1_1_420px]">
            <h2 className="m-0 font-display text-[clamp(40px,5vw,60px)] font-normal leading-[0.92] text-white">
              Signups open in Discord.
            </h2>
            <p className="mb-0 mt-2.5 max-w-[52ch] text-ds-body text-ds-text-muted">
              Captains register teams there and every player confirms their own slot. This page
              updates the moment a bracket is drawn.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <a
              href="https://discord.gg/lolmk"
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: "discord", size: "lg" }))}
            >
              <DiscordIcon className="h-5 w-5" />
              Join the Discord
            </a>
            <a
              href="https://open.kakao.com/o/gIPbdi3e"
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
            >
              Message an admin on Kakao
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
