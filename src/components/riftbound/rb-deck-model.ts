// Pure desk logic for the Riftbound control deck: which phase the event is
// in, the phase rail, the single primary action with its label and blocked
// reason (docs/design/control-deck-v2/behaviour.md "Primary action"), and what
// auto-follow will do next. No React, no server actions: the definition in
// rb-deck-definition.ts binds these to the actions.
//
// Relative imports (not "@/") so scripts/test-rb-setup.ts can load it.

import { isTimeCalled } from "../../lib/rb-clock";
import { resolveRoundCount, resolveTopCutSize, type SwissStanding } from "../../lib/swiss-engine";
import type {
  RbAuditLogEntry,
  RbMatch,
  RbPlayer,
  RbRound,
  RbScene,
  RbTournamentFull,
} from "../../types/riftbound";
import { rbBasicsMissing } from "./rb-setup-model";

/** What /api/rb/admin-state returns and the desk polls. */
export interface RbDeskState extends RbTournamentFull {
  standings: SwissStanding[];
  audit: RbAuditLogEntry[];
  /** The server's clock (ms since epoch) when this state was read. The judges' floor corrects its clock with it. */
  serverNow?: number;
}

export type RbPhaseId = "setup" | "checkin" | "swiss" | "top_cut" | "complete";

export const RB_PHASE_ORDER: { id: RbPhaseId; label: string }[] = [
  { id: "setup", label: "Setup" },
  { id: "checkin", label: "Check-in" },
  { id: "swiss", label: "Swiss rounds" },
  { id: "top_cut", label: "Top cut" },
  { id: "complete", label: "Complete" },
];

export const RB_SCENE_LABEL: Record<RbScene, string> = {
  idle: "Idle / brand",
  pairings: "Pairings",
  pairings_clock: "Pairings + clock",
  clock: "Clock",
  standings: "Standings",
  top_cut: "Top-cut bracket",
  champion: "Champion",
};

const byNumber = (a: RbRound, b: RbRound) => a.number - b.number;
const isParticipant = (p: RbPlayer) => p.status === "active" || p.status === "dropped" || p.status === "dq";

/** The phase the event is in right now. */
export function rbCurrentPhase(state: Pick<RbDeskState, "tournament">): RbPhaseId {
  const t = state.tournament;
  if (t.status === "draft") return "setup";
  if (t.status === "registration") return "checkin";
  if (t.status === "completed" || t.status === "archived") return "complete";
  return t.config.topCutSeedIds ? "top_cut" : "swiss";
}

/** Total Swiss rounds: the fixed number once Round 1 is paired, else the Auto preset. */
export function rbSwissTotal(state: Pick<RbDeskState, "tournament" | "players">): number {
  const { config } = state.tournament;
  if (typeof config.swissRounds === "number") return config.swissRounds;
  const n = state.players.filter((p) => p.status !== "dropped" && p.status !== "dq").length;
  return resolveRoundCount(Math.max(2, n), { swissRounds: "auto" });
}

/** Size of the cut this event would make (0 = none), from the players who took part. */
export function rbCutSize(state: Pick<RbDeskState, "tournament" | "players">): 0 | 4 | 8 {
  const { config } = state.tournament;
  const field =
    state.tournament.status === "draft" || state.tournament.status === "registration"
      ? state.players.filter((p) => p.status !== "dropped" && p.status !== "dq")
      : state.players.filter(isParticipant);
  return resolveTopCutSize(field.length, { topCut: config.topCut });
}

function latestRound(state: Pick<RbDeskState, "rounds">, stage?: RbRound["stage"]): RbRound | null {
  const rounds = stage ? state.rounds.filter((r) => r.stage === stage) : state.rounds;
  return [...rounds].sort(byNumber).at(-1) ?? null;
}

const matchesOf = (state: Pick<RbDeskState, "matches">, round: RbRound): RbMatch[] =>
  state.matches.filter((m) => m.round_id === round.id);

export const outstandingTables = (state: Pick<RbDeskState, "matches">, round: RbRound): number =>
  matchesOf(state, round).filter((m) => m.status === "pending").length;

/** Whether a scene can be loaded into preview / taken right now. */
export function rbSceneAvailable(scene: RbScene, state: Pick<RbDeskState, "tournament" | "rounds">): boolean {
  if (scene === "top_cut") return Boolean(state.tournament.config.topCutSeedIds);
  if (scene === "champion") return state.tournament.status === "completed" || state.tournament.status === "archived";
  if (scene === "standings" || scene === "pairings" || scene === "pairings_clock" || scene === "clock") {
    return state.rounds.length > 0;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

export interface RbPhaseRow {
  id: RbPhaseId;
  label: string;
  status: "done" | "live" | "next" | "off";
  meta?: string;
}

export function rbPhases(state: RbDeskState): RbPhaseRow[] {
  const current = rbCurrentPhase(state);
  const index = (id: RbPhaseId) => RB_PHASE_ORDER.findIndex((p) => p.id === id);
  const cutOff = !state.tournament.config.topCutSeedIds && rbCutSize(state) === 0;
  const swiss = state.rounds.filter((r) => r.stage === "swiss");
  const checkedIn = state.players.filter((p) => p.status === "checked_in" || p.status === "active").length;

  return RB_PHASE_ORDER.map(({ id, label }) => {
    let status: RbPhaseRow["status"] = index(id) < index(current) ? "done" : id === current ? "live" : "next";
    if (id === "top_cut" && cutOff && current !== "top_cut") status = "off";
    let meta: string | undefined;
    if (id === "checkin" && state.tournament.status === "registration") meta = `${checkedIn}`;
    if (id === "swiss" && swiss.length > 0) meta = `R${swiss.length}/${rbSwissTotal(state)}`;
    if (id === "top_cut" && status === "off") meta = "none";
    return { id, label, status, meta };
  });
}

/** Mono chip next to the event name: SETUP, CHECK-IN, ROUND 3 / 5 · LIVE (· TIME once the clock is out), TOP CUT · ROUND 6 · LIVE, COMPLETE. */
export function rbStatusChip(state: RbDeskState, now: number | null = null): string {
  const phase = rbCurrentPhase(state);
  if (phase === "setup") return "SETUP";
  if (phase === "checkin") return "CHECK-IN";
  if (phase === "complete") return state.tournament.status === "archived" ? "ARCHIVED" : "COMPLETE";
  const round = latestRound(state);
  if (!round) return "SWISS";
  // "In time" is derived, never stored: a live round whose clock has run out reads TIME.
  const timeCalled = round.status === "live" && now !== null && isTimeCalled(round, null, now);
  const status = timeCalled ? "TIME" : round.status.toUpperCase();
  return round.stage === "top_cut"
    ? `TOP CUT · ROUND ${round.number} · ${status}`
    : `ROUND ${round.number} / ${rbSwissTotal(state)} · ${status}`;
}

// ---------------------------------------------------------------------------
// Primary action
// ---------------------------------------------------------------------------

export type RbPrimaryKind =
  | "open_checkin"
  | "close_checkin"
  | "publish_round"
  | "start_clock"
  | "close_round"
  | "pair_next"
  | "cut"
  | "complete";

export interface RbPrimarySpec {
  kind: RbPrimaryKind;
  label: string;
  enabled: boolean;
  /** Why it's blocked (shown under a disabled button). */
  reason?: string;
  /** Neutral note under an enabled button. */
  hint?: string;
  /** Round the action applies to, for the round actions. */
  roundId?: string;
  /** One-way actions ask first (behaviour.md: cut and complete). */
  confirm?: string;
}

/**
 * The single next step, exactly as in behaviour.md. `null` while top-cut
 * tables are being played (the desk works the bracket) and when the event is
 * over.
 */
export function rbPrimarySpec(state: RbDeskState): RbPrimarySpec | null {
  const t = state.tournament;

  if (t.status === "draft") {
    const missing = rbBasicsMissing(state);
    return {
      kind: "open_checkin",
      label: "Open check-in",
      enabled: missing.length === 0,
      reason: missing.length ? `Needs: ${missing.join(", ")}` : undefined,
      hint: missing.length ? undefined : "Players can still register after",
    };
  }

  if (t.status === "registration") {
    const checkedIn = state.players.filter((p) => p.status === "checked_in").length;
    return {
      kind: "close_checkin",
      label: "Close check-in & pair Round 1",
      enabled: checkedIn >= 2,
      reason: checkedIn >= 2 ? undefined : "Need at least 2 players",
    };
  }

  if (t.status !== "in_progress") return null;

  const round = latestRound(state);
  if (!round) return null;
  const n = round.number;

  if (round.stage === "top_cut") return rbTopCutPrimary(state, round);

  if (round.status === "draft") {
    return { kind: "publish_round", label: `Publish Round ${n}`, enabled: true, roundId: round.id };
  }
  if (round.status === "published") {
    return { kind: "start_clock", label: `Start Round ${n} clock`, enabled: true, roundId: round.id };
  }
  if (round.status === "live") {
    const open = outstandingTables(state, round);
    return {
      kind: "close_round",
      label: `Close Round ${n}`,
      enabled: open === 0,
      reason: open === 0 ? undefined : `${open} ${open === 1 ? "table" : "tables"} outstanding`,
      roundId: round.id,
    };
  }

  // Closed.
  const swissCount = state.rounds.filter((r) => r.stage === "swiss").length;
  if (swissCount < rbSwissTotal(state)) {
    return { kind: "pair_next", label: `Pair Round ${n + 1}`, enabled: true };
  }
  const size = rbCutSize(state);
  if (size > 0) {
    return {
      kind: "cut",
      label: `Cut to Top ${size}`,
      enabled: true,
      confirm: `Cut to the top ${size}? The cut can't be undone.`,
    };
  }
  return {
    kind: "complete",
    label: "Complete event",
    enabled: true,
    confirm: "Complete the event and crown the Swiss leader? This can't be undone.",
  };
}

function rbTopCutPrimary(state: RbDeskState, round: RbRound): RbPrimarySpec | null {
  const n = round.number;
  const isFinal = matchesOf(state, round).length === 1;
  const open = outstandingTables(state, round);

  if (round.status === "draft") {
    return { kind: "publish_round", label: `Publish Round ${n}`, enabled: true, roundId: round.id };
  }
  // Top-cut tables pending: no primary step, the desk works the bracket.
  if (round.status !== "closed" && open > 0) return null;

  if (isFinal) {
    return {
      kind: "complete",
      label: "Complete event",
      enabled: true,
      confirm: "Complete the event and crown the champion? This can't be undone.",
    };
  }
  if (round.status === "closed") {
    return { kind: "pair_next", label: `Pair Round ${n + 1}`, enabled: true };
  }
  return { kind: "close_round", label: `Close Round ${n}`, enabled: true, roundId: round.id };
}

// ---------------------------------------------------------------------------
// Auto-follow
// ---------------------------------------------------------------------------

/**
 * The scene the program moves to for the change from `prev` to `next`
 * (behaviour.md "Auto-follow"), or null. Describes what the server will do;
 * the server applies it inside the action.
 */
export function rbAutoFollow(prev: RbDeskState, next: RbDeskState): RbScene | null {
  if (next.tournament.status === "completed" && prev.tournament.status !== "completed") return "champion";
  if (next.tournament.config.topCutSeedIds && !prev.tournament.config.topCutSeedIds) return "top_cut";
  for (const r of next.rounds) {
    const before = prev.rounds.find((x) => x.id === r.id);
    if (r.status === "closed" && before && before.status !== "closed") return "standings";
    if (r.started_at && before && !before.started_at) return "pairings_clock";
    if (r.status === "published" && before && before.status !== "published") return "pairings";
  }
  return null;
}
