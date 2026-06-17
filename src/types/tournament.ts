// Mirror of the bot's tournament types. When the bot HTTP integration ships,
// the bot side will be the source of truth and this file becomes the contract
// the website holds it to. For Phase 1 preview these types are read from
// src/data/tournament-preview.json via src/lib/tournaments.ts.

export type TournamentStatus =
  | "draft"
  | "signups_open"
  | "signups_closed"
  | "bracket_released"
  | "in_progress"
  | "completed";

export type TournamentFormat = "double_elim" | "single_elim";

export type BracketSide =
  | "upper"
  | "lower"
  | "grand_final"
  | "grand_final_reset";

export type MatchStatus =
  | "scheduled"
  | "in_progress"
  | "completed"
  | "forfeit"
  | "bye";

export type TeamStatus = "pending" | "approved" | "rejected" | "withdrawn";

export interface Tournament {
  id: string;
  slug: string;
  name: string;
  season: string;
  format: TournamentFormat;
  status: TournamentStatus;
  max_teams: number;
  signup_deadline: string | null;
  start_date: string | null;
  end_date: string | null;
  description: string | null;
  prize_description: string | null;
  champion_team_id: string | null;
}

export type PlayerRole = "TOP" | "JUNGLE" | "MID" | "ADC" | "SUPPORT" | "FILL";

export type Rank =
  | "IRON_IV" | "IRON_III" | "IRON_II" | "IRON_I"
  | "BRONZE_IV" | "BRONZE_III" | "BRONZE_II" | "BRONZE_I"
  | "SILVER_IV" | "SILVER_III" | "SILVER_II" | "SILVER_I"
  | "GOLD_IV" | "GOLD_III" | "GOLD_II" | "GOLD_I"
  | "PLATINUM_IV" | "PLATINUM_III" | "PLATINUM_II" | "PLATINUM_I"
  | "EMERALD_IV" | "EMERALD_III" | "EMERALD_II" | "EMERALD_I"
  | "DIAMOND_IV" | "DIAMOND_III" | "DIAMOND_II" | "DIAMOND_I"
  | "MASTER" | "GRANDMASTER" | "CHALLENGER";

export interface Player {
  id: string;
  team_id: string;
  discord_id: string;
  discord_username: string;
  ign: string;
  role: PlayerRole;
  peak_rank: Rank | null;
  current_rank: Rank | null;
  is_captain: number;
  is_substitute: number;
}

export interface Team {
  id: string;
  tournament_id: string;
  name: string;
  tag: string;
  slug: string;
  logo_url: string | null;
  color: string | null;
  captain_discord_id: string;
  status: TeamStatus;
  seed: number | null;
  players?: Player[];
}

export interface Match {
  id: string;
  tournament_id: string;
  bracket: BracketSide;
  round_number: number;
  match_number: number;
  team_a_id: string | null;
  team_b_id: string | null;
  team_a_score: number | null;
  team_b_score: number | null;
  winner_id: string | null;
  status: MatchStatus;
  advances_to_match_id: string | null;
  drops_to_match_id: string | null;
}

export interface TournamentFull {
  tournament: Tournament;
  teams: Team[];
  matches: Match[];
}
