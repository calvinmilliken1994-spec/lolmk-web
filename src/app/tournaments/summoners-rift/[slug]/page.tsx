import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { DiscordIcon } from "@/components/ui/brand-icons";
import { PageHeader } from "@/components/ds/page-header";
import { statCells } from "@/components/ds/stat-strip";
import { cn } from "@/lib/utils";
import { getPublicTournamentBySlug } from "@/lib/sr-db";
import { pageMetadata } from "@/lib/metadata";
import { SrPublicBracket } from "@/components/sr/sr-public-bracket";
import type { SrPublicTeam, SrPublicTournament } from "@/types/sr-tournament";

export const revalidate = 60;

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  month: "short",
  day: "numeric",
  year: "numeric",
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await getPublicTournamentBySlug(slug);
  if (!data) {
    return pageMetadata({
      title: "Tournament not found",
      description: "This tournament doesn't exist or isn't public.",
      noindex: true,
    });
  }
  return pageMetadata({
    title: data.tournament.name,
    description: `${data.tournament.name}: a LoLMK Summoner's Rift tournament on the KR server. Bracket, field and results.`,
    path: `/tournaments/summoners-rift/${data.tournament.slug}`,
    // opengraph-image.tsx in this folder renders the share card.
    hasOwnImage: true,
  });
}

const STATUS_LABEL: Record<SrPublicTournament["status"], string> = {
  draft: "Draft",
  seeding: "Seeded, bracket soon",
  bracket_published: "Bracket live",
  in_progress: "Live now",
  completed: "Finished",
  archived: "Finished",
};

/**
 * Public tournament page. `getPublicTournamentBySlug` refuses drafts and
 * test tournaments in SQL and projects rows down to the SrPublic* shapes,
 * so nothing admin-only reaches this component.
 */
export default async function SummonersRiftTournamentPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await getPublicTournamentBySlug(slug);
  if (!data) notFound();

  const { tournament, teams, matches } = data;
  const champion = tournament.champion_team_id
    ? teams.find((t) => t.id === tournament.champion_team_id) ?? null
    : null;
  const isFinished = tournament.status === "completed" || tournament.status === "archived";
  const hasBracket = matches.length > 0;
  const shape = `${tournament.format === "double_elim" ? "Double elimination" : "Single elimination"}, best of ${tournament.best_of}`;
  const window = formatWindow(tournament);

  return (
    <>
      <PageHeader
        tag="Summoner's Rift"
        title={tournament.name}
        deck={`${shape}, played on the KR server.${window ? ` ${window}.` : ""}`}
        stats={statCells([
          { k: "Status", v: STATUS_LABEL[tournament.status] },
          { k: "Format", v: shape },
          { k: "Field", v: teams.length > 0 ? `${teams.length} ${teams.length === 1 ? "team" : "teams"}` : null },
          champion ? { k: "Champion", v: champion.name, tone: "gold" as const } : { k: "When", v: window },
        ])}
      />

      {tournament.status === "seeding" && !hasBracket && (
        <section className="ds-container">
          <p className="m-0 max-w-deck border border-ds-line bg-ds-surface p-8 text-ds-deck text-ds-text-muted">
            Teams are locked and every seed was drawn at random. The bracket goes up here as soon as
            it&apos;s generated.
          </p>
        </section>
      )}

      {hasBracket && (
        <section aria-labelledby="bracket-title" className="ds-container pt-6">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <h2
              id="bracket-title"
              className="m-0 font-display text-[clamp(40px,5vw,60px)] font-normal leading-[0.92] text-ds-text"
            >
              {isFinished ? "How it finished." : "How it stands."}
            </h2>
            {!isFinished && (
              <p className="m-0 font-heading text-ds-label text-ds-text-dim">Updates as results are reported</p>
            )}
          </div>
          <SrPublicBracket matches={matches} teams={teams} championTeamId={tournament.champion_team_id} />
        </section>
      )}

      {teams.length > 0 && (
        <section aria-labelledby="field-title" className="ds-container pt-[clamp(64px,8vw,104px)]">
          <h2
            id="field-title"
            className="m-0 font-display text-[clamp(40px,5vw,60px)] font-normal leading-[0.92] text-ds-text"
          >
            The field.
          </h2>
          <ul className="mt-6 grid grid-cols-1 gap-px border border-ds-line bg-ds-line sm:grid-cols-2 lg:grid-cols-4">
            {teams.map((team) => (
              <TeamCell key={team.id} team={team} isChampion={team.id === tournament.champion_team_id} />
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Next tournament" className="ds-container pt-[clamp(64px,8vw,104px)]">
        <div className="flex flex-wrap items-center justify-between gap-6 border border-ds-line bg-ds-surface px-8 py-8 [clip-path:polygon(0_0,calc(100%-24px)_0,100%_24px,100%_100%,0_100%)]">
          <div className="min-w-0">
            <h2 className="m-0 font-display text-[clamp(36px,4vw,48px)] font-normal leading-[0.95] text-white">
              Want in on the next one?
            </h2>
            <p className="mb-0 mt-2 text-ds-body text-ds-text-muted">
              Signups, rosters and scheduling all run through the LoLMK Discord.
            </p>
          </div>
          <a
            href="https://discord.gg/lolmk"
            target="_blank"
            rel="noreferrer"
            className={cn(buttonVariants({ variant: "discord", size: "lg" }), "shrink-0")}
          >
            <DiscordIcon className="h-5 w-5" />
            Join the Discord
          </a>
        </div>
      </section>
    </>
  );
}

function TeamCell({ team, isChampion }: { team: SrPublicTeam; isChampion: boolean }) {
  return (
    <li className="flex items-center gap-4 bg-ds-surface px-6 py-5">
      {team.logo_url ? (
        // Blob host is store-specific; no next/image remotePatterns entry exists.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={team.logo_url} alt="" width={48} height={48} className="h-12 w-12 shrink-0 object-cover" />
      ) : null}
      <div className="min-w-0">
        <p
          title={team.name}
          className={cn(
            "m-0 truncate font-heading text-[17px] font-semibold",
            isChampion ? "text-ds-gold" : "text-ds-text",
          )}
        >
          {team.name}
        </p>
        <p className="m-0 mt-0.5 font-heading text-ds-label text-ds-text-dim">
          {[team.seed !== null ? `Seed ${team.seed}` : null, isChampion ? "Champion" : null]
            .filter(Boolean)
            .join(", ") || `${team.players.length} players`}
        </p>
      </div>
    </li>
  );
}

/** Known dates only; null when the record has neither. */
function formatWindow(t: SrPublicTournament): string | null {
  const start = t.start_at ? DATE_FMT.format(new Date(t.start_at)) : null;
  const end = t.end_at ? DATE_FMT.format(new Date(t.end_at)) : null;
  if (start && end) return start === end ? `${start} KST` : `${start} to ${end} KST`;
  if (start) return `From ${start} KST`;
  if (end) return `Until ${end} KST`;
  return null;
}
