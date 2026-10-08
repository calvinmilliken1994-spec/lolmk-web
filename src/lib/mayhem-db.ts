import { sql, type VercelPoolClient } from "@vercel/postgres";
import { randomUUID } from "node:crypto";
import { isAuditActorKind } from "@/types/audit-actor";
import type {
  MayhemActor,
  MayhemAuditEntry,
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
  MayhemTeamFormat,
} from "@/types/mayhem";
import { DEFAULT_FORMAT_CONFIG, PREMADE_ROSTER_SIZE } from "@/types/mayhem";
import { computeAutoRevealIndex } from "@/lib/mayhem-reveal";

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
          updated_at timestamptz NOT NULL DEFAULT now(),
          team_format text NOT NULL DEFAULT 'randomized',
          registration_open boolean NOT NULL DEFAULT false,
          registration_generation integer NOT NULL DEFAULT 0
        );
      `;
      // Additive migrations for events created before these columns existed —
      // safe to run every cold start; a no-op once applied.
      await sql`ALTER TABLE mayhem_events ADD COLUMN IF NOT EXISTS team_format text NOT NULL DEFAULT 'randomized';`;
      await sql`ALTER TABLE mayhem_events ADD COLUMN IF NOT EXISTS registration_open boolean NOT NULL DEFAULT false;`;
      await sql`ALTER TABLE mayhem_events ADD COLUMN IF NOT EXISTS registration_generation integer NOT NULL DEFAULT 0;`;
      // Auto-reveal: a persisted start timestamp is the single source of
      // truth for "how many teams are visible" — every reader (admin,
      // venue screen, public page) derives the count from elapsed time via
      // computeAutoRevealIndex(), so this keeps advancing correctly even if
      // no admin browser tab is open. reveal_index remains the source of
      // truth for MANUAL mode and doubles as the frozen value the moment
      // auto-reveal is paused.
      await sql`ALTER TABLE mayhem_events ADD COLUMN IF NOT EXISTS auto_reveal boolean NOT NULL DEFAULT false;`;
      await sql`ALTER TABLE mayhem_events ADD COLUMN IF NOT EXISTS reveal_started_at timestamptz;`;
      await sql`ALTER TABLE mayhem_events ADD COLUMN IF NOT EXISTS reveal_interval_ms integer NOT NULL DEFAULT 10000;`;
      await sql`ALTER TABLE mayhem_events ADD COLUMN IF NOT EXISTS reveal_start_on_countdown boolean NOT NULL DEFAULT false;`;
      await sql`
        CREATE TABLE IF NOT EXISTS mayhem_players (
          id text PRIMARY KEY,
          event_id text NOT NULL REFERENCES mayhem_events(id) ON DELETE CASCADE,
          display_name text NOT NULL,
          entry_order integer NOT NULL,
          team_id text,
          member_discord_id text
        );
      `;
      await sql`ALTER TABLE mayhem_players ADD COLUMN IF NOT EXISTS member_discord_id text;`;
      // A verified member can only hold one entrant row per event — without
      // this, a double-submitted join request (e.g. a rapid double-click)
      // could enroll the same Discord account twice under the display name
      // they had at each moment.
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS mayhem_players_member_unique
        ON mayhem_players (event_id, member_discord_id) WHERE member_discord_id IS NOT NULL;`;
      await sql`
        CREATE TABLE IF NOT EXISTS mayhem_teams (
          id text PRIMARY KEY,
          event_id text NOT NULL REFERENCES mayhem_events(id) ON DELETE CASCADE,
          name text NOT NULL,
          icon_url text NOT NULL DEFAULT '',
          seed integer,
          reveal_order integer NOT NULL,
          group_id text,
          is_ready boolean NOT NULL DEFAULT true,
          captain_discord_id text
        );
      `;
      await sql`ALTER TABLE mayhem_teams ADD COLUMN IF NOT EXISTS is_ready boolean NOT NULL DEFAULT true;`;
      await sql`ALTER TABLE mayhem_teams ADD COLUMN IF NOT EXISTS captain_discord_id text;`;
      // One premade team per captain per event — a captain re-submitting
      // "create team" must not silently spawn a second roster.
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS mayhem_teams_captain_unique
        ON mayhem_teams (event_id, captain_discord_id) WHERE captain_discord_id IS NOT NULL;`;
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
      // Pending premade applications — never counted as registered teams
      // until every slot is confirmed. See confirmPremadeApplicationSlot()
      // in actions.ts for the promotion path into mayhem_teams/mayhem_players.
      await sql`
        CREATE TABLE IF NOT EXISTS mayhem_team_applications (
          id text PRIMARY KEY,
          event_id text NOT NULL REFERENCES mayhem_events(id) ON DELETE CASCADE,
          team_name text NOT NULL,
          captain_discord_id text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          registration_generation integer NOT NULL DEFAULT 0,
          roster_version integer NOT NULL DEFAULT 0,
          send_in_progress boolean NOT NULL DEFAULT false
        );
      `;
      await sql`ALTER TABLE mayhem_team_applications ADD COLUMN IF NOT EXISTS roster_version integer NOT NULL DEFAULT 0;`;
      await sql`ALTER TABLE mayhem_team_applications ADD COLUMN IF NOT EXISTS send_in_progress boolean NOT NULL DEFAULT false;`;
      // One open application per captain per event — matches the same
      // one-team-per-captain rule as mayhem_teams' own unique index.
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS mayhem_team_applications_captain_unique
        ON mayhem_team_applications (event_id, captain_discord_id);`;
      await sql`
        CREATE TABLE IF NOT EXISTS mayhem_team_application_slots (
          id text PRIMARY KEY,
          application_id text NOT NULL REFERENCES mayhem_team_applications(id) ON DELETE CASCADE,
          member_discord_id text,
          display_name text,
          avatar_url text,
          status text NOT NULL DEFAULT 'draft',
          is_captain boolean NOT NULL DEFAULT false,
          confirm_token_hash text,
          confirm_token_expires_at timestamptz,
          delivery_status text NOT NULL DEFAULT 'not_sent',
          token_roster_version integer,
          updated_at timestamptz NOT NULL DEFAULT now(),
          created_at timestamptz NOT NULL DEFAULT now()
        );
      `;
      await sql`ALTER TABLE mayhem_team_application_slots ADD COLUMN IF NOT EXISTS confirm_token_expires_at timestamptz;`;
      await sql`ALTER TABLE mayhem_team_application_slots ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'not_sent';`;
      await sql`ALTER TABLE mayhem_team_application_slots ADD COLUMN IF NOT EXISTS token_roster_version integer;`;
      await sql`ALTER TABLE mayhem_team_application_slots ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();`;
      await sql`ALTER TABLE mayhem_team_application_slots ADD COLUMN IF NOT EXISTS delivery_error text;`;
      // A given Discord account can only be invited into ONE slot of a
      // given application (no duplicate invites to the same person), and
      // — critically — only one PENDING-OR-CONFIRMED slot across ALL
      // applications for the event, enforced by the reservation check in
      // actions.ts rather than a DB constraint (which can't easily express
      // "across applications" without a separate reservation table; the
      // event-lock transaction is what actually prevents the race).
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS mayhem_application_slots_member_unique
        ON mayhem_team_application_slots (application_id, member_discord_id) WHERE member_discord_id IS NOT NULL;`;
      await sql`CREATE INDEX IF NOT EXISTS mayhem_application_slots_application_idx
        ON mayhem_team_application_slots (application_id);`;
      // Audit log: one row per admin action, with the acting admin's
      // Discord id and display name (getCurrentAdmin()). Written by every
      // admin server action in src/app/tools/mayhem/actions.ts; read by the
      // desk's activity log. Admin-only: never joined into the venue or
      // public reads.
      await sql`
        CREATE TABLE IF NOT EXISTS mayhem_audit_log (
          id text PRIMARY KEY,
          event_id text NOT NULL REFERENCES mayhem_events(id) ON DELETE CASCADE,
          at timestamptz NOT NULL DEFAULT now(),
          action text NOT NULL,
          detail jsonb NOT NULL DEFAULT '{}'::jsonb,
          actor_discord_id text NOT NULL,
          actor_name text NOT NULL
        );
      `;
      await sql`CREATE INDEX IF NOT EXISTS mayhem_audit_log_event_at_idx ON mayhem_audit_log (event_id, at DESC);`;
      // 'admin' or 'member', matching rb_audit_log and sr_audit_log.
      await sql`
        ALTER TABLE mayhem_audit_log ADD COLUMN IF NOT EXISTS actor_kind text
          CONSTRAINT mayhem_audit_actor_kind_check CHECK (actor_kind IN ('admin', 'member'));
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
  const rawRevealIndex: number = row.reveal_index;
  const autoReveal = Boolean(row.auto_reveal);
  const revealStartedAt = row.reveal_started_at ? new Date(row.reveal_started_at).toISOString() : null;
  const revealIntervalMs = row.reveal_interval_ms ?? 10_000;
  const revealStartOnCountdown = Boolean(row.reveal_start_on_countdown);
  const countdownEndsAt = row.countdown_ends_at ? new Date(row.countdown_ends_at).toISOString() : null;

  const event: MayhemEvent = {
    id: row.id,
    title: row.title,
    stage: row.stage as MayhemStage,
    scene: row.scene as MayhemScene,
    countdown_ends_at: countdownEndsAt,
    // Auto mode: reveal_index is DERIVED here at read time from elapsed
    // wall-clock time, not the raw column — see computeAutoRevealIndex's
    // doc comment for why this is the only reveal_index every consumer
    // (admin dashboard, venue screen poll, public page) ever sees.
    reveal_index: computeAutoRevealIndex({
      teamCount: teamsRes.rows.length,
      manualIndex: rawRevealIndex,
      auto: autoReveal,
      revealStartedAt,
      countdownEndsAt,
      startOnCountdownEnd: revealStartOnCountdown,
      intervalMs: revealIntervalMs,
    }),
    format: row.format as MayhemFormatConfig,
    active_match_id: row.active_match_id,
    champion_team_id: row.champion_team_id,
    updated_at: new Date(row.updated_at).toISOString(),
    team_format: (row.team_format as MayhemTeamFormat) ?? "randomized",
    registration_open: Boolean(row.registration_open),
    registration_generation: row.registration_generation ?? 0,
    auto_reveal: autoReveal,
    reveal_started_at: revealStartedAt,
    reveal_interval_ms: revealIntervalMs,
    reveal_start_on_countdown: revealStartOnCountdown,
  };

  const players: MayhemPlayer[] = playersRes.rows.map((p) => ({
    id: p.id,
    event_id: p.event_id,
    display_name: p.display_name,
    entry_order: p.entry_order,
    team_id: p.team_id,
    member_discord_id: p.member_discord_id ?? null,
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
    is_ready: Boolean(t.is_ready),
    captain_discord_id: t.captain_discord_id ?? null,
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
// Audit log
// ---------------------------------------------------------------------------

/**
 * Record one admin action. Pass the transaction's client when the action runs
 * inside withEventLock(), so the audit row commits or rolls back with the
 * change; otherwise it is written right after the change.
 */
export async function writeMayhemAudit(
  actor: MayhemActor,
  action: string,
  detail: Record<string, unknown> = {},
  client?: VercelPoolClient,
): Promise<void> {
  const params = [
    newId("audit"),
    SINGLETON_EVENT_ID,
    action,
    JSON.stringify(detail),
    actor.discordId,
    actor.name,
    actor.kind ?? "admin",
  ];
  const text = `INSERT INTO mayhem_audit_log (id, event_id, action, detail, actor_discord_id, actor_name, actor_kind)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`;
  if (client) await client.query(text, params);
  else await sql.query(text, params);
}

/** Newest first. */
export async function listMayhemAudit(limit = 50): Promise<MayhemAuditEntry[]> {
  await ensureSchema();
  const { rows } = await sql.query(
    `SELECT * FROM mayhem_audit_log WHERE event_id = $1 ORDER BY at DESC, id DESC LIMIT $2`,
    [SINGLETON_EVENT_ID, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    event_id: r.event_id,
    at: new Date(r.at).toISOString(),
    action: r.action,
    detail: (r.detail ?? {}) as Record<string, unknown>,
    actor_discord_id: r.actor_discord_id,
    actor_name: r.actor_name,
    actor_kind: isAuditActorKind(r.actor_kind) ? r.actor_kind : null,
  }));
}

// ---------------------------------------------------------------------------
// Venue-safe read (no admin/session data, no Discord identities)
// ---------------------------------------------------------------------------

/**
 * Venue-safe projection of MayhemFull's team/player shape — strips
 * member_discord_id and captain_discord_id, which getMayhemFull() carries
 * for the admin tool but which have no business reaching /mayhemlive or its
 * polling API. Distinct from MayhemPublic: this keeps admin-only fields
 * like `scene`, `reveal_index`, and `format` (the venue screen and its
 * poll loop need those to render), it only removes the specific
 * Discord-identity columns added for self-service signup.
 */
export interface MayhemVenuePlayer {
  id: string;
  display_name: string;
  entry_order: number;
  team_id: string | null;
}

export interface MayhemVenueTeam {
  id: string;
  name: string;
  icon_url: string;
  seed: number | null;
  reveal_order: number;
  group_id: string | null;
  players: MayhemVenuePlayer[];
  is_ready: boolean;
}

export interface MayhemVenueState {
  event: MayhemEvent;
  players: MayhemVenuePlayer[];
  teams: MayhemVenueTeam[];
  groups: MayhemGroup[];
  matches: MayhemMatch[];
}

/**
 * What /mayhemlive and its polling API (/api/mayhem/state) are allowed to
 * serve. Never returns member_discord_id or captain_discord_id — those
 * identify a real Discord account and have no reason to ride a payload
 * polled by anyone who opens the venue-screen URL. Built by re-fetching
 * full state and stripping fields, not by reusing a cached getMayhemFull()
 * result, so this is always in sync with what admins see.
 */
export async function getMayhemVenueState(): Promise<MayhemVenueState> {
  const full = await getMayhemFull();
  const stripPlayer = (p: MayhemPlayer): MayhemVenuePlayer => ({
    id: p.id,
    display_name: p.display_name,
    entry_order: p.entry_order,
    team_id: p.team_id,
  });
  return {
    event: full.event,
    players: full.players.map(stripPlayer),
    teams: full.teams.map((t) => ({
      id: t.id,
      name: t.name,
      icon_url: t.icon_url,
      seed: t.seed,
      reveal_order: t.reveal_order,
      group_id: t.group_id,
      players: t.players.map(stripPlayer),
      is_ready: t.is_ready,
    })),
    groups: full.groups,
    matches: full.matches,
  };
}

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
    team_format: event.team_format,
    registration_open: event.registration_open,
    registration_generation: event.registration_generation,
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
