// Riftbound tournament types. Rules live in docs/RIFTBOUND.md; change that
// document first if a rule changes.
//
// Same split as sr-tournament.ts:
//   - RbX        ADMIN types. Mirror the DB rows exactly and are what the
//                /tools surface reads. May contain Discord ids, flags,
//                idempotency keys and who-reported-what.
//   - RbPublicX  PUBLIC types. What an unauthenticated visitor, the venue
//                screen and the public tournament page may see. Produced
//                only by the toPublic* mappers in src/lib/rb-db.ts, so
//                "is this field public?" is decided in exactly one place.
//
// Never import an RbX admin type into a public page component; take the
// RbPublicX shape from getPublicTournament() instead.

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export type RbTournamentStatus =
  | "draft" // admin workspace, never public
  | "registration" // players being added / checked in, publicly viewable
  | "in_progress" // rounds being played
  | "completed" // champion decided
  | "archived"; // hidden from the active list, still reachable by direct link

export const RB_TOURNAMENT_STATUSES: RbTournamentStatus[] = [
  "draft",
  "registration",
  "in_progress",
  "completed",
  "archived",
];

/** Statuses a visitor may see listed or fetch by slug. `draft` is never public. */
export const RB_PUBLIC_STATUSES: RbTournamentStatus[] = [
  "registration",
  "in_progress",
  "completed",
  "archived",
];

export type RbPlayerStatus = "registered" | "checked_in" | "active" | "dropped" | "dq";

export const RB_PLAYER_STATUSES: RbPlayerStatus[] = [
  "registered",
  "checked_in",
  "active",
  "dropped",
  "dq",
];

export type RbRoundStage = "swiss" | "top_cut";

/** draft → published → live → closed. "In time" is derived, never stored. */
export type RbRoundStatus = "draft" | "published" | "live" | "closed";

export const RB_ROUND_STATUSES: RbRoundStatus[] = ["draft", "published", "live", "closed"];

/**
 * `pending`   — no result yet.
 * `completed` — a judge reported a result (reported_by_* / reported_at set).
 * `bye`       — player_b is null; recorded as a configurable win (2–0).
 */
export type RbMatchStatus = "pending" | "completed" | "bye";

/**
 * Program scene shown on the venue screen (/rblive/[slug]). This is what is
 * STORED. `time-called` is deliberately not in this list: it is rendered by
 * the venue screen itself when the program scene is `pairings_clock` or
 * `clock` and the round end has passed (see RbRenderedScene).
 */
export type RbScene =
  | "idle"
  | "pairings"
  | "pairings_clock"
  | "clock"
  | "standings"
  | "top_cut"
  | "champion";

export const RB_SCENES: RbScene[] = [
  "idle",
  "pairings",
  "pairings_clock",
  "clock",
  "standings",
  "top_cut",
  "champion",
];

/** What the venue screen actually draws: the stored scene, or the derived time call. */
export type RbRenderedScene = RbScene | "time-called";

/** Rules enforcement level. Must be `casual` whenever staff are playing. */
export type RbEnforcementLevel = "casual" | "competitive" | "professional";

// ---------------------------------------------------------------------------
// Tournament config (rb_tournaments.config jsonb)
// ---------------------------------------------------------------------------

export interface RbScoringConfig {
  winPoints: number;
  drawPoints: number;
  lossPoints: number;
  /** Floor applied to MW% and GW% when computing opponent averages. */
  winPercentFloor: number;
  /** A bye is recorded as this game score. */
  byeGamesWon: number;
  byeGamesLost: number;
}

export interface RbTournamentConfig {
  /** Match length: best of 3 by default, best of 1 available. */
  bestOf: 1 | 3;
  /** Swiss round length in minutes. Top cut has no time limit. */
  roundMinutes: number;
  /** "auto" until Round 1 is paired, then fixed; editable until the final round is paired. */
  swissRounds: "auto" | number;
  /** "auto": none for 4–6 players, top 4 for 7–16, top 8 for 17+. */
  topCut: "auto" | 0 | 4 | 8;
  /** Pair the final Swiss round by rank (1v2, 3v4, ...). */
  powerPairFinalRound: boolean;
  enforcementLevel: RbEnforcementLevel;
  scoring: RbScoringConfig;
  /**
   * Random-tiebreak seed so standings can be reproduced. Null until the
   * event starts; generated once and never changed afterwards.
   */
  tiebreakSeed: string | null;
  /**
   * Player ids of the top cut in seed order (index 0 = seed 1). Null until
   * the cut is made; fixed afterwards. The bracket is rebuilt from these
   * seeds plus the reported top-cut results (see rb-service.ts).
   */
  topCutSeedIds: string[] | null;
  /** Event day, "YYYY-MM-DD" (KST calendar date). Required before check-in opens. */
  date: string | null;
  /** Where the event is held. Required before check-in opens. */
  venue: string | null;
  /** Floor judges and their optional table ranges. Admin only. */
  judges: RbJudge[];
  /** ISO time the operator marked the venue screen tested; null until then. Set only by markVenueTested. */
  venueTestedAt: string | null;
}

/**
 * A judge on the floor. Judges are normal tools admins (no separate role);
 * this is only a roster for the desk, so the name is free text. A range of
 * `from`/`to` both null means "all tables"; `to` null with a `from` means
 * "from that table up" (the "12+" in the setup checklist).
 */
export interface RbJudge {
  id: string;
  name: string;
  from: number | null;
  to: number | null;
}

export const DEFAULT_RB_CONFIG: RbTournamentConfig = {
  bestOf: 3,
  roundMinutes: 60,
  swissRounds: "auto",
  topCut: "auto",
  powerPairFinalRound: true,
  enforcementLevel: "casual",
  scoring: {
    winPoints: 3,
    drawPoints: 1,
    lossPoints: 0,
    winPercentFloor: 0.33,
    byeGamesWon: 2,
    byeGamesLost: 0,
  },
  tiebreakSeed: null,
  topCutSeedIds: null,
  date: null,
  venue: null,
  judges: [],
  venueTestedAt: null,
};

/** The config fields a visitor may see. No tiebreak seed. */
export type RbPublicConfig = Omit<RbTournamentConfig, "tiebreakSeed" | "judges" | "venueTestedAt">;

// ---------------------------------------------------------------------------
// Admin types
// ---------------------------------------------------------------------------

export interface RbTournament {
  id: string;
  slug: string;
  name: string;
  status: RbTournamentStatus;
  config: RbTournamentConfig;
  scene: RbScene;
  /** Whether phase changes move `scene` automatically. See docs/RIFTBOUND.md "Auto-follow". */
  auto_follow: boolean;
  /** Set by a manual scene change; cleared by the next phase change. */
  auto_follow_paused: boolean;
  champion_player_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RbPlayer {
  id: string;
  tournament_id: string;
  display_name: string;
  /** Null = guest. Same guest/verified model as Mayhem. Never public. */
  member_discord_id: string | null;
  /** Legend name only, optional. No decklists in v1. */
  legend: string | null;
  status: RbPlayerStatus;
  dropped_after_round: number | null;
  created_at: string;
}

export interface RbRound {
  id: string;
  tournament_id: string;
  /** Event-wide: top-cut rounds continue the Swiss numbering. */
  number: number;
  stage: RbRoundStage;
  status: RbRoundStatus;
  /**
   * Clock fields. Server timestamps only; clients derive the remaining time
   * (see clockRemainingMs in rb-db.ts).
   */
  started_at: string | null;
  paused_at: string | null;
  paused_total_ms: number;
  /** Null = no time limit (top cut). */
  duration_ms: number | null;
  pairing_seed: string | null;
  created_at: string;
}

/** Kinds a judge can raise to the desk from the floor ("Flag to desk"). */
export type RbDeskFlagKind = "no_show" | "judge_call" | "deck_check" | "head_judge" | "dispute" | "other";

export const RB_DESK_FLAG_KINDS: RbDeskFlagKind[] = [
  "no_show",
  "judge_call",
  "deck_check",
  "head_judge",
  "dispute",
  "other",
];

/** A table flagged to the desk. Open until a desk admin acknowledges it. */
export interface RbDeskFlag {
  kind: RbDeskFlagKind;
  id: string;
  note: string;
  raised_by_name: string;
  raised_at: string;
  acknowledged_by_name: string | null;
  acknowledged_at: string | null;
}

/** A free-text or structured note on a match. Admin only. */
export type RbMatchFlag =
  | { kind: "drop"; playerId: string }
  | { kind: "dq"; playerId: string }
  | { kind: "override"; note?: string }
  | { kind: "note"; text: string }
  | RbDeskFlag;

export interface RbMatch {
  id: string;
  tournament_id: string;
  round_id: string;
  table_number: number;
  player_a_id: string;
  /** Null = bye. */
  player_b_id: string | null;
  games_a: number;
  games_b: number;
  games_drawn: number;
  decided_on_time: boolean;
  /** Per-table extension added to the round's duration. */
  extension_ms: number;
  /**
   * Top cut only: when the desk marked the table as in progress (the venue's
   * LIVE tag). Null until then; kept after the result, cleared by nothing.
   */
  started_at: string | null;
  status: RbMatchStatus;
  reported_by_id: string | null;
  reported_by_name: string | null;
  reported_at: string | null;
  idempotency_key: string | null;
  flags: RbMatchFlag[];
}

export type RbAuditAction =
  | "tournament.create"
  | "tournament.update"
  | "venue.tested"
  | "tournament.status"
  | "tournament.archive"
  | "tournament.complete"
  | "player.add"
  | "player.update"
  | "player.remove"
  | "player.check_in"
  | "player.drop"
  | "player.undrop"
  | "player.dq"
  | "round.pair"
  | "round.override"
  | "round.publish"
  | "round.unpublish"
  | "round.close"
  | "clock.start"
  | "clock.pause"
  | "clock.resume"
  | "clock.adjust"
  | "match.report"
  | "match.undo"
  | "match.start"
  | "match.unstart"
  | "match.correct"
  | "match.extension"
  | "match.flag"
  | "match.flag_ack"
  | "cut.make"
  | "scene.set"
  | "auto_follow.toggle"
  | "export.download";

/** Who performed a mutation. Required on every audit write. */
export interface RbActor {
  discordId: string;
  name: string;
}

export interface RbAuditLogEntry {
  id: number;
  tournament_id: string;
  action: RbAuditAction;
  detail: Record<string, unknown> | null;
  actor_discord_id: string;
  actor_name: string;
  created_at: string;
}

export interface RbTournamentFull {
  tournament: RbTournament;
  players: RbPlayer[];
  rounds: RbRound[];
  matches: RbMatch[];
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------
//
// Deliberately dropped on the way out:
//   - ids of the tournament (the public handle is the slug) and
//     `tournament_id` on everything nested under it
//   - Discord ids (member_discord_id, reported_by_id, audit actors)
//   - flags, idempotency_key, reported_by_name/at, audit data
//   - legend (deck information, kept private until a use is decided)
//   - `dq` status, collapsed to `dropped`: a disciplinary outcome is not public
//   - pairing_seed, tiebreakSeed, auto_follow*, created_at/updated_at
//   - everything belonging to a `draft` round, including its pairings
//
// Player, round and match ids stay: the public page needs them to resolve
// references and "find my table".

export type RbPublicPlayerStatus = "registered" | "checked_in" | "active" | "dropped";

export interface RbPublicTournament {
  slug: string;
  name: string;
  status: RbTournamentStatus;
  config: RbPublicConfig;
  /** Public: the venue screen is unauthenticated and this is what it draws. */
  scene: RbScene;
  champion_player_id: string | null;
}

export interface RbPublicPlayer {
  id: string;
  display_name: string;
  status: RbPublicPlayerStatus;
  dropped_after_round: number | null;
}

export interface RbPublicRound {
  id: string;
  number: number;
  stage: RbRoundStage;
  status: Exclude<RbRoundStatus, "draft">;
  started_at: string | null;
  paused_at: string | null;
  paused_total_ms: number;
  duration_ms: number | null;
}

export interface RbPublicMatch {
  id: string;
  round_id: string;
  table_number: number;
  player_a_id: string;
  player_b_id: string | null;
  games_a: number;
  games_b: number;
  games_drawn: number;
  decided_on_time: boolean;
  /** Public because clients need it to compute the table's remaining time. */
  extension_ms: number;
  /** Top cut: set while the table is in progress (LIVE tag); null otherwise. */
  started_at: string | null;
  status: RbMatchStatus;
}

export interface RbPublicTournamentFull {
  tournament: RbPublicTournament;
  players: RbPublicPlayer[];
  rounds: RbPublicRound[];
  matches: RbPublicMatch[];
}

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

/** The round fields clockRemainingMs needs. Satisfied by RbRound and RbPublicRound. */
export interface RbClockFields {
  started_at: string | null;
  paused_at: string | null;
  paused_total_ms: number;
  duration_ms: number | null;
}

/** The match field clockRemainingMs needs. Satisfied by RbMatch and RbPublicMatch. */
export interface RbMatchClockFields {
  extension_ms: number;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type RbExportFormat = "csv" | "json";

/** One row per match, resolved to names. Admin export. */
export interface RbMatchExportRow {
  round: number;
  stage: RbRoundStage;
  table: number;
  player_a: string;
  /** Empty string for a bye. */
  player_b: string;
  games_a: number;
  games_b: number;
  games_drawn: number;
  decided_on_time: boolean;
  extension_minutes: number;
  status: RbMatchStatus;
  reported_by_id: string;
  reported_by_name: string;
  reported_at: string;
  flags: string;
}

/**
 * One row per player per match (two per match, one per bye). The database
 * stores game COUNTS per match, not individual games, so this is the
 * per-player view of those counts: what a player won, lost and drew.
 */
export interface RbGameExportRow {
  round: number;
  stage: RbRoundStage;
  table: number;
  player: string;
  opponent: string;
  games_won: number;
  games_lost: number;
  games_drawn: number;
  match_result: "win" | "loss" | "draw" | "bye" | "pending";
}
