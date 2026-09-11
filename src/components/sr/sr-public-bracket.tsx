import { Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SrPublicMatch, SrPublicTeam } from "@/types/sr-tournament";

/**
 * Public bracket renderer for Summoner's Rift tournaments.
 *
 * Deliberately NOT `@/components/sections/bracket-flow`. BracketFlow lays
 * matches out with hardcoded PLACEMENT_8 / PLACEMENT_12 / PLACEMENT_16 maps
 * keyed on `match_number`, built against the Discord bot's numbering for
 * three exact bracket shapes — and it silently DROPS any match whose number
 * isn't in the map (`inGrid` filters on `placement[m.match_number] !== undefined`).
 * The shared bracket engine in @/lib/bracket-engine numbers matches
 * sequentially in build order, which is a different sequence, and it
 * supports shapes those maps don't cover (9/10/11/13/14/15 teams, optional
 * third-place match, optional grand-final reset). Feeding SR data through it
 * would produce a bracket that is wrong in a way that looks plausible.
 *
 * This renders round-by-round columns grouped on (bracket, round_number) —
 * the same approach the ARAM Mayhem venue screen uses — which is correct for
 * every shape the engine can emit, at the cost of drawn connector lines.
 */

const BRACKET_TITLE: Record<SrPublicMatch["bracket"], string> = {
  upper: "Upper bracket",
  lower: "Lower bracket",
  grand_final: "Grand final",
  third_place: "Third place",
};

const BRACKET_ORDER: SrPublicMatch["bracket"][] = [
  "upper",
  "lower",
  "third_place",
  "grand_final",
];

export function SrPublicBracket({
  matches,
  teams,
  championTeamId,
}: {
  matches: SrPublicMatch[];
  teams: SrPublicTeam[];
  championTeamId: string | null;
}) {
  const teamById = new Map(teams.map((t) => [t.id, t]));

  // A fully-dead bye (both slots permanently unreachable, nothing played)
  // carries no information for a viewer — the engine emits these for
  // non-power-of-two brackets. Byes that DID advance a team are kept: they
  // explain why a team appears a round later without playing.
  const visible = matches.filter(
    (m) => !(m.status === "bye" && !m.winner_id && !m.team_a_id && !m.team_b_id),
  );

  const sections = BRACKET_ORDER.map((bracket) => {
    const inBracket = visible.filter((m) => m.bracket === bracket);
    const rounds = Array.from(new Set(inBracket.map((m) => m.round_number))).sort(
      (a, b) => a - b,
    );
    return { bracket, rounds, inBracket };
  }).filter((s) => s.inBracket.length > 0);

  if (sections.length === 0) {
    return (
      <p className="border border-dashed border-line-strong bg-surface p-10 text-center text-body-md text-ink-secondary">
        The bracket goes up here the moment it&apos;s drawn.
      </p>
    );
  }

  return (
    <div className="space-y-10">
      {sections.map(({ bracket, rounds, inBracket }) => (
        <section key={bracket} className="space-y-4">
          <h3 className="text-label uppercase tracking-wider text-ink-muted">
            {BRACKET_TITLE[bracket]}
          </h3>
          <div className="overflow-x-auto pb-2">
            <div className="flex gap-4 min-w-min">
              {rounds.map((round) => {
                const roundMatches = inBracket
                  .filter((m) => m.round_number === round)
                  .sort((a, b) => a.match_number - b.match_number);
                return (
                  <div key={round} className="w-[260px] shrink-0 space-y-3">
                    <p className="text-caption font-mono uppercase tracking-wider text-ink-muted border-b border-line-subtle pb-2">
                      {roundLabel(bracket, round, rounds.length)}
                    </p>
                    {roundMatches.map((m) => (
                      <MatchCard
                        key={m.id}
                        match={m}
                        teamById={teamById}
                        championTeamId={championTeamId}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}

function roundLabel(
  bracket: SrPublicMatch["bracket"],
  round: number,
  totalRounds: number,
): string {
  if (bracket === "grand_final") return round === 1 ? "Grand final" : "Reset";
  if (bracket === "third_place") return "Third place";
  if (bracket === "upper" && round === totalRounds) return "Upper final";
  if (bracket === "lower" && round === totalRounds) return "Lower final";
  return `Round ${round}`;
}

function MatchCard({
  match,
  teamById,
  championTeamId,
}: {
  match: SrPublicMatch;
  teamById: Map<string, SrPublicTeam>;
  championTeamId: string | null;
}) {
  const done = match.status === "completed";
  return (
    <article
      className={cn(
        "border bg-surface",
        done ? "border-line-strong" : "border-line",
        match.status === "bye" && "opacity-60",
      )}
    >
      <TeamRow
        team={match.team_a_id ? teamById.get(match.team_a_id) : undefined}
        score={match.team_a_score}
        won={done && match.winner_id === match.team_a_id}
        showScore={done}
        isChampion={Boolean(championTeamId) && match.team_a_id === championTeamId && done}
      />
      <div className="h-px bg-line-subtle" />
      <TeamRow
        team={match.team_b_id ? teamById.get(match.team_b_id) : undefined}
        score={match.team_b_score}
        won={done && match.winner_id === match.team_b_id}
        showScore={done}
        isChampion={Boolean(championTeamId) && match.team_b_id === championTeamId && done}
      />
      {match.status === "bye" && (
        <p className="border-t border-line-subtle px-3 py-1 text-caption font-mono uppercase tracking-wide text-ink-muted">
          Bye
        </p>
      )}
    </article>
  );
}

function TeamRow({
  team,
  score,
  won,
  showScore,
  isChampion,
}: {
  team: SrPublicTeam | undefined;
  score: number;
  won: boolean;
  showScore: boolean;
  isChampion: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5">
      {team?.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element -- Blob-hosted
        // logos live on a per-store hostname; next/image would need a
        // remotePatterns entry that isn't configured.
        <img
          src={team.logo_url}
          alt=""
          width={32}
          height={32}
          className="h-8 w-8 shrink-0 border border-line object-cover"
        />
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center border border-line bg-elevated text-caption font-mono text-ink-muted">
          {team?.seed ?? "–"}
        </span>
      )}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-body-sm",
          team ? (won ? "text-ink font-semibold" : "text-ink-secondary") : "text-ink-muted italic",
        )}
      >
        {team?.name ?? "TBD"}
      </span>
      {isChampion && <Trophy strokeWidth={1.75} className="h-4 w-4 shrink-0 text-warning" />}
      {showScore && (
        <span
          className={cn(
            "shrink-0 font-mono text-body-sm tabular-nums",
            won ? "text-ink" : "text-ink-muted",
          )}
        >
          {score}
        </span>
      )}
    </div>
  );
}
