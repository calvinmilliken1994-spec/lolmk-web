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
  created_at: string;
  updated_at: string;
}

export interface SrTeam {
  id: string;
  tournament_id: string;
  name: string;
  logo_url: string | null; // nullable until logo upload storage is wired up
  seed: number | null;
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
}

export const SR_MIN_TEAMS = 8;
export const SR_MAX_TEAMS = 16;
