import { sql } from "@vercel/postgres";
import { randomUUID } from "node:crypto";
import type {
  MayhemEvent,
  MayhemFormatConfig,
  MayhemFull,
  MayhemGroup,
  MayhemMatch,
  MayhemPlayer,
  MayhemPublic,
  MayhemScene,
  MayhemStage,
  MayhemTeam,
} from "@/types/mayhem";
import { DEFAULT_FORMAT_CONFIG } from "@/types/mayhem";

/**
 * ARAM Mayhem persistence layer (Vercel Postgres).
 *
 * Single active event model: we only ever run one Mayhem tournament at a
 * time (same-day venue events), so there's one "current" row per table,
 * looked up by a well-known singleton event id. `ensureSchema()` is called
 * lazily on first use — cheap `CREATE TABLE IF NOT EXISTS`, safe to run on
 * every cold start.
 */

const SINGLETON_EVENT_ID = "mayhem-main";
let schemaReady: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS mayhem_events (
          id text PRIMARY KEY,
          title text NOT NULL DEFAULT 'ARAM Mayhem',
          stage text NOT NULL DEFAULT 'collecting',
          scene text NOT NULL DEFAULT 'idle',
          countdown_ends_at timestamptz,
          reveal_index integer NOT NULL DEFAULT 0,
          format jsonb NOT NULL,
          active_match_id text,
          champion_team_id text,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS mayhem_players (
          id text PRIMARY KEY,
          event_id text NOT NULL REFERENCES mayhem_events(id) ON DELETE CASCADE,
          display_name text NOT NULL,
          entry_order integer NOT NULL,
          team_id text
        );
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS mayhem_teams (
          id text PRIMARY KEY,
          event_id text NOT NULL REFERENCES mayhem_events(id) ON DELETE CASCADE,
          name text NOT NULL,
          icon_url text NOT NULL DEFAULT '',
          seed integer,
          reveal_order integer NOT NULL,
          group_id text
        );
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS mayhem_groups (
          id text PRIMARY KEY,
          event_id text NOT NULL REFERENCES mayhem_events(id) ON DELETE CASCADE,
          label text NOT NULL,
          advance_count integer NOT NULL DEFAULT 1
        );
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS mayhem_matches (
          id text PRIMARY KEY,
          event_id text NOT NULL REFERENCES mayhem_events(id) ON DELETE CASCADE,
          bracket text NOT NULL,
          group_id text,
          round_number integer NOT NULL,
          match_number integer NOT NULL,
          best_of integer NOT NULL DEFAULT 1,
          team_a_id text,
          team_b_id text,
          team_a_score integer NOT NULL DEFAULT 0,
          team_b_score integer NOT NULL DEFAULT 0,
          winner_id text,
          status text NOT NULL DEFAULT 'pending',
          advances_to_match_id text,
          advances_to_slot text,
          drops_to_match_id text,
          drops_to_slot text
        );
      `;
      // Ensure the singleton event row exists.
      await sql`
        INSERT INTO mayhem_events (id, title, format)
        VALUES (${SINGLETON_EVENT_ID}, 'ARAM Mayhem', ${JSON.stringify(DEFAULT_FORMAT_CONFIG)}::jsonb)
        ON CONFLICT (id) DO NOTHING;
      `;
    })();
  }
  return schemaReady;
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 12)}`;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getMayhemFull(): Promise<MayhemFull> {
  await ensureSchema();

  const [eventRes, playersRes, teamsRes, groupsRes, matchesRes] = await Promise.all([
    sql`SELECT * FROM mayhem_events WHERE id = ${SINGLETON_EVENT_ID}`,
    sql`SELECT * FROM mayhem_players WHERE event_id = ${SINGLETON_EVENT_ID} ORDER BY entry_order ASC`,
    sql`SELECT * FROM mayhem_teams WHERE event_id = ${SINGLETON_EVENT_ID} ORDER BY reveal_order ASC`,
    sql`SELECT * FROM mayhem_groups WHERE event_id = ${SINGLETON_EVENT_ID} ORDER BY label ASC`,
    sql`SELECT * FROM mayhem_matches WHERE event_id = ${SINGLETON_EVENT_ID} ORDER BY match_number ASC`,
  ]);

  const row = eventRes.rows[0];
  const event: MayhemEvent = {
    id: row.id,
    title: row.title,
    stage: row.stage as MayhemStage,
    scene: row.scene as MayhemScene,
    countdown_ends_at: row.countdown_ends_at
      ? new Date(row.countdown_ends_at).toISOString()
      : null,
    reveal_index: row.reveal_index,
    format: row.format as MayhemFormatConfig,
    active_match_id: row.active_match_id,
    champion_team_id: row.champion_team_id,
    updated_at: new Date(row.updated_at).toISOString(),
  };

  const players: MayhemPlayer[] = playersRes.rows.map((p) => ({
    id: p.id,
    event_id: p.event_id,
    display_name: p.display_name,
    entry_order: p.entry_order,
    team_id: p.team_id,
  }));

  const teams: MayhemTeam[] = teamsRes.rows.map((t) => ({
    id: t.id,
    event_id: t.event_id,
    name: t.name,
    icon_url: t.icon_url,
    seed: t.seed,
    reveal_order: t.reveal_order,
    group_id: t.group_id,
    players: players.filter((p) => p.team_id === t.id),
  }));

  const groups: MayhemGroup[] = groupsRes.rows.map((g) => ({
    id: g.id,
    event_id: g.event_id,
    label: g.label,
    advance_count: g.advance_count,
  }));

  const matches: MayhemMatch[] = matchesRes.rows.map((m) => ({
    id: m.id,
    event_id: m.event_id,
    bracket: m.bracket,
    group_id: m.group_id,
    round_number: m.round_number,
    match_number: m.match_number,
    best_of: m.best_of,
    team_a_id: m.team_a_id,
    team_b_id: m.team_b_id,
    team_a_score: m.team_a_score,
    team_b_score: m.team_b_score,
    winner_id: m.winner_id,
    status: m.status,
    advances_to_match_id: m.advances_to_match_id,
    advances_to_slot: m.advances_to_slot,
    drops_to_match_id: m.drops_to_match_id,
    drops_to_slot: m.drops_to_slot,
  }));

  return { event, players, teams, groups, matches };
}

export { SINGLETON_EVENT_ID };

// ---------------------------------------------------------------------------
// Public read
// ---------------------------------------------------------------------------

/**
 * The single read used by the public /tournaments/aram page.
 *
 * getMayhemFull() above is the admin/venue read and returns the whole event
 * including presentation state; this projects it down to MayhemPublic and,
 * more importantly, enforces the reveal gate:
 *
 *   stage === "collecting"  → no teams at all (the randomizer hasn't run)
 *   scene  === "reveal"     → only the teams already shown on /mayhemlive
 *   otherwise               → the full field
 *
 * Without that gate the website would publish the complete team list while
 * the room is still watching them get revealed one by one, which is the
 * entire point of the format.
 */
export async function getMayhemPublic(): Promise<MayhemPublic> {
  const full = await getMayhemFull();
  const { event, players, teams, matches } = full;

  const revealing = event.scene === "reveal";
  const visibleTeams =
    event.stage === "collecting" ? [] : revealing ? teams.slice(0, event.reveal_index) : teams;

  return {
    title: event.title,
    stage: event.stage,
    // A champion id that points at a team we're deliberately not showing yet
    // would be a leak of exactly the thing the reveal gate protects.
    champion_team_id:
      event.champion_team_id && visibleTeams.some((t) => t.id === event.champion_team_id)
        ? event.champion_team_id
        : null,
    player_count: players.length,
    teams: visibleTeams.map((t) => ({
      id: t.id,
      name: t.name,
      icon_url: t.icon_url,
      seed: t.seed,
      players: t.players.map((p) => ({ display_name: p.display_name })),
    })),
    reveal_in_progress: revealing && visibleTeams.length < teams.length,
    // Matches referencing a not-yet-revealed team are withheld wholesale
    // rather than shown with blanked-out slots, which would still leak that
    // a pairing exists.
    matches: matches
      .filter(
        (m) =>
          (!m.team_a_id || visibleTeams.some((t) => t.id === m.team_a_id)) &&
          (!m.team_b_id || visibleTeams.some((t) => t.id === m.team_b_id)),
      )
      .map((m) => ({
        id: m.id,
        bracket: m.bracket,
        round_number: m.round_number,
        match_number: m.match_number,
        best_of: m.best_of,
        team_a_id: m.team_a_id,
        team_b_id: m.team_b_id,
        team_a_score: m.team_a_score,
        team_b_score: m.team_b_score,
        winner_id: m.winner_id,
        status: m.status,
      })),
    updated_at: event.updated_at,
  };
}
