"use client";

import { useState } from "react";
import { Crown, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { TeamRosterModal } from "@/components/sections/team-roster-modal";
import type { Team } from "@/types/tournament";

interface TeamGridProps {
  teams: Team[];
}

export function TeamGrid({ teams }: TeamGridProps) {
  const [openTeam, setOpenTeam] = useState<Team | null>(null);
  const sorted = teams.slice().sort((a, b) => (a.seed ?? 99) - (b.seed ?? 99));

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {sorted.map((team) => (
          <TeamCard
            key={team.id}
            team={team}
            onClick={() => setOpenTeam(team)}
          />
        ))}
      </div>
      <TeamRosterModal
        team={openTeam}
        open={openTeam !== null}
        onClose={() => setOpenTeam(null)}
      />
    </>
  );
}

interface TeamCardProps {
  team: Team;
  onClick: () => void;
}

function TeamCard({ team, onClick }: TeamCardProps) {
  const players = team.players ?? [];
  const captain = players.find((p) => p.is_captain === 1);
  const startersCount = players.filter((p) => !p.is_substitute).length;
  const subsCount = players.filter((p) => p.is_substitute).length;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group text-left bg-surface border border-line p-6 flex flex-col gap-4",
        "hover:border-line-strong hover:-translate-y-0.5 hover:bg-elevated/40",
        "transition-all duration-200 ease-out-soft cursor-pointer",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-base",
      )}
      style={
        team.color ? { borderBottom: `3px solid ${team.color}` } : undefined
      }
      aria-label={`View roster for ${team.name}`}
    >
      <div className="flex items-start justify-between">
        <p className="text-label uppercase text-ink-muted">
          seed #{team.seed ?? "—"}
        </p>
        <span className="text-caption font-mono text-ink-muted">
          [{team.tag}]
        </span>
      </div>

      <div
        className="h-16 w-16 self-center flex items-center justify-center border-2"
        style={{
          backgroundColor: team.color ?? "#1A2240",
          borderColor: team.color ?? "#2D3A52",
        }}
      >
        <span className="font-display text-heading-lg leading-none text-white tracking-wider">
          {team.tag.slice(0, 4)}
        </span>
      </div>

      <div className="text-center space-y-1">
        <p className="font-display text-heading-md text-ink leading-tight">
          {team.name}
        </p>
        {captain && (
          <p className="text-caption text-ink-muted inline-flex items-center gap-1 justify-center">
            <Crown strokeWidth={1.5} className="h-3 w-3 text-brand-red-bright" />
            {captain.ign}
          </p>
        )}
      </div>

      <div className="flex items-center justify-center gap-2 pt-2 border-t border-line-subtle text-caption text-ink-muted font-mono">
        <Users strokeWidth={1.5} className="h-3 w-3" />
        {startersCount}/5
        {subsCount > 0 ? ` +${subsCount}` : ""}
        <span className="text-ink-disabled ml-2 group-hover:text-brand-red-bright transition-colors">
          · view roster
        </span>
      </div>
    </button>
  );
}
