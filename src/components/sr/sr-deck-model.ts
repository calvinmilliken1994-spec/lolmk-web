// Pure model for the Summoner's Rift desk (Control Deck v2). No React, no
// server imports: the desk components render what these functions return,
// and scripts/test-sr-deck-model.ts checks them over hand-built states.
//
// Spec: docs/design/control-deck-v2/ (components.md "SR", behaviour.md,
// screens/sr-desk-live.html). Where the reference assumes data SR doesn't
// have (rooms, a "start match" state, per-game scores, start times), these
// derive the nearest real thing; see the Task 12 entry in
// docs/RIFTBOUND-LOG.md.

import { ubr1RevealDurationMs, ubr1VisibleCount } from "../../lib/sr-reveal";
import { formatAuditActor } from "../../types/audit-actor";
import type {
  SrAdminState,
  SrAuditLogEntry,
  SrMatch,
  SrMatchScene,
  SrTeam,
  SrTeamApplicationView,
} from "../../types/sr-tournament";

export type SrPhaseId = "setup" | "signups" | "seeding" | "bracket" | "live" | "complete";
export type SrPhaseStatus = "done" | "live" | "next" | "off";

export interface SrPhaseRow {
  id: SrPhaseId;
  label: string;
  status: SrPhaseStatus;
  meta?: string;
}

const PHASE_ORDER: SrPhaseId[] = ["setup", "signups", "seeding", "bracket", "live", "complete"];

const PHASE_LABEL: Record<SrPhaseId, string> = {
  setup: "Setup",
  signups: "Signups",
  seeding: "Seeding",
  bracket: "Bracket",
  live: "Live",
  complete: "Complete",
};

export const SR_SCENE_ORDER: SrMatchScene[] = ["idle", "starting_soon", "teams", "bracket", "match", "champion"];

export const SR_SCENE_LABEL: Record<SrMatchScene, string> = {
  idle: "Idle",
  starting_soon: "Starting soon",
  teams: "Teams",
  bracket: "Bracket",
  match: "Match",
  champion: "Champion",
};

// ---------------------------------------------------------------------------
// Teams and counts
// ---------------------------------------------------------------------------

export function srApproved(s: SrAdminState): SrTeam[] {
  return s.teams.filter((t) => t.status === "approved");
}

export function srTeamName(s: SrAdminState, id: string | null): string {
  if (!id) return "TBD";
  return s.teams.find((t) => t.id === id)?.name ?? "TBD";
}

function teamSeed(s: SrAdminState, id: string | null): number | null {
  return id ? (s.teams.find((t) => t.id === id)?.seed ?? null) : null;
}

/** Anything in the signups queue: a team, or an application still collecting confirmations. */
function hasSignupActivity(s: SrAdminState): boolean {
  return s.tournament.signups_open || s.teams.length > 0 || s.applications.length > 0;
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

/**
 * The phase the event is in. Setup and Signups are both `draft` (there is no
 * signups status: `signups_open` is a flag on a draft tournament). Signups
 * is current once signups are open or anyone has applied.
 */
export function srCurrentPhase(s: SrAdminState): SrPhaseId {
  switch (s.tournament.status) {
    case "draft":
      return hasSignupActivity(s) ? "signups" : "setup";
    case "seeding":
      return "seeding";
    case "bracket_published":
      return "bracket";
    case "in_progress":
      return "live";
    case "completed":
    case "archived":
      return "complete";
  }
}

export function srPhases(s: SrAdminState): SrPhaseRow[] {
  const current = srCurrentPhase(s);
  const at = PHASE_ORDER.indexOf(current);
  const approved = srApproved(s).length;
  const counts = srMatchCounts(s);
  return PHASE_ORDER.map((id, i) => {
    const status: SrPhaseStatus = i < at ? "done" : i === at ? "live" : "next";
    let meta: string | undefined;
    if (id === "signups" && (status !== "next" || approved > 0)) meta = `${approved} team${approved === 1 ? "" : "s"}`;
    if (id === "bracket" && status === "live") meta = `${counts.done}/${counts.total}`;
    if (id === "live" && status === "live") meta = "LIVE";
    if (id === "complete" && status === "live") meta = s.tournament.status === "archived" ? "ARCHIVED" : "DONE";
    return { id, label: PHASE_LABEL[id], status, meta };
  });
}

// ---------------------------------------------------------------------------
// Match labels and the bracket graph
// ---------------------------------------------------------------------------

/** The grand-final reset before it's been decided: no teams and nothing feeds it. */
function isDeferredReset(s: SrAdminState, m: SrMatch): boolean {
  return (
    m.bracket === "grand_final" &&
    m.round_number > 1 &&
    !m.team_a_id &&
    !m.team_b_id &&
    m.status !== "completed" &&
    !s.matches.some((x) => x.advances_to_match_id === m.id || x.drops_to_match_id === m.id)
  );
}

/** Matches that are or may be played: no byes and no undecided grand-final reset. */
function realMatches(s: SrAdminState): SrMatch[] {
  return s.matches.filter((m) => m.status !== "bye" && !isDeferredReset(s, m));
}

export function srMatchCounts(s: SrAdminState): { done: number; total: number } {
  const real = realMatches(s);
  return { done: real.filter((m) => m.status === "completed").length, total: real.length };
}

function roundsIn(s: SrAdminState, bracket: SrMatch["bracket"]): number {
  return s.matches.filter((m) => m.bracket === bracket).reduce((n, m) => Math.max(n, m.round_number), 0);
}

function indexInRound(s: SrAdminState, m: SrMatch): { index: number; of: number } {
  const peers = s.matches
    .filter((x) => x.bracket === m.bracket && x.round_number === m.round_number)
    .sort((a, b) => a.match_number - b.match_number);
  return { index: peers.findIndex((x) => x.id === m.id) + 1, of: peers.length };
}

/**
 * "UB Semi 1", "LB Round 2", "Grand final · reset". `long` spells out
 * Semifinal/Quarterfinal for the Now playing kicker. Single elimination
 * drops the UB prefix ("Semi 1", "Final").
 */
export function srMatchLabel(s: SrAdminState, m: SrMatch, long = false): string {
  const de = s.tournament.format === "double_elim";
  // Single elimination: the engine retags the final as the grand final.
  if (m.bracket === "grand_final") return !de ? "Final" : m.round_number > 1 ? "Grand final · reset" : "Grand final";
  if (m.bracket === "third_place") return "Third place";
  // ...so the upper section there ends one round before the final.
  const rounds = roundsIn(s, m.bracket) + (!de && m.bracket === "upper" ? 1 : 0);
  const { index, of } = indexInRound(s, m);
  const n = of > 1 ? ` ${index}` : "";
  if (m.bracket === "lower") {
    return m.round_number === rounds ? "LB Final" : `LB Round ${m.round_number}`;
  }
  const p = de ? "UB " : "";
  if (m.round_number === rounds) return `${p}Final`;
  if (m.round_number === rounds - 1) return `${p}${long ? "Semifinal" : "Semi"}${n}`;
  if (m.round_number === rounds - 2 && rounds >= 3) return `${p}${long ? "Quarterfinal" : "Quarter"}${n}`;
  return `${p}Round ${m.round_number}`;
}

/**
 * A feeder's label, numbered when its round has several unnumbered matches:
 * "LB Round 1 · 2" (semis and quarters already carry a number).
 */
function sourceLabel(s: SrAdminState, m: SrMatch): string {
  const label = srMatchLabel(s, m);
  const { index, of } = indexInRound(s, m);
  return of > 1 && !/(Semi|Quarter)\S* \d+$/.test(label) ? `${label} · ${index}` : label;
}

/** Where a still-unknown slot comes from: "Winner UB Semi 1", "Loser UB Final". */
function slotSource(s: SrAdminState, m: SrMatch, slot: "a" | "b"): string {
  const teamId = slot === "a" ? m.team_a_id : m.team_b_id;
  if (teamId) return srTeamName(s, teamId);
  const win = s.matches.find((x) => x.advances_to_match_id === m.id && x.advances_to_slot === slot);
  if (win) return `Winner ${sourceLabel(s, win)}`;
  const lose = s.matches.find((x) => x.drops_to_match_id === m.id && x.drops_to_slot === slot);
  if (lose) return `Loser ${sourceLabel(s, lose)}`;
  return "TBD";
}

const BRACKET_RANK: Record<SrMatch["bracket"], number> = { upper: 0, lower: 1, third_place: 2, grand_final: 3 };

/**
 * How many results deep a match sits: 0 for first-round matches, otherwise
 * one more than its deepest feeder. Round numbers can't order a double
 * elimination bracket on their own (LB rounds outnumber UB rounds, and the
 * grand final is round 1 of its own section).
 */
function depths(s: SrAdminState): Map<string, number> {
  const feeders = new Map<string, SrMatch[]>();
  for (const x of s.matches) {
    for (const to of [x.advances_to_match_id, x.drops_to_match_id]) {
      if (to) feeders.set(to, [...(feeders.get(to) ?? []), x]);
    }
  }
  const memo = new Map<string, number>();
  const depth = (m: SrMatch, seen: Set<string>): number => {
    const known = memo.get(m.id);
    if (known !== undefined) return known;
    if (seen.has(m.id)) return 0;
    seen.add(m.id);
    const from = feeders.get(m.id) ?? [];
    // The grand-final reset is fed by app code, not links: it follows GF1.
    const gf1 = m.bracket === "grand_final" && m.round_number > 1
      ? s.matches.filter((x) => x.bracket === "grand_final" && x.round_number < m.round_number)
      : [];
    const d = [...from, ...gf1].reduce((n, x) => Math.max(n, depth(x, seen) + 1), 0);
    memo.set(m.id, d);
    return d;
  };
  for (const m of s.matches) depth(m, new Set());
  return memo;
}

/** Bracket order: how deep in the bracket, upper before lower, then round and match number. */
function bracketOrder(s: SrAdminState): (a: SrMatch, b: SrMatch) => number {
  const d = depths(s);
  return (a, b) =>
    (d.get(a.id) ?? 0) - (d.get(b.id) ?? 0) ||
    BRACKET_RANK[a.bracket] - BRACKET_RANK[b.bracket] ||
    a.round_number - b.round_number ||
    a.match_number - b.match_number;
}

// ---------------------------------------------------------------------------
// Match queue
// ---------------------------------------------------------------------------

export interface SrQueueRow {
  match: SrMatch;
  label: string;
  nameA: string;
  nameB: string;
  seedA: number | null;
  seedB: number | null;
  /** Up next: "Both teams ready" / "Hanbit Five is playing UB Semi 1". */
  readiness: string;
  ready: boolean;
}

export interface SrQueue {
  /** The featured match (`active_match_id`), while it has no result. */
  nowPlaying: SrQueueRow | null;
  /** Both teams known, no result, in bracket order. */
  upNext: SrQueueRow[];
  /** At least one team still depends on another result. */
  waiting: SrQueueRow[];
  /** Reported, most recent round first. */
  done: SrQueueRow[];
}

function playable(m: SrMatch): boolean {
  return Boolean(m.team_a_id && m.team_b_id) && m.status !== "completed" && m.status !== "bye";
}

export function srQueue(s: SrAdminState): SrQueue {
  const active = s.matches.find((m) => m.id === s.tournament.active_match_id) ?? null;
  const nowMatch = active && playable(active) ? active : null;
  const busy = new Set([nowMatch?.team_a_id, nowMatch?.team_b_id].filter(Boolean) as string[]);
  const nowLabel = nowMatch ? srMatchLabel(s, nowMatch) : "";

  const row = (m: SrMatch): SrQueueRow => {
    const playing = [m.team_a_id, m.team_b_id].filter((id) => id && busy.has(id)) as string[];
    return {
      match: m,
      label: srMatchLabel(s, m),
      nameA: slotSource(s, m, "a"),
      nameB: slotSource(s, m, "b"),
      seedA: teamSeed(s, m.team_a_id),
      seedB: teamSeed(s, m.team_b_id),
      readiness:
        playing.length === 0
          ? "Both teams ready"
          : `${playing.map((id) => srTeamName(s, id)).join(" and ")} ${playing.length === 1 ? "is" : "are"} playing ${nowLabel}`,
      ready: playing.length === 0,
    };
  };

  const real = realMatches(s).sort(bracketOrder(s));
  return {
    nowPlaying: nowMatch ? row(nowMatch) : null,
    upNext: real.filter((m) => playable(m) && m.id !== nowMatch?.id).map(row),
    waiting: real.filter((m) => m.status !== "completed" && !playable(m)).map(row),
    done: real
      .filter((m) => m.status === "completed")
      .reverse()
      .map(row),
  };
}

/** The next match to start in bracket order: the first ready one, else the first in the queue. */
export function srNextMatch(s: SrAdminState): SrQueueRow | null {
  const q = srQueue(s);
  return q.upNext.find((r) => r.ready) ?? q.upNext[0] ?? null;
}

export type SrScorePadFormat = "bo1" | "bo3" | "bo5";

/** The match's own series length (the grand-final override is already on the row). */
export function srScorePadFormat(m: SrMatch): SrScorePadFormat {
  return m.best_of === 5 ? "bo5" : m.best_of === 3 ? "bo3" : "bo1";
}

// ---------------------------------------------------------------------------
// UBR1 reveal
// ---------------------------------------------------------------------------

export interface SrRevealView {
  total: number;
  shown: number;
  started: boolean;
  /** The sequence is still playing on the live screen. */
  running: boolean;
}

/** Progress of the timed Round 1 reveal, computed exactly as /srlive does. */
export function srUbr1Reveal(s: SrAdminState, nowMs: number): SrRevealView {
  const total = s.matches.filter((m) => m.bracket === "upper" && m.round_number === 1).length;
  const startedAt = s.tournament.ubr1_reveal_started_at;
  if (!startedAt) return { total, shown: 0, started: false, running: false };
  const elapsed = Math.max(0, nowMs - Date.parse(startedAt));
  return {
    total,
    shown: ubr1VisibleCount(total, elapsed),
    started: true,
    running: total > 0 && elapsed < ubr1RevealDurationMs(total),
  };
}

// ---------------------------------------------------------------------------
// Primary action
// ---------------------------------------------------------------------------

export type SrPrimarySpec =
  | { kind: "open_signups"; label: string; enabled: boolean; reason?: string; hint?: string }
  | { kind: "roll_seeds"; label: string; enabled: boolean; reason?: string; hint?: string }
  | { kind: "generate_bracket"; label: string; enabled: boolean; reason?: string; hint?: string }
  | { kind: "start_reveal"; label: string; enabled: boolean; reason?: string; hint?: string }
  | { kind: "start_match"; matchId: string; label: string; enabled: boolean; reason?: string; hint?: string };

/**
 * The one next step. Rooms aren't tracked (decision, Task 12): the Bracket
 * and Live step is "Start ‹next match›" in bracket order, which features it
 * on the live screen. Null while a featured match has no result: its
 * ScorePad is the next step.
 */
export function srPrimarySpec(s: SrAdminState, nowMs = Date.now()): SrPrimarySpec | null {
  const t = s.tournament;
  const phase = srCurrentPhase(s);
  if (phase === "setup") {
    return {
      kind: "open_signups",
      label: "Open signups",
      enabled: true,
      hint: "Captains can apply with a five-player roster",
    };
  }
  if (phase === "signups") {
    const approved = srApproved(s).length;
    const pending = s.teams.filter((x) => x.status === "pending").length;
    const short = t.min_teams - approved;
    const reason =
      short > 0
        ? `Need ${short} more approved team${short === 1 ? "" : "s"} (min ${t.min_teams}).`
        : approved > t.max_teams
          ? `Too many approved teams (${approved}, max ${t.max_teams}).`
          : undefined;
    return {
      kind: "roll_seeds",
      label: "Roll seeds",
      enabled: reason === undefined,
      reason,
      hint:
        pending > 0
          ? `${pending} team${pending === 1 ? "" : "s"} still waiting for review`
          : "Closes signups and locks the roster",
    };
  }
  if (phase === "seeding") {
    return {
      kind: "generate_bracket",
      label: "Generate bracket",
      enabled: t.seed_locked,
      reason: t.seed_locked ? undefined : "Roll seeds first.",
      hint: "Publishes the bracket",
    };
  }
  if (phase === "bracket" || phase === "live") {
    const reveal = srUbr1Reveal(s, nowMs);
    if (phase === "bracket" && reveal.total > 0 && !reveal.started) {
      return {
        kind: "start_reveal",
        label: "Start UBR1 reveal",
        enabled: true,
        hint: `${reveal.total} matchups, on the live screen now`,
      };
    }
    if (srQueue(s).nowPlaying) return null;
    const next = srNextMatch(s);
    if (!next) return null;
    return {
      kind: "start_match",
      matchId: next.match.id,
      label: `Start ${next.label}`,
      enabled: true,
      hint: `${next.nameA} vs ${next.nameB} · ${next.readiness.toLowerCase()}`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------

export function srTitle(s: SrAdminState): string {
  return `${s.tournament.name} · ${s.tournament.format === "double_elim" ? "Double elim" : "Single elim"}`;
}

export function srStatusChip(s: SrAdminState): string {
  const c = srMatchCounts(s);
  switch (srCurrentPhase(s)) {
    case "setup":
      return "SETUP · DRAFT";
    case "signups": {
      const approved = srApproved(s).length;
      const pending = s.teams.filter((x) => x.status === "pending").length + s.applications.length;
      return `SIGNUPS · ${approved} APPROVED${pending ? ` · ${pending} PENDING` : ""}`;
    }
    case "seeding":
      return `SEEDING · ${srApproved(s).length} TEAMS`;
    case "bracket":
      return `BRACKET · ${c.done} / ${c.total} MATCHES`;
    case "live":
      return `LIVE · ${c.done} / ${c.total} MATCHES`;
    case "complete":
      return s.tournament.status === "archived" ? "ARCHIVED" : "COMPLETE";
  }
}

/** "Match · UB Semi 1", "Bracket", "Starting soon". */
export function srOnAirLabel(s: SrAdminState): string {
  const scene = s.tournament.scene;
  if (scene === "match") {
    const m = s.matches.find((x) => x.id === s.tournament.active_match_id);
    if (m) return `Match · ${srMatchLabel(s, m)}`;
  }
  return SR_SCENE_LABEL[scene];
}

// ---------------------------------------------------------------------------
// Scenes and locks
// ---------------------------------------------------------------------------

export function srSceneUnavailableReason(id: SrMatchScene, s: SrAdminState): string | null {
  switch (id) {
    case "idle":
    case "starting_soon":
      return null;
    case "teams":
      return srApproved(s).length > 0 ? null : "No approved teams yet";
    case "bracket":
      return s.matches.length > 0 ? null : "Generate the bracket first";
    case "match":
      return s.tournament.active_match_id ? null : "Start a match first";
    case "champion":
      return s.tournament.champion_team_id ? null : "No champion yet";
  }
}

export function srParseScene(value: string | null | undefined): SrMatchScene | null {
  return SR_SCENE_ORDER.find((x) => x === value) ?? null;
}

/** Approve/reject/remove only while in draft and before seeds are rolled (setTeamStatus, removeTeam). */
export function srRosterLock(s: SrAdminState): string | null {
  if (s.tournament.status !== "draft") return "The roster is set once seeds are rolled. Unlock seeds to change it.";
  return null;
}

/** Series length, grand-final length, third place, reset: fixed once the bracket exists. */
export function srBracketSettingsLock(s: SrAdminState): string | null {
  return s.matches.length > 0 ? "Bracket settings can't change after the bracket is generated." : null;
}

export function srDatesLock(s: SrAdminState): string | null {
  return s.tournament.status !== "draft" ? "Dates can only change while in draft." : null;
}

// ---------------------------------------------------------------------------
// Signups queue
// ---------------------------------------------------------------------------

export interface SrApplicationRow {
  view: SrTeamApplicationView;
  confirmed: number;
  selected: number;
}

export interface SrSignupQueue {
  /** Fully confirmed rosters waiting for an admin: approve or reject. First. */
  pending: SrTeam[];
  /** Applications still collecting their five confirmations: withdraw only. */
  inProgress: SrApplicationRow[];
  approved: SrTeam[];
  rejected: SrTeam[];
}

export function srSignupQueue(s: SrAdminState): SrSignupQueue {
  const byCreated = (a: SrTeam, b: SrTeam) => a.created_at.localeCompare(b.created_at);
  return {
    pending: s.teams.filter((t) => t.status === "pending").sort(byCreated),
    inProgress: s.applications.map((view) => ({
      view,
      confirmed: view.slots.filter((x) => x.status === "confirmed").length,
      selected: view.slots.length,
    })),
    approved: s.teams
      .filter((t) => t.status === "approved")
      .sort((a, b) => (a.seed ?? 99) - (b.seed ?? 99) || byCreated(a, b)),
    rejected: s.teams.filter((t) => t.status === "rejected").sort(byCreated),
  };
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export interface SrActivityRow {
  id: string;
  at: string;
  actor: string;
  text: string;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

function matchText(s: SrAdminState, id: unknown): string {
  const m = s.matches.find((x) => x.id === id);
  return m ? srMatchLabel(s, m) : "a match";
}

function activityText(s: SrAdminState, e: SrAuditLogEntry): string {
  const d = e.detail ?? {};
  const team = str(d.name) ?? (str(d.teamId) ? srTeamName(s, str(d.teamId)) : "a team");
  switch (e.action) {
    case "tournament.create":
      return "Created the tournament";
    case "tournament.update":
      return "Changed the settings";
    case "tournament.complete":
      return "Completed the tournament";
    case "tournament.archive":
      return "Archived the tournament";
    case "team.add":
      return `Added ${team}`;
    case "team.remove":
      return `Removed ${team}`;
    case "team.update":
      return "logoUrl" in d ? `Changed the logo of ${srTeamName(s, str(d.teamId))}` : `Renamed a team to ${team}`;
    case "team.status":
      return `${d.status === "approved" ? "Approved" : d.status === "rejected" ? "Rejected" : "Reopened"} ${team}`;
    case "team.signup":
      return `${team} is fully confirmed and waiting for review`;
    case "team.disband":
      return `Disbanded ${team}`;
    case "team.application_create":
      return `Applied as ${team}`;
    case "team.application_withdraw":
      return `Withdrew the ${team} application`;
    case "roster.add":
      return `Added ${str(d.ign) ?? "a player"} to ${srTeamName(s, str(d.teamId))}`;
    case "roster.remove":
      return `Removed ${str(d.ign) ?? "a player"} from the roster`;
    case "roster.invite_send":
      return typeof d.count === "number" ? `Sent ${d.count} roster invite${d.count === 1 ? "" : "s"}` : "Sent roster invites";
    case "roster.invite_retry":
      return "Re-sent a roster invite";
    case "roster.slot_confirm":
      return "Confirmed their roster spot";
    case "roster.slot_decline":
      return "Declined their roster spot";
    case "signups.toggle":
      return d.open ? "Opened signups" : "Closed signups";
    case "seed.roll":
      return `Rolled seeds (${typeof d.teamCount === "number" ? d.teamCount : "?"} teams)`;
    case "bracket.generate":
      return "Generated the bracket";
    case "match.report": {
      const m = s.matches.find((x) => x.id === d.matchId);
      const a = Number(d.teamAScore);
      const b = Number(d.teamBScore);
      const winner = srTeamName(s, str(d.winnerId));
      return m ? `${srMatchLabel(s, m)}: ${winner} won ${Math.max(a, b)}–${Math.min(a, b)}` : `${winner} won a match`;
    }
    case "match.undo":
      return `Undid the result of ${matchText(s, d.matchId)}`;
    case "scene.set":
      if (d.scene === "match") return `Started ${matchText(s, d.matchId)}`;
      if (d.scene === "starting_soon" && typeof d.seconds === "number") {
        return `Started a ${Math.round(d.seconds / 60)}-minute countdown`;
      }
      if (d.scene === "bracket" && "matchId" in d) return "Took the match off screen";
      return `Took ${SR_SCENE_LABEL[d.scene as SrMatchScene] ?? "a scene"}`;
    case "reveal.start":
      return `Started the UBR1 reveal (${typeof d.total === "number" ? d.total : "?"} matchups)`;
    case "reveal.reset":
      return "Reset the UBR1 reveal";
  }
}

/** Captains (of a team or an application in this tournament) read as "(captain)". */
function actorLabel(s: SrAdminState, e: SrAuditLogEntry): string {
  if (!e.actor_name) return "—";
  const id = e.actor_discord_id;
  const captain =
    e.actor_kind === "member" &&
    id !== null &&
    (s.teams.some((t) => t.captain_discord_id === id) ||
      s.applications.some((a) => a.application.captain_discord_id === id));
  return formatAuditActor(e.actor_name, e.actor_kind, captain ? "captain" : undefined);
}

export function srActivity(s: SrAdminState): SrActivityRow[] {
  return s.audit.map((e) => ({ id: String(e.id), at: e.created_at, actor: actorLabel(s, e), text: activityText(s, e) }));
}
