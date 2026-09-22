import { sql, type VercelPoolClient } from "@vercel/postgres";
import { randomUUID } from "node:crypto";
import type {
  SrApplicationSlotStatus,
  SrAuditAction,
  SrAuditLogEntry,
  SrDeliveryStatus,
  SrMatch,
  SrMatchScene,
  SrTeam,
  SrTeamApplication,
  SrTeamApplicationSlot,
  SrTeamApplicationView,
  SrTeamPlayer,
  SrTournament,
  SrTournamentFull,
  SrTournamentStatus,
  SrPublicMatch,
  SrPublicPlayer,
  SrPublicTeam,
  SrPublicTournament,
  SrPublicTournamentFull,
} from "../types/sr-tournament";
import {
  SR_MAX_TEAMS,
  SR_MIN_TEAMS,
  SR_PUBLIC_LISTED_STATUSES,
} from "../types/sr-tournament";

/**
 * Summoner's Rift tournament persistence layer (Vercel Postgres).
 *
 * Unlike ARAM Mayhem's singleton-event model (one live event at a time),
 * this is a real multi-row table: many tournaments exist over time, each
 * running its own bracket over a configurable window. `ensureSchema()`
 * follows the same lazy `CREATE TABLE IF NOT EXISTS` pattern as
 * mayhem-db.ts — cheap, idempotent, safe on every cold start.
 *
 * IMPORTANT: `CREATE TABLE IF NOT EXISTS` is schema *creation*, not schema
 * *migration*. If these tables' shape ever needs to change after teams have
 * real data in them, this pattern cannot express an ALTER safely — that
 * would need a real migration tool. Flagging this now rather than pretending
 * it doesn't matter; it's the same gap ARAM Mayhem already has.
 *
 * Cross-tournament reference safety: sr_matches.team_a_id/team_b_id/winner_id
 * are constrained via composite foreign keys against
 * `sr_teams(tournament_id, id)` (a team can only be referenced by a match in
 * the SAME tournament), not a plain `REFERENCES sr_teams(id)` — a bare FK
 * would let a match in tournament A point at a team that belongs to
 * tournament B, which is a real data-integrity hole for a multi-tournament
 * table (ARAM Mayhem never had to worry about this since it only ever has
 * one event).
 */

let schemaReady: Promise<void> | null = null;

/** Serialize runtime compatibility migrations across serverless instances. */
async function withSchemaMigrationLock(
  fn: (client: VercelPoolClient) => Promise<void>,
): Promise<void> {
  const client = await sql.connect();
  try {
    await client.sql`BEGIN`;
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('lolmk:sr-schema-v2'))`);
    await fn(client);
    await client.sql`COMMIT`;
  } catch (error) {
    try {
      await client.sql`ROLLBACK`;
    } catch {
      // Preserve the original migration failure.
    }
    throw error;
  } finally {
    client.release();
  }
}

export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      // Table bounds are compile-time constants inlined directly as SQL
      // literals (not bind parameters). Postgres's extended query protocol
      // parses DDL as taking 0 parameters regardless of ${...}
      // interpolations inside DEFAULT/CHECK clauses — @vercel/postgres
      // still sends them as bound values, producing "bind message supplies
      // N parameters, but prepared statement requires 0". This bit ARAM
      // Mayhem too (its bracket/format values are all inline literals for
      // the same reason) — DDL and bind parameters don't mix here.
      const MIN_TEAMS = SR_MIN_TEAMS;
      const MAX_TEAMS = SR_MAX_TEAMS;
      await sql.query(`
        CREATE TABLE IF NOT EXISTS sr_tournaments (
          id text PRIMARY KEY,
          slug text NOT NULL,
          name text NOT NULL,
          status text NOT NULL DEFAULT 'draft',
          format text NOT NULL DEFAULT 'single_elim',
          best_of integer NOT NULL DEFAULT 1,
          third_place_match boolean NOT NULL DEFAULT false,
          grand_final_reset boolean NOT NULL DEFAULT true,
          grand_final_best_of integer,
          ubr1_reveal_started_at timestamptz,
          ubr1_reveal_run_id text,
          min_teams integer NOT NULL DEFAULT ${MIN_TEAMS},
          max_teams integer NOT NULL DEFAULT ${MAX_TEAMS},
          start_at timestamptz,
          end_at timestamptz,
          seed_locked boolean NOT NULL DEFAULT false,
          champion_team_id text,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT sr_tournaments_status_check
            CHECK (status IN ('draft','seeding','bracket_published','in_progress','completed','archived')),
          CONSTRAINT sr_tournaments_format_check
            CHECK (format IN ('single_elim','double_elim')),
          CONSTRAINT sr_tournaments_best_of_check
            CHECK (best_of IN (1, 3, 5)),
          CONSTRAINT sr_tournaments_grand_final_best_of_check
            CHECK (grand_final_best_of IS NULL OR grand_final_best_of IN (1, 3, 5)),
          CONSTRAINT sr_tournaments_team_bounds_check
            CHECK (min_teams >= ${MIN_TEAMS} AND max_teams <= ${MAX_TEAMS} AND min_teams <= max_teams),
          CONSTRAINT sr_tournaments_dates_check
            CHECK (start_at IS NULL OR end_at IS NULL OR start_at <= end_at),
          CONSTRAINT sr_tournaments_name_nonblank_check
            CHECK (trim(name) <> ''),
          CONSTRAINT sr_tournaments_slug_nonblank_check
            CHECK (trim(slug) <> ''),
          -- A completed tournament must have a champion recorded; an
          -- incomplete one must not (prevents a half-written completion).
          CONSTRAINT sr_tournaments_completed_has_champion_check
            CHECK (status <> 'completed' OR champion_team_id IS NOT NULL),
          -- Enables the composite FK from sr_matches AND the future
          -- champion_team_id -> sr_teams same-tournament FK added below.
          CONSTRAINT sr_tournaments_id_unique UNIQUE (id)
        );
      `);
      // Case-insensitive slug/name uniqueness. Expression indexes, not table
      // constraints, since Postgres CHECK constraints can't express
      // cross-row uniqueness.
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS sr_tournaments_slug_unique
          ON sr_tournaments (lower(slug));
      `;

      await sql.query(`
        CREATE TABLE IF NOT EXISTS sr_teams (
          id text PRIMARY KEY,
          tournament_id text NOT NULL REFERENCES sr_tournaments(id) ON DELETE CASCADE,
          name text NOT NULL,
          logo_url text,
          seed integer,
          created_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT sr_teams_seed_bounds_check
            CHECK (seed IS NULL OR (seed >= 1 AND seed <= ${MAX_TEAMS})),
          CONSTRAINT sr_teams_name_nonblank_check
            CHECK (trim(name) <> ''),
          -- Lets sr_matches reference (tournament_id, id) as a composite FK,
          -- so a match can only point at a team from its own tournament.
          CONSTRAINT sr_teams_tournament_id_unique UNIQUE (tournament_id, id)
        );
      `);
      // Case-insensitive team-name uniqueness per tournament (the doc
      // comment previously claimed this without the schema actually
      // enforcing it — this expression index is what makes it true).
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS sr_teams_name_unique
          ON sr_teams (tournament_id, lower(name));
      `;
      // Partial unique index: seed uniqueness only applies once a team has
      // been assigned a seed (NULL != NULL in Postgres, so pre-seed rows
      // never collide with each other — this only guards against two teams
      // in the same tournament ending up with the same real seed number).
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS sr_teams_seed_unique
          ON sr_teams (tournament_id, seed) WHERE seed IS NOT NULL;
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS sr_matches (
          id text PRIMARY KEY,
          tournament_id text NOT NULL REFERENCES sr_tournaments(id) ON DELETE CASCADE,
          bracket text NOT NULL,
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
          drops_to_slot text,
          CONSTRAINT sr_matches_bracket_check
            CHECK (bracket IN ('upper','lower','grand_final','third_place')),
          CONSTRAINT sr_matches_status_check
            CHECK (status IN ('pending','scheduled','in_progress','completed','bye')),
          CONSTRAINT sr_matches_best_of_check
            CHECK (best_of IN (1, 3, 5)),
          CONSTRAINT sr_matches_scores_nonneg_check
            CHECK (team_a_score >= 0 AND team_b_score >= 0),
          CONSTRAINT sr_matches_slot_check
            CHECK (advances_to_slot IS NULL OR advances_to_slot IN ('a','b')),
          CONSTRAINT sr_matches_drop_slot_check
            CHECK (drops_to_slot IS NULL OR drops_to_slot IN ('a','b')),
          -- A slot value only makes sense alongside its target id, and vice
          -- versa: both null (no link) or both set (a real link) — never one
          -- without the other.
          CONSTRAINT sr_matches_advances_pair_check
            CHECK ((advances_to_match_id IS NULL) = (advances_to_slot IS NULL)),
          CONSTRAINT sr_matches_drops_pair_check
            CHECK ((drops_to_match_id IS NULL) = (drops_to_slot IS NULL)),
          -- Winner, when set, must be one of the two participants.
          CONSTRAINT sr_matches_winner_is_participant_check
            CHECK (winner_id IS NULL OR winner_id = team_a_id OR winner_id = team_b_id),
          -- The two participants, when both present, must be different
          -- teams (a team can't play itself).
          CONSTRAINT sr_matches_distinct_participants_check
            CHECK (team_a_id IS NULL OR team_b_id IS NULL OR team_a_id <> team_b_id),
          -- A "completed" match must have a winner. A "bye" may legitimately
          -- have NO winner (the "fully dead" case in resolveByes(), where
          -- both slots were permanently unreachable and nothing was ever
          -- played) — so byes are deliberately excluded from this check.
          CONSTRAINT sr_matches_completed_has_winner_check
            CHECK (status <> 'completed' OR winner_id IS NOT NULL),
          CONSTRAINT sr_matches_number_unique UNIQUE (tournament_id, match_number),
          -- Lets advances_to_match_id/drops_to_match_id self-reference
          -- (tournament_id, id) below.
          CONSTRAINT sr_matches_tournament_id_unique UNIQUE (tournament_id, id),
          -- Composite FKs: a match's participants/winner must be teams that
          -- belong to THIS match's own tournament — not a bare
          -- REFERENCES sr_teams(id), which would allow cross-tournament
          -- team references. RESTRICT, not SET NULL: a composite ON DELETE
          -- SET NULL nulls BOTH columns, including tournament_id (NOT
          -- NULL) -- that fails loudly instead of clearing the reference.
          -- Once a team is seeded into a bracket, deleting it must be
          -- blocked (or done via an explicit, transactional bracket reset
          -- that clears matches first) rather than silently vanishing.
          CONSTRAINT sr_matches_team_a_fkey
            FOREIGN KEY (tournament_id, team_a_id) REFERENCES sr_teams (tournament_id, id) ON DELETE RESTRICT,
          CONSTRAINT sr_matches_team_b_fkey
            FOREIGN KEY (tournament_id, team_b_id) REFERENCES sr_teams (tournament_id, id) ON DELETE RESTRICT,
          CONSTRAINT sr_matches_winner_fkey
            FOREIGN KEY (tournament_id, winner_id) REFERENCES sr_teams (tournament_id, id) ON DELETE RESTRICT,
          -- Self-referencing links stay in the same tournament. NO ACTION is
          -- intentional: composite SET NULL would also try to null the
          -- NOT NULL tournament_id, and clearing only the id would violate
          -- the paired id/slot check. Bracket rows are deleted as a set.
          CONSTRAINT sr_matches_advances_to_fkey
            FOREIGN KEY (tournament_id, advances_to_match_id) REFERENCES sr_matches (tournament_id, id)
            ON DELETE NO ACTION,
          CONSTRAINT sr_matches_drops_to_fkey
            FOREIGN KEY (tournament_id, drops_to_match_id) REFERENCES sr_matches (tournament_id, id)
            ON DELETE NO ACTION
        );
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS sr_audit_log (
          id bigserial PRIMARY KEY,
          tournament_id text NOT NULL REFERENCES sr_tournaments(id) ON DELETE CASCADE,
          action text NOT NULL,
          detail jsonb,
          created_at timestamptz NOT NULL DEFAULT now()
        );
      `;
      await sql`CREATE INDEX IF NOT EXISTS sr_tournaments_status_idx ON sr_tournaments(status);`;
      await sql`CREATE INDEX IF NOT EXISTS sr_teams_tournament_idx ON sr_teams(tournament_id);`;
      await sql`CREATE INDEX IF NOT EXISTS sr_matches_tournament_idx ON sr_matches(tournament_id);`;
      await sql`CREATE INDEX IF NOT EXISTS sr_matches_status_idx ON sr_matches(tournament_id, status);`;
      await sql`CREATE INDEX IF NOT EXISTS sr_audit_log_tournament_idx ON sr_audit_log(tournament_id);`;

      // ---------------------------------------------------------------
      // Captain self-service additions (see src/app/captain/*)
      // ---------------------------------------------------------------
      //
      // These are ALTERs on tables the block above may already have created
      // with real rows in them, which is exactly the case the file-level
      // comment warns `CREATE TABLE IF NOT EXISTS` cannot express. They are
      // safe here because every one of them is additive and nullable-or-
      // defaulted: no existing row needs rewriting and no existing query
      // needs to change. `ADD COLUMN IF NOT EXISTS` is natively idempotent
      // (Postgres 9.6+), so this runs harmlessly on every cold start, the
      // same way the CREATEs above do. Anything requiring a backfill or a
      // type change would still need a real migration tool.

      // Which tournaments are accepting captain-submitted teams. A boolean
      // FLAG rather than a new status value, deliberately: `status` is a
      // linear lifecycle (draft → seeding → bracket_published → ...) that
      // actions.ts gates every transition on and a CHECK constraint
      // enumerates. Inserting a `signups_open` status into that sequence
      // would mean revisiting every one of those gates and the public
      // status list, and it would make "open for signups" mutually
      // exclusive with "draft" — which it isn't; an admin is still setting
      // the tournament up while captains register. An orthogonal flag says
      // the orthogonal thing.
      await sql`
        ALTER TABLE sr_tournaments ADD COLUMN IF NOT EXISTS signups_open boolean NOT NULL DEFAULT false
      `;

      // The Discord user id of the captain who owns this team. NULL means an
      // admin created the team directly (the task-1 flow) and no captain can
      // edit it. This column is the ONLY thing that scopes captain ownership
      // — every captain mutation matches on it.
      await sql`ALTER TABLE sr_teams ADD COLUMN IF NOT EXISTS captain_discord_id text`;
      await sql`
        ALTER TABLE sr_teams ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved'
      `;
      // One team per captain per tournament. Partial (WHERE NOT NULL) so the
      // admin-created teams, which all have a NULL captain, never collide.
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS sr_teams_captain_unique
          ON sr_teams (tournament_id, captain_discord_id) WHERE captain_discord_id IS NOT NULL;
      `;

      // Roster. tournament_id is carried denormalised alongside team_id so a
      // player row can be constrained to the same tournament as its team via
      // the composite FK (the same cross-tournament-reference protection
      // sr_matches gets), and so "everyone in tournament X" is one index hit.
      //
      // Ranks are SELF-REPORTED. current_rank/peak_rank are free-ish text
      // validated against a fixed list in the write layer, not proof of
      // anything — the UI labels them unverified wherever they appear. See
      // src/lib/riot.ts for the optional lookup that can corroborate an IGN's
      // current rank; even that is not proof the Discord account owns it.
      await sql`
        CREATE TABLE IF NOT EXISTS sr_team_players (
          id text PRIMARY KEY,
          team_id text NOT NULL,
          tournament_id text NOT NULL REFERENCES sr_tournaments(id) ON DELETE CASCADE,
          discord_id text NOT NULL,
          ign text NOT NULL,
          role text NOT NULL DEFAULT 'FILL',
          current_rank text,
          peak_rank text,
          rank_verified_at timestamptz,
          is_captain boolean NOT NULL DEFAULT false,
          is_substitute boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT sr_team_players_role_check
            CHECK (role IN ('TOP','JUNGLE','MID','ADC','SUPPORT','FILL')),
          CONSTRAINT sr_team_players_ign_nonblank_check CHECK (trim(ign) <> ''),
          CONSTRAINT sr_team_players_discord_nonblank_check CHECK (trim(discord_id) <> ''),
          CONSTRAINT sr_team_players_team_fkey
            FOREIGN KEY (tournament_id, team_id) REFERENCES sr_teams (tournament_id, id) ON DELETE CASCADE
        );
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS sr_team_players_team_idx ON sr_team_players(team_id);
      `;
      await sql`ALTER TABLE sr_team_players ADD COLUMN IF NOT EXISTS reservation_active boolean NOT NULL DEFAULT true`;
      // Rejected teams release their Discord-account reservations without
      // deleting roster/history rows. Backfill keeps existing databases aligned.
      await sql`
        UPDATE sr_team_players p
        SET reservation_active = (t.status <> 'rejected')
        FROM sr_teams t
        WHERE t.id = p.team_id AND p.reservation_active IS DISTINCT FROM (t.status <> 'rejected');
      `;
      await sql`DROP INDEX IF EXISTS sr_team_players_one_team_per_tournament`;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS sr_team_players_active_team_per_tournament
          ON sr_team_players (tournament_id, discord_id) WHERE reservation_active;
      `;

      // ---------------------------------------------------------------
      // Verified premade signup — team applications
      // ---------------------------------------------------------------
      //
      // An application is NOT a team. It holds a captain's intent plus five
      // slots, and only becomes an sr_teams row once every slot's own Discord
      // account has confirmed (see confirmApplicationSlot in
      // src/app/captain/actions.ts). Nothing in the bracket, seeding or public
      // projection layers can see these rows, which is what structurally
      // guarantees a half-confirmed application can never be played.
      //
      // tournament_id is the scoping column everywhere: unlike ARAM Mayhem's
      // singleton event, SR runs many tournaments at once and every query
      // against these tables carries an explicit tournament predicate.
      await sql`
        CREATE TABLE IF NOT EXISTS sr_team_applications (
          id text PRIMARY KEY,
          tournament_id text NOT NULL REFERENCES sr_tournaments(id) ON DELETE CASCADE,
          team_name text NOT NULL,
          captain_discord_id text NOT NULL,
          roster_version integer NOT NULL DEFAULT 0,
          send_in_progress boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT sr_team_applications_name_nonblank_check CHECK (trim(team_name) <> ''),
          CONSTRAINT sr_team_applications_captain_nonblank_check CHECK (trim(captain_discord_id) <> '')
        );
      `;
      // One open application per captain per tournament — the application-side
      // mirror of sr_teams_captain_unique.
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS sr_team_applications_captain_unique
          ON sr_team_applications (tournament_id, captain_discord_id);
      `;
      // Case-insensitive name uniqueness WITHIN applications. Note this index
      // cannot see sr_teams, so it is only half the rule: the write path also
      // runs an explicit UNION check against sr_teams.name, because a name
      // must not collide with an already-registered team either and no single
      // index can span two tables.
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS sr_team_applications_name_unique
          ON sr_team_applications (tournament_id, lower(team_name));
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS sr_team_applications_tournament_idx
          ON sr_team_applications (tournament_id);
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS sr_team_application_slots (
          id text PRIMARY KEY,
          application_id text NOT NULL REFERENCES sr_team_applications(id) ON DELETE CASCADE,
          member_discord_id text,
          display_name text,
          avatar_url text,
          status text NOT NULL DEFAULT 'draft',
          is_captain boolean NOT NULL DEFAULT false,
          -- Only ever the SHA-256 of the token that went out in the DM. The
          -- raw token exists in exactly one place: that Discord message.
          confirm_token_hash text,
          confirm_token_expires_at timestamptz,
          delivery_status text NOT NULL DEFAULT 'not_sent',
          delivery_error text,
          token_roster_version integer,
          updated_at timestamptz NOT NULL DEFAULT now(),
          created_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT sr_application_slots_status_check
            CHECK (status IN ('draft','pending','confirmed','declined')),
          CONSTRAINT sr_application_slots_delivery_check
            CHECK (delivery_status IN ('not_sent','sending','sent','failed'))
        );
      `;
      // One slot per person per application. The stronger "one
      // pending-or-confirmed slot across ALL applications in this tournament"
      // rule can't be expressed as an index across two tables either, so it
      // lives in isDiscordIdReserved() under the per-tournament row lock —
      // the lock, not the index, is what closes the race.
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS sr_application_slots_member_unique
          ON sr_team_application_slots (application_id, member_discord_id)
          WHERE member_discord_id IS NOT NULL;
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS sr_application_slots_application_idx
          ON sr_team_application_slots (application_id);
      `;

      // ---------------------------------------------------------------
      // Presentation / scene state (per tournament)
      // ---------------------------------------------------------------
      //
      // Same additive ALTER pattern as the captain columns above, and for the
      // same reason: sr_tournaments already has real rows, so this must be
      // ADD COLUMN IF NOT EXISTS with a default, never a CREATE TABLE. An
      // existing tournament comes back as scene='idle', countdown_ends_at
      // NULL, active_match_id NULL — i.e. exactly the state it would have had
      // if it had been created after this migration and nobody had touched
      // the presentation desk yet.
      await sql`
        ALTER TABLE sr_tournaments ADD COLUMN IF NOT EXISTS scene text NOT NULL DEFAULT 'idle'
      `;
      await sql`ALTER TABLE sr_tournaments ADD COLUMN IF NOT EXISTS countdown_ends_at timestamptz`;
      await sql`ALTER TABLE sr_tournaments ADD COLUMN IF NOT EXISTS active_match_id text`;

      // Upper-bracket Round 1 staged reveal. Persisted (not client-only
      // React state) so it survives a live-screen refresh/reconnect and so
      // two admins on different tabs see the same reveal progress. `revealed_count`
      // is the number of UBR1 matchups currently shown, in match_number order;
      // it never exceeds the real UBR1 match count. `generation` is bumped
      // every time the bracket is (re)generated so a reveal from a previous
      // bracket can never be misread as progress on a new one.
      await sql`
        ALTER TABLE sr_tournaments ADD COLUMN IF NOT EXISTS ubr1_revealed_count integer NOT NULL DEFAULT 0
      `;
      await sql`
        ALTER TABLE sr_tournaments ADD COLUMN IF NOT EXISTS ubr1_reveal_generation integer NOT NULL DEFAULT 0
      `;
      // Grand-final series-length override, added after the initial column
      // set above — existing databases need this ALTER since CREATE TABLE
      // IF NOT EXISTS is a no-op once the table already exists.
      await sql`
        ALTER TABLE sr_tournaments ADD COLUMN IF NOT EXISTS grand_final_best_of integer
      `;
      // Reveal-run identity: `ubr1_reveal_started_at` is the server
      // timestamp Start was clicked, and the live screen derives how many
      // rows are visible purely from elapsed time against it — never from
      // ubr1_revealed_count, which existed for the old manual-Advance flow
      // and is kept only for the audit trail / admin progress readout.
      // `ubr1_reveal_run_id` changes on every Start/Restart so a client that
      // was mid-animation for a previous run can tell the run changed and
      // restart its own local sequence instead of misreading stale timing.
      await sql`
        ALTER TABLE sr_tournaments ADD COLUMN IF NOT EXISTS ubr1_reveal_started_at timestamptz
      `;
      await sql`
        ALTER TABLE sr_tournaments ADD COLUMN IF NOT EXISTS ubr1_reveal_run_id text
      `;

      // Compatibility migrations for databases created by earlier releases.
      // The advisory transaction lock removes the check-then-ALTER race across
      // concurrent cold starts, and every catalog lookup is scoped to the
      // exact relation instead of assuming constraint names are database-wide.
      await withSchemaMigrationLock(async (client) => {
        const constraintDefinition = async (table: string, name: string) => {
          const { rows } = await client.query(
            `SELECT pg_get_constraintdef(c.oid) AS definition
             FROM pg_constraint c
             WHERE c.conrelid = $1::regclass AND c.conname = $2`,
            [table, name],
          );
          return rows[0]?.definition as string | undefined;
        };

        if (!(await constraintDefinition("sr_tournaments", "sr_tournaments_champion_same_tournament_fkey"))) {
          await client.query(`
            ALTER TABLE sr_tournaments
              ADD CONSTRAINT sr_tournaments_champion_same_tournament_fkey
              FOREIGN KEY (id, champion_team_id) REFERENCES sr_teams (tournament_id, id)
              ON DELETE RESTRICT
          `);
        }

        if (!(await constraintDefinition("sr_teams", "sr_teams_status_check"))) {
          await client.query(`
            ALTER TABLE sr_teams
              ADD CONSTRAINT sr_teams_status_check
              CHECK (status IN ('pending','approved','rejected'))
          `);
        }

        // Scene enum + active-match reference. ADD COLUMN IF NOT EXISTS above
        // is idempotent on its own, but ADD CONSTRAINT is not, so these are
        // guarded by a catalog lookup under the same advisory lock.
        if (!(await constraintDefinition("sr_tournaments", "sr_tournaments_scene_check"))) {
          await client.query(`
            ALTER TABLE sr_tournaments
              ADD CONSTRAINT sr_tournaments_scene_check
              CHECK (scene IN ('idle','starting_soon','teams','bracket','match','champion'))
          `);
        }
        // Composite FK, same shape and same reasoning as the sr_matches
        // participant FKs: the active match must belong to THIS tournament, a
        // bare REFERENCES sr_matches(id) would let it point into another one.
        // NO ACTION rather than SET NULL because a composite SET NULL would
        // also try to null the NOT NULL `id` column. Bracket regeneration
        // clears active_match_id explicitly before deleting match rows.
        if (
          !(await constraintDefinition("sr_tournaments", "sr_tournaments_active_match_fkey"))
        ) {
          await client.query(`
            ALTER TABLE sr_tournaments
              ADD CONSTRAINT sr_tournaments_active_match_fkey
              FOREIGN KEY (id, active_match_id) REFERENCES sr_matches (tournament_id, id)
              ON DELETE NO ACTION
          `);
        }

        for (const [name, column] of [
          ["sr_matches_advances_to_fkey", "advances_to_match_id"],
          ["sr_matches_drops_to_fkey", "drops_to_match_id"],
        ] as const) {
          const definition = await constraintDefinition("sr_matches", name);
          if (!definition || definition.includes("ON DELETE SET NULL")) {
            if (definition) {
              await client.query(`ALTER TABLE sr_matches DROP CONSTRAINT ${name}`);
            }
            await client.query(`
              ALTER TABLE sr_matches ADD CONSTRAINT ${name}
              FOREIGN KEY (tournament_id, ${column}) REFERENCES sr_matches (tournament_id, id)
              ON DELETE NO ACTION
            `);
          }
        }
      });
    })().catch((e) => {
      // If schema creation fails partway (a transient network blip, a
      // Neon cold-start timeout, etc.), don't let the failed Promise sit
      // cached in schemaReady forever — every future ensureSchema() call
      // in this process would immediately reject with the same stale
      // error, even after the underlying issue clears. Reset to null so
      // the next caller gets a fresh attempt.
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
// Reads
// ---------------------------------------------------------------------------

function rowToTournament(row: Record<string, unknown>): SrTournament {
  return {
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    status: row.status as SrTournamentStatus,
    format: row.format as SrTournament["format"],
    best_of: row.best_of as SrTournament["best_of"],
    third_place_match: row.third_place_match as boolean,
    grand_final_reset: row.grand_final_reset as boolean,
    grand_final_best_of: (row.grand_final_best_of as SrTournament["grand_final_best_of"]) ?? null,
    min_teams: row.min_teams as number,
    max_teams: row.max_teams as number,
    start_at: row.start_at ? new Date(row.start_at as string).toISOString() : null,
    end_at: row.end_at ? new Date(row.end_at as string).toISOString() : null,
    seed_locked: row.seed_locked as boolean,
    champion_team_id: (row.champion_team_id as string) ?? null,
    signups_open: (row.signups_open as boolean) ?? false,
    // `?? "idle"` is not redundant defensiveness: a row read by an instance
    // that has the new code but reached a database whose ALTER hasn't landed
    // yet would otherwise surface `undefined` as a scene name.
    scene: (row.scene as SrMatchScene) ?? "idle",
    countdown_ends_at: row.countdown_ends_at
      ? new Date(row.countdown_ends_at as string).toISOString()
      : null,
    active_match_id: (row.active_match_id as string) ?? null,
      ubr1_revealed_count: Number(row.ubr1_revealed_count ?? 0),
      ubr1_reveal_generation: Number(row.ubr1_reveal_generation ?? 0),
      ubr1_reveal_started_at: row.ubr1_reveal_started_at
        ? new Date(row.ubr1_reveal_started_at as string).toISOString()
        : null,
      ubr1_reveal_run_id: (row.ubr1_reveal_run_id as string) ?? null,
      created_at: new Date(row.created_at as string).toISOString(),
    updated_at: new Date(row.updated_at as string).toISOString(),
  };
}

function rowToApplication(row: Record<string, unknown>): SrTeamApplication {
  return {
    id: row.id as string,
    tournament_id: row.tournament_id as string,
    team_name: row.team_name as string,
    captain_discord_id: row.captain_discord_id as string,
    roster_version: Number(row.roster_version ?? 0),
    send_in_progress: Boolean(row.send_in_progress),
    created_at: new Date(row.created_at as string).toISOString(),
  };
}

/** Projects a slot row. confirm_token_hash is never carried onto the shape. */
function rowToApplicationSlot(row: Record<string, unknown>): SrTeamApplicationSlot {
  return {
    id: row.id as string,
    application_id: row.application_id as string,
    member_discord_id: (row.member_discord_id as string) ?? null,
    display_name: (row.display_name as string) ?? null,
    avatar_url: (row.avatar_url as string) ?? null,
    status: (row.status as SrApplicationSlotStatus) ?? "draft",
    is_captain: Boolean(row.is_captain),
    confirm_token_expires_at: row.confirm_token_expires_at
      ? new Date(row.confirm_token_expires_at as string).toISOString()
      : null,
    delivery_status: (row.delivery_status as SrDeliveryStatus) ?? "not_sent",
    delivery_error: (row.delivery_error as string) ?? null,
    token_roster_version:
      row.token_roster_version === null || row.token_roster_version === undefined
        ? null
        : Number(row.token_roster_version),
    updated_at: new Date(row.updated_at as string).toISOString(),
    created_at: new Date(row.created_at as string).toISOString(),
  };
}

function rowToTeam(row: Record<string, unknown>): SrTeam {
  return {
    id: row.id as string,
    tournament_id: row.tournament_id as string,
    name: row.name as string,
    logo_url: (row.logo_url as string) ?? null,
    seed: (row.seed as number) ?? null,
    captain_discord_id: (row.captain_discord_id as string) ?? null,
    status: (row.status as SrTeam["status"]) ?? "approved",
    created_at: new Date(row.created_at as string).toISOString(),
  };
}

function rowToPlayer(row: Record<string, unknown>): SrTeamPlayer {
  return {
    id: row.id as string,
    team_id: row.team_id as string,
    tournament_id: row.tournament_id as string,
    discord_id: row.discord_id as string,
    ign: row.ign as string,
    role: row.role as SrTeamPlayer["role"],
    current_rank: (row.current_rank as SrTeamPlayer["current_rank"]) ?? null,
    peak_rank: (row.peak_rank as SrTeamPlayer["peak_rank"]) ?? null,
    rank_verified_at: row.rank_verified_at
      ? new Date(row.rank_verified_at as string).toISOString()
      : null,
    is_captain: row.is_captain as boolean,
    is_substitute: row.is_substitute as boolean,
    created_at: new Date(row.created_at as string).toISOString(),
  };
}

function rowToMatch(row: Record<string, unknown>): SrMatch {
  return {
    id: row.id as string,
    tournament_id: row.tournament_id as string,
    bracket: row.bracket as SrMatch["bracket"],
    round_number: row.round_number as number,
    match_number: row.match_number as number,
    best_of: row.best_of as SrMatch["best_of"],
    team_a_id: (row.team_a_id as string) ?? null,
    team_b_id: (row.team_b_id as string) ?? null,
    team_a_score: row.team_a_score as number,
    team_b_score: row.team_b_score as number,
    winner_id: (row.winner_id as string) ?? null,
    status: row.status as SrMatch["status"],
    advances_to_match_id: (row.advances_to_match_id as string) ?? null,
    advances_to_slot: (row.advances_to_slot as SrMatch["advances_to_slot"]) ?? null,
    drops_to_match_id: (row.drops_to_match_id as string) ?? null,
    drops_to_slot: (row.drops_to_slot as SrMatch["drops_to_slot"]) ?? null,
  };
}

export async function listTournaments(): Promise<SrTournament[]> {
  await ensureSchema();
  const { rows } = await sql`
    SELECT * FROM sr_tournaments
    WHERE status != 'archived'
    ORDER BY created_at DESC
  `;
  return rows.map(rowToTournament);
}

/** Completed tournaments only, most recent champion first — feeds Hall of Fame. */
export async function listCompletedTournaments(): Promise<SrTournament[]> {
  await ensureSchema();
  const { rows } = await sql`
    SELECT * FROM sr_tournaments
    WHERE status = 'completed'
    ORDER BY end_at DESC NULLS LAST, updated_at DESC
  `;
  return rows.map(rowToTournament);
}

export async function getTournamentFull(tournamentId: string): Promise<SrTournamentFull | null> {
  await ensureSchema();
  const [tournamentRes, teamsRes, matchesRes, playersRes] = await Promise.all([
    sql`SELECT * FROM sr_tournaments WHERE id = ${tournamentId}`,
    sql`SELECT * FROM sr_teams WHERE tournament_id = ${tournamentId} ORDER BY seed ASC NULLS LAST, created_at ASC`,
    sql`SELECT * FROM sr_matches WHERE tournament_id = ${tournamentId} ORDER BY match_number ASC`,
    sql`SELECT * FROM sr_team_players WHERE tournament_id = ${tournamentId} ORDER BY is_captain DESC, is_substitute ASC, created_at ASC`,
  ]);
  if (tournamentRes.rows.length === 0) return null;
  return {
    tournament: rowToTournament(tournamentRes.rows[0]),
    teams: teamsRes.rows.map(rowToTeam),
    matches: matchesRes.rows.map(rowToMatch),
    players: playersRes.rows.map(rowToPlayer),
  };
}

export async function getTournamentBySlug(slug: string): Promise<SrTournamentFull | null> {
  await ensureSchema();
  const { rows } = await sql`SELECT id FROM sr_tournaments WHERE lower(slug) = lower(${slug})`;
  if (rows.length === 0) return null;
  return getTournamentFull(rows[0].id as string);
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export async function writeAudit(
  tournamentId: string,
  action: SrAuditAction,
  detail?: Record<string, unknown>,
): Promise<void> {
  await sql`
    INSERT INTO sr_audit_log (tournament_id, action, detail)
    VALUES (${tournamentId}, ${action}, ${detail ? JSON.stringify(detail) : null}::jsonb)
  `;
}

export async function listAudit(tournamentId: string): Promise<SrAuditLogEntry[]> {
  await ensureSchema();
  const { rows } = await sql`
    SELECT * FROM sr_audit_log WHERE tournament_id = ${tournamentId} ORDER BY created_at DESC
  `;
  return rows.map((r) => ({
    id: Number(r.id),
    tournament_id: r.tournament_id as string,
    action: r.action as SrAuditAction,
    detail: (r.detail as Record<string, unknown>) ?? null,
    created_at: new Date(r.created_at as string).toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Public reads
// ---------------------------------------------------------------------------
//
// Everything above returns full DB rows and is for the authenticated /tools
// surface only. The functions below are the ONLY ones the public
// /tournaments/summoners-rift pages call. They differ in two ways that both
// matter:
//
//   1. Status filtering happens in SQL. A `draft` tournament is an admin
//      workspace — half-entered teams, unconfirmed dates — and must never be
//      reachable publicly, not even by guessing its slug. Filtering in the
//      page component instead would mean the row was already fetched and one
//      forgotten early-return away from being rendered.
//   2. Rows are projected down to the SrPublic* shapes before leaving this
//      module, so a column added to sr_tournaments later (an internal note, a
//      moderation flag) is not published by default.

function toPublicTournament(t: SrTournament): SrPublicTournament {
  return {
    slug: t.slug,
    name: t.name,
    status: t.status,
    format: t.format,
    best_of: t.best_of,
    third_place_match: t.third_place_match,
    grand_final_reset: t.grand_final_reset,
    grand_final_best_of: t.grand_final_best_of,
    ubr1_revealed_count: t.ubr1_revealed_count,
    ubr1_reveal_generation: t.ubr1_reveal_generation,
    ubr1_reveal_started_at: t.ubr1_reveal_started_at,
    ubr1_reveal_run_id: t.ubr1_reveal_run_id,
    min_teams: t.min_teams,
    max_teams: t.max_teams,
    start_at: t.start_at,
    end_at: t.end_at,
    champion_team_id: t.champion_team_id,
    signups_open: t.signups_open,
    // Presentation state, not admin workflow — /srlive/[slug] is public and
    // these three fields are the whole of what it needs. See the doc comment
    // on SrPublicTournament for why `seed_locked` stays private and these
    // don't.
    scene: t.scene,
    countdown_ends_at: t.countdown_ends_at,
    active_match_id: t.active_match_id,
  };
}

function toPublicPlayer(p: SrTeamPlayer): SrPublicPlayer {
  // discord_id is dropped here and nowhere else — this function is the only
  // path a roster row takes to a public page.
  return {
    id: p.id,
    ign: p.ign,
    role: p.role,
    current_rank: p.current_rank,
    peak_rank: p.peak_rank,
    is_captain: p.is_captain,
    is_substitute: p.is_substitute,
  };
}

function toPublicTeam(t: SrTeam, players: SrTeamPlayer[] = []): SrPublicTeam {
  return {
    id: t.id,
    name: t.name,
    logo_url: t.logo_url,
    seed: t.seed,
    players: players.map(toPublicPlayer),
  };
}

function toPublicMatch(m: SrMatch): SrPublicMatch {
  return {
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
    advances_to_match_id: m.advances_to_match_id,
    advances_to_slot: m.advances_to_slot,
    drops_to_match_id: m.drops_to_match_id,
    drops_to_slot: m.drops_to_slot,
  };
}

/** Tournaments a visitor may see listed. Live/upcoming first, then finished. */
export async function listPublicTournaments(): Promise<SrPublicTournament[]> {
  await ensureSchema();
  // sql.query(text, params) rather than the tagged template: the tagged
  // template's value type is a single primitive per interpolation, and this
  // needs to bind a text[] for the ANY(...) filter.
  const { rows } = await sql.query(
    `SELECT * FROM sr_tournaments
     WHERE status = ANY($1::text[])
     ORDER BY
       CASE status
         WHEN 'in_progress' THEN 0
         WHEN 'bracket_published' THEN 1
         WHEN 'seeding' THEN 2
         ELSE 3
       END,
       start_at DESC NULLS LAST,
       created_at DESC`,
    [SR_PUBLIC_LISTED_STATUSES],
  );
  return rows.map(rowToTournament).map(toPublicTournament);
}

/**
 * Public detail read by slug. Returns null for a draft tournament exactly as
 * it does for one that doesn't exist — a visitor cannot tell the difference,
 * which is the point.
 *
 * `archived` IS served here (unlike in the listing): an archived tournament
 * still holds a real result that Hall of Fame links to, and 404ing those
 * links would be worse than simply not advertising them.
 */
export async function getPublicTournamentBySlug(
  slug: string,
): Promise<SrPublicTournamentFull | null> {
  await ensureSchema();
  const { rows } = await sql`
    SELECT id FROM sr_tournaments
    WHERE lower(slug) = lower(${slug})
      AND (
        status IN ('seeding','bracket_published','in_progress','completed')
        OR (status = 'archived' AND champion_team_id IS NOT NULL)
      )
  `;
  if (rows.length === 0) return null;
  const full = await getTournamentFull(rows[0].id as string);
  if (!full) return null;
  const rosterByTeam = new Map<string, SrTeamPlayer[]>();
  for (const p of full.players) {
    const list = rosterByTeam.get(p.team_id);
    if (list) list.push(p);
    else rosterByTeam.set(p.team_id, [p]);
  }
  return {
    tournament: toPublicTournament(full.tournament),
    // Only approved teams are published. A `pending` signup is a submission
    // an admin hasn't looked at yet and a `rejected` one is a decision — a
    // visitor should see neither in the field. Note the explicit arrow: a
    // bare `.map(toPublicTeam)` would pass Array#map's index as the second
    // argument and blow up on `players.map`.
    teams: full.teams
      .filter((t) => t.status === "approved")
      .map((t) => toPublicTeam(t, rosterByTeam.get(t.id) ?? [])),
    matches: full.matches.map(toPublicMatch),
  };
}

/**
 * Champion name lookup for completed tournaments, for Hall of Fame. Returned
 * as a map keyed by tournament id so callers that already hold
 * listCompletedTournaments() output can join without an N+1 query per row.
 */
export async function getChampionTeams(
  tournamentIds: string[],
): Promise<Map<string, SrPublicTeam>> {
  if (tournamentIds.length === 0) return new Map();
  await ensureSchema();
  const { rows } = await sql.query(
    `SELECT t.* FROM sr_teams t
     JOIN sr_tournaments tr ON tr.champion_team_id = t.id AND tr.id = t.tournament_id
     WHERE tr.id = ANY($1::text[])`,
    [tournamentIds],
  );
  const out = new Map<string, SrPublicTeam>();
  for (const row of rows) {
    const team = rowToTeam(row);
    out.set(team.tournament_id, toPublicTeam(team));
  }
  return out;
}

/** Runner-up (the loser of the terminal grand final) for a completed tournament. */
export async function getRunnerUpTeams(
  tournamentIds: string[],
): Promise<Map<string, SrPublicTeam>> {
  if (tournamentIds.length === 0) return new Map();
  await ensureSchema();
  // The deciding match is the completed grand final with the highest
  // round_number (the reset match when one was played, GF1 otherwise). Its
  // loser is the runner-up.
  const { rows } = await sql.query(
    `SELECT DISTINCT ON (m.tournament_id)
       m.tournament_id,
       CASE WHEN m.winner_id = m.team_a_id THEN m.team_b_id ELSE m.team_a_id END AS runner_up_id
     FROM sr_matches m
     WHERE m.tournament_id = ANY($1::text[])
       AND m.bracket = 'grand_final'
       AND m.status = 'completed'
     ORDER BY m.tournament_id, m.round_number DESC`,
    [tournamentIds],
  );
  const byTournament = new Map<string, string>();
  for (const r of rows) {
    if (r.runner_up_id) byTournament.set(r.tournament_id as string, r.runner_up_id as string);
  }
  if (byTournament.size === 0) return new Map();

  const ids = Array.from(byTournament.values());
  const { rows: teamRows } = await sql.query(
    `SELECT * FROM sr_teams WHERE id = ANY($1::text[])`,
    [ids],
  );
  const teamById = new Map(teamRows.map((r) => [r.id as string, rowToTeam(r)]));
  const out = new Map<string, SrPublicTeam>();
  for (const [tournamentId, teamId] of byTournament) {
    const team = teamById.get(teamId);
    if (team) out.set(tournamentId, toPublicTeam(team));
  }
  return out;
}

/** Team count per tournament — the "field size" line in Hall of Fame. */
export async function getTeamCounts(tournamentIds: string[]): Promise<Map<string, number>> {
  if (tournamentIds.length === 0) return new Map();
  await ensureSchema();
  const { rows } = await sql.query(
    `SELECT tournament_id, count(*)::int AS c FROM sr_teams
     WHERE tournament_id = ANY($1::text[])
     GROUP BY tournament_id`,
    [tournamentIds],
  );
  return new Map(rows.map((r) => [r.tournament_id as string, r.c as number]));
}

// ---------------------------------------------------------------------------
// Captain reads
// ---------------------------------------------------------------------------
//
// Reads for the /captain surface. These are NOT public projections — a
// captain sees their own roster's Discord ids, which no public page exposes
// — but they are also not admin reads: every one of them is scoped by a
// `captain_discord_id` the caller has proven they own via getCaptainSession().
// The scoping is done in SQL rather than by filtering in the page, so
// "someone else's team" is never fetched in the first place.

export interface SrCaptainTeamView {
  team: SrTeam;
  players: SrTeamPlayer[];
  tournament: SrTournament;
}

/** Tournaments currently accepting captain signups. */
export async function listSignupOpenTournaments(): Promise<SrTournament[]> {
  await ensureSchema();
  const { rows } = await sql`
    SELECT * FROM sr_tournaments
    WHERE signups_open = true AND status = 'draft'
    ORDER BY start_at ASC NULLS LAST, created_at DESC
  `;
  return rows.map(rowToTournament);
}

/**
 * Every team owned by this captain, newest first. Returns [] — never
 * throws — for a captain who has not registered anything.
 */
export async function getTeamsForCaptain(discordId: string): Promise<SrCaptainTeamView[]> {
  await ensureSchema();
  const { rows: teamRows } = await sql`
    SELECT * FROM sr_teams WHERE captain_discord_id = ${discordId} ORDER BY created_at DESC
  `;
  if (teamRows.length === 0) return [];
  const teams = teamRows.map(rowToTeam);
  const teamIds = teams.map((t) => t.id);
  const tournamentIds = [...new Set(teams.map((t) => t.tournament_id))];

  const [playerRes, tournamentRes] = await Promise.all([
    sql.query(
      `SELECT * FROM sr_team_players WHERE team_id = ANY($1::text[])
       ORDER BY is_captain DESC, is_substitute ASC, created_at ASC`,
      [teamIds],
    ),
    sql.query(`SELECT * FROM sr_tournaments WHERE id = ANY($1::text[])`, [tournamentIds]),
  ]);

  const playersByTeam = new Map<string, SrTeamPlayer[]>();
  for (const row of playerRes.rows) {
    const p = rowToPlayer(row);
    const list = playersByTeam.get(p.team_id);
    if (list) list.push(p);
    else playersByTeam.set(p.team_id, [p]);
  }
  const tournamentById = new Map(
    tournamentRes.rows.map((r) => {
      const t = rowToTournament(r);
      return [t.id, t] as const;
    }),
  );

  const out: SrCaptainTeamView[] = [];
  for (const team of teams) {
    const tournament = tournamentById.get(team.tournament_id);
    if (!tournament) continue; // orphan row; the FK makes this unreachable
    out.push({ team, players: playersByTeam.get(team.id) ?? [], tournament });
  }
  return out;
}

/**
 * Load one team ONLY if the given captain owns it. Every captain mutation
 * calls this (or its transactional equivalent) first — returning null for
 * "doesn't exist" and "isn't yours" alike, so a captain probing team ids
 * learns nothing either way.
 */
export async function getCaptainTeam(
  teamId: string,
  discordId: string,
): Promise<SrCaptainTeamView | null> {
  await ensureSchema();
  const { rows } = await sql`
    SELECT * FROM sr_teams WHERE id = ${teamId} AND captain_discord_id = ${discordId}
  `;
  if (rows.length === 0) return null;
  const team = rowToTeam(rows[0]);
  const [playerRes, tournamentRes] = await Promise.all([
    sql`SELECT * FROM sr_team_players WHERE team_id = ${teamId}
        ORDER BY is_captain DESC, is_substitute ASC, created_at ASC`,
    sql`SELECT * FROM sr_tournaments WHERE id = ${team.tournament_id}`,
  ]);
  if (tournamentRes.rows.length === 0) return null;
  return {
    team,
    players: playerRes.rows.map(rowToPlayer),
    tournament: rowToTournament(tournamentRes.rows[0]),
  };
}

// ---------------------------------------------------------------------------
// Team application reads
// ---------------------------------------------------------------------------
//
// Same rule as the captain reads above: these take the id to scope by as an
// ARGUMENT, so they must never be re-exported through a "use server" module —
// that would turn "read my own application" into "read anyone's application
// by passing their id". They are imported directly by server components that
// have already proven who the caller is.

async function loadSlots(applicationIds: string[]): Promise<Map<string, SrTeamApplicationSlot[]>> {
  const byApplication = new Map<string, SrTeamApplicationSlot[]>();
  if (applicationIds.length === 0) return byApplication;
  const { rows } = await sql.query(
    `SELECT * FROM sr_team_application_slots
     WHERE application_id = ANY($1::text[])
     ORDER BY is_captain DESC, created_at ASC`,
    [applicationIds],
  );
  for (const row of rows) {
    const slot = rowToApplicationSlot(row);
    const list = byApplication.get(slot.application_id);
    if (list) list.push(slot);
    else byApplication.set(slot.application_id, [slot]);
  }
  return byApplication;
}

function zipApplications(
  applications: SrTeamApplication[],
  slotsByApplication: Map<string, SrTeamApplicationSlot[]>,
): SrTeamApplicationView[] {
  return applications.map((application) => ({
    application,
    slots: slotsByApplication.get(application.id) ?? [],
  }));
}

/**
 * This captain's in-progress application for ONE tournament, if any. Returns
 * an array rather than a single view purely so the caller doesn't have to
 * special-case null; the captain-unique index means it holds 0 or 1 entries.
 */
export async function getMyPremadeApplications(
  tournamentId: string,
  captainDiscordId: string,
): Promise<SrTeamApplicationView[]> {
  await ensureSchema();
  const { rows } = await sql`
    SELECT * FROM sr_team_applications
    WHERE tournament_id = ${tournamentId} AND captain_discord_id = ${captainDiscordId}
  `;
  const applications = rows.map(rowToApplication);
  return zipApplications(applications, await loadSlots(applications.map((a) => a.id)));
}

/**
 * Every in-progress application this captain owns, across tournaments —
 * what the /captain dashboard lists alongside their already-registered teams.
 */
export async function getApplicationsForCaptain(
  captainDiscordId: string,
): Promise<SrTeamApplicationView[]> {
  await ensureSchema();
  const { rows } = await sql`
    SELECT * FROM sr_team_applications
    WHERE captain_discord_id = ${captainDiscordId}
    ORDER BY created_at DESC
  `;
  const applications = rows.map(rowToApplication);
  return zipApplications(applications, await loadSlots(applications.map((a) => a.id)));
}

/**
 * Every in-flight application for one tournament — the admin dashboard's
 * read-only view of signups that haven't become teams yet. Admin-only by
 * virtue of who imports it (the isToolsSession()-gated tool page and API
 * route); nothing here filters by captain.
 */
export async function listTournamentApplications(
  tournamentId: string,
): Promise<SrTeamApplicationView[]> {
  await ensureSchema();
  const { rows } = await sql`
    SELECT * FROM sr_team_applications
    WHERE tournament_id = ${tournamentId}
    ORDER BY created_at ASC
  `;
  const applications = rows.map(rowToApplication);
  return zipApplications(applications, await loadSlots(applications.map((a) => a.id)));
}
