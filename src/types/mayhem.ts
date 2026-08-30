// ARAM Mayhem tournament types. Mirrors the shape stored in Postgres
// (src/lib/mayhem-db.ts). Kept separate from src/types/tournament.ts because
// Mayhem is a distinct, much more configurable ad-hoc format (fun ARAM
// tournaments run same-day at meetups), not the seasonal League tournament
// system described in assets/TOURNAMENT.md.

export type MayhemScene =
  | "idle"
  | "starting_soon"
  | "reveal"
  | "teams"
  | "groups"
  | "bracket"
  | "match"
  | "champion";

export type MayhemStage =
  | "collecting" // adding players
  | "randomized" // teams confirmed, not yet seeded into a bracket
  | "group_stage" // groups configured/running
  | "knockout" // knockout bracket running
  | "completed";

export type SeriesLength = 1 | 3 | 5;

export interface MayhemFormatConfig {
  groupStage: {
    enabled: boolean;
    groupCount: number;
    seriesLength: SeriesLength;
    advancePerGroup: number;
    seeding: "random" | "manual";
  };
  knockout: {
    seriesLength: SeriesLength;
    doubleElimination: boolean;
    thirdPlaceMatch: boolean;
    grandFinalReset: boolean;
  };
}

export const DEFAULT_FORMAT_CONFIG: MayhemFormatConfig = {
  groupStage: {
    enabled: false,
    groupCount: 2,
    seriesLength: 1,
    advancePerGroup: 2,
    seeding: "random",
  },
  knockout: {
    seriesLength: 1,
    doubleElimination: false,
    thirdPlaceMatch: false,
    grandFinalReset: true,
  },
};

export interface MayhemPlayer {
  id: string;
  event_id: string;
  display_name: string;
  entry_order: number;
  team_id: string | null;
}

export interface MayhemTeam {
  id: string;
  event_id: string;
  name: string;
  icon_url: string;
  seed: number | null;
  reveal_order: number;
  group_id: string | null;
  players: MayhemPlayer[];
}

export interface MayhemGroup {
  id: string;
  event_id: string;
  label: string;
  advance_count: number;
}

export type MayhemMatchBracket = "group" | "upper" | "lower" | "grand_final" | "third_place";
export type MayhemMatchStatus = "pending" | "scheduled" | "in_progress" | "completed" | "bye";

export interface MayhemMatch {
  id: string;
  event_id: string;
  bracket: MayhemMatchBracket;
  group_id: string | null;
  round_number: number;
  match_number: number;
  best_of: SeriesLength;
  team_a_id: string | null;
  team_b_id: string | null;
  team_a_score: number;
  team_b_score: number;
  winner_id: string | null;
  status: MayhemMatchStatus;
  advances_to_match_id: string | null;
  advances_to_slot: "a" | "b" | null;
  drops_to_match_id: string | null;
  drops_to_slot: "a" | "b" | null;
}

export interface MayhemEvent {
  id: string;
  title: string;
  stage: MayhemStage;
  scene: MayhemScene;
  countdown_ends_at: string | null;
  reveal_index: number; // how many teams have been revealed on /mayhemlive
  format: MayhemFormatConfig;
  active_match_id: string | null;
  champion_team_id: string | null;
  updated_at: string;
}

export interface MayhemFull {
  event: MayhemEvent;
  players: MayhemPlayer[];
  teams: MayhemTeam[];
  groups: MayhemGroup[];
  matches: MayhemMatch[];
}
