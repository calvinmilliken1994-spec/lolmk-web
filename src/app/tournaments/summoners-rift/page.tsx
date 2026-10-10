import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { DiscordIcon } from "@/components/ui/brand-icons";
import { cn } from "@/lib/utils";
import {
  getApplicationsForCaptain,
  getTeamCountsBySlug,
  getTeamsForCaptain,
  listPublicTournaments,
  listSignupOpenTournaments,
} from "@/lib/sr-db";
import { getCaptainSession } from "@/lib/discord-auth";
import type { SrPublicTournament, SrTournament } from "@/types/sr-tournament";
import { SrPublicSignupGate, SrSignupSection } from "@/components/sr/sr-public-signup";
import { pageMetadata } from "@/lib/metadata";
import { FormatStatus } from "@/components/ds/format-status";
import { LiveDot } from "@/components/ds/live-dot";
import { PageHeader } from "@/components/ds/page-header";
import { getTournamentOverview } from "@/lib/tournament-status";

export const metadata: Metadata = pageMetadata({
  title: "Summoner's Rift tournaments",
  description:
    "LoLMK's 5v5 Summoner's Rift tournaments on the Korean server: live brackets, team lists and results.",
  path: "/tournaments/summoners-rift",
});

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

const STATUS_COPY: Record<SrPublicTournament["status"], { label: string; live: boolean }> = {
  draft: { label: "Draft", live: false },
  seeding: { label: "Seeded, bracket soon", live: false },
  bracket_published: { label: "Bracket live", live: true },
  in_progress: { label: "Live now", live: true },
  completed: { label: "Finished", live: false },
  archived: { label: "Archived", live: false },
};

export default async function SummonersRiftPublicPage() {
  // Same shape as the ARAM page: a session failure degrades to the
  // signed-out state, never a failed request.
  const captain = await getCaptainSession().catch(() => null);
  const [tournaments, signupOpen, overview] = await Promise.all([
    listPublicTournaments(),
    listSignupOpenTournaments(),
    getTournamentOverview(),
  ]);
  const fieldBySlug = await getTeamCountsBySlug(tournaments.map((t) => t.slug));

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
      <PageHeader
        tag="Summoner's Rift"
        title="5v5 on the KR server."
        deck="Full-draft 5v5s, run over a week or a month. Captains register a team, every player confirms their own slot, rosters lock before kickoff, and the bracket updates as results come in."
        actions={
          <>
            <a
              href="https://discord.gg/lolmk"
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: "discord", size: "md" }))}
            >
              <DiscordIcon className="h-5 w-5" />
              Enter via Discord
            </a>
            <Link href="/captain" className={cn(buttonVariants({ variant: "outline", size: "md" }))}>
              Captain dashboard
            </Link>
          </>
        }
      />

      <FormatStatus overview={overview} format="sr" />

      {signupOpen.length > 0 && (
        <section className="ds-container space-y-4 pt-14">
          {enterable.map((tournament) => (
            <SrSignupSection key={tournament.id} tournament={tournament} />
          ))}
          {enterable.length === 0 && <SrPublicSignupGate />}
        </section>
      )}

      {live.length > 0 && (
        <section aria-labelledby="sr-running" className="ds-container pt-14">
          <h2 id="sr-running" className="m-0 font-display text-[clamp(40px,5vw,60px)] font-normal leading-[0.92] text-ds-text">
            Running now
          </h2>
          <ul className="mt-6 grid gap-5 md:grid-cols-2">
            {live.map((t) => (
              <TournamentCard key={t.slug} tournament={t} field={fieldBySlug.get(t.slug)} />
            ))}
          </ul>
        </section>
      )}

      {finished.length > 0 && (
        <section aria-labelledby="sr-finished" className="ds-container pt-14">
          <h2 id="sr-finished" className="m-0 font-display text-[clamp(40px,5vw,60px)] font-normal leading-[0.92] text-ds-text">
            Finished
          </h2>
          <ul className="mt-6 grid gap-5 md:grid-cols-2">
            {finished.map((t) => (
              <TournamentCard key={t.slug} tournament={t} field={fieldBySlug.get(t.slug)} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function TournamentCard({
  tournament,
  field,
}: {
  tournament: SrPublicTournament;
  /** Approved teams in the field. Omitted from the card when unknown or zero. */
  field: number | undefined;
}) {
  const status = STATUS_COPY[tournament.status];
  const window = formatWindow(tournament);
  const facts = [
    {
      k: "Format",
      v: `${tournament.format === "double_elim" ? "Double elimination" : "Single elimination"}, best of ${tournament.best_of}`,
    },
    field ? { k: "Field", v: `${field} ${field === 1 ? "team" : "teams"}` } : null,
    window ? { k: "When", v: window } : null,
  ].filter((f): f is { k: string; v: string } => f !== null);
  return (
    <li className="cut-plate flex flex-col border border-ds-line bg-ds-surface transition-[transform,border-color] duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] hover:-translate-y-1 hover:border-ds-line-strong motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <div className="flex flex-col gap-3 px-7 pt-6">
        <span
          className={cn(
            "inline-flex min-h-7 items-center gap-2 self-start px-3 font-heading text-ds-label font-semibold",
            status.live ? "bg-ds-red text-white" : "bg-ds-line-soft text-[#C9D0E3]",
          )}
        >
          {status.live && <LiveDot size="sm" />}
          {status.label}
        </span>
        <h3 className="m-0 font-display text-ds-plate font-normal text-white [overflow-wrap:anywhere]">
          {tournament.name}
        </h3>
        <dl className="mb-0 mt-1 font-heading text-ds-ui">
          {facts.map((f) => (
            <div key={f.k} className="flex justify-between gap-4 border-t border-ds-line-soft py-[11px]">
              <dt className="text-ds-text-dim">{f.k}</dt>
              <dd className="m-0 text-right font-semibold text-ds-text">{f.v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <Link
        href={`/tournaments/summoners-rift/${tournament.slug}`}
        className="mt-4 flex min-h-14 items-center border-t border-ds-line px-7 font-heading text-ds-ui font-semibold text-white transition-colors duration-150 hover:bg-ds-surface-2"
      >
        {tournament.status === "completed" ? "See the result" : "Open the bracket"}
      </Link>
    </li>
  );
}

/** Known dates only. Returns null when the record has neither, so the row is omitted. */
function formatWindow(t: SrPublicTournament): string | null {
  const start = t.start_at ? DATE_FMT.format(new Date(t.start_at)) : null;
  const end = t.end_at ? DATE_FMT.format(new Date(t.end_at)) : null;
  if (start && end) return start === end ? `${start} KST` : `${start} to ${end} KST`;
  if (start) return `From ${start} KST`;
  if (end) return `Until ${end} KST`;
  return null;
}
