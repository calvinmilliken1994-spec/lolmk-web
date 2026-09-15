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

/**
 * How teams are formed for this event. Locked once any player or team
 * exists (enforced in mayhem-db.ts / actions.ts) — switching formats
 * mid-signup would strand whatever's already been collected under the old
 * model, so the UI and the server both require a full reset first.
 *
 *   - "randomized": solo entrants only (admin bulk-add, pasted list, or
 *     self-service via verified Discord login); the admin runs the
 *     randomizer once signups close.
 *   - "premade": only complete 5-player teams register; no randomizer.
 *   - "mixed": both paths open at once on the same event. Solo entrants
 *     accumulate exactly like "randomized" and get placed into additional
 *     teams by the randomizer at close; premade teams register exactly
 *     like "premade" and are seeded in as complete rosters untouched by
 *     the randomizer. The two pools never merge — a solo entrant is never
 *     folded into a premade team's roster, and a premade team is never
 *     broken up to fill a randomized team.
 */
export type MayhemTeamFormat = "randomized" | "premade" | "mixed";

export const PREMADE_ROSTER_SIZE = 5;

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
  /**
   * Verified Discord member who self-registered, or null for an
   * admin-added / pasted guest name. Never merge a guest and a verified
   * row just because their display names match — this is the only field
   * that distinguishes them, and it's set once at creation, never inferred.
   */
  member_discord_id: string | null;
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
  /**
   * Only meaningful in "premade" format. A draft team (not yet at
   * PREMADE_ROSTER_SIZE players) is never tournament-ready — it's excluded
   * from randomizer-equivalent seeding into groups/bracket until the
   * captain fills the roster and the admin (or an auto-check) marks it
   * ready. Always true for randomized-format teams (they're born full).
   */
  is_ready: boolean;
  /** Verified Discord member who created this team. Null for randomized-format teams (no captain concept there). */
  captain_discord_id: string | null;
}

export interface MayhemGroup {
  id: string;
  event_id: string;
  label: string;
  advance_count: number;
}

/**
 * A pending premade team submission, not yet a real MayhemTeam. Only
 * promoted to mayhem_teams/mayhem_players once every slot has a confirmed
 * member — see confirmPremadeApplicationSlot() in actions.ts. Never counted
 * toward tournament capacity, group/bracket generation, or the public page
 * while pending; existing only so the captain and invited members have
 * something to look at and confirm against.
 */
export interface MayhemTeamApplication {
  id: string;
  event_id: string;
  team_name: string;
  captain_discord_id: string;
  created_at: string;
  /** Bumped from setRegistrationOpen()'s generation at creation — a stale-generation application is rejected at promotion time, same guard as everywhere else. */
  registration_generation: number;
  /** Bumped on every roster edit (add/remove a draft or pending slot). A confirmation token snapshots this value at send time — confirmApplicationSlot rejects a token whose snapshot no longer matches, so editing the roster after invites went out invalidates the edited-around links instead of leaving them live against a changed team. */
  roster_version: number;
}

/**
 * "draft": captain picked this person via search but no DM/token exists yet
 *   — reversible with zero side effects, never reserves the slot against
 *   other applications (isDiscordIdReserved ignores drafts entirely).
 * "pending": a confirmation DM was sent (or attempted); reserves the slot.
 * "confirmed" / "declined": terminal, per confirmApplicationSlot/declineApplicationSlot.
 */
export type MayhemApplicationSlotStatus = "draft" | "pending" | "confirmed" | "declined";

/** Per-slot DM delivery outcome, independent of confirmation status — a "sent" DM can still go unconfirmed for days; a "failed" send always allows retry. */
export type MayhemInviteDeliveryStatus = "not_sent" | "sending" | "sent" | "failed";

export interface MayhemTeamApplicationSlot {
  id: string;
  application_id: string;
  /** Null until the invited member is identified — captain's own slot is filled immediately. */
  member_discord_id: string | null;
  display_name: string | null;
  avatar_url: string | null;
  status: MayhemApplicationSlotStatus;
  /** True only for the captain's own slot, which never requires separate confirmation — creating the application IS their confirmation. */
  is_captain: boolean;
  confirm_token_hash: string | null;
  delivery_status: MayhemInviteDeliveryStatus;
  /** Snapshot of the application's roster_version when this slot's current token was issued — see MayhemTeamApplication.roster_version's doc comment. */
  token_roster_version: number | null;
  created_at: string;
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
  /** How teams are formed this event. See MayhemTeamFormat's doc comment. */
  team_format: MayhemTeamFormat;
  /**
   * Whether the public self-service signup (verified-member join, or
   * premade team creation/joining) is currently accepting writes. Admin
   * bulk-add/paste always works regardless of this flag — it only gates
   * the public-facing endpoints. Checked atomically with the insert itself
   * (same transaction), not just used to hide the button client-side.
   */
  registration_open: boolean;
  /**
   * Bumped on every full reset (clearAllPlayers). A stale invite
   * link/session holding an old generation number is rejected rather than
   * silently enrolling into the fresh event that replaced it — see
   * withEventLock() call sites in actions.ts that check this.
   */
  registration_generation: number;
  /**
   * When true, reveal_index is DERIVED at read time (see
   * computeAutoRevealIndex in mayhem-reveal.ts) from reveal_started_at,
   * not persisted per-tick — no server-side timer or cron needed, and the
   * reveal keeps advancing correctly even with every admin tab closed.
   * When false, reveal_index is the plain manual-mode value advanceReveal()
   * writes directly.
   */
  auto_reveal: boolean;
  /** Set once when auto-reveal actually begins (either immediately, or when the countdown ends if reveal_start_on_countdown). Null before it starts. */
  reveal_started_at: string | null;
  /** Milliseconds between each team appearing during auto-reveal. */
  reveal_interval_ms: number;
  /** If true and auto_reveal is true, the reveal timer's effective start is countdown_ends_at instead of the moment auto-reveal was armed. */
  reveal_start_on_countdown: boolean;
}

export interface MayhemFull {
  event: MayhemEvent;
  players: MayhemPlayer[];
  teams: MayhemTeam[];
  groups: MayhemGroup[];
  matches: MayhemMatch[];
}

// ---------------------------------------------------------------------------
// Public projection
// ---------------------------------------------------------------------------
//
// What an unauthenticated visitor on /tournaments/aram may see. The shapes
// above mirror DB rows and drive the admin tool + the venue screen; these
// drop everything that is either presentation state for the venue screen or
// simply nobody's business:
//
//   - `scene`, `reveal_index`, `countdown_ends_at`, `active_match_id`: stage
//     direction for /mayhemlive. Publishing them would let anyone watch an
//     admin cue the room in real time.
//   - `format`: the admin's configuration object, not a result.
//   - player `id` / `entry_order` / `team_id`: internal keys.
//
// The reveal gate below is the load-bearing part: ARAM Mayhem's whole format
// is a live team reveal at the venue. Publishing the full team list on the
// website while the room is still watching them appear one at a time would
// spoil the event, so this page shows exactly as much as the venue screen
// has already shown, and nothing before the randomizer has even run.

export interface MayhemPublicPlayer {
  display_name: string;
}

export interface MayhemPublicTeam {
  id: string;
  name: string;
  icon_url: string;
  seed: number | null;
  players: MayhemPublicPlayer[];
}

export interface MayhemPublicMatch {
  id: string;
  bracket: MayhemMatchBracket;
  round_number: number;
  match_number: number;
  best_of: SeriesLength;
  team_a_id: string | null;
  team_b_id: string | null;
  team_a_score: number;
  team_b_score: number;
  winner_id: string | null;
  status: MayhemMatchStatus;
}

export interface MayhemPublic {
  title: string;
  stage: MayhemStage;
  /** How teams are formed this event — drives which signup UI the public page shows. */
  team_format: MayhemTeamFormat;
  /** Whether self-service signup is currently open. */
  registration_open: boolean;
  /** Passed back on every signup action so a reset mid-session is rejected instead of silently landing on stale state. */
  registration_generation: number;
  /** Null until a champion is decided; always one of `teams` when set. */
  champion_team_id: string | null;
  /** Entrant count. Safe to show while teams are still hidden. */
  player_count: number;
  /** Empty while entrants are still being collected, or partially filled mid-reveal. */
  teams: MayhemPublicTeam[];
  /** True when `teams` is intentionally incomplete because the venue reveal is running. */
  reveal_in_progress: boolean;
  matches: MayhemPublicMatch[];
  updated_at: string;
}
