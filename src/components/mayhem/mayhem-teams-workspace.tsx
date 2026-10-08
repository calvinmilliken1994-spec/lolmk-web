"use client";

import { DeckKicker } from "@/components/control-deck";
import { cn } from "@/lib/utils";
import type { MayhemTeam } from "@/types/mayhem";
import { mhQuietButton, type MayhemWorkspaceProps } from "./mayhem-entrants-workspace";
import { mayhemRerollLock, mayhemRevealStarted, mayhemTeamOnScreen } from "./mayhem-deck-model";

/**
 * Teams phase (mayhem-desk-teams.html): every team as a card, solid when it
 * is on the venue screen and dashed while still hidden. Re-roll and the
 * name/icon refresh lock once the reveal has started; the reveal itself is
 * driven from the broadcast column's tool slot and the primary action.
 */
export function MayhemTeamsWorkspace({ state, run, pending, actions }: MayhemWorkspaceProps) {
  const teams = state.teams;
  const lock = mayhemRerollLock(state);
  const started = mayhemRevealStarted(state);
  const premade = state.event.team_format === "premade";
  const sizes = new Set(teams.map((t) => t.players.length));
  const heading =
    teams.length === 0
      ? "No teams yet"
      : sizes.size === 1
        ? `${teams.length} teams of ${[...sizes][0]}`
        : `${teams.length} teams`;

  const reroll = () => {
    if (window.confirm("Re-roll teams? This reshuffles every roster and erases groups and the bracket.")) {
      void run(() => actions.randomizeTeams());
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <DeckKicker className="text-brand-red-bright">
            TEAMS · {premade ? "PREMADE" : state.event.team_format === "mixed" ? "MIXED" : "RANDOMIZED"}
          </DeckKicker>
          <h2 className="mt-1 font-heading text-[24px] font-semibold">{heading}</h2>
        </div>
        {teams.length > 0 && !premade && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" disabled={pending || lock !== null} onClick={reroll} className={cn(mhQuietButton, "h-[34px]")}>
              Re-roll teams
            </button>
            <button
              type="button"
              disabled={pending || started}
              onClick={() => void run(() => actions.refreshTeamIdentities())}
              className={cn(mhQuietButton, "h-[34px]")}
            >
              Refresh names
            </button>
            {lock && <span className="text-[12px] text-ink-muted">{lock}</span>}
          </div>
        )}
      </div>

      {teams.length === 0 ? (
        <p className="border border-dashed border-line-strong p-4 text-[13px] text-ink-muted">
          {premade
            ? "Premade teams appear here as captains register them. Finalize them with the action at the top."
            : "Randomize teams with the action at the top once enough players are in."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3" aria-label="Teams">
          {teams.map((t) => (
            <TeamCard key={t.id} team={t} onScreen={mayhemTeamOnScreen(state, t)} premade={premade} />
          ))}
        </div>
      )}

      {started && !premade && (
        <p className="text-[12px] text-ink-muted">
          Restart the reveal (broadcast column) to unlock re-roll and name refresh.
        </p>
      )}
      <div className="border border-line bg-deck-rail px-3 py-2.5 text-[13px] text-ink-secondary">
        {state.event.format.groupStage.enabled
          ? `Groups are on: ${state.event.format.groupStage.groupCount} groups, top ${state.event.format.groupStage.advancePerGroup} advance. Format settings stay in Entrants.`
          : "Groups are switched off for this event, so the rail skips that phase. Format settings stay in Entrants."}
      </div>
    </>
  );
}

function TeamCard({ team, onScreen, premade }: { team: MayhemTeam; onScreen: boolean; premade: boolean }) {
  return (
    <div
      data-team-card={team.id}
      data-on-screen={onScreen ? "1" : "0"}
      className={cn(
        "flex flex-col gap-1.5 rounded-sm border p-3",
        onScreen ? "border-line-strong bg-surface" : "border-dashed border-line-strong bg-deck-rail",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-heading text-[17px] font-semibold" title={team.name}>
          {team.name}
        </span>
        <span
          className={cn(
            "shrink-0 px-1.5 py-[3px] font-mono text-[10px] font-semibold",
            onScreen ? "bg-success-surface text-success-ink" : "bg-line-subtle text-ink-muted",
          )}
        >
          {onScreen ? "ON SCREEN" : "HIDDEN"}
        </span>
      </div>
      {team.players.map((p) => (
        <span key={p.id} className="flex min-h-[22px] justify-between gap-2 text-[13px] text-ink-secondary">
          <span className="min-w-0 truncate text-ink">{p.display_name}</span>
          <span className="shrink-0 text-[12px] text-ink-muted">
            {premade && team.captain_discord_id && p.member_discord_id === team.captain_discord_id
              ? "captain"
              : p.member_discord_id
                ? "member"
                : "guest"}
          </span>
        </span>
      ))}
      {premade && !team.is_ready && <span className="text-[12px] text-warning-ink">Not full yet</span>}
    </div>
  );
}
