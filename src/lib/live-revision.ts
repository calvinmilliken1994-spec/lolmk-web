import "server-only";
import { sql } from "@vercel/postgres";
import { RB_PUBLIC_STATUSES } from "@/types/riftbound";

/**
 * Change detection for the polled tournament screens.
 *
 * The desks, floor views and venue screens used to download the full state
 * every 1.5 to 2 seconds whether anything had changed or not, and Neon meters
 * every byte. A revision is an md5 over every row that makes up a
 * tournament's state, computed inside Postgres, so a poll costs one 32-char
 * string. Clients poll the revision and fetch the full state only when it
 * changes.
 *
 * Hashing the rows, rather than bumping a counter on writes, catches every
 * write path: `/tools` actions, captain flows, the floor view, migrations and
 * hand-run SQL. `row::text` includes every column, so any change to any row,
 * plus any insert or delete, changes the hash.
 *
 * Public revisions cover only the tables behind the public projection, with
 * the same visibility rules as the matching state route, so they don't
 * reveal drafts or tell anyone when an admin touched private rows. Admin
 * revisions also cover the audit log and team applications.
 *
 * Every function returns null when the tournament doesn't exist or isn't
 * visible in that mode.
 */

/** Append-only tables: count plus newest id is enough and avoids hashing every row. */
const AUDIT = (table: string, fk: string, alias = "a") =>
  `(SELECT count(*)::text || ':' || coalesce(max(${alias}.id::text), '') FROM ${table} ${alias} WHERE ${alias}.${fk} = t.id)`;

const ROWS = (table: string, fk: string, alias: string) =>
  `(SELECT string_agg(${alias}::text, '|' ORDER BY ${alias}.id) FROM ${table} ${alias} WHERE ${alias}.${fk} = t.id)`;

async function one(query: string, params: unknown[]): Promise<string | null> {
  const { rows } = await sql.query(query, params);
  return (rows[0]?.rev as string | undefined) ?? null;
}

/** Riftbound, by slug (case-insensitive). Public mode matches /api/rb/state. */
export function rbRevision(slug: string, admin: boolean): Promise<string | null> {
  return one(
    `SELECT md5(concat_ws('#',
        t::text,
        ${ROWS("rb_players", "tournament_id", "p")},
        ${ROWS("rb_rounds", "tournament_id", "r")},
        ${ROWS("rb_matches", "tournament_id", "m")},
        CASE WHEN $2 THEN ${AUDIT("rb_audit_log", "tournament_id")} END
      )) AS rev
     FROM rb_tournaments t
     WHERE lower(t.slug) = lower($1) AND ($2 OR t.status = ANY($3::text[]))`,
    [slug, admin, RB_PUBLIC_STATUSES],
  );
}

/**
 * Summoner's Rift. Public mode looks up by slug with the venue screen's
 * visibility (test tournaments included, as /api/sr/state does); admin mode
 * looks up by tournament id, as /api/sr/admin-state does.
 */
export function srRevision(key: { slug: string } | { id: string }, admin: boolean): Promise<string | null> {
  const bySlug = "slug" in key;
  return one(
    `SELECT md5(concat_ws('#',
        t::text,
        ${ROWS("sr_teams", "tournament_id", "tm")},
        ${ROWS("sr_team_players", "tournament_id", "tp")},
        ${ROWS("sr_matches", "tournament_id", "m")},
        CASE WHEN $2 THEN concat_ws('#',
          ${ROWS("sr_team_applications", "tournament_id", "ap")},
          (SELECT string_agg(s::text, '|' ORDER BY s.id) FROM sr_team_application_slots s
             JOIN sr_team_applications ap2 ON ap2.id = s.application_id WHERE ap2.tournament_id = t.id),
          ${AUDIT("sr_audit_log", "tournament_id")}
        ) END
      )) AS rev
     FROM sr_tournaments t
     WHERE ${bySlug ? "lower(t.slug) = lower($1)" : "t.id = $1"}
       AND ($2 OR (
         t.status IN ('seeding','bracket_published','in_progress','completed')
         OR (t.status = 'archived' AND t.champion_team_id IS NOT NULL)
       ))`,
    [bySlug ? key.slug : key.id, admin],
  );
}

/**
 * ARAM Mayhem, by event id. Public mode matches /api/mayhem/state (published
 * and not archived); admin mode, also used by the admin preview, sees every
 * event.
 */
export function mayhemRevision(eventId: string, admin: boolean): Promise<string | null> {
  return one(
    `SELECT md5(concat_ws('#',
        t::text,
        ${ROWS("mayhem_groups", "event_id", "g")},
        ${ROWS("mayhem_teams", "event_id", "tm")},
        ${ROWS("mayhem_players", "event_id", "p")},
        ${ROWS("mayhem_matches", "event_id", "m")},
        CASE WHEN $2 THEN concat_ws('#',
          ${ROWS("mayhem_team_applications", "event_id", "ap")},
          (SELECT string_agg(s::text, '|' ORDER BY s.id) FROM mayhem_team_application_slots s
             JOIN mayhem_team_applications ap2 ON ap2.id = s.application_id WHERE ap2.event_id = t.id),
          ${AUDIT("mayhem_audit_log", "event_id")}
        ) END
      )) AS rev
     FROM mayhem_events t
     WHERE t.id = $1 AND ($2 OR (t.published = true AND t.archived_at IS NULL))`,
    [eventId, admin],
  );
}
