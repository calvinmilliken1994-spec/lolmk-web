import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, Crown, Swords, Trophy, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { DiscordIcon } from "@/components/ui/brand-icons";
import { cn } from "@/lib/utils";
import { getPublicTournamentBySlug } from "@/lib/sr-db";
import { SrPublicBracket } from "@/components/sr/sr-public-bracket";
import type { SrPublicTeam, SrPublicTournamentFull } from "@/types/sr-tournament";

export const revalidate = 60;

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  month: "long",
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
  if (!data) return { title: "Tournament not found" };
  return {
    title: data.tournament.name,
    description: `${data.tournament.name} — LoLMK Summoner's Rift tournament on the KR server.`,
  };
}

/**
 * Status-aware public tournament page. No auth: `getPublicTournamentBySlug`
 * refuses draft tournaments in SQL and projects rows down to the SrPublic*
 * shapes, so nothing admin-only can reach this component to begin with.
 *
 * Three presentations, keyed on status:
 *   seeding                       → info + seeded team list, no bracket yet
 *   bracket_published/in_progress → live bracket + team grid
 *   completed/archived            → champion banner + final bracket
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

  return (
    <>
      <Hero data={data} champion={champion} />

      {tournament.status === "seeding" && !hasBracket && (
        <section className="container-wide py-16 border-b border-line-subtle">
          <div className="border border-line bg-surface p-8 md:p-10 max-w-3xl space-y-3">
            <p className="text-label uppercase text-warning">Seeded — bracket pending</p>
            <h2 className="font-heading text-display-sm text-ink">
              Teams are locked. Seeds are drawn.
            </h2>
            <p className="text-body-md text-ink-secondary max-w-[55ch]">
              The field below is final and every seed was drawn at random. The
              bracket goes up here as soon as it&apos;s generated — follow along
              in Discord for the kickoff call.
            </p>
          </div>
        </section>
      )}

      {hasBracket && (
        <section className="container-wide py-16 border-b border-line-subtle space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-label uppercase text-ink-muted mb-3 inline-flex items-center gap-2">
                <Swords strokeWidth={1.5} className="h-4 w-4" />
                Bracket
              </p>
              <h2 className="font-heading text-display-sm text-ink">
                {isFinished ? "How it finished." : "How it stands."}
              </h2>
            </div>
            {!isFinished && (
              <p className="text-caption font-mono uppercase tracking-wide text-ink-muted">
                Updates as results are reported
              </p>
            )}
          </div>
          <SrPublicBracket
            matches={matches}
            teams={teams}
            championTeamId={tournament.champion_team_id}
          />
        </section>
      )}

      <section className="container-wide py-16">
        <div className="mb-8">
          <p className="text-label uppercase text-ink-muted mb-3 inline-flex items-center gap-2">
            <Users strokeWidth={1.5} className="h-4 w-4" />
            The field
          </p>
          <h2 className="font-heading text-display-sm text-ink">
            {teams.length} {teams.length === 1 ? "team" : "teams"}.
          </h2>
        </div>
        {teams.length === 0 ? (
          <p className="border border-dashed border-line-strong bg-surface p-10 text-center text-body-md text-ink-secondary">
            Teams are announced once the roster locks.
          </p>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {teams.map((team) => (
              <TeamCard
                key={team.id}
                team={team}
                isChampion={team.id === tournament.champion_team_id}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="container-wide pb-24">
        <div className="border border-line bg-surface p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div>
            <p className="font-heading text-heading-lg text-ink">
              Want in on the next one?
            </p>
            <p className="mt-1 text-body-md text-ink-secondary">
              Signups, rosters and scheduling all run through the LoLMK Discord.
            </p>
          </div>
          <a
            href="https://discord.gg/lolmk"
            target="_blank"
            rel="noreferrer"
            className={cn(buttonVariants({ variant: "discord", size: "lg" }), "shrink-0")}
          >
            <DiscordIcon className="h-6 w-6" />
            Join the Discord
          </a>
        </div>
      </section>
    </>
  );
}

function Hero({
  data,
  champion,
}: {
  data: SrPublicTournamentFull;
  champion: SrPublicTeam | null;
}) {
  const { tournament } = data;
  const window =
    tournament.start_at || tournament.end_at
      ? `${tournament.start_at ? DATE_FMT.format(new Date(tournament.start_at)) : "TBA"} – ${
          tournament.end_at ? DATE_FMT.format(new Date(tournament.end_at)) : "TBA"
        } KST`
      : "Dates to be announced";

  return (
    <section className="relative overflow-hidden border-b border-line-subtle">
      <div aria-hidden className="absolute inset-0 grain pointer-events-none" />
      <div
        aria-hidden
        className={cn(
          "absolute -top-40 left-1/2 h-[520px] w-[1100px] -translate-x-1/2 blur-3xl pointer-events-none bg-gradient-to-br",
          champion
            ? "from-warning/20 via-transparent to-brand-red/15"
            : "from-brand-red/15 via-transparent to-brand-blue/15",
        )}
      />
      <div className="container-wide relative py-20 md:py-24 space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/tournaments" className="text-body-sm text-ink-muted hover:text-ink">
            Tournaments
          </Link>
          <span className="text-ink-muted">/</span>
          <Link
            href="/tournaments/summoners-rift"
            className="text-body-sm text-ink-muted hover:text-ink"
          >
            Summoner&apos;s Rift
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={tournament.status === "in_progress" ? "red" : "outline"} pulse={tournament.status === "in_progress"}>
            {tournament.status === "in_progress"
              ? "Live"
              : tournament.status === "completed"
                ? "Completed"
                : tournament.status === "archived"
                  ? "Archived"
                  : tournament.status === "seeding"
                    ? "Seeded"
                    : "Bracket live"}
          </Badge>
          <Badge variant="blue">
            {tournament.format === "double_elim" ? "Double elim" : "Single elim"} · Bo
            {tournament.best_of}
          </Badge>
        </div>

        <h1 className="font-display text-display-lg md:text-display-xl text-ink leading-[0.95]">
          {tournament.name}
        </h1>

        {champion ? (
          <div className="flex flex-col sm:flex-row sm:items-center gap-5 border border-warning/50 bg-warning/10 p-6 max-w-2xl">
            {champion.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- Blob host
              // is store-specific; no next/image remotePatterns entry exists.
              <img
                src={champion.logo_url}
                alt=""
                width={80}
                height={80}
                className="h-20 w-20 shrink-0 border border-warning/50 object-cover"
              />
            ) : (
              <span className="flex h-20 w-20 shrink-0 items-center justify-center border border-warning/50 bg-warning/10">
                <Trophy strokeWidth={1.25} className="h-9 w-9 text-warning" />
              </span>
            )}
            <div className="min-w-0">
              <p className="inline-flex items-center gap-2 text-label uppercase text-warning">
                <Crown strokeWidth={1.5} className="h-4 w-4" />
                Champion
              </p>
              <p className="mt-1 font-display text-display-sm text-ink leading-none truncate">
                {champion.name}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-body-lg text-ink-secondary max-w-[55ch]">
            {tournament.format === "double_elim" ? "Double elimination" : "Single elimination"},
            best of {tournament.best_of}, {tournament.min_teams}–{tournament.max_teams} teams.
            Seeds are drawn at random — no committee, no favours.
          </p>
        )}

        <p className="inline-flex items-center gap-2 text-body-sm text-ink-muted">
          <CalendarDays strokeWidth={1.5} className="h-4 w-4" />
          {window}
        </p>
      </div>
    </section>
  );
}

function TeamCard({ team, isChampion }: { team: SrPublicTeam; isChampion: boolean }) {
  return (
    <li
      className={cn(
        "flex flex-col items-center gap-3 border bg-surface p-5 text-center",
        isChampion ? "border-warning/60" : "border-line",
      )}
    >
      {team.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element -- see above.
        <img
          src={team.logo_url}
          alt=""
          width={64}
          height={64}
          className="h-16 w-16 border border-line object-cover"
        />
      ) : (
        <span className="flex h-16 w-16 items-center justify-center border border-line bg-elevated font-display text-heading-lg text-ink-muted">
          {team.name.slice(0, 2).toUpperCase()}
        </span>
      )}
      <div className="min-w-0 w-full">
        <p className="font-heading text-body-md text-ink truncate">{team.name}</p>
        <p className="mt-0.5 text-caption font-mono uppercase tracking-wide text-ink-muted">
          {team.seed === null ? "Unseeded" : `Seed ${team.seed}`}
        </p>
      </div>
      {isChampion && (
        <span className="inline-flex items-center gap-1.5 text-caption uppercase tracking-wider text-warning">
          <Crown strokeWidth={1.75} className="h-3.5 w-3.5" />
          Champion
        </span>
      )}
    </li>
  );
}
