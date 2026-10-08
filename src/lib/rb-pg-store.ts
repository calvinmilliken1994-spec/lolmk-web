import type { VercelPoolClient } from "@vercel/postgres";
import {
  findMatchByIdempotencyKey,
  lockMatch,
  lockPlayers,
  lockRound,
  lockRounds,
  lockTournament,
  lockTournamentMatches,
  writeAudit,
} from "./rb-db";
import type { RbMatchPatch, RbPlayerPatch, RbRoundPatch, RbStore, RbTournamentPatch } from "./rb-service";
import type { RbMatch, RbPlayer, RbRound, RbTournament } from "../types/riftbound";

/**
 * The Postgres implementation of RbStore, bound to one transaction's client.
 * Locks come from rb-db.ts (SELECT ... FOR UPDATE); writes are plain
 * parameterised statements on the same client, so they commit or roll back
 * with the audit row the operation writes.
 */

/** Field -> column, for the columns a patch may set. jsonb columns are cast. */
type ColumnMap = Record<string, { column: string; json?: boolean }>;

const TOURNAMENT_COLUMNS: ColumnMap = {
  name: { column: "name" },
  status: { column: "status" },
  config: { column: "config", json: true },
  scene: { column: "scene" },
  auto_follow: { column: "auto_follow" },
  auto_follow_paused: { column: "auto_follow_paused" },
  champion_player_id: { column: "champion_player_id" },
};
const PLAYER_COLUMNS: ColumnMap = {
  display_name: { column: "display_name" },
  member_discord_id: { column: "member_discord_id" },
  legend: { column: "legend" },
  status: { column: "status" },
  dropped_after_round: { column: "dropped_after_round" },
};
const ROUND_COLUMNS: ColumnMap = {
  status: { column: "status" },
  started_at: { column: "started_at" },
  paused_at: { column: "paused_at" },
  paused_total_ms: { column: "paused_total_ms" },
  duration_ms: { column: "duration_ms" },
};
const MATCH_COLUMNS: ColumnMap = {
  table_number: { column: "table_number" },
  player_a_id: { column: "player_a" },
  player_b_id: { column: "player_b" },
  games_a: { column: "games_a" },
  games_b: { column: "games_b" },
  games_drawn: { column: "games_drawn" },
  decided_on_time: { column: "decided_on_time" },
  extension_ms: { column: "extension_ms" },
  started_at: { column: "started_at" },
  status: { column: "status" },
  reported_by_id: { column: "reported_by_id" },
  reported_by_name: { column: "reported_by_name" },
  reported_at: { column: "reported_at" },
  idempotency_key: { column: "idempotency_key" },
  flags: { column: "flags", json: true },
};

/** Build `SET a = $n, ...` for the defined keys of `patch`. Unknown keys are an error. */
function setClause(patch: object, columns: ColumnMap, firstParam: number): { sql: string; values: unknown[] } {
  const parts: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const col = columns[key];
    if (!col) throw new Error(`rb-pg-store: ${key} is not an updatable column.`);
    values.push(col.json ? JSON.stringify(value) : value);
    parts.push(`${col.column} = $${firstParam + values.length - 1}${col.json ? "::jsonb" : ""}`);
  }
  return { sql: parts.join(", "), values };
}

export function createPgStore(client: VercelPoolClient): RbStore {
  const update = async (
    table: string,
    columns: ColumnMap,
    patch: object,
    tournamentId: string,
    id: string,
  ) => {
    const { sql, values } = setClause(patch, columns, 3);
    if (!sql) return;
    await client.query(`UPDATE ${table} SET ${sql} WHERE tournament_id = $1 AND id = $2`, [
      tournamentId,
      id,
      ...values,
    ]);
  };

  return {
    async findMatchRef(matchId) {
      const { rows } = await client.query(`SELECT tournament_id, round_id FROM rb_matches WHERE id = $1`, [matchId]);
      return rows[0] ? { tournamentId: rows[0].tournament_id as string, roundId: rows[0].round_id as string } : null;
    },
    async findRoundTournamentId(roundId) {
      const { rows } = await client.query(`SELECT tournament_id FROM rb_rounds WHERE id = $1`, [roundId]);
      return (rows[0]?.tournament_id as string) ?? null;
    },
    async findPlayerTournamentId(playerId) {
      const { rows } = await client.query(`SELECT tournament_id FROM rb_players WHERE id = $1`, [playerId]);
      return (rows[0]?.tournament_id as string) ?? null;
    },
    async slugTaken(slug) {
      const { rows } = await client.query(`SELECT 1 FROM rb_tournaments WHERE lower(slug) = lower($1)`, [slug]);
      return rows.length > 0;
    },

    lockTournament: (id) => lockTournament(client, id),
    lockRounds: (tid) => lockRounds(client, tid),
    lockRound: (tid, rid) => lockRound(client, tid, rid),
    lockTournamentMatches: (tid) => lockTournamentMatches(client, tid),
    lockMatch: (tid, mid) => lockMatch(client, tid, mid),
    lockPlayers: (tid) => lockPlayers(client, tid),
    findMatchByIdempotencyKey: (key) => findMatchByIdempotencyKey(client, key),

    async insertTournament(t: RbTournament) {
      await client.query(
        `INSERT INTO rb_tournaments
           (id, slug, name, status, config, scene, auto_follow, auto_follow_paused, champion_player_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11)`,
        [
          t.id,
          t.slug,
          t.name,
          t.status,
          JSON.stringify(t.config),
          t.scene,
          t.auto_follow,
          t.auto_follow_paused,
          t.champion_player_id,
          t.created_at,
          t.updated_at,
        ],
      );
    },
    async updateTournament(tournamentId, patch: RbTournamentPatch) {
      const { sql, values } = setClause(patch, TOURNAMENT_COLUMNS, 2);
      if (!sql) return;
      await client.query(`UPDATE rb_tournaments SET ${sql}, updated_at = now() WHERE id = $1`, [
        tournamentId,
        ...values,
      ]);
    },

    async insertPlayer(p: RbPlayer) {
      await client.query(
        `INSERT INTO rb_players
           (id, tournament_id, display_name, member_discord_id, legend, status, dropped_after_round, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [p.id, p.tournament_id, p.display_name, p.member_discord_id, p.legend, p.status, p.dropped_after_round, p.created_at],
      );
    },
    updatePlayer: (tid, id, patch: RbPlayerPatch) => update("rb_players", PLAYER_COLUMNS, patch, tid, id),
    async deletePlayer(tid, id) {
      await client.query(`DELETE FROM rb_players WHERE tournament_id = $1 AND id = $2`, [tid, id]);
    },

    async insertRound(r: RbRound) {
      await client.query(
        `INSERT INTO rb_rounds
           (id, tournament_id, number, stage, status, started_at, paused_at, paused_total_ms, duration_ms, pairing_seed, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          r.id,
          r.tournament_id,
          r.number,
          r.stage,
          r.status,
          r.started_at,
          r.paused_at,
          r.paused_total_ms,
          r.duration_ms,
          r.pairing_seed,
          r.created_at,
        ],
      );
    },
    updateRound: (tid, id, patch: RbRoundPatch) => update("rb_rounds", ROUND_COLUMNS, patch, tid, id),
    async deleteRound(tid, id) {
      await client.query(`DELETE FROM rb_rounds WHERE tournament_id = $1 AND id = $2`, [tid, id]);
    },

    async insertMatch(m: RbMatch) {
      await client.query(
        `INSERT INTO rb_matches
           (id, tournament_id, round_id, table_number, player_a, player_b, games_a, games_b, games_drawn,
            decided_on_time, extension_ms, started_at, status, reported_by_id, reported_by_name, reported_at,
            idempotency_key, flags)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb)`,
        [
          m.id,
          m.tournament_id,
          m.round_id,
          m.table_number,
          m.player_a_id,
          m.player_b_id,
          m.games_a,
          m.games_b,
          m.games_drawn,
          m.decided_on_time,
          m.extension_ms,
          m.started_at,
          m.status,
          m.reported_by_id,
          m.reported_by_name,
          m.reported_at,
          m.idempotency_key,
          JSON.stringify(m.flags),
        ],
      );
    },
    updateMatch: (tid, id, patch: RbMatchPatch) => update("rb_matches", MATCH_COLUMNS, patch, tid, id),
    async deleteRoundMatches(tid, roundId) {
      await client.query(`DELETE FROM rb_matches WHERE tournament_id = $1 AND round_id = $2`, [tid, roundId]);
    },

    writeAudit: (tid, action, detail, actor) => writeAudit(tid, action, detail, actor, client),
  };
}
