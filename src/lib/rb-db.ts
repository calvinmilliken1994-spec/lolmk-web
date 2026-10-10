import { sql, type VercelPoolClient } from "@vercel/postgres";
import { randomUUID } from "node:crypto";
import { isAuditActorKind } from "../types/audit-actor";
import type {
  RbActor,
  RbAuditAction,
  RbAuditLogEntry,
  RbExportFormat,
  RbGameExportRow,
  RbMatch,
  RbMatchExportRow,
  RbMatchFlag,
  RbPlayer,
  RbPublicMatch,
  RbPublicPlayer,
  RbPublicRound,
  RbPublicTournament,
  RbPublicTournamentFull,
  RbRound,
  RbScene,
  RbTournament,
  RbTournamentConfig,
  RbTournamentFull,
} from "../types/riftbound";
import { DEFAULT_RB_CONFIG, RB_PUBLIC_STATUSES } from "../types/riftbound";

/**
 * Riftbound tournament persistence layer (Vercel Postgres).
 *
 * Multi-tournament like sr-db.ts, individual players instead of teams. Rules
 * are in docs/RIFTBOUND.md. Conventions carried over from sr-db.ts:
 *   - lazy, idempotent `CREATE TABLE IF NOT EXISTS` in ensureSchema(); this is
 *     schema creation, not migration — a later column change on a table with
 *     real data needs an additive `ALTER ... ADD COLUMN IF NOT EXISTS` block
 *     (or a real migration tool for anything else)
 *   - composite (tournament_id, id) foreign keys so a match can only reference
 *     a round or player of its OWN tournament
 *   - ADMIN reads return Rb* rows; PUBLIC reads go through toPublic* mappers
 *
 * Differences from sr-db.ts that are deliberate:
 *   - Records are retained (appeals, >= 3 months): every foreign key is
 *     RESTRICT, nothing cascades, so deleting a tournament that has history
 *     fails loudly. Archive instead.
 *   - writeAudit() requires an actor; the audit table has NOT NULL actor
 *     columns.
 *   - The whole schema is created under one advisory lock so concurrent cold
 *     starts cannot race on CREATE.
 *
 * Lock order for every mutation, to keep two admins from deadlocking:
 *   tournament -> round -> matches (by table) -> players (by id).
 * Take a lower lock only after the higher ones, never the reverse.
 */

let schemaReady: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const client = await sql.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SELECT pg_advisory_xact_lock(hashtext('lolmk:rb-schema-v1'))`);

        await client.query(`
          CREATE TABLE IF NOT EXISTS rb_tournaments (
            id text PRIMARY KEY,
            slug text NOT NULL,
            name text NOT NULL,
            status text NOT NULL DEFAULT 'draft',
            config jsonb NOT NULL DEFAULT '{}'::jsonb,
            scene text NOT NULL DEFAULT 'idle',
            auto_follow boolean NOT NULL DEFAULT true,
            auto_follow_paused boolean NOT NULL DEFAULT false,
            champion_player_id text,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT rb_tournaments_status_check
              CHECK (status IN ('draft','registration','in_progress','completed','archived')),
            CONSTRAINT rb_tournaments_scene_check
              CHECK (scene IN ('idle','pairings','pairings_clock','clock','standings','top_cut','champion')),
            CONSTRAINT rb_tournaments_name_nonblank_check CHECK (trim(name) <> ''),
            CONSTRAINT rb_tournaments_slug_nonblank_check CHECK (trim(slug) <> ''),
            CONSTRAINT rb_tournaments_completed_has_champion_check
              CHECK (status <> 'completed' OR champion_player_id IS NOT NULL)
          );
        `);
        await client.query(
          `CREATE UNIQUE INDEX IF NOT EXISTS rb_tournaments_slug_unique ON rb_tournaments (lower(slug))`,
        );
        await client.query(
          `CREATE INDEX IF NOT EXISTS rb_tournaments_status_idx ON rb_tournaments (status)`,
        );

        await client.query(`
          CREATE TABLE IF NOT EXISTS rb_players (
            id text PRIMARY KEY,
            tournament_id text NOT NULL REFERENCES rb_tournaments(id) ON DELETE RESTRICT,
            display_name text NOT NULL,
            member_discord_id text,
            legend text,
            status text NOT NULL DEFAULT 'registered',
            dropped_after_round integer,
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT rb_players_status_check
              CHECK (status IN ('registered','checked_in','active','dropped','dq')),
            CONSTRAINT rb_players_name_nonblank_check CHECK (trim(display_name) <> ''),
            CONSTRAINT rb_players_member_nonblank_check
              CHECK (member_discord_id IS NULL OR trim(member_discord_id) <> ''),
            CONSTRAINT rb_players_dropped_round_check
              CHECK (dropped_after_round IS NULL OR dropped_after_round >= 0),
            -- Target of the composite FKs from rb_matches / rb_tournaments.
            CONSTRAINT rb_players_tournament_id_unique UNIQUE (tournament_id, id)
          );
        `);
        // One entry per verified member per tournament. Guests (NULL) never collide.
        await client.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS rb_players_member_unique
            ON rb_players (tournament_id, member_discord_id) WHERE member_discord_id IS NOT NULL
        `);
        await client.query(
          `CREATE INDEX IF NOT EXISTS rb_players_tournament_idx ON rb_players (tournament_id, status)`,
        );

        await client.query(`
          CREATE TABLE IF NOT EXISTS rb_rounds (
            id text PRIMARY KEY,
            tournament_id text NOT NULL REFERENCES rb_tournaments(id) ON DELETE RESTRICT,
            number integer NOT NULL,
            stage text NOT NULL DEFAULT 'swiss',
            status text NOT NULL DEFAULT 'draft',
            started_at timestamptz,
            paused_at timestamptz,
            paused_total_ms integer NOT NULL DEFAULT 0,
            duration_ms integer,
            pairing_seed text,
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT rb_rounds_stage_check CHECK (stage IN ('swiss','top_cut')),
            CONSTRAINT rb_rounds_status_check CHECK (status IN ('draft','published','live','closed')),
            CONSTRAINT rb_rounds_number_check CHECK (number >= 1),
            CONSTRAINT rb_rounds_paused_total_check CHECK (paused_total_ms >= 0),
            CONSTRAINT rb_rounds_duration_check CHECK (duration_ms IS NULL OR duration_ms >= 0),
            CONSTRAINT rb_rounds_paused_needs_start_check
              CHECK (paused_at IS NULL OR started_at IS NOT NULL),
            -- Round numbers are event-wide; top-cut rounds continue the Swiss count.
            CONSTRAINT rb_rounds_number_unique UNIQUE (tournament_id, number),
            CONSTRAINT rb_rounds_tournament_id_unique UNIQUE (tournament_id, id)
          );
        `);

        await client.query(`
          CREATE TABLE IF NOT EXISTS rb_matches (
            id text PRIMARY KEY,
            tournament_id text NOT NULL REFERENCES rb_tournaments(id) ON DELETE RESTRICT,
            round_id text NOT NULL,
            table_number integer NOT NULL,
            player_a text NOT NULL,
            player_b text,
            games_a integer NOT NULL DEFAULT 0,
            games_b integer NOT NULL DEFAULT 0,
            games_drawn integer NOT NULL DEFAULT 0,
            decided_on_time boolean NOT NULL DEFAULT false,
            extension_ms integer NOT NULL DEFAULT 0,
            status text NOT NULL DEFAULT 'pending',
            reported_by_id text,
            reported_by_name text,
            reported_at timestamptz,
            idempotency_key text,
            flags jsonb NOT NULL DEFAULT '[]'::jsonb,
            CONSTRAINT rb_matches_status_check CHECK (status IN ('pending','completed','bye')),
            CONSTRAINT rb_matches_table_check CHECK (table_number >= 1),
            CONSTRAINT rb_matches_games_nonneg_check
              CHECK (games_a >= 0 AND games_b >= 0 AND games_drawn >= 0),
            CONSTRAINT rb_matches_extension_nonneg_check CHECK (extension_ms >= 0),
            CONSTRAINT rb_matches_distinct_players_check
              CHECK (player_b IS NULL OR player_a <> player_b),
            -- A bye is exactly the match with no opponent.
            CONSTRAINT rb_matches_bye_iff_no_opponent_check
              CHECK ((player_b IS NULL) = (status = 'bye')),
            -- A reported result always says who reported it and when.
            CONSTRAINT rb_matches_completed_has_reporter_check
              CHECK (status <> 'completed'
                     OR (reported_by_id IS NOT NULL AND reported_by_name IS NOT NULL AND reported_at IS NOT NULL)),
            CONSTRAINT rb_matches_idempotency_key_unique UNIQUE (idempotency_key),
            CONSTRAINT rb_matches_table_unique UNIQUE (round_id, table_number),
            CONSTRAINT rb_matches_round_fkey
              FOREIGN KEY (tournament_id, round_id) REFERENCES rb_rounds (tournament_id, id) ON DELETE RESTRICT,
            CONSTRAINT rb_matches_player_a_fkey
              FOREIGN KEY (tournament_id, player_a) REFERENCES rb_players (tournament_id, id) ON DELETE RESTRICT,
            CONSTRAINT rb_matches_player_b_fkey
              FOREIGN KEY (tournament_id, player_b) REFERENCES rb_players (tournament_id, id) ON DELETE RESTRICT
          );
        `);
        // Added after the first release: idempotent, and runs for fresh tables too.
        await client.query(`ALTER TABLE rb_matches ADD COLUMN IF NOT EXISTS started_at timestamptz`);
        await client.query(
          `CREATE INDEX IF NOT EXISTS rb_matches_tournament_idx ON rb_matches (tournament_id)`,
        );
        await client.query(
          `CREATE INDEX IF NOT EXISTS rb_matches_round_idx ON rb_matches (round_id, status)`,
        );
        await client.query(
          `CREATE INDEX IF NOT EXISTS rb_matches_player_a_idx ON rb_matches (tournament_id, player_a)`,
        );
        await client.query(
          `CREATE INDEX IF NOT EXISTS rb_matches_player_b_idx ON rb_matches (tournament_id, player_b) WHERE player_b IS NOT NULL`,
        );

        await client.query(`
          CREATE TABLE IF NOT EXISTS rb_audit_log (
            id bigserial PRIMARY KEY,
            tournament_id text NOT NULL REFERENCES rb_tournaments(id) ON DELETE RESTRICT,
            action text NOT NULL,
            detail jsonb,
            actor_discord_id text NOT NULL,
            actor_name text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT rb_audit_actor_id_nonblank_check CHECK (trim(actor_discord_id) <> ''),
            CONSTRAINT rb_audit_actor_name_nonblank_check CHECK (trim(actor_name) <> '')
          );
        `);
        await client.query(
          `CREATE INDEX IF NOT EXISTS rb_audit_log_tournament_idx ON rb_audit_log (tournament_id, created_at DESC)`,
        );
        // Who acted: 'admin' (desk/judge) or 'member'. Same column on
        // mayhem_audit_log and sr_audit_log; null on older rows.
        await client.query(
          `ALTER TABLE rb_audit_log ADD COLUMN IF NOT EXISTS actor_kind text
             CONSTRAINT rb_audit_actor_kind_check CHECK (actor_kind IN ('admin', 'member'))`,
        );

        // Champion must be a player of THIS tournament. Added after both
        // tables exist (the FK is circular); ADD CONSTRAINT is not idempotent,
        // so it is guarded by a catalog lookup under the advisory lock above.
        const { rows } = await client.query(
          `SELECT 1 FROM pg_constraint
           WHERE conrelid = 'rb_tournaments'::regclass
             AND conname = 'rb_tournaments_champion_same_tournament_fkey'`,
        );
        if (rows.length === 0) {
          await client.query(`
            ALTER TABLE rb_tournaments
              ADD CONSTRAINT rb_tournaments_champion_same_tournament_fkey
              FOREIGN KEY (id, champion_player_id) REFERENCES rb_players (tournament_id, id)
              ON DELETE RESTRICT
          `);
        }

        await client.query("COMMIT");
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the original failure.
        }
        throw error;
      } finally {
        client.release();
      }
    })().catch((e) => {
      // Don't cache a failed attempt forever (transient network / cold start).
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 12)}`;
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

const iso = (v: unknown): string => new Date(v as string).toISOString();
const isoOrNull = (v: unknown): string | null => (v ? iso(v) : null);

/** Stored config merged over defaults, so a config written before a field existed still reads whole. */
function parseConfig(raw: unknown): RbTournamentConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Partial<RbTournamentConfig>;
  return {
    ...DEFAULT_RB_CONFIG,
    ...c,
    scoring: { ...DEFAULT_RB_CONFIG.scoring, ...(c.scoring ?? {}) },
  };
}

export function rowToTournament(row: Record<string, unknown>): RbTournament {
  return {
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    status: row.status as RbTournament["status"],
    config: parseConfig(row.config),
    scene: (row.scene as RbScene) ?? "idle",
    auto_follow: Boolean(row.auto_follow),
    auto_follow_paused: Boolean(row.auto_follow_paused),
    champion_player_id: (row.champion_player_id as string) ?? null,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

export function rowToPlayer(row: Record<string, unknown>): RbPlayer {
  return {
    id: row.id as string,
    tournament_id: row.tournament_id as string,
    display_name: row.display_name as string,
    member_discord_id: (row.member_discord_id as string) ?? null,
    legend: (row.legend as string) ?? null,
    status: row.status as RbPlayer["status"],
    dropped_after_round:
      row.dropped_after_round === null || row.dropped_after_round === undefined
        ? null
        : Number(row.dropped_after_round),
    created_at: iso(row.created_at),
  };
}

export function rowToRound(row: Record<string, unknown>): RbRound {
  return {
    id: row.id as string,
    tournament_id: row.tournament_id as string,
    number: Number(row.number),
    stage: row.stage as RbRound["stage"],
    status: row.status as RbRound["status"],
    started_at: isoOrNull(row.started_at),
    paused_at: isoOrNull(row.paused_at),
    paused_total_ms: Number(row.paused_total_ms ?? 0),
    duration_ms:
      row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
    pairing_seed: (row.pairing_seed as string) ?? null,
    created_at: iso(row.created_at),
  };
}

export function rowToMatch(row: Record<string, unknown>): RbMatch {
  return {
    id: row.id as string,
    tournament_id: row.tournament_id as string,
    round_id: row.round_id as string,
    table_number: Number(row.table_number),
    player_a_id: row.player_a as string,
    player_b_id: (row.player_b as string) ?? null,
    games_a: Number(row.games_a),
    games_b: Number(row.games_b),
    games_drawn: Number(row.games_drawn),
    decided_on_time: Boolean(row.decided_on_time),
    extension_ms: Number(row.extension_ms ?? 0),
    started_at: isoOrNull(row.started_at),
    status: row.status as RbMatch["status"],
    reported_by_id: (row.reported_by_id as string) ?? null,
    reported_by_name: (row.reported_by_name as string) ?? null,
    reported_at: isoOrNull(row.reported_at),
    idempotency_key: (row.idempotency_key as string) ?? null,
    flags: Array.isArray(row.flags) ? (row.flags as RbMatchFlag[]) : [],
  };
}

// ---------------------------------------------------------------------------
// Transactions and row locks
// ---------------------------------------------------------------------------
//
// Every mutation runs inside withTransaction() on a checked-out client (the
// tagged-template `sql` opens a fresh connection per call and cannot span a
// transaction), takes the locks it depends on BEFORE checking invariants, and
// writes its audit row with the same client so audit and change commit or
// roll back together. Call revalidatePath() only after withTransaction()
// returns.

export async function withTransaction<T>(
  fn: (client: VercelPoolClient) => Promise<T>,
): Promise<T> {
  const client = await sql.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Connection may already be dead; nothing more to do.
    }
    throw e;
  } finally {
    client.release();
  }
}

/** Lock one tournament row. Always the first lock taken. Null if it doesn't exist. */
export async function lockTournament(
  client: VercelPoolClient,
  tournamentId: string,
): Promise<RbTournament | null> {
  const { rows } = await client.query(`SELECT * FROM rb_tournaments WHERE id = $1 FOR UPDATE`, [
    tournamentId,
  ]);
  return rows[0] ? rowToTournament(rows[0]) : null;
}

/** Same, resolving by slug (case-insensitive). */
export async function lockTournamentBySlug(
  client: VercelPoolClient,
  slug: string,
): Promise<RbTournament | null> {
  const { rows } = await client.query(
    `SELECT * FROM rb_tournaments WHERE lower(slug) = lower($1) FOR UPDATE`,
    [slug],
  );
  return rows[0] ? rowToTournament(rows[0]) : null;
}

/**
 * Lock one round. Scoped by tournament so a round id from another tournament
 * is "not found" rather than silently accepted.
 */
export async function lockRound(
  client: VercelPoolClient,
  tournamentId: string,
  roundId: string,
): Promise<RbRound | null> {
  const { rows } = await client.query(
    `SELECT * FROM rb_rounds WHERE tournament_id = $1 AND id = $2 FOR UPDATE`,
    [tournamentId, roundId],
  );
  return rows[0] ? rowToRound(rows[0]) : null;
}

/** Lock every round of a tournament in number order. */
export async function lockRounds(
  client: VercelPoolClient,
  tournamentId: string,
): Promise<RbRound[]> {
  const { rows } = await client.query(
    `SELECT * FROM rb_rounds WHERE tournament_id = $1 ORDER BY number FOR UPDATE`,
    [tournamentId],
  );
  return rows.map(rowToRound);
}

/** Lock one match. Scoped by tournament. */
export async function lockMatch(
  client: VercelPoolClient,
  tournamentId: string,
  matchId: string,
): Promise<RbMatch | null> {
  const { rows } = await client.query(
    `SELECT * FROM rb_matches WHERE tournament_id = $1 AND id = $2 FOR UPDATE`,
    [tournamentId, matchId],
  );
  return rows[0] ? rowToMatch(rows[0]) : null;
}

/** Lock every match of a round in table order (the order that avoids deadlocks). */
export async function lockRoundMatches(
  client: VercelPoolClient,
  tournamentId: string,
  roundId: string,
): Promise<RbMatch[]> {
  const { rows } = await client.query(
    `SELECT * FROM rb_matches WHERE tournament_id = $1 AND round_id = $2
     ORDER BY table_number FOR UPDATE`,
    [tournamentId, roundId],
  );
  return rows.map(rowToMatch);
}

/** Lock every match of a tournament (round number, then table). For close/cut/standings writes. */
export async function lockTournamentMatches(
  client: VercelPoolClient,
  tournamentId: string,
): Promise<RbMatch[]> {
  const { rows } = await client.query(
    `SELECT m.* FROM rb_matches m
     JOIN rb_rounds r ON r.tournament_id = m.tournament_id AND r.id = m.round_id
     WHERE m.tournament_id = $1
     ORDER BY r.number, m.table_number
     FOR UPDATE OF m`,
    [tournamentId],
  );
  return rows.map(rowToMatch);
}

/** Lock every player of a tournament in id order. */
export async function lockPlayers(
  client: VercelPoolClient,
  tournamentId: string,
): Promise<RbPlayer[]> {
  const { rows } = await client.query(
    `SELECT * FROM rb_players WHERE tournament_id = $1 ORDER BY id FOR UPDATE`,
    [tournamentId],
  );
  return rows.map(rowToPlayer);
}

/** Look up a previously stored result by its client idempotency key (inside the transaction). */
export async function findMatchByIdempotencyKey(
  client: VercelPoolClient,
  key: string,
): Promise<RbMatch | null> {
  const { rows } = await client.query(`SELECT * FROM rb_matches WHERE idempotency_key = $1`, [key]);
  return rows[0] ? rowToMatch(rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/** Anything with a parameterised `query`: a pooled client (in a transaction) or the shared pool. */
type Queryable = Pick<VercelPoolClient, "query">;

/**
 * Append an audit row. `actor` is required — there is no anonymous mutation.
 * Pass the transaction's `client` to commit the audit with the change; without
 * it the row is written on its own connection.
 */
export async function writeAudit(
  tournamentId: string,
  action: RbAuditAction,
  detail: Record<string, unknown> | null,
  actor: RbActor,
  client?: Queryable,
): Promise<void> {
  if (!actor || !actor.discordId?.trim() || !actor.name?.trim()) {
    throw new Error("writeAudit requires an actor with a Discord id and a name.");
  }
  const db: Queryable = client ?? sql;
  await db.query(
    `INSERT INTO rb_audit_log (tournament_id, action, detail, actor_discord_id, actor_name, actor_kind)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6)`,
    [tournamentId, action, detail ? JSON.stringify(detail) : null, actor.discordId, actor.name, actor.kind ?? "admin"],
  );
}

/** Newest first. `limit` caps the number of rows (all rows when omitted). */
export async function listAudit(tournamentId: string, limit?: number): Promise<RbAuditLogEntry[]> {
  await ensureSchema();
  const { rows } = await sql.query(
    `SELECT * FROM rb_audit_log WHERE tournament_id = $1 ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    [tournamentId, limit ?? null],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    tournament_id: r.tournament_id as string,
    action: r.action as RbAuditAction,
    detail: (r.detail as Record<string, unknown>) ?? null,
    actor_discord_id: r.actor_discord_id as string,
    actor_name: r.actor_name as string,
    actor_kind: isAuditActorKind(r.actor_kind) ? r.actor_kind : null,
    created_at: iso(r.created_at),
  }));
}

// ---------------------------------------------------------------------------
// Admin reads
// ---------------------------------------------------------------------------

/** Every non-archived tournament, newest first. */
export async function listTournaments(): Promise<RbTournament[]> {
  await ensureSchema();
  const { rows } = await sql.query(
    `SELECT * FROM rb_tournaments WHERE status <> 'archived' ORDER BY created_at DESC`,
  );
  return rows.map(rowToTournament);
}

async function loadFull(tournamentRow: Record<string, unknown>): Promise<RbTournamentFull> {
  const id = tournamentRow.id as string;
  const [playersRes, roundsRes, matchesRes] = await Promise.all([
    sql.query(`SELECT * FROM rb_players WHERE tournament_id = $1 ORDER BY created_at, id`, [id]),
    sql.query(`SELECT * FROM rb_rounds WHERE tournament_id = $1 ORDER BY number`, [id]),
    sql.query(
      `SELECT m.* FROM rb_matches m
       JOIN rb_rounds r ON r.tournament_id = m.tournament_id AND r.id = m.round_id
       WHERE m.tournament_id = $1
       ORDER BY r.number, m.table_number`,
      [id],
    ),
  ]);
  return {
    tournament: rowToTournament(tournamentRow),
    players: playersRes.rows.map(rowToPlayer),
    rounds: roundsRes.rows.map(rowToRound),
    matches: matchesRes.rows.map(rowToMatch),
  };
}

/** Admin view by slug: everything, including Discord ids, flags and reporters. */
export async function getTournamentFull(slug: string): Promise<RbTournamentFull | null> {
  await ensureSchema();
  const { rows } = await sql.query(`SELECT * FROM rb_tournaments WHERE lower(slug) = lower($1)`, [
    slug,
  ]);
  if (rows.length === 0) return null;
  return loadFull(rows[0]);
}

/**
 * Completed (or archived) events that have a champion, newest first, loaded in
 * full. Feeds the Hall of Champions the way SR's completed tournaments do:
 * completeEvent writes status + champion_player_id, and nothing else is stored.
 */
export async function listChampionEvents(): Promise<RbTournamentFull[]> {
  await ensureSchema();
  const { rows } = await sql.query(
    `SELECT * FROM rb_tournaments
     WHERE status IN ('completed', 'archived') AND champion_player_id IS NOT NULL
     ORDER BY updated_at DESC`,
  );
  return Promise.all(rows.map((r) => loadFull(r)));
}

// ---------------------------------------------------------------------------
// Public projection
// ---------------------------------------------------------------------------
//
// These mappers are the ONLY path a row takes to a public page. A column added
// to a table later is not published by default.

export function toPublicTournament(t: RbTournament): RbPublicTournament {
  // Destructure out the private seed rather than listing the public fields,
  // so a new RbPublicConfig field is picked up by the type checker.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { tiebreakSeed, judges, venueTestedAt, ...publicConfig } = t.config;
  return {
    slug: t.slug,
    name: t.name,
    status: t.status,
    config: publicConfig,
    scene: t.scene,
    champion_player_id: t.champion_player_id,
  };
}

export function toPublicPlayer(p: RbPlayer): RbPublicPlayer {
  return {
    id: p.id,
    display_name: p.display_name,
    // A disqualification is a disciplinary outcome, not public information.
    status: p.status === "dq" ? "dropped" : p.status,
    dropped_after_round: p.dropped_after_round,
  };
}

/** Null for a draft round: it must not appear publicly at all. */
export function toPublicRound(r: RbRound): RbPublicRound | null {
  if (r.status === "draft") return null;
  return {
    id: r.id,
    number: r.number,
    stage: r.stage,
    status: r.status,
    started_at: r.started_at,
    paused_at: r.paused_at,
    paused_total_ms: r.paused_total_ms,
    duration_ms: r.duration_ms,
  };
}

export function toPublicMatch(m: RbMatch): RbPublicMatch {
  return {
    id: m.id,
    round_id: m.round_id,
    table_number: m.table_number,
    player_a_id: m.player_a_id,
    player_b_id: m.player_b_id,
    games_a: m.games_a,
    games_b: m.games_b,
    games_drawn: m.games_drawn,
    decided_on_time: m.decided_on_time,
    extension_ms: m.extension_ms,
    started_at: m.started_at,
    status: m.status,
  };
}

/**
 * Public view by slug. A draft tournament returns null exactly as a missing
 * one does. Pairings of a draft (unpublished) round are withheld, matches and
 * all. `archived` is served by direct link, as in sr-db.
 */
export async function getPublicTournament(slug: string): Promise<RbPublicTournamentFull | null> {
  await ensureSchema();
  const { rows } = await sql.query(
    `SELECT * FROM rb_tournaments WHERE lower(slug) = lower($1) AND status = ANY($2::text[])`,
    [slug, RB_PUBLIC_STATUSES],
  );
  if (rows.length === 0) return null;
  const full = await loadFull(rows[0]);

  const rounds: RbPublicRound[] = [];
  const visibleRoundIds = new Set<string>();
  for (const r of full.rounds) {
    const pr = toPublicRound(r);
    if (pr) {
      rounds.push(pr);
      visibleRoundIds.add(r.id);
    }
  }
  return {
    tournament: toPublicTournament(full.tournament),
    players: full.players.map((p) => toPublicPlayer(p)),
    rounds,
    matches: full.matches.filter((m) => visibleRoundIds.has(m.round_id)).map(toPublicMatch),
  };
}

export * from "./rb-clock";

// ---------------------------------------------------------------------------
// Export (games and matches; CSV / JSON)
// ---------------------------------------------------------------------------

/**
 * Guard against spreadsheet formula injection: a player name such as
 * "=HYPERLINK(...)" must not execute when an organiser opens the export.
 */
function csvCell(value: string | number | boolean): string {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv<T extends object>(rows: T[], columns: (keyof T & string)[]): string {
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => csvCell(row[c] as string | number | boolean)).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

const MATCH_COLUMNS: (keyof RbMatchExportRow)[] = [
  "round",
  "stage",
  "table",
  "player_a",
  "player_b",
  "games_a",
  "games_b",
  "games_drawn",
  "decided_on_time",
  "extension_minutes",
  "status",
  "reported_by_id",
  "reported_by_name",
  "reported_at",
  "flags",
];

const GAME_COLUMNS: (keyof RbGameExportRow)[] = [
  "round",
  "stage",
  "table",
  "player",
  "opponent",
  "games_won",
  "games_lost",
  "games_drawn",
  "match_result",
];

/** Pure: build the match rows from an admin view. */
export function buildMatchExportRows(full: RbTournamentFull): RbMatchExportRow[] {
  const names = new Map(full.players.map((p) => [p.id, p.display_name]));
  const rounds = new Map(full.rounds.map((r) => [r.id, r]));
  const rows: RbMatchExportRow[] = [];
  for (const m of full.matches) {
    const round = rounds.get(m.round_id);
    if (!round) continue;
    rows.push({
      round: round.number,
      stage: round.stage,
      table: m.table_number,
      player_a: names.get(m.player_a_id) ?? m.player_a_id,
      player_b: m.player_b_id ? (names.get(m.player_b_id) ?? m.player_b_id) : "",
      games_a: m.games_a,
      games_b: m.games_b,
      games_drawn: m.games_drawn,
      decided_on_time: m.decided_on_time,
      extension_minutes: Math.round((m.extension_ms / 60000) * 100) / 100,
      status: m.status,
      reported_by_id: m.reported_by_id ?? "",
      reported_by_name: m.reported_by_name ?? "",
      reported_at: m.reported_at ?? "",
      flags: m.flags.length ? JSON.stringify(m.flags) : "",
    });
  }
  return rows;
}

/** Pure: per-player rows (two per match, one per bye) from an admin view. */
export function buildGameExportRows(full: RbTournamentFull): RbGameExportRow[] {
  const names = new Map(full.players.map((p) => [p.id, p.display_name]));
  const rounds = new Map(full.rounds.map((r) => [r.id, r]));
  const rows: RbGameExportRow[] = [];
  const result = (
    won: number,
    lost: number,
    status: RbMatch["status"],
  ): RbGameExportRow["match_result"] =>
    status === "pending" ? "pending" : won > lost ? "win" : won < lost ? "loss" : "draw";

  for (const m of full.matches) {
    const round = rounds.get(m.round_id);
    if (!round) continue;
    const a = names.get(m.player_a_id) ?? m.player_a_id;
    if (!m.player_b_id) {
      rows.push({
        round: round.number,
        stage: round.stage,
        table: m.table_number,
        player: a,
        opponent: "",
        games_won: m.games_a,
        games_lost: m.games_b,
        games_drawn: m.games_drawn,
        match_result: "bye",
      });
      continue;
    }
    const b = names.get(m.player_b_id) ?? m.player_b_id;
    rows.push(
      {
        round: round.number,
        stage: round.stage,
        table: m.table_number,
        player: a,
        opponent: b,
        games_won: m.games_a,
        games_lost: m.games_b,
        games_drawn: m.games_drawn,
        match_result: result(m.games_a, m.games_b, m.status),
      },
      {
        round: round.number,
        stage: round.stage,
        table: m.table_number,
        player: b,
        opponent: a,
        games_won: m.games_b,
        games_lost: m.games_a,
        games_drawn: m.games_drawn,
        match_result: result(m.games_b, m.games_a, m.status),
      },
    );
  }
  return rows;
}

export function formatMatchExport(full: RbTournamentFull, format: RbExportFormat): string {
  const rows = buildMatchExportRows(full);
  return format === "csv" ? toCsv(rows, MATCH_COLUMNS) : JSON.stringify(rows, null, 2);
}

export function formatGameExport(full: RbTournamentFull, format: RbExportFormat): string {
  const rows = buildGameExportRows(full);
  return format === "csv" ? toCsv(rows, GAME_COLUMNS) : JSON.stringify(rows, null, 2);
}

/** Admin-only. Callers must check the tools session first and write an `export.download` audit row. */
export async function exportMatches(slug: string, format: RbExportFormat): Promise<string | null> {
  const full = await getTournamentFull(slug);
  return full ? formatMatchExport(full, format) : null;
}

/** Admin-only. See exportMatches. */
export async function exportGames(slug: string, format: RbExportFormat): Promise<string | null> {
  const full = await getTournamentFull(slug);
  return full ? formatGameExport(full, format) : null;
}
