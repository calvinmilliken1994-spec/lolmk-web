/**
 * Pure model for the Mayhem desk (Control Deck v2). No React, no server
 * calls: phases, the single primary step, scene availability, lock reasons
 * and the labels the top bar and broadcast column show. Tested in
 * scripts/test-mayhem-deck-model.ts.
 */
import { isRevealStarted } from "../../lib/mayhem-reveal";
import type {
  MayhemAdminState,
  MayhemAuditEntry,
  MayhemFull,
  MayhemMatch,
  MayhemScene,
  MayhemTeam,
} from "../../types/mayhem";

export type MayhemPhaseId = "entrants" | "teams" | "groups" | "knockout" | "complete";

export interface MayhemPhaseRow {
  id: MayhemPhaseId;
  label: string;
  status: "done" | "live" | "next" | "off";
  meta?: string;
}

export const MAYHEM_SCENE_ORDER: MayhemScene[] = [
  "idle",
  "starting_soon",
  "reveal",
  "teams",
  "groups",
  "bracket",
  "match",
  "champion",
];

/** Scene-grid button labels (mayhem-desk-teams.html). */
export const MAYHEM_SCENE_LABEL: Record<MayhemScene, string> = {
  idle: "Idle",
  starting_soon: "Starting soon",
  reveal: "Reveal",
  teams: "Teams",
  groups: "Groups",
  bracket: "Bracket",
  match: "Match",
  champion: "Champion",
};

/** Monitor labels ("● PROGRAM · Team reveal"). */
export const MAYHEM_SCENE_TITLE: Record<MayhemScene, string> = {
  idle: "Idle (logo)",
  starting_soon: "Starting soon",
  reveal: "Team reveal",
  teams: "Team list",
  groups: "Groups",
  bracket: "Bracket",
  match: "Current match",
  champion: "Champion",
};

export function mayhemParseScene(raw: string | null | undefined): MayhemScene | null {
  return raw && (MAYHEM_SCENE_ORDER as string[]).includes(raw) ? (raw as MayhemScene) : null;
}

const groupsOn = (s: MayhemFull) => s.event.format.groupStage.enabled;
const knockout = (s: MayhemFull) => s.matches.filter((m) => m.bracket !== "group");
const groupMatches = (s: MayhemFull) => s.matches.filter((m) => m.bracket === "group");
const isPremade = (s: MayhemFull) => s.event.team_format === "premade";

/** The phase the event is in, from MayhemStage. */
export function mayhemCurrentPhase(s: MayhemFull): MayhemPhaseId {
  switch (s.event.stage) {
    case "collecting":
      return "entrants";
    case "randomized":
      return "teams";
    case "group_stage":
      return "groups";
    case "knockout":
      return "knockout";
    case "completed":
      return "complete";
  }
}

const PHASES: { id: MayhemPhaseId; label: string }[] = [
  { id: "entrants", label: "Entrants" },
  { id: "teams", label: "Teams" },
  { id: "groups", label: "Groups" },
  { id: "knockout", label: "Knockout" },
  { id: "complete", label: "Complete" },
];

/**
 * Rail rows. Groups is "off" (skipped) when the group stage is disabled,
 * unless the event is somehow in it. Live rows say NOW, like the reference;
 * Entrants always shows the player count.
 */
export function mayhemPhases(s: MayhemFull): MayhemPhaseRow[] {
  const current = mayhemCurrentPhase(s);
  const order = PHASES.map((p) => p.id);
  const idx = (id: MayhemPhaseId) => order.indexOf(id);
  return PHASES.map(({ id, label }) => {
    if (id === "groups" && !groupsOn(s) && current !== "groups") return { id, label, status: "off", meta: "OFF" };
    const status: MayhemPhaseRow["status"] = idx(id) < idx(current) ? "done" : id === current ? "live" : "next";
    let meta: string | undefined = status === "live" ? "NOW" : undefined;
    if (id === "entrants") meta = `${s.players.length}`;
    const played = id === "groups" ? groupMatches(s) : id === "knockout" ? knockout(s) : [];
    if (status === "live" && played.length > 0) meta = `${doneCount(played)}/${played.filter(isRealMatch).length}`;
    if (id === "complete" && status === "live") meta = "DONE";
    return { id, label, status, meta };
  });
}

/** A match that is (or will be) played: byes don't count toward progress. */
const isRealMatch = (m: MayhemMatch) => m.status !== "bye";
const doneCount = (ms: MayhemMatch[]) => ms.filter((m) => m.status === "completed").length;

// ---------------------------------------------------------------------------
// Entrants rules (ported from the old dashboard, unchanged)
// ---------------------------------------------------------------------------

export interface MayhemReadiness {
  canRandomize: boolean;
  playersNeeded: number;
  teamCount: number;
}

/** Randomize needs at least 20 players in multiples of 5 (the server re-checks). */
export function mayhemReadiness(s: MayhemFull): MayhemReadiness {
  const n = s.players.length;
  const target = Math.max(20, Math.ceil(n / 5) * 5);
  return { canRandomize: n >= 20 && n % 5 === 0, playersNeeded: target - n, teamCount: n / 5 };
}

/** Team format is locked once any player or team exists (server rule in setTeamFormat). */
export function mayhemTeamFormatLock(s: MayhemFull): string | null {
  return s.players.length > 0 || s.teams.length > 0 ? "Locked: players exist. Reset everything to change it." : null;
}

/** Knockout settings are locked once a bracket exists (server rule in updateFormat). */
export function mayhemKnockoutSettingsLock(s: MayhemFull): string | null {
  return knockout(s).length > 0 ? "Locked: the knockout bracket is generated." : null;
}

/** Re-roll and name refresh: locked once the reveal has started (server rule too). */
export function mayhemRevealStarted(s: MayhemFull): boolean {
  return isRevealStarted({
    stage: s.event.stage,
    revealIndex: s.event.reveal_index,
    autoReveal: s.event.auto_reveal,
    revealStartedAt: s.event.reveal_started_at,
  });
}

export function mayhemRerollLock(s: MayhemFull): string | null {
  if (s.event.stage === "collecting") return "No teams yet.";
  if (isPremade(s)) return "Premade teams can't be re-rolled.";
  if (mayhemRevealStarted(s)) return "Locked: reveal started";
  return null;
}

// ---------------------------------------------------------------------------
// Reveal
// ---------------------------------------------------------------------------

/** Teams come back from getMayhemFull in reveal order; the first `reveal_index` are on screen. */
export function mayhemTeamOnScreen(s: MayhemFull, team: MayhemTeam): boolean {
  return s.teams.findIndex((t) => t.id === team.id) < s.event.reveal_index;
}

export interface MayhemRevealView {
  shown: number;
  total: number;
  running: boolean;
  waitingForCountdown: boolean;
  intervalSeconds: number;
}

export function mayhemReveal(s: MayhemFull): MayhemRevealView {
  return {
    shown: s.event.reveal_index,
    total: s.teams.length,
    running: s.event.auto_reveal,
    waitingForCountdown: s.event.auto_reveal && s.event.reveal_start_on_countdown && !s.event.reveal_started_at,
    intervalSeconds: Math.round(s.event.reveal_interval_ms / 1000),
  };
}

// ---------------------------------------------------------------------------
// Primary action
// ---------------------------------------------------------------------------

export type MayhemPrimaryKind =
  | "randomize"
  | "finalize_premade"
  | "reveal_next"
  | "generate_groups"
  | "knockout_from_groups"
  | "knockout_from_teams";

export interface MayhemPrimarySpec {
  kind: MayhemPrimaryKind;
  label: string;
  enabled: boolean;
  reason?: string;
  hint?: string;
}

/** What comes after the reveal: groups when on, otherwise the bracket. */
function afterReveal(s: MayhemFull): string {
  return groupsOn(s) ? "generate groups" : "seed knockout bracket";
}

/**
 * The one next step. Null while the knockout is being played (the match
 * queue is the work) and once the event is complete.
 */
export function mayhemPrimarySpec(s: MayhemFull): MayhemPrimarySpec | null {
  switch (s.event.stage) {
    case "collecting": {
      if (isPremade(s)) {
        const notReady = s.teams.filter((t) => !t.is_ready).length;
        const reason =
          s.teams.length === 0
            ? "No premade teams yet."
            : notReady > 0
              ? `${notReady} team${notReady === 1 ? "" : "s"} not full yet.`
              : undefined;
        return { kind: "finalize_premade", label: "Finalize premade teams", enabled: !reason, reason, hint: reason ? undefined : "Then: reveal teams" };
      }
      const r = mayhemReadiness(s);
      return r.canRandomize
        ? { kind: "randomize", label: "Randomize teams", enabled: true, hint: `${r.teamCount} teams of 5 · closes signups` }
        : {
            kind: "randomize",
            label: "Randomize teams",
            enabled: false,
            reason: `Need ${r.playersNeeded} more player${r.playersNeeded === 1 ? "" : "s"} (multiples of 5, min 20).`,
          };
    }
    case "randomized": {
      const v = mayhemReveal(s);
      if (v.shown < v.total) {
        return {
          kind: "reveal_next",
          label: `Reveal team ${v.shown + 1}`,
          enabled: !v.running,
          reason: v.running
            ? v.waitingForCountdown
              ? "Auto-reveal starts when the countdown ends."
              : `Auto-reveal is running (every ${v.intervalSeconds}s).`
            : undefined,
          hint: v.running ? undefined : `Then: ${afterReveal(s)}`,
        };
      }
      return groupsOn(s)
        ? { kind: "generate_groups", label: "Generate groups", enabled: true, hint: `${s.event.format.groupStage.groupCount} groups` }
        : { kind: "knockout_from_teams", label: "Seed knockout bracket", enabled: s.teams.length > 0, hint: "Seeded from all teams" };
    }
    case "group_stage": {
      if (s.groups.length === 0) return { kind: "generate_groups", label: "Generate groups", enabled: true };
      const open = groupMatches(s).filter((m) => isRealMatch(m) && m.status !== "completed").length;
      // The server seeds from standings as they are; this only says what's left.
      return {
        kind: "knockout_from_groups",
        label: "Seed knockout from standings",
        enabled: true,
        hint: open > 0 ? `${open} group match${open === 1 ? "" : "es"} still open` : "Every group match is reported",
      };
    }
    case "knockout":
    case "completed":
      return null;
  }
}

// ---------------------------------------------------------------------------
// Scenes, top bar
// ---------------------------------------------------------------------------

/** Null when the scene can go on air now; otherwise why not. Ported from the old desk. */
export function mayhemSceneUnavailableReason(scene: MayhemScene, s: MayhemFull): string | null {
  switch (scene) {
    case "reveal":
    case "teams":
      return s.teams.length === 0 ? "Randomize teams first" : null;
    case "groups":
      if (!groupsOn(s)) return "Enable group stage first";
      return s.groups.length === 0 ? "Generate groups first" : null;
    case "bracket":
      return knockout(s).length === 0 ? "Generate a bracket first" : null;
    case "match":
      return s.event.active_match_id ? null : "Set an active match first";
    case "champion":
      return s.event.champion_team_id ? null : "Awarded automatically once decided";
    default:
      return null;
  }
}

/** ON AIR chip text: the reveal shows its progress ("Reveal · 3 of 6"). */
export function mayhemOnAirLabel(s: MayhemFull): string {
  if (s.event.scene === "reveal") return `Reveal · ${s.event.reveal_index} of ${s.teams.length}`;
  return MAYHEM_SCENE_TITLE[s.event.scene];
}

const FORMAT_LABEL = { randomized: "Random teams", premade: "Premade teams", mixed: "Mixed teams" } as const;

export function mayhemTitle(s: MayhemFull): string {
  return `${s.event.title} · ${FORMAT_LABEL[s.event.team_format]}`;
}

/** Mono status chip, e.g. "TEAMS · 30 PLAYERS" or "KNOCKOUT · 3/7 MATCHES". */
export function mayhemStatusChip(s: MayhemFull): string {
  const players = `${s.players.length} PLAYER${s.players.length === 1 ? "" : "S"}`;
  switch (s.event.stage) {
    case "collecting":
      return `ENTRANTS · ${players}${s.event.registration_open ? " · SIGNUPS OPEN" : ""}`;
    case "randomized":
      return `TEAMS · ${players}`;
    case "group_stage": {
      const ms = groupMatches(s).filter(isRealMatch);
      return `GROUPS · ${doneCount(ms)}/${ms.length} MATCHES`;
    }
    case "knockout": {
      const ms = knockout(s).filter(isRealMatch);
      return `KNOCKOUT · ${doneCount(ms)}/${ms.length} MATCHES`;
    }
    case "completed":
      return "COMPLETE";
  }
}

// ---------------------------------------------------------------------------
// Matches
// ---------------------------------------------------------------------------

export function mayhemTeamName(s: Pick<MayhemFull, "teams">, id: string | null): string {
  if (!id) return "TBD";
  return s.teams.find((t) => t.id === id)?.name ?? "TBD";
}

export type MayhemQueueStatus = "on_screen" | "ready" | "waiting" | "done" | "bye";

export interface MayhemQueueRow {
  match: MayhemMatch;
  status: MayhemQueueStatus;
  nameA: string;
  nameB: string;
  /** e.g. "Upper · R1" / "Grand final" / "Group A". */
  where: string;
}

const BRACKET_LABEL: Record<MayhemMatch["bracket"], string> = {
  group: "Group",
  upper: "Upper",
  lower: "Lower",
  grand_final: "Grand final",
  third_place: "Third place",
};

export function mayhemMatchWhere(s: MayhemFull, m: MayhemMatch): string {
  if (m.bracket === "group") return s.groups.find((g) => g.id === m.group_id)?.label ?? "Group";
  if (m.bracket === "grand_final" || m.bracket === "third_place") {
    return m.round_number > 1 ? `${BRACKET_LABEL[m.bracket]} · reset` : BRACKET_LABEL[m.bracket];
  }
  return `${BRACKET_LABEL[m.bracket]} · R${m.round_number}`;
}

function queueRow(s: MayhemFull, m: MayhemMatch): MayhemQueueRow {
  const status: MayhemQueueStatus =
    m.status === "completed"
      ? "done"
      : m.status === "bye"
        ? "bye"
        : !m.team_a_id || !m.team_b_id
          ? "waiting"
          : s.event.active_match_id === m.id
            ? "on_screen"
            : "ready";
  return {
    match: m,
    status,
    nameA: mayhemTeamName(s, m.team_a_id),
    nameB: mayhemTeamName(s, m.team_b_id),
    where: mayhemMatchWhere(s, m),
  };
}

export interface MayhemQueue {
  /** The match on the venue screen, if any. */
  onScreen: MayhemQueueRow | null;
  /** Both teams known, no result, not on screen; in match-number order. */
  ready: MayhemQueueRow[];
  /** Waiting on earlier results. */
  waiting: MayhemQueueRow[];
  /** Reported, newest match number first. */
  done: MayhemQueueRow[];
}

/** Knockout match queue (or a group's matches when `bracket` is "group"). */
export function mayhemQueue(s: MayhemFull, which: "knockout" | "group" = "knockout"): MayhemQueue {
  const rows = (which === "knockout" ? knockout(s) : groupMatches(s))
    .slice()
    .sort((a, b) => a.match_number - b.match_number)
    .map((m) => queueRow(s, m));
  return {
    onScreen: rows.find((r) => r.status === "on_screen") ?? null,
    ready: rows.filter((r) => r.status === "ready"),
    waiting: rows.filter((r) => r.status === "waiting"),
    done: rows.filter((r) => r.status === "done").reverse(),
  };
}

export function mayhemGroupRows(s: MayhemFull, groupId: string): MayhemQueueRow[] {
  return groupMatches(s)
    .filter((m) => m.group_id === groupId)
    .sort((a, b) => a.match_number - b.match_number)
    .map((m) => queueRow(s, m));
}

export function scorePadFormat(m: MayhemMatch): "bo1" | "bo3" | "bo5" {
  return m.best_of === 5 ? "bo5" : m.best_of === 3 ? "bo3" : "bo1";
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

export interface MayhemActivityRow {
  id: string;
  at: string;
  actor: string;
  text: string;
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** One line per audit row, newest first. Team names resolve against the current teams. */
export function mayhemActivityText(s: Pick<MayhemFull, "teams" | "matches">, e: MayhemAuditEntry): string {
  const d = e.detail;
  switch (e.action) {
    case "player.add":
      return `Added ${str(d.name)}`;
    case "player.bulk_add":
      return `Pasted a list: ${num(d.added)} added`;
    case "player.remove":
      return `Removed ${str(d.name)}`;
    case "player.rename":
      return `Renamed a player to ${str(d.name)}`;
    case "event.reset":
      return "Reset everything";
    case "event.team_format":
      return `Team format: ${str(d.format)}`;
    case "registration.open":
      return "Opened signups";
    case "registration.close":
      return "Closed signups";
    case "teams.randomize":
      return d.reroll ? `Re-rolled teams (${num(d.teams)})` : `Randomized ${num(d.teams)} teams`;
    case "teams.finalize_premade":
      return `Finalized ${num(d.teams)} premade teams`;
    case "teams.refresh_identities":
      return "Refreshed team names and icons";
    case "scene.set":
      return `Took ${MAYHEM_SCENE_TITLE[str(d.scene) as MayhemScene] ?? str(d.scene)}`;
    case "countdown.start":
      return `Started a ${num(d.seconds)}s countdown`;
    case "reveal.advance":
      return `Revealed team ${num(d.shown)} of ${num(d.of)}`;
    case "reveal.auto_start":
      return d.startOnCountdownEnd
        ? `Auto-reveal every ${num(d.intervalSeconds)}s after the countdown`
        : `Auto-reveal every ${num(d.intervalSeconds)}s`;
    case "reveal.auto_pause":
      return `Paused auto-reveal at ${num(d.shown)} of ${num(d.of)}`;
    case "reveal.hide_last":
      return `Hid the last team (${num(d.shown)} of ${num(d.of)} on screen)`;
    case "reveal.restart":
      return "Restarted the reveal";
    case "format.update":
      return "Changed the format";
    case "groups.generate":
      return d.regenerated ? `Regenerated ${num(d.groups)} groups` : `Generated ${num(d.groups)} groups`;
    case "knockout.generate":
      return d.source === "groups" ? "Seeded the knockout from group standings" : "Seeded the knockout from all teams";
    case "match.set_active":
    case "match.clear_active": {
      if (e.action === "match.clear_active") return "Cleared the active match";
      const m = s.matches.find((x) => x.id === str(d.matchId));
      return m ? `Put M${m.match_number} on screen` : "Set the active match";
    }
    case "match.report": {
      const winner = mayhemTeamName(s, str(d.winnerId) || null);
      const a = num(d.teamAScore);
      const b = num(d.teamBScore);
      const text = `M${num(d.matchNumber)}: ${winner} won ${Math.max(a, b)}–${Math.min(a, b)}`;
      return d.championId ? `${text} · champion` : text;
    }
    case "match.undo":
      return `Undid the M${num(d.matchNumber)} result`;
    default:
      return e.action;
  }
}

export function mayhemActivity(s: MayhemAdminState): MayhemActivityRow[] {
  return s.audit.map((e) => ({ id: e.id, at: e.at, actor: e.actor_name, text: mayhemActivityText(s, e) }));
}
