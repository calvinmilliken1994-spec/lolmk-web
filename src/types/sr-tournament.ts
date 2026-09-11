// Summoner's Rift tournament types. Admin-driven (like ARAM Mayhem), but
// persistent and multi-tournament: unlike mayhem's singleton "one live event
// at a time" model, sr_tournaments is a real table — many tournaments exist
// over time, each running its own bracket over a configurable window (a
// week, two weeks, a month — see start_at/end_at below).
//
// Distinct from src/types/tournament.ts (the captain-self-service, Discord
// OAuth, Supabase-backed spec in assets/TOURNAMENT.md). That system is not
// built yet. This one reuses ARAM Mayhem's admin-driven, single-shared-login
// pattern, scaled up to persistent multi-tournament + team logos.

export type SrTournamentStatus =
  | "draft" // admin is setting up teams, format, dates — not visible publicly
  | "seeding" // teams locked, random seed generated, publicly viewable pre-kickoff
  | "bracket_published" // bracket generated from the seed, publicly live
  | "in_progress" // matches being reported
  | "completed" // champion decided
  | "archived"; // hidden from the active list, still in Hall of Fame history

export type SrBracketFormat = "single_elim" | "double_elim";

export type SrMatchBracket = "upper" | "lower" | "grand_final" | "third_place";
export type SrMatchStatus = "pending" | "scheduled" | "in_progress" | "completed" | "bye";

export interface SrTournament {
  id: string;
  slug: string;
  name: string;
  status: SrTournamentStatus;
  format: SrBracketFormat;
  best_of: 1 | 3 | 5;
  third_place_match: boolean;
  grand_final_reset: boolean;
  min_teams: number; // enforced 8
  max_teams: number; // enforced 16
  start_at: string | null; // ISO — tournament kickoff
  end_at: string | null; // ISO — expected finish (drives "1 week / 1 month" UI presets)
  seed_locked: boolean; // true once the random seed has been rolled and published
  champion_team_id: string | null;
  // Whether captains may register a team right now. A flag rather than a
  // status value on purpose — see the ensureSchema() comment in sr-db.ts.
  // Orthogonal to `status`: a tournament is typically `draft` while signups
  // are open, and signups close before seeding.
  signups_open: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Approval state for a captain-submitted team. Admin-created teams default
 * to `approved` — the DEFAULT on the column — so the pre-existing task-1
 * flow is unaffected; only the captain signup path inserts `pending`.
 * Seeding and bracket generation count `approved` teams only.
 */
export type SrTeamStatus = "pending" | "approved" | "rejected";

export interface SrTeam {
  id: string;
  tournament_id: string;
  name: string;
  logo_url: string | null; // nullable until logo upload storage is wired up
  seed: number | null;
  /**
   * Discord user id of the captain who owns this team, or null for a team an
   * admin entered by hand. This is the ONLY thing that scopes captain
   * ownership: every captain mutation in src/app/captain/actions.ts matches
   * on it against the captain session's own discordId.
   */
  captain_discord_id: string | null;
  status: SrTeamStatus;
  created_at: string;
}

export type SrPlayerRole = "TOP" | "JUNGLE" | "MID" | "ADC" | "SUPPORT" | "FILL";

export const SR_PLAYER_ROLES: SrPlayerRole[] = [
  "TOP",
  "JUNGLE",
  "MID",
  "ADC",
  "SUPPORT",
  "FILL",
];

/**
 * Ranks a player may claim. Mirrors the tier list in src/types/tournament.ts
 * but kept as its own list because these are SELF-REPORTED strings stored as
 * free text in the DB, validated on write against this array — not a value
 * the system has verified. Wherever a rank is displayed, the UI must say so.
 */
export const SR_RANKS = [
  "UNRANKED",
  "IRON",
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "EMERALD",
  "DIAMOND",
  "MASTER",
  "GRANDMASTER",
  "CHALLENGER",
] as const;

export type SrRank = (typeof SR_RANKS)[number];

export interface SrTeamPlayer {
  id: string;
  team_id: string;
  tournament_id: string;
  /** Typed in by the captain. Not proof the person consented to be rostered. */
  discord_id: string;
  ign: string;
  role: SrPlayerRole;
  /** Self-reported. Never treat as verified — see SR_RANKS. */
  current_rank: SrRank | null;
  /** Self-reported. */
  peak_rank: SrRank | null;
  /**
   * Set when a Riot API lookup last corroborated `current_rank` for this
   * IGN. Corroborates the SUMMONER's rank only — it is not, and must never
   * be presented as, proof that this Discord account owns that summoner.
   */
  rank_verified_at: string | null;
  is_captain: boolean;
  is_substitute: boolean;
  created_at: string;
}

export interface SrMatch {
  id: string;
  tournament_id: string;
  bracket: SrMatchBracket;
  round_number: number;
  match_number: number;
  best_of: 1 | 3 | 5;
  team_a_id: string | null;
  team_b_id: string | null;
  team_a_score: number;
  team_b_score: number;
  winner_id: string | null;
  status: SrMatchStatus;
  advances_to_match_id: string | null;
  advances_to_slot: "a" | "b" | null;
  drops_to_match_id: string | null;
  drops_to_slot: "a" | "b" | null;
}

export type SrAuditAction =
  | "tournament.create"
  | "tournament.update"
  | "team.add"
  | "team.remove"
  | "team.update"
  | "team.status"
  | "team.signup"
  | "team.disband"
  | "roster.add"
  | "roster.remove"
  | "signups.toggle"
  | "seed.roll"
  | "bracket.generate"
  | "match.report"
  | "match.undo"
  | "tournament.complete"
  | "tournament.archive";

export interface SrAuditLogEntry {
  id: number;
  tournament_id: string;
  action: SrAuditAction;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export interface SrTournamentFull {
  tournament: SrTournament;
  teams: SrTeam[];
  matches: SrMatch[];
  /**
   * Every roster row across every team in the tournament, flat. Kept flat
   * rather than nested inside each team so the existing SrTeam shape (and
   * everything that consumes it) is unchanged; the UI groups by team_id.
   */
  players: SrTeamPlayer[];
}

export const SR_MIN_TEAMS = 8;
export const SR_MAX_TEAMS = 16;

// ---------------------------------------------------------------------------
// Public projections
// ---------------------------------------------------------------------------
//
// The shapes above mirror the DB rows exactly and are ADMIN types — they are
// what the /tools surface reads. The types below are what an unauthenticated
// visitor is allowed to see, and they exist so that "is this field public?"
// is a decision recorded in one place instead of being re-litigated in every
// page component.
//
// Deliberately dropped on the way out:
//   - `id` on the tournament (the public handle is the slug; the internal id
//     is what every admin action takes as its argument, so it is not free
//     information to hand out)
//   - `created_at` / `updated_at` (internal bookkeeping; `updated_at` also
//     leaks admin activity timing on a not-yet-finished tournament)
//   - `seed_locked` (an admin workflow flag, meaningless publicly)
//   - `tournament_id` on teams and matches (redundant once nested)
//   - `advances_to_*` / `drops_to_*` on matches (bracket wiring; the public
//     renderer groups by bracket+round and never follows these links)
//
// Team and match `id`s are kept because the public bracket needs to resolve
// team references and key its React lists.

export interface SrPublicTournament {
  slug: string;
  name: string;
  status: SrTournamentStatus;
  format: SrBracketFormat;
  best_of: 1 | 3 | 5;
  third_place_match: boolean;
  grand_final_reset: boolean;
  min_teams: number;
  max_teams: number;
  start_at: string | null;
  end_at: string | null;
  champion_team_id: string | null;
  /** Public because it is the answer to "can I still enter?". */
  signups_open: boolean;
}

/**
 * A rostered player as a visitor sees them.
 *
 * `discord_id` is deliberately ABSENT. It is on the row, it is what captain
 * ownership and the one-team-per-tournament index are built on, and it is
 * exactly the kind of identifier that should not be scraped off a public
 * page. Visitors get the in-game name and the self-reported ranks; that is
 * all a spectator needs.
 */
export interface SrPublicPlayer {
  id: string;
  ign: string;
  role: SrPlayerRole;
  current_rank: SrRank | null;
  peak_rank: SrRank | null;
  is_captain: boolean;
  is_substitute: boolean;
}

export interface SrPublicTeam {
  id: string;
  name: string;
  logo_url: string | null;
  seed: number | null;
  players: SrPublicPlayer[];
}

export interface SrPublicMatch {
  id: string;
  bracket: SrMatchBracket;
  round_number: number;
  match_number: number;
  best_of: 1 | 3 | 5;
  team_a_id: string | null;
  team_b_id: string | null;
  team_a_score: number;
  team_b_score: number;
  winner_id: string | null;
  status: SrMatchStatus;
}

export interface SrPublicTournamentFull {
  tournament: SrPublicTournament;
  teams: SrPublicTeam[];
  matches: SrPublicMatch[];
}

/**
 * Statuses a visitor may see at all. `draft` is an admin workspace (teams
 * half-entered, dates unconfirmed) and never appears publicly; `archived`
 * is hidden from listings but still reachable by direct link so old
 * tournaments linked from Hall of Fame don't 404.
 */
export const SR_PUBLIC_LISTED_STATUSES: SrTournamentStatus[] = [
  "seeding",
  "bracket_published",
  "in_progress",
  "completed",
];
