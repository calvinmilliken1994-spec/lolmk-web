import type { Metadata } from "next";
import Link from "next/link";
import { Crown, Swords, Trophy, Tv, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { DiscordIcon } from "@/components/ui/brand-icons";
import { cn } from "@/lib/utils";
import { getMayhemPublic } from "@/lib/mayhem-db";
import { getMemberSession } from "@/lib/discord-auth";
import type { MayhemPublic, MayhemPublicTeam } from "@/types/mayhem";
import { AramSignupPanel } from "@/components/mayhem/aram-signup-panel";

export const metadata: Metadata = {
  title: "ARAM Mayhem",
  description:
    "LoLMK's ARAM meetup tournament: sign up solo or bring a full premade team, teams drawn live, bracket runs the same day.",
};

// This route depends on a live singleton event. Rendering it dynamically keeps
// a missing build-time database from turning the public ARAM route into a
// deployment failure.
export const dynamic = "force-dynamic";

const EMPTY_MAYHEM: MayhemPublic = {
  title: "ARAM Mayhem",
  stage: "collecting",
  team_format: "randomized",
  registration_open: false,
  registration_generation: 0,
  champion_team_id: null,
  player_count: 0,
  teams: [],
  reveal_in_progress: false,
  matches: [],
  updated_at: new Date(0).toISOString(),
};

async function loadMayhemPublic(
  load: () => Promise<MayhemPublic> = getMayhemPublic,
): Promise<MayhemPublic> {
  try {
    return await load();
  } catch {
    // The descriptive route remains useful during a database outage; render
    // its normal inactive state instead of failing the request.
    return EMPTY_MAYHEM;
  }
}

const STAGE_COPY: Record<
  MayhemPublic["stage"],
  { label: string; variant: "default" | "red" | "blue" | "success" | "warning" | "outline"; live: boolean }
> = {
  collecting: { label: "Signing people in", variant: "warning", live: true },
  randomized: { label: "Teams drawn", variant: "blue", live: true },
  group_stage: { label: "Group stage", variant: "red", live: true },
  knockout: { label: "Knockout", variant: "red", live: true },
  completed: { label: "Finished", variant: "success", live: false },
};

export default async function AramPublicPage() {
  const [data, member] = await Promise.all([
    loadMayhemPublic(),
    // Never let a Discord/session failure take the whole public page down —
    // an unauthenticated visitor just sees the signed-out signup state.
    getMemberSession().catch(() => null),
  ]);
  const stage = STAGE_COPY[data.stage];
  const champion = data.champion_team_id
    ? data.teams.find((t) => t.id === data.champion_team_id) ?? null
    : null;
  const knockoutMatches = data.matches.filter((m) => m.bracket !== "group");
  const groupMatches = data.matches.filter((m) => m.bracket === "group");
  const teamById = new Map(data.teams.map((t) => [t.id, t]));
  // An event that has never had signups opened reads the same as a fresh
  // collecting-stage event with nobody in it — show the "nothing running"
  // placeholder ONLY then. The moment an admin opens registration, real
  // people need to be ABLE to be the first signup — gating on player_count
  // would make that structurally impossible (0 players -> hidden signup ->
  // stays 0 forever). registration_open is the actual signal for "is this
  // page live right now", not player_count.
  const neverRun = data.stage === "collecting" && data.player_count === 0 && !data.registration_open;
  const canSignUp = data.stage === "collecting";

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
              <Badge variant="blue">ARAM Mayhem</Badge>
              {!neverRun && (
                <Badge variant={stage.variant} pulse={stage.live}>
                  {stage.label}
                </Badge>
              )}
            </div>
            <h1 className="font-heading text-heading-xl text-ink">ARAM meetup tournament</h1>
            <p className="text-body-md text-ink-secondary max-w-[62ch]">
              LoLMK's ARAM Mayhem is a meetup tournament, usually run over the
              course of a day. Bring a full premade team, or sign up solo and
              get placed into a team — solo signups are genuinely encouraged,
              especially if you haven't put a friend group together in Korea
              yet. Small prizes are up for grabs.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <a
                href="https://discord.gg/lolmk"
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ variant: "discord", size: "md" }))}
              >
                <DiscordIcon className="h-5 w-5" />
                Find the next one
              </a>
              {stage.live && !neverRun && (
                <Link
                  href="/mayhemlive"
                  className={cn(buttonVariants({ variant: "secondary", size: "md" }))}
                >
                  <Tv strokeWidth={1.5} className="h-4 w-4" />
                  Venue screen
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>

      {neverRun ? (
        <section className="container-wide py-20">
          <div className="border border-dashed border-line-strong bg-surface p-12 text-center flex flex-col items-center gap-4">
            <Swords strokeWidth={1} className="h-14 w-14 text-ink-muted opacity-40" />
            <div className="space-y-2">
              <p className="font-heading text-heading-lg text-ink">
                No Mayhem running right now.
              </p>
              <p className="text-body-md text-ink-secondary max-w-lg mx-auto">
                Mayhem runs at meetups, announced in Discord a few days out.
                When one is live this page fills in with signup, then the
                teams and bracket as they happen.
              </p>
            </div>
          </div>
        </section>
      ) : (
        <>
          {canSignUp && (
            <section className="container-wide py-12 border-b border-line-subtle">
              <AramSignupPanel
                teamFormat={data.team_format}
                registrationOpen={data.registration_open}
                member={
                  member
                    ? { discordUserId: member.discordUserId, displayName: member.displayName, avatarUrl: member.avatarUrl }
                    : null
                }
              />
            </section>
          )}

          {champion && (
            <section className="container-wide py-16 border-b border-line-subtle">
              <div className="border border-warning/50 bg-warning/10 p-8 flex flex-col sm:flex-row sm:items-center gap-6">
                <Trophy strokeWidth={1.25} className="h-14 w-14 shrink-0 text-warning" />
                <div className="min-w-0">
                  <p className="inline-flex items-center gap-2 text-label uppercase text-warning">
                    <Crown strokeWidth={1.5} className="h-4 w-4" />
                    {data.title} champion
                  </p>
                  <p className="mt-1 font-display text-display-sm text-ink leading-none truncate">
                    {champion.name}
                  </p>
                  {champion.players.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {champion.players.map((p) => (
                        <span
                          key={p.display_name}
                          className="border border-line bg-elevated px-3 py-1 text-body-sm text-ink-secondary"
                        >
                          {p.display_name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          <section className="container-wide py-16 border-b border-line-subtle">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-label uppercase text-ink-muted mb-3 inline-flex items-center gap-2">
                  <Users strokeWidth={1.5} className="h-4 w-4" />
                  Teams
                </p>
                <h2 className="font-heading text-display-sm text-ink">
                  {data.player_count} {data.player_count === 1 ? "player" : "players"} in.
                </h2>
              </div>
              {data.reveal_in_progress && (
                <p className="text-caption font-mono uppercase tracking-wide text-warning">
                  Reveal in progress — more teams appearing
                </p>
              )}
            </div>

            {data.teams.length === 0 ? (
              <p className="border border-dashed border-line-strong bg-surface p-10 text-center text-body-md text-ink-secondary">
                {data.stage === "collecting"
                  ? "Names are still going in the hat. Teams appear here once the randomiser runs."
                  : "Teams are being revealed on the venue screen right now."}
              </p>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.teams.map((team) => (
                  <TeamCard
                    key={team.id}
                    team={team}
                    isChampion={team.id === data.champion_team_id}
                  />
                ))}
              </ul>
            )}
          </section>

          {(knockoutMatches.length > 0 || groupMatches.length > 0) && (
            <section className="container-wide py-16">
              <div className="mb-8">
                <p className="text-label uppercase text-ink-muted mb-3 inline-flex items-center gap-2">
                  <Swords strokeWidth={1.5} className="h-4 w-4" />
                  Results
                </p>
                <h2 className="font-heading text-display-sm text-ink">Every game played.</h2>
              </div>
              <ul className="divide-y divide-line-subtle border border-line bg-surface">
                {[...groupMatches, ...knockoutMatches].map((m) => {
                  const a = m.team_a_id ? teamById.get(m.team_a_id) : undefined;
                  const b = m.team_b_id ? teamById.get(m.team_b_id) : undefined;
                  const done = m.status === "completed";
                  return (
                    <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                      <span className="w-32 shrink-0 text-caption font-mono uppercase tracking-wide text-ink-muted">
                        {m.bracket.replace("_", " ")} R{m.round_number}
                      </span>
                      <span
                        className={cn(
                          "flex-1 min-w-0 truncate text-body-sm",
                          done && m.winner_id === m.team_a_id ? "text-ink font-semibold" : "text-ink-secondary",
                        )}
                      >
                        {a?.name ?? "TBD"}
                      </span>
                      <span className="shrink-0 font-mono text-body-sm tabular-nums text-ink">
                        {done ? `${m.team_a_score} – ${m.team_b_score}` : "vs"}
                      </span>
                      <span
                        className={cn(
                          "flex-1 min-w-0 truncate text-right text-body-sm",
                          done && m.winner_id === m.team_b_id ? "text-ink font-semibold" : "text-ink-secondary",
                        )}
                      >
                        {b?.name ?? "TBD"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}

function TeamCard({ team, isChampion }: { team: MayhemPublicTeam; isChampion: boolean }) {
  return (
    <li
      className={cn(
        "border bg-surface p-5 space-y-3",
        isChampion ? "border-warning/60" : "border-line",
      )}
    >
      <div className="flex items-center gap-3">
        {team.icon_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- Mayhem team
          // icons come from Riot's Data Dragon CDN, which has no next/image
          // remotePatterns entry configured.
          <img
            src={team.icon_url}
            alt=""
            width={48}
            height={48}
            className="h-12 w-12 shrink-0 border border-line object-cover"
          />
        ) : (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center border border-line bg-elevated font-display text-ink-muted">
            {team.name.slice(0, 2).toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <p className="font-heading text-heading-md text-ink truncate">{team.name}</p>
          {team.seed !== null && (
            <p className="text-caption font-mono uppercase tracking-wide text-ink-muted">
              Seed {team.seed}
            </p>
          )}
        </div>
        {isChampion && <Crown strokeWidth={1.75} className="ml-auto h-5 w-5 shrink-0 text-warning" />}
      </div>
      {team.players.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {team.players.map((p) => (
            <li
              key={p.display_name}
              className="border border-line-subtle bg-elevated px-2 py-0.5 text-caption text-ink-secondary"
            >
              {p.display_name}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
