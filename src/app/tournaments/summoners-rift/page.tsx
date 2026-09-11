import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarDays, Trophy, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { DiscordIcon } from "@/components/ui/brand-icons";
import { cn } from "@/lib/utils";
import { listPublicTournaments } from "@/lib/sr-db";
import type { SrPublicTournament } from "@/types/sr-tournament";

export const metadata: Metadata = {
  title: "Summoner's Rift tournaments",
  description:
    "LoLMK's 5v5 Summoner's Rift tournaments on the Korean server: live brackets, team lists and results.",
};

// Bracket state changes whenever an admin reports a result, and the admin
// actions revalidate this path explicitly — but a cold render must never
// serve a stale cached bracket during a live event.
export const revalidate = 60;

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
  const tournaments = await listPublicTournaments();
  const live = tournaments.filter((t) => t.status !== "completed");
  const finished = tournaments.filter((t) => t.status === "completed");

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
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/tournaments"
                className="text-body-sm text-ink-muted hover:text-ink"
              >
                Tournaments
              </Link>
              <span className="text-ink-muted">/</span>
              <Badge variant="red">Summoner&apos;s Rift</Badge>
            </div>
            <h1 className="font-display text-display-lg md:text-display-xl text-ink leading-[0.95]">
              5v5, full draft, real stakes.
            </h1>
            <p className="text-body-lg text-ink-secondary max-w-[55ch]">
              Team tournaments on the KR server, run over a week or a month.
              Rosters are locked before kickoff, seeds are drawn at random, and
              the bracket below updates as results come in.
            </p>
            <div className="pt-2">
              <a
                href="https://discord.gg/lolmk"
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ variant: "discord", size: "lg" }))}
              >
                <DiscordIcon className="h-6 w-6" />
                Enter via Discord
              </a>
            </div>
          </div>
        </div>
      </section>

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
