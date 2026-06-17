"use client";

import { useEffect, useRef } from "react";
import { X, Crown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Player, Team } from "@/types/tournament";

interface TeamRosterModalProps {
  team: Team | null;
  open: boolean;
  onClose: () => void;
}

const RANK_DISPLAY: Record<string, string> = {
  IRON_IV: "Iron IV", IRON_III: "Iron III", IRON_II: "Iron II", IRON_I: "Iron I",
  BRONZE_IV: "Bronze IV", BRONZE_III: "Bronze III", BRONZE_II: "Bronze II", BRONZE_I: "Bronze I",
  SILVER_IV: "Silver IV", SILVER_III: "Silver III", SILVER_II: "Silver II", SILVER_I: "Silver I",
  GOLD_IV: "Gold IV", GOLD_III: "Gold III", GOLD_II: "Gold II", GOLD_I: "Gold I",
  PLATINUM_IV: "Platinum IV", PLATINUM_III: "Platinum III", PLATINUM_II: "Platinum II", PLATINUM_I: "Platinum I",
  EMERALD_IV: "Emerald IV", EMERALD_III: "Emerald III", EMERALD_II: "Emerald II", EMERALD_I: "Emerald I",
  DIAMOND_IV: "Diamond IV", DIAMOND_III: "Diamond III", DIAMOND_II: "Diamond II", DIAMOND_I: "Diamond I",
  MASTER: "Master", GRANDMASTER: "Grandmaster", CHALLENGER: "Challenger",
};

const ROLE_ORDER: Player["role"][] = [
  "TOP",
  "JUNGLE",
  "MID",
  "ADC",
  "SUPPORT",
  "FILL",
];

export function TeamRosterModal({ team, open, onClose }: TeamRosterModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  function onBackdropClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  if (!team) return null;

  const players = (team.players ?? []).slice().sort(
    (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role),
  );
  const starters = players.filter((p) => !p.is_substitute);
  const subs = players.filter((p) => p.is_substitute);
  const captainInRoster = players.find((p) => p.is_captain === 1);

  return (
    <dialog
      ref={dialogRef}
      onClick={onBackdropClick}
      onClose={onClose}
      aria-labelledby={`team-${team.id}-title`}
      className="bg-transparent text-ink p-0 m-auto max-w-2xl w-[calc(100vw-2rem)] backdrop:bg-base/85 backdrop:backdrop-blur-sm"
    >
      <div
        className="bg-surface border border-line-strong relative"
        style={
          team.color
            ? { borderBottom: `4px solid ${team.color}` }
            : undefined
        }
      >
        <div className="flex items-start gap-5 p-6 border-b border-line-subtle">
          <div
            className="h-20 w-20 flex items-center justify-center border-2 shrink-0"
            style={{
              backgroundColor: team.color ?? "#1A2240",
              borderColor: team.color ?? "#2D3A52",
            }}
          >
            <span className="font-display text-display-sm leading-none text-white tracking-wider">
              {team.tag.slice(0, 4)}
            </span>
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-label uppercase text-ink-muted">
                Seed #{team.seed ?? "—"}
              </p>
              <span className="text-label uppercase text-ink-muted">·</span>
              <p className="text-label uppercase text-ink-muted font-mono">
                [{team.tag}]
              </p>
            </div>
            <h2
              id={`team-${team.id}-title`}
              className="font-display text-display-sm text-ink leading-tight"
            >
              {team.name}
            </h2>
            {captainInRoster && (
              <p className="text-body-sm text-ink-secondary inline-flex items-center gap-2">
                <Crown
                  strokeWidth={1.5}
                  className="h-4 w-4 text-brand-red-bright"
                />
                Captain: <span className="text-ink">{captainInRoster.ign}</span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 -mr-1 -mt-1 text-ink-muted hover:text-ink transition-colors"
          >
            <X strokeWidth={1.5} className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 max-h-[70vh] overflow-y-auto">
          <p className="text-label uppercase text-ink-muted mb-3">Starters</p>
          <div className="space-y-2">
            {starters.length === 0 && (
              <p className="text-body-sm text-ink-muted">No roster on file yet.</p>
            )}
            {starters.map((p) => (
              <PlayerRow key={p.id} player={p} />
            ))}
          </div>

          {subs.length > 0 && (
            <>
              <p className="text-label uppercase text-ink-muted mt-6 mb-3">
                Substitutes
              </p>
              <div className="space-y-2 opacity-70">
                {subs.map((p) => (
                  <PlayerRow key={p.id} player={p} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}

function PlayerRow({ player }: { player: Player }) {
  const roleClass = roleBadgeClass(player.role);
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 bg-base border border-line-subtle">
      <div className="h-10 w-10 bg-elevated border border-line-subtle flex items-center justify-center shrink-0">
        <span className="font-display text-body-md text-ink-secondary leading-none">
          {player.ign.slice(0, 2).toUpperCase()}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-heading text-heading-sm text-ink leading-tight truncate inline-flex items-center gap-2">
          {player.ign}
          {player.is_captain === 1 && (
            <span
              title="Captain"
              className="inline-flex items-center justify-center h-4 w-4 bg-brand-red-muted text-brand-red-bright text-[10px] font-bold leading-none"
            >
              C
            </span>
          )}
        </p>
        <p className="text-caption font-mono text-ink-muted truncate">
          @{player.discord_username}
        </p>
      </div>
      <span
        className={cn(
          "px-2 py-1 text-label uppercase tracking-wider",
          roleClass,
        )}
      >
        {player.role}
      </span>
      <div className="text-right shrink-0 w-28">
        <p className="font-display text-body-md text-ink leading-tight">
          {player.peak_rank ? RANK_DISPLAY[player.peak_rank] : "—"}
        </p>
        <p className="text-caption text-ink-muted leading-tight">
          now: {player.current_rank ? RANK_DISPLAY[player.current_rank] : "—"}
        </p>
      </div>
    </div>
  );
}

function roleBadgeClass(role: Player["role"]): string {
  if (role === "FILL") return "bg-brand-blue-muted text-brand-blue-bright";
  return "bg-elevated text-ink";
}
