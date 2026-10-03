import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarDays, Swords, Trophy, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { DiscordIcon } from "@/components/ui/brand-icons";
import { cn } from "@/lib/utils";
import {
  getApplicationsForCaptain,
  getTeamsForCaptain,
  listPublicTournaments,
  listSignupOpenTournaments,
} from "@/lib/sr-db";
import { getCaptainSession } from "@/lib/discord-auth";
import type { SrPublicTournament, SrTournament } from "@/types/sr-tournament";
import { SrPublicSignupGate, SrSignupSection } from "@/components/sr/sr-public-signup";

export const metadata: Metadata = {
  title: "Summoner's Rift tournaments",
  description:
    "LoLMK's 5v5 Summoner's Rift tournaments on the Korean server: live brackets, team lists and results.",
};

// Signup state and eligibility are per-captain (session/cookie driven), so
// this route renders dynamically like the ARAM page — a cached render would
// show one captain's panel to everyone.
export const dynamic = "force-dynamic";

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  month: "short",
  day: "numeric",
  year: "numeric",
});

const STATUS_COPY: Record<
  SrPublicTournament["status"],
  { label: string; variant: "default" | "red" | "blue" | "success" | "warning" | "outline"; pulse?: boolean }
> = {
  draft: { label: "Draft", variant: "outline" },
  seeding: { label: "Seeded — bracket soon", variant: "warning" },
  bracket_published: { label: "Bracket live", variant: "blue" },
  in_progress: { label: "In progress", variant: "red", pulse: true },
  completed: { label: "Completed", variant: "success" },
  archived: { label: "Archived", variant: "default" },
};

export default async function SummonersRiftPublicPage() {
  // Same shape as the ARAM page: a session failure degrades to the
  // signed-out state, never a failed request.
  const captain = await getCaptainSession().catch(() => null);
  const [tournaments, signupOpen] = await Promise.all([
    listPublicTournaments(),
    listSignupOpenTournaments(),
  ]);

  // Same eligibility rule as CaptainDashboard: open for signups, minus
  // tournaments this captain already has a team or a pending application in.
  let enterable: SrTournament[] = [];
  if (captain) {
    const [teams, applications] = await Promise.all([
      getTeamsForCaptain(captain.discordUserId),
      getApplicationsForCaptain(captain.discordUserId),
    ]);
    const entered = new Set([
      ...teams.map((v) => v.team.tournament_id),
      ...applications.map((v) => v.application.tournament_id),
    ]);
    enterable = signupOpen.filter((t) => !entered.has(t.id));
  }
  const live = tournaments.filter((t) => t.status !== "completed");
  const finished = tournaments.filter((t) => t.status === "completed");

  return (
    <>
      <section className="border-b border-line-subtle">
        <div className="container-wide py-10 md:py-14">
          <div className="max-w-3xl space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/tournaments" className="text-body-sm text-ink-muted hover:text-ink">
                Tournaments
              </Link>
              <span className="text-ink-muted">/</span>
              <Badge variant="red">Summoner&apos;s Rift</Badge>
            </div>
            <h1 className="font-heading text-heading-xl text-ink">5v5 team tournaments</h1>
            <p className="text-body-md text-ink-secondary max-w-[62ch]">
              Full-draft 5v5s on the KR server, run over a week or a month.
              Captains register a team, every player confirms their own slot,
              rosters lock before kickoff, and the bracket below updates as
              results come in.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <a
                href="https://discord.gg/lolmk"
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ variant: "discord", size: "md" }))}
              >
                <DiscordIcon className="h-5 w-5" />
                Enter via Discord
              </a>
              <Link
                href="/captain"
                className={cn(buttonVariants({ variant: "secondary", size: "md" }))}
              >
                <Swords strokeWidth={1.5} className="h-4 w-4" />
                Captain dashboard
              </Link>
            </div>
          </div>
        </div>
      </section>

      {signupOpen.length > 0 && (
        <section className="container-wide py-12 border-b border-line-subtle space-y-4">
          {enterable.map((tournament) => (
            <SrSignupSection key={tournament.id} tournament={tournament} />
          ))}
          {enterable.length === 0 && <SrPublicSignupGate />}
        </section>
      )}

      <section className="container-wide py-20 space-y-14">
        <div className="space-y-6">
          <h2 className="font-heading text-display-sm text-ink">Running now</h2>
          {live.length === 0 ? (
            <div className="border border-dashed border-line-strong bg-surface p-10 text-center space-y-2">
              <p className="font-heading text-heading-lg text-ink">
                No Summoner&apos;s Rift tournament is live right now.
              </p>
              <p className="text-body-md text-ink-secondary max-w-lg mx-auto">
                The next one is announced in Discord first. Signups and rosters
                are handled there; this page goes live the moment the bracket
                is drawn.
              </p>
            </div>
          ) : (
            <ul className="grid gap-4 md:grid-cols-2">
              {live.map((t) => (
                <TournamentCard key={t.slug} tournament={t} />
              ))}
            </ul>
          )}
        </div>

        {finished.length > 0 && (
          <div className="space-y-6 border-t border-line-subtle pt-14">
            <h2 className="font-heading text-display-sm text-ink">Finished</h2>
            <ul className="grid gap-4 md:grid-cols-2">
              {finished.map((t) => (
                <TournamentCard key={t.slug} tournament={t} />
              ))}
            </ul>
          </div>
        )}
      </section>
    </>
  );
}

function TournamentCard({ tournament }: { tournament: SrPublicTournament }) {
  const status = STATUS_COPY[tournament.status];
  return (
    <li>
      <Link
        href={`/tournaments/summoners-rift/${tournament.slug}`}
        className="group flex h-full flex-col gap-4 border border-line bg-surface p-6 transition-all duration-200 ease-out-soft hover:-translate-y-0.5 hover:border-line-strong hover:bg-elevated/40"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-heading text-heading-lg text-ink group-hover:text-brand-red-bright transition-colors">
            {tournament.name}
          </h3>
          <Badge variant={status.variant} pulse={status.pulse}>
            {status.label}
          </Badge>
        </div>
        <ul className="space-y-1.5 text-body-sm text-ink-secondary">
          <li className="inline-flex items-center gap-2">
            <Trophy strokeWidth={1.5} className="h-4 w-4 text-ink-muted" />
            {tournament.format === "double_elim" ? "Double elimination" : "Single elimination"}
            {" · "}
            Best of {tournament.best_of}
          </li>
          <li className="inline-flex items-center gap-2">
            <Users strokeWidth={1.5} className="h-4 w-4 text-ink-muted" />
            {tournament.min_teams}–{tournament.max_teams} teams
          </li>
          <li className="inline-flex items-center gap-2">
            <CalendarDays strokeWidth={1.5} className="h-4 w-4 text-ink-muted" />
            {formatWindow(tournament)}
          </li>
        </ul>
        <span className="mt-auto inline-flex items-center gap-1.5 text-body-sm font-medium text-brand-red-bright">
          {tournament.status === "completed" ? "See the result" : "Open the bracket"}
          <ArrowRight strokeWidth={2} className="h-4 w-4" />
        </span>
      </Link>
    </li>
  );
}

function formatWindow(t: SrPublicTournament): string {
  if (!t.start_at && !t.end_at) return "Dates to be announced";
  const start = t.start_at ? DATE_FMT.format(new Date(t.start_at)) : "TBA";
  const end = t.end_at ? DATE_FMT.format(new Date(t.end_at)) : "TBA";
  return `${start} – ${end} KST`;
}
