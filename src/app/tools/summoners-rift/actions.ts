"use server";

import { sql, type VercelPoolClient } from "@vercel/postgres";
import { revalidatePath } from "next/cache";
import { getCurrentAdmin, isToolsSession } from "@/lib/tools-auth";
import {
  ensureSchema,
  insertSrAudit,
  newId,
} from "@/lib/sr-db";
import {
  applyBracketResult,
  buildKnockoutBracket,
  resolveByes,
  retractBracketResult,
  type BracketMatch,
} from "@/lib/bracket-engine";
import { assertOwnBlobUrl, deleteTeamLogo, uploadTeamLogo } from "@/lib/team-logo";
import { shuffle } from "@/lib/mayhem-icons";
import type {
  SrActor,
  SrBracketFormat,
  SrMatch,
  SrMatchScene,
  SrTournamentStatus,
} from "@/types/sr-tournament";
import { SR_MAX_TEAMS, SR_MIN_TEAMS, SR_SCENES } from "@/types/sr-tournament";

/**
 * Summoner's Rift admin write layer. Every mutation:
 *   1. requires an authenticated admin session
 *   2. runs inside a single Postgres transaction (BEGIN...COMMIT/ROLLBACK)
 *      via a real client checked out from the pool, not the tagged-template
 *      `sql` helper (which opens a fresh connection per call and cannot
 *      span a transaction) — this matters here in a way it didn't for ARAM
 *      Mayhem: multi-tournament data with cross-row invariants (unique
 *      seeds, self-referencing match links, seed-then-generate ordering)
 *      needs real atomicity, not "mostly sequential awaits and hope."
 *   3. locks the rows it depends on with `FOR UPDATE` before checking
 *      application-level invariants, so two admins clicking the same
 *      button in different tabs can't race each other into a torn state.
 *   4. writes an audit row in the same transaction as the mutation itself.
 *   5. revalidates the admin page + public tournament page after commit.
 */

/** Gate every admin action; returns the admin as the audit actor. */
async function requireAdmin(): Promise<SrActor> {
  const ok = await isToolsSession();
  if (!ok) throw new Error("Not authorized.");
  const admin = await getCurrentAdmin();
  if (!admin) throw new Error("Not authorized.");
  return { discordId: admin.discordUserId, name: admin.username, kind: "admin" };
}

/** Run `fn` inside a transaction on a dedicated client, always releasing it. */
async function withTransaction<T>(fn: (client: VercelPoolClient) => Promise<T>): Promise<T> {
  const client = await sql.connect();
  try {
    await client.sql`BEGIN`;
    const result = await fn(client);
    await client.sql`COMMIT`;
    return result;
  } catch (e) {
    try {
      await client.sql`ROLLBACK`;
    } catch {
      // Connection may already be dead (e.g. the error came from the DB
      // itself); nothing more we can do to roll back cleanly.
    }
    throw e;
  } finally {
    client.release();
  }
}

// Cache invalidation happens OUTSIDE the transaction: revalidatePath() has
// no rollback semantics, so calling it from inside a transaction callback
// would invalidate caches for data that might still get rolled back if a
// later statement in the same transaction fails. Every mutation below
// calls refresh() only after withTransaction() has returned successfully
// (i.e. after COMMIT), never from inside the callback passed to it.

function refresh(slug?: string) {
  revalidatePath("/tools/summoners-rift");
  // These must be the REAL public route paths. revalidatePath() silently
  // no-ops on a path that doesn't correspond to a route, so a stale target
  // isn't an error you'd ever see — it just means the public bracket keeps
  // serving cached data after a result is reported. The public pages live
  // under /tournaments/summoners-rift (an earlier draft of this file pointed
  // at a top-level /summoners-rift that was never built).
  revalidatePath("/tournaments");
  revalidatePath("/tournaments/summoners-rift");
  if (slug) {
    revalidatePath(`/tournaments/summoners-rift/${slug}`);
    // The live screen is per-tournament, so it can only be revalidated when
    // the slug is known. It polls /api/sr/state anyway (which is
    // force-dynamic and never cached), so this is belt-and-braces for the
    // server-rendered first paint, not the mechanism the screen relies on.
    revalidatePath(`/srlive/${slug}`);
  }
}

/** Load and lock a tournament's match graph in engine-compatible form. */
async function loadBracketForUpdate(
  client: VercelPoolClient,
  tournamentId: string,
): Promise<BracketMatch[]> {
  const { rows } = await client.query(
    `SELECT * FROM sr_matches WHERE tournament_id = $1 ORDER BY match_number FOR UPDATE`,
    [tournamentId],
  );
  return (rows as SrMatch[]).map((match) => ({
    ...match,
    event_id: match.tournament_id,
    group_id: null,
  }));
}

/** Persist all mutable match state after an in-memory graph transition. */
async function persistBracketState(
  client: VercelPoolClient,
  matches: BracketMatch[],
): Promise<void> {
  for (const match of matches) {
    await client.query(
      `UPDATE sr_matches SET
         team_a_id = $2, team_b_id = $3,
         team_a_score = $4, team_b_score = $5,
         winner_id = $6, status = $7
       WHERE id = $1`,
      [
        match.id,
        match.team_a_id,
        match.team_b_id,
        match.team_a_score,
        match.team_b_score,
        match.winner_id,
        match.status,
      ],
    );
  }
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// Tournament lifecycle
// ---------------------------------------------------------------------------

export async function createTournament(input: {
  name: string;
  format: SrBracketFormat;
  bestOf: 1 | 3 | 5;
  thirdPlaceMatch: boolean;
  grandFinalReset: boolean;
  minTeams: number;
  maxTeams: number;
  startAt: string | null;
  endAt: string | null;
}): Promise<string> {
  const actor = await requireAdmin();
  await ensureSchema();

  const name = input.name.trim();
  if (!name) throw new Error("Tournament name is required.");
  if (input.format === "double_elim" && input.thirdPlaceMatch) {
    throw new Error("Third-place matches are not supported for double-elimination tournaments.");
  }
  const minTeams = Math.max(SR_MIN_TEAMS, Math.min(input.minTeams, SR_MAX_TEAMS));
  const maxTeams = Math.max(minTeams, Math.min(input.maxTeams, SR_MAX_TEAMS));

  // The pre-check-then-insert below narrows the race but can't close it
  // entirely: two concurrent creates can both pass the SELECT before either
  // INSERTs, and the loser hits sr_tournaments_slug_unique. Retry a few
  // times on exactly that violation (picking a fresh -N suffix each time)
  // rather than surfacing a raw constraint error to the admin for what is,
  // from their point of view, just "click create tournament twice quickly."
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const { id, slug } = await withTransaction(async (client) => {
        const id = newId("sr");
        const baseSlug = slugify(name) || id;
        // Resolve slug collisions by appending -2, -3, ... — checked inside
        // the transaction (with the client, not the bare `sql` helper) so a
        // concurrent create can't sneak the same slug in between our check
        // and insert within THIS attempt (the retry loop above handles the
        // remaining cross-transaction race).
        let slug = baseSlug;
        let suffix = 1;
        for (;;) {
          const { rows } = await client.sql`
            SELECT 1 FROM sr_tournaments WHERE lower(slug) = lower(${slug})
          `;
          if (rows.length === 0) break;
          suffix += 1;
          slug = `${baseSlug}-${suffix}`;
        }

        await client.query(
          `INSERT INTO sr_tournaments
             (id, slug, name, status, format, best_of, third_place_match, grand_final_reset, min_teams, max_teams, start_at, end_at)
           VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            id,
            slug,
            name,
            input.format,
            input.bestOf,
            input.thirdPlaceMatch,
            input.grandFinalReset,
            minTeams,
            maxTeams,
            input.startAt,
            input.endAt,
          ],
        );

        await insertSrAudit(client, id, "tournament.create", { name, format: input.format }, actor);

        return { id, slug };
      });
      // refresh() runs only after withTransaction() has returned, i.e.
      // after COMMIT succeeded — never inside the callback, where a later
      // statement failing would still have already invalidated caches for
      // data that got rolled back.
      refresh(slug);
      return id;
    } catch (e) {
      const msg = (e as Error).message;
      const isLastAttempt = attempt === 4;
      if (msg.includes("sr_tournaments_slug_unique") && !isLastAttempt) continue;
      throw e;
    }
  }
  // Unreachable (the loop always returns or throws), but keeps TypeScript's
  // control-flow analysis happy about a guaranteed return type.
  throw new Error("Could not create tournament after several slug retries.");
}

export async function updateTournament(
  tournamentId: string,
  input: Partial<{
    name: string;
    bestOf: 1 | 3 | 5;
    thirdPlaceMatch: boolean;
    grandFinalReset: boolean;
    grandFinalBestOf: 1 | 3 | 5 | null;
    startAt: string | null;
    endAt: string | null;
  }>,
): Promise<void> {
  const actor = await requireAdmin();

  let refreshSlug: string | undefined;
  await withTransaction(async (client) => {
    const { rows } = await client.sql`
      SELECT * FROM sr_tournaments WHERE id = ${tournamentId} FOR UPDATE
    `;
    if (rows.length === 0) throw new Error("Tournament not found.");
    const current = rows[0];
    if (current.status !== "draft" && (input.startAt !== undefined || input.endAt !== undefined)) {
      // Dates are load-bearing for the public "1 week / 1 month" framing
      // once a tournament is live; only allow free editing pre-launch.
      throw new Error("Dates can only be changed while the tournament is in draft.");
    }
    const bracketSettingSupplied =
      input.bestOf !== undefined ||
      input.thirdPlaceMatch !== undefined ||
      input.grandFinalReset !== undefined ||
      input.grandFinalBestOf !== undefined;
    if (bracketSettingSupplied) {
      const { rows: matchRows } = await client.query(
        `SELECT 1 FROM sr_matches WHERE tournament_id = $1 LIMIT 1`,
        [tournamentId],
      );
      if (matchRows.length > 0) {
        throw new Error("Bracket settings can't be changed after the bracket is generated.");
      }
    }
    if (
      current.format === "double_elim" &&
      input.thirdPlaceMatch === true
    ) {
      throw new Error("Third-place matches are not supported for double-elimination tournaments.");
    }

    const name = input.name?.trim();
    if (input.name !== undefined && !name) throw new Error("Tournament name cannot be blank.");

    // grandFinalBestOf is nullable by design ("same as best_of"), so it
    // can't reuse the COALESCE($n, col) pattern every other optional field
    // here uses — COALESCE would make "clear it back to null" impossible.
    // The explicit CASE WHEN $set THEN $value pattern (matching startAt/
    // endAt below) lets `null` be written on purpose.
    await client.query(
      `UPDATE sr_tournaments SET
         name = COALESCE($2, name),
         best_of = COALESCE($3, best_of),
         third_place_match = COALESCE($4, third_place_match),
         grand_final_reset = COALESCE($5, grand_final_reset),
         grand_final_best_of = CASE WHEN $10 THEN $11 ELSE grand_final_best_of END,
         start_at = CASE WHEN $6 THEN $7 ELSE start_at END,
         end_at = CASE WHEN $8 THEN $9 ELSE end_at END,
         updated_at = now()
       WHERE id = $1`,
      [
        tournamentId,
        name ?? null,
        input.bestOf ?? null,
        input.thirdPlaceMatch ?? null,
        input.grandFinalReset ?? null,
        input.startAt !== undefined,
        input.startAt ?? null,
        input.endAt !== undefined,
        input.endAt ?? null,
        input.grandFinalBestOf !== undefined,
        input.grandFinalBestOf ?? null,
      ],
    );
    await insertSrAudit(client, tournamentId, "tournament.update", input, actor);
    refreshSlug = current.slug as string;
  });
  refresh(refreshSlug);
}

export async function archiveTournament(tournamentId: string): Promise<void> {
  const actor = await requireAdmin();
  const slug = await withTransaction(async (client) => {
    const { rows } = await client.sql`
      UPDATE sr_tournaments SET status = 'archived', updated_at = now()
      WHERE id = ${tournamentId}
      RETURNING slug
    `;
    if (rows.length === 0) throw new Error("Tournament not found.");
    await insertSrAudit(client, tournamentId, "tournament.archive", null, actor);
    return rows[0].slug as string;
  });
  refresh(slug);
}

/**
 * Hard-delete a tournament: removes it from the admin list AND the Hall of
 * Champions, unlike archive (which keeps the historical champion public).
 * For cleaning up test runs, not for tournaments that deserve history.
 *
 * Every child table (sr_teams, sr_matches, sr_audit_log, ...) cascades off
 * sr_tournaments, but sr_tournaments.champion_team_id is a FK *back to*
 * sr_teams(id) — the row delete would cascade its own champion team away and
 * leave a dangling self-reference. Nulling champion_team_id first breaks that
 * self-loop, then the cascades tear down everything else.
 */
export async function deleteTournament(tournamentId: string): Promise<void> {
  await requireAdmin();
  const slug = await withTransaction(async (client) => {
    const { rows } = await client.sql`
      UPDATE sr_tournaments SET champion_team_id = NULL
      WHERE id = ${tournamentId} AND champion_team_id IS NOT NULL
      RETURNING slug
    `;
    if (rows.length === 0) {
      // Either unknown id or nothing to unlink — confirm existence either way.
      const { rows: exists } = await client.sql`
        SELECT slug FROM sr_tournaments WHERE id = ${tournamentId}
      `;
      if (exists.length === 0) throw new Error("Tournament not found.");
    }
    await client.sql`
      DELETE FROM sr_tournaments WHERE id = ${tournamentId}
    `;
    return rows[0]?.slug;
  });
  // Audit rows cascade away with the tournament, so there is no audit entry
  // possible here — the delete is the audit trail's own deletion.
  refresh(slug);
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

export async function addTeam(
  tournamentId: string,
  input: { name: string; logoUrl?: string | null },
): Promise<string> {
  const actor = await requireAdmin();
  const name = input.name.trim();
  if (!name) throw new Error("Team name is required.");
  if (input.logoUrl) assertOwnBlobUrl(input.logoUrl);

  const { id, slug } = await withTransaction(async (client) => {
    const { rows: tRows } = await client.sql`
      SELECT * FROM sr_tournaments WHERE id = ${tournamentId} FOR UPDATE
    `;
    if (tRows.length === 0) throw new Error("Tournament not found.");
    const tournament = tRows[0];
    if (tournament.status !== "draft") {
      throw new Error("Teams can only be added while the tournament is in draft.");
    }

    // Rejected signups don't occupy a slot in the field.
    const { rows: countRows } = await client.sql`
      SELECT count(*)::int as c FROM sr_teams
      WHERE tournament_id = ${tournamentId} AND status <> 'rejected'
    `;
    if (countRows[0].c >= (tournament.max_teams as number)) {
      throw new Error(`Tournament is capped at ${tournament.max_teams} teams.`);
    }
    const { rows: applicationClash } = await client.query(
      `SELECT id FROM sr_team_applications
       WHERE tournament_id = $1 AND lower(team_name) = lower($2)`,
      [tournamentId, name],
    );
    if (applicationClash.length > 0) {
      throw new Error(`A team named "${name}" already has an application in progress.`);
    }

    const id = newId("srteam");
    try {
      await client.query(
        `INSERT INTO sr_teams (id, tournament_id, name, logo_url) VALUES ($1, $2, $3, $4)`,
        [id, tournamentId, name, input.logoUrl ?? null],
      );
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("sr_teams_name_unique")) {
        throw new Error(`A team named "${name}" already exists in this tournament.`);
      }
      throw e;
    }
    await insertSrAudit(client, tournamentId, "team.add", { teamId: id, name }, actor);
    return { id, slug: tournament.slug as string };
  });
  refresh(slug);
  return id;
}

export async function updateTeam(
  teamId: string,
  input: { name?: string; logoUrl?: string | null },
): Promise<void> {
  const actor = await requireAdmin();
  // A logo URL may only ever be one of ours. Anything else — a Discord CDN
  // attachment link, an imgur hotlink — is rejected here rather than
  // stored, so this is true no matter which caller supplies it.
  if (input.logoUrl) assertOwnBlobUrl(input.logoUrl);
  const slug = await withTransaction(async (client) => {
    const { rows } = await client.sql`
      SELECT t.*, tr.slug as tournament_slug FROM sr_teams t
      JOIN sr_tournaments tr ON tr.id = t.tournament_id
      WHERE t.id = ${teamId} FOR UPDATE OF t, tr
    `;
    if (rows.length === 0) throw new Error("Team not found.");
    const team = rows[0];
    const name = input.name?.trim();
    if (input.name !== undefined && !name) throw new Error("Team name cannot be blank.");
    if (name) {
      const { rows: applicationClash } = await client.query(
        `SELECT id FROM sr_team_applications
         WHERE tournament_id = $1 AND lower(team_name) = lower($2)`,
        [team.tournament_id, name],
      );
      if (applicationClash.length > 0) {
        throw new Error(`A team named "${name}" already has an application in progress.`);
      }
    }

    try {
      await client.query(
        `UPDATE sr_teams SET name = COALESCE($2, name), logo_url = CASE WHEN $3 THEN $4 ELSE logo_url END WHERE id = $1`,
        [teamId, name ?? null, input.logoUrl !== undefined, input.logoUrl ?? null],
      );
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("sr_teams_name_unique")) {
        throw new Error(`A team named "${name}" already exists in this tournament.`);
      }
      throw e;
    }
    await insertSrAudit(client, team.tournament_id, "team.update", { teamId, ...input }, actor);
    return team.tournament_slug as string;
  });
  refresh(slug);
}

export async function removeTeam(teamId: string): Promise<void> {
  const actor = await requireAdmin();
  const slug = await withTransaction(async (client) => {
    const { rows } = await client.sql`
      SELECT t.*, tr.slug as tournament_slug, tr.status as tournament_status FROM sr_teams t
      JOIN sr_tournaments tr ON tr.id = t.tournament_id
      WHERE t.id = ${teamId} FOR UPDATE OF t
    `;
    if (rows.length === 0) return; // already gone; nothing to do
    const team = rows[0];

    try {
      await client.query(`DELETE FROM sr_teams WHERE id = $1`, [teamId]);
    } catch (e) {
      const msg = (e as Error).message;
      // sr_matches_team_a_fkey / sr_matches_team_b_fkey / sr_matches_winner_fkey
      // / sr_tournaments_champion_same_tournament_fkey are all ON DELETE
      // RESTRICT — a team already seeded into a generated bracket, or
      // recorded as champion, cannot simply vanish. Surface a clear
      // admin-facing message instead of the raw Postgres FK error.
      if (msg.includes("_fkey")) {
        throw new Error(
          "This team is already part of the generated bracket (or is the recorded champion) and can't be deleted directly. Reset the bracket first if you need to remove it.",
        );
      }
      throw e;
    }
    await insertSrAudit(client, team.tournament_id, "team.remove", { teamId, name: team.name }, actor);
    return team.tournament_slug as string;
  });
  if (slug) refresh(slug);
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/**
 * Randomly assign seeds 1..N to every team in the tournament. Safe to call
 * again before the bracket is generated (a reroll) — not safe afterward
 * (the bracket would no longer match the seed order), so it's gated on
 * `seed_locked = false`.
 */
export async function rollSeeds(tournamentId: string): Promise<void> {
  const actor = await requireAdmin();
  const slug = await withTransaction(async (client) => {
    const { rows: tRows } = await client.sql`
      SELECT * FROM sr_tournaments WHERE id = ${tournamentId} FOR UPDATE
    `;
    if (tRows.length === 0) throw new Error("Tournament not found.");
    const tournament = tRows[0];
    if (tournament.seed_locked) {
      throw new Error("Seeds are already locked for this tournament. Reset the bracket to reroll.");
    }

    // Approved teams only. A captain-submitted team sitting at `pending`
    // hasn't been reviewed yet, and a `rejected` one has been turned down —
    // neither belongs in the seed order. Admin-created teams are `approved`
    // by column default, so the task-1 flow is unaffected.
    const { rows: teamRows } = await client.sql`
      SELECT id FROM sr_teams WHERE tournament_id = ${tournamentId} AND status = 'approved' FOR UPDATE
    `;
    const count = teamRows.length;
    if (count < (tournament.min_teams as number)) {
      throw new Error(
        `Need at least ${tournament.min_teams} approved teams to roll seeds (have ${count}).`,
      );
    }
    if (count > (tournament.max_teams as number)) {
      throw new Error(`Too many teams (${count}); max is ${tournament.max_teams}.`);
    }

    // Clear every seed first: the partial unique index on (tournament_id,
    // seed) would otherwise reject the reassignment mid-loop the moment two
    // teams' new/old seed numbers momentarily collide.
    await client.query(`UPDATE sr_teams SET seed = NULL WHERE tournament_id = $1`, [tournamentId]);

    const shuffled = shuffle(teamRows.map((r) => r.id as string));
    for (let i = 0; i < shuffled.length; i++) {
      await client.query(`UPDATE sr_teams SET seed = $2 WHERE id = $1`, [shuffled[i], i + 1]);
    }

    await client.query(
      `UPDATE sr_tournaments SET status = 'seeding', seed_locked = true,
         signups_open = false, updated_at = now() WHERE id = $1`,
      [tournamentId],
    );
    await insertSrAudit(client, tournamentId, "seed.roll", { teamCount: count }, actor);
    return tournament.slug as string;
  });
  refresh(slug);
}

/** Unlock seeding (e.g. to add/remove a team before generating the bracket). Only valid pre-bracket. */
export async function unlockSeeds(tournamentId: string): Promise<void> {
  await requireAdmin();
  const slug = await withTransaction(async (client) => {
    const { rows } = await client.sql`
      SELECT * FROM sr_tournaments WHERE id = ${tournamentId} FOR UPDATE
    `;
    if (rows.length === 0) throw new Error("Tournament not found.");
    const tournament = rows[0];
    if (tournament.status !== "seeding") {
      throw new Error("Can only unlock seeding before the bracket has been generated.");
    }
    await client.query(
      `UPDATE sr_tournaments SET status = 'draft', seed_locked = false, updated_at = now() WHERE id = $1`,
      [tournamentId],
    );
    return tournament.slug as string;
  });
  refresh(slug);
}

// ---------------------------------------------------------------------------
// Bracket generation
// ---------------------------------------------------------------------------

export async function generateBracket(tournamentId: string): Promise<void> {
  const actor = await requireAdmin();
  const slug = await withTransaction(async (client) => {
    const { rows: tRows } = await client.sql`
      SELECT * FROM sr_tournaments WHERE id = ${tournamentId} FOR UPDATE
    `;
    if (tRows.length === 0) throw new Error("Tournament not found.");
    const tournament = tRows[0];
    if (!tournament.seed_locked) {
      throw new Error("Roll seeds before generating the bracket.");
    }

    const { rows: existingMatches } = await client.sql`
      SELECT count(*)::int as c FROM sr_matches WHERE tournament_id = ${tournamentId} AND status != 'pending'
    `;
    if (existingMatches[0].c > 0) {
      throw new Error("This tournament already has reported results — reset it explicitly before regenerating.");
    }

    const { rows: teamRows } = await client.sql`
      SELECT id, seed FROM sr_teams
      WHERE tournament_id = ${tournamentId} AND status = 'approved' AND seed IS NOT NULL
      ORDER BY seed ASC
    `;
    if (teamRows.length < (tournament.min_teams as number)) {
      throw new Error(`Need at least ${tournament.min_teams} seeded teams.`);
    }

    // Drop the presentation's pointer into the old bracket FIRST. The
    // sr_tournaments_active_match_fkey composite FK is ON DELETE NO ACTION,
    // so deleting a match that active_match_id still references would abort
    // the whole transaction. Demote the scene with it — "match" with nothing
    // to show is a blank screen on the stream.
    await client.query(
      `UPDATE sr_tournaments
       SET active_match_id = NULL,
           scene = CASE WHEN scene = 'match' THEN 'bracket' ELSE scene END
       WHERE id = $1`,
      [tournamentId],
    );

    // Clear any prior (all-pending) bracket before regenerating.
    await client.query(`DELETE FROM sr_matches WHERE tournament_id = $1`, [tournamentId]);

    const teamIdsBySeed = teamRows.map((r) => r.id as string);
    const built = resolveByes(
      buildKnockoutBracket(teamIdsBySeed, {
        tournamentId,
        knockoutBestOf: tournament.best_of as 1 | 3 | 5,
        doubleElimination: tournament.format === "double_elim",
        thirdPlaceMatch: tournament.third_place_match as boolean,
        grandFinalReset: tournament.grand_final_reset as boolean,
        grandFinalBestOf: tournament.grand_final_best_of as 1 | 3 | 5 | null,
        idFactory: () => newId("srmatch"),
      }),
    );

    // Two-pass insert: sr_matches_advances_to_fkey / sr_matches_drops_to_fkey
    // are non-deferrable self-referencing FKs, so a match cannot reference
    // another match's id before that row exists. Pass 1 inserts every row
    // with both links null; pass 2 updates the links once every id is present.
    for (const m of built) {
      await client.query(
        `INSERT INTO sr_matches
           (id, tournament_id, bracket, round_number, match_number, best_of,
            team_a_id, team_b_id, team_a_score, team_b_score, winner_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          m.id,
          tournamentId,
          m.bracket,
          m.round_number,
          m.match_number,
          m.best_of,
          m.team_a_id,
          m.team_b_id,
          m.team_a_score,
          m.team_b_score,
          m.winner_id,
          m.status,
        ],
      );
    }
    for (const m of built) {
      if (!m.advances_to_match_id && !m.drops_to_match_id) continue;
      await client.query(
        `UPDATE sr_matches SET advances_to_match_id = $2, advances_to_slot = $3,
           drops_to_match_id = $4, drops_to_slot = $5 WHERE id = $1`,
        [m.id, m.advances_to_match_id, m.advances_to_slot, m.drops_to_match_id, m.drops_to_slot],
      );
    }

    // A bye-cascade at build time can already crown a champion (e.g. a
    // 2-team tournament, or every non-top seed byeing straight through) —
    // check for that before defaulting to 'bracket_published'.
    const terminalFinal = built.find((m) => m.bracket === "grand_final" && !m.advances_to_match_id);
    const champion = terminalFinal?.status === "completed" || terminalFinal?.status === "bye"
      ? terminalFinal.winner_id
      : null;

    await client.query(
      `UPDATE sr_tournaments SET status = $2, champion_team_id = $3, updated_at = now() WHERE id = $1`,
      [tournamentId, champion ? "completed" : "bracket_published", champion],
    );
    await insertSrAudit(client, tournamentId, "bracket.generate", { matchCount: built.length }, actor);
    // New bracket, new reveal: reset UBR1 progress and bump the generation
    // so a stale client can never mistake old reveal progress for new-bracket
    // progress. Default is fully-revealed-looking (count starts at 0, but
    // the live screen treats generation mismatch as "show everything") is
    // NOT what we want here — a fresh bracket always starts unrevealed, and
    // the admin explicitly clicks Start to begin the staged reveal.
    await client.query(
      `UPDATE sr_tournaments
       SET ubr1_revealed_count = 0, ubr1_reveal_generation = ubr1_reveal_generation + 1,
           ubr1_reveal_started_at = NULL, ubr1_reveal_run_id = NULL
       WHERE id = $1`,
      [tournamentId],
    );
    return tournament.slug as string;
  });
  refresh(slug);
}

// ---------------------------------------------------------------------------
// Live match control
// ---------------------------------------------------------------------------

export async function reportMatchResult(
  matchId: string,
  teamAScore: number,
  teamBScore: number,
): Promise<void> {
  const actor = await requireAdmin();

  const slug = await withTransaction(async (client) => {
    const { rows: mRows } = await client.sql`
      SELECT m.*, t.slug as tournament_slug, t.status as tournament_status
      FROM sr_matches m JOIN sr_tournaments t ON t.id = m.tournament_id
      WHERE m.id = ${matchId} FOR UPDATE OF m, t
    `;
    if (mRows.length === 0) throw new Error("Match not found.");
    const match = mRows[0];
    if (match.tournament_status === "completed" && match.bracket !== "third_place") {
      throw new Error("This tournament is already completed.");
    }

    const graph = await loadBracketForUpdate(client, match.tournament_id as string);
    const result = applyBracketResult(graph, matchId, teamAScore, teamBScore);
    await persistBracketState(client, graph);

    if (result.championId) {
      await client.query(
        `UPDATE sr_tournaments
         SET status = 'completed', champion_team_id = $2,
             scene = 'champion', active_match_id = NULL, countdown_ends_at = NULL,
             updated_at = now()
         WHERE id = $1`,
        [match.tournament_id, result.championId],
      );
    } else {
      // A late third-place result is allowed after the final, but must never
      // regress a completed tournament back to in_progress.
      await client.query(
        `UPDATE sr_tournaments SET status = 'in_progress', updated_at = now()
         WHERE id = $1 AND status = 'bracket_published'`,
        [match.tournament_id],
      );
      // Clear the live screen's pointer only if it was pointing at THIS
      // match. Scoping it matters: an operator reporting a side-bracket
      // result while the stream is showing the feature match shouldn't have
      // the scene yanked out from under them. (ARAM Mayhem clears
      // unconditionally; SR runs several matches concurrently, so it can't.)
      await client.query(
        `UPDATE sr_tournaments
         SET active_match_id = NULL, scene = CASE WHEN scene = 'match' THEN 'bracket' ELSE scene END
         WHERE id = $1 AND active_match_id = $2`,
        [match.tournament_id, matchId],
      );
    }

    await insertSrAudit(
      client,
      match.tournament_id,
      "match.report",
      { matchId, teamAScore, teamBScore, winnerId: result.winnerId },
      actor,
    );
    return match.tournament_slug as string;
  });
  refresh(slug);
}

/** Undo a completed match, including transitive auto-bye advancement. */
export async function undoMatchResult(matchId: string): Promise<void> {
  const actor = await requireAdmin();
  const slug = await withTransaction(async (client) => {
    const { rows: mRows } = await client.sql`
      SELECT m.*, t.slug as tournament_slug FROM sr_matches m
      JOIN sr_tournaments t ON t.id = m.tournament_id
      WHERE m.id = ${matchId} FOR UPDATE OF m, t
    `;
    if (mRows.length === 0) throw new Error("Match not found.");
    const match = mRows[0];
    const previousWinner = match.winner_id as string | null;

    const graph = await loadBracketForUpdate(client, match.tournament_id as string);
    retractBracketResult(graph, matchId);
    await persistBracketState(client, graph);

    // Un-crowning also has to take the champion scene down with it, or the
    // live screen keeps celebrating a winner the bracket no longer has.
    await client.query(
      `UPDATE sr_tournaments
       SET champion_team_id = NULL, status = 'in_progress',
           scene = CASE WHEN scene = 'champion' THEN 'bracket' ELSE scene END,
           updated_at = now()
       WHERE id = $1 AND champion_team_id = $2`,
      [match.tournament_id, previousWinner],
    );
    // An undone match can't be the feature match any more — it has no result
    // and its downstream advancement was just retracted.
    await client.query(
      `UPDATE sr_tournaments
       SET active_match_id = NULL, scene = CASE WHEN scene = 'match' THEN 'bracket' ELSE scene END
       WHERE id = $1 AND active_match_id = $2`,
      [match.tournament_id, matchId],
    );
    await insertSrAudit(client, match.tournament_id, "match.undo", { matchId }, actor);
    return match.tournament_slug as string;
  });
  refresh(slug);
}

// ---------------------------------------------------------------------------
// Presentation desk (drives /srlive/[slug])
// ---------------------------------------------------------------------------
//
// Scene state is deliberately separate from `status`. `status` is what the
// tournament IS (draft / seeding / bracket_published / in_progress /
// completed) and is derived from real progress; `scene` is only what the
// stream overlay is currently SHOWING, and an operator flips it freely
// without changing a single fact about the tournament. Nothing in the
// bracket engine, seeding, or signup gating reads these columns.
//
// Every scene mutation and its audit row share one transaction. Active-match
// selection also performs an application-level tournament ownership check so
// bad input yields a clear error before the composite FK is reached.

export async function setScene(tournamentId: string, scene: SrMatchScene): Promise<void> {
  const actor = await requireAdmin();
  if (!SR_SCENES.includes(scene)) throw new Error("Unknown scene.");

  const slug = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE sr_tournaments SET scene = $2, updated_at = now()
       WHERE id = $1 RETURNING slug`,
      [tournamentId, scene],
    );
    if (rows.length === 0) throw new Error("Tournament not found.");
    await insertSrAudit(client, tournamentId, "scene.set", { scene }, actor);
    return rows[0].slug as string;
  });
  refresh(slug);
}

/** Start a server-timestamped starting-soon countdown. */
export async function startCountdown(tournamentId: string, seconds: number): Promise<void> {
  const actor = await requireAdmin();
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) {
    throw new Error("Countdown must be between 1 and 3600 seconds.");
  }
  const endsAt = new Date(Date.now() + seconds * 1000).toISOString();
  const slug = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE sr_tournaments
       SET scene = 'starting_soon', countdown_ends_at = $2, updated_at = now()
       WHERE id = $1 RETURNING slug`,
      [tournamentId, endsAt],
    );
    if (rows.length === 0) throw new Error("Tournament not found.");
    await insertSrAudit(client, tournamentId, "scene.set", { scene: "starting_soon", seconds }, actor);
    return rows[0].slug as string;
  });
  refresh(slug);
}

/** Select a tournament-owned match for the live screen, or return to bracket. */
export async function setActiveMatch(tournamentId: string, matchId: string | null): Promise<void> {
  const actor = await requireAdmin();
  const slug = await withTransaction(async (client) => {
    const { rows: tournamentRows } = await client.query(
      `SELECT slug FROM sr_tournaments WHERE id = $1 FOR UPDATE`,
      [tournamentId],
    );
    if (tournamentRows.length === 0) throw new Error("Tournament not found.");
    if (matchId) {
      const { rows: matchRows } = await client.query(
        `SELECT id FROM sr_matches WHERE id = $1 AND tournament_id = $2`,
        [matchId, tournamentId],
      );
      if (matchRows.length === 0) throw new Error("Match not found in this tournament.");
    }
    await client.query(
      `UPDATE sr_tournaments
       SET active_match_id = $2, scene = $3, updated_at = now()
       WHERE id = $1`,
      [tournamentId, matchId, matchId ? "match" : "bracket"],
    );
    await insertSrAudit(
      client,
      tournamentId,
      "scene.set",
      { scene: matchId ? "match" : "bracket", matchId },
      actor,
    );
    return tournamentRows[0].slug as string;
  });
  refresh(slug);
}

/** Admin override for deleting a stalled application and releasing reservations. */
export async function withdrawTeamApplication(applicationId: string): Promise<void> {
  const actor = await requireAdmin();
  await ensureSchema();
  const slug = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT a.tournament_id, a.team_name, t.slug
       FROM sr_team_applications a
       JOIN sr_tournaments t ON t.id = a.tournament_id
       WHERE a.id = $1
       FOR UPDATE OF a, t`,
      [applicationId],
    );
    if (rows.length === 0) throw new Error("Application not found.");
    await client.query(`DELETE FROM sr_team_applications WHERE id = $1`, [applicationId]);
    await insertSrAudit(
      client,
      rows[0].tournament_id,
      "team.application_withdraw",
      { applicationId, name: rows[0].team_name, by: "admin" },
      actor,
    );
    return rows[0].slug as string;
  });
  refresh(slug);
}

// ---------------------------------------------------------------------------
// Upper-bracket Round 1 staged reveal
// ---------------------------------------------------------------------------
//
// Admin-controlled, persisted (see sr-db.ts ubr1_revealed_count /
// ubr1_reveal_generation). Start/Next/Reset all lock the tournament row and
// write their audit entry in the same transaction as the mutation.

/**
 * Starts (or replays) the automatic Round 1 reveal on the live screen. The
 * whole sequence is timed client-side off `ubr1_reveal_started_at` — this
 * action's only job is to stamp a fresh server timestamp and a fresh
 * `ubr1_reveal_run_id` so every connected client (and one that reconnects
 * mid-sequence) computes the exact same animation frame from elapsed time,
 * never from a manually-clicked step count.
 */
export async function startUbr1Reveal(tournamentId: string): Promise<void> {
  const actor = await requireAdmin();
  const slug = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT slug FROM sr_tournaments WHERE id = $1 FOR UPDATE`,
      [tournamentId],
    );
    if (rows.length === 0) throw new Error("Tournament not found.");
    const { rows: countRows } = await client.query(
      `SELECT count(*)::int AS c FROM sr_matches WHERE tournament_id = $1 AND bracket = 'upper' AND round_number = 1`,
      [tournamentId],
    );
    const total = countRows[0].c as number;
    if (total === 0) throw new Error("No upper-bracket Round 1 matchups exist yet.");
    const runId = newId("srreveal");
    await client.query(
      `UPDATE sr_tournaments
       SET ubr1_revealed_count = $2, ubr1_reveal_started_at = now(), ubr1_reveal_run_id = $3, updated_at = now()
       WHERE id = $1`,
      [tournamentId, total, runId],
    );
    await insertSrAudit(client, tournamentId, "reveal.start", { runId, total }, actor);
    return rows[0].slug as string;
  });
  refresh(slug);
}

/** Hides every Round 1 matchup again and shows the full bracket immediately — does NOT bump the generation, so this is a true rewind, not a new bracket. */
export async function resetUbr1Reveal(tournamentId: string): Promise<void> {
  const actor = await requireAdmin();
  const slug = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE sr_tournaments
       SET ubr1_revealed_count = 0, ubr1_reveal_started_at = NULL, ubr1_reveal_run_id = NULL, updated_at = now()
       WHERE id = $1 RETURNING slug`,
      [tournamentId],
    );
    if (rows.length === 0) throw new Error("Tournament not found.");
    await insertSrAudit(client, tournamentId, "reveal.reset", {}, actor);
    return rows[0].slug as string;
  });
  refresh(slug);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
//
// getTournamentFull is intentionally NOT re-exported here (or anywhere).
// This file has "use server" at the top, which makes every exported async
// function a directly, remotely callable RPC endpoint with no path-based
// authorization at all — unlike a page component, which only renders after
// isToolsSession() gates it. A bare re-export here would let anyone who
// found the endpoint read full tournament data (including draft-status
// tournaments not yet meant to be public) with zero auth check, the same
// class of bug writeAudit had. Callers that need this data should import
// getTournamentFull directly from @/lib/sr-db in server components (which
// already gate on isToolsSession()), not through this actions file.

// ---------------------------------------------------------------------------
// Team logo upload (Vercel Blob)
// ---------------------------------------------------------------------------

/**
 * Admin-authorized logo upload. The file never round-trips through the
 * client to Blob: the browser posts multipart form data to this action, the
 * server validates + re-encodes it with sharp, uploads to our own Blob
 * store, and only then writes the resulting permanent URL. A raw Discord
 * CDN URL (or any other third-party link) can never reach
 * sr_teams.logo_url — updateTeam() enforces that independently via
 * assertOwnBlobUrl().
 *
 * Unlike the mutations above this one deliberately does NOT run the upload
 * inside the transaction: an HTTP upload to Blob can take seconds, and
 * holding a Postgres row lock open across it would serialize every other
 * admin action behind a network call. The DB write that follows is the
 * transactional part.
 */
export async function uploadTeamLogoAction(
  teamId: string,
  formData: FormData,
): Promise<{ url: string }> {
  await requireAdmin();

  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("No file was uploaded.");

  const { rows } = await sql`
    SELECT tournament_id, logo_url FROM sr_teams WHERE id = ${teamId}
  `;
  if (rows.length === 0) throw new Error("Team not found.");
  const previous = (rows[0].logo_url as string) ?? null;

  const { url } = await uploadTeamLogo(file, `sr/${rows[0].tournament_id as string}/${teamId}`);
  // updateTeam() re-checks admin auth (cheap: the session is already
  // verified and cached within this request's reverify window) and owns the
  // transaction + audit row, so the new URL lands through exactly the same
  // validated path as a manual rename.
  await updateTeam(teamId, { logoUrl: url });
  // Only after the new URL is durably committed is the old blob removed —
  // a failure between upload and commit leaves an orphan, never a team
  // pointing at a deleted image.
  await deleteTeamLogo(previous);
  return { url };
}

/** Clear a team's logo and delete the stored blob. */
export async function clearTeamLogoAction(teamId: string): Promise<void> {
  await requireAdmin();
  const { rows } = await sql`SELECT logo_url FROM sr_teams WHERE id = ${teamId}`;
  if (rows.length === 0) throw new Error("Team not found.");
  await updateTeam(teamId, { logoUrl: null });
  await deleteTeamLogo((rows[0].logo_url as string) ?? null);
}

// ---------------------------------------------------------------------------
// Captain signups — admin side
// ---------------------------------------------------------------------------
//
// The captain-facing half of this lives in src/app/captain/actions.ts behind
// its OWN auth gate (isCaptainSession, a different cookie and a different
// table — see src/lib/captain-session-db.ts). Nothing below broadens the
// admin gate; these are the two levers an admin pulls over that flow:
// whether signups are open, and whether a submitted team is in the field.

/** Open or close captain signups for a tournament. */
export async function setSignupsOpen(
  tournamentId: string,
  open: boolean,
): Promise<void> {
  const actor = await requireAdmin();
  const slug = await withTransaction(async (client) => {
    const { rows } = await client.sql`
      SELECT slug, status FROM sr_tournaments WHERE id = ${tournamentId} FOR UPDATE
    `;
    if (rows.length === 0) throw new Error("Tournament not found.");
    // Once seeds are rolled the field is fixed; reopening signups then would
    // let a team register into a tournament it can no longer be seeded into.
    if (open && rows[0].status !== "draft") {
      throw new Error("Signups can only be opened while the tournament is in draft.");
    }
    await client.query(
      `UPDATE sr_tournaments SET signups_open = $2, updated_at = now() WHERE id = $1`,
      [tournamentId, open],
    );
    await insertSrAudit(client, tournamentId, "signups.toggle", { open }, actor);
    return rows[0].slug as string;
  });
  refresh(slug);
}

/** Approve or reject a captain-submitted team. */
export async function setTeamStatus(
  teamId: string,
  status: "pending" | "approved" | "rejected",
): Promise<void> {
  const actor = await requireAdmin();
  const slug = await withTransaction(async (client) => {
    // Lock the tournament first, then the team — same order every other
    // application/team code path uses, so this can never deadlock against
    // withTournamentLock in captain/actions.ts.
    const { rows: preRows } = await client.query(
      `SELECT tournament_id FROM sr_teams WHERE id = $1`,
      [teamId],
    );
    if (preRows.length === 0) throw new Error("Team not found.");
    await client.query(`SELECT id FROM sr_tournaments WHERE id = $1 FOR UPDATE`, [
      preRows[0].tournament_id,
    ]);

    const { rows } = await client.sql`
      SELECT t.*, tr.slug as tournament_slug, tr.status as tournament_status,
             tr.max_teams as tournament_max_teams
      FROM sr_teams t
      JOIN sr_tournaments tr ON tr.id = t.tournament_id
      WHERE t.id = ${teamId} FOR UPDATE OF t
    `;
    if (rows.length === 0) throw new Error("Team not found.");
    const team = rows[0];
    if (team.tournament_status !== "draft" || team.seed !== null) {
      throw new Error("Team approval can only change before seeding begins.");
    }
    if (status === "approved" && team.status !== "approved") {
      const { rows: approvedRows } = await client.query(
        `SELECT count(*)::int AS c FROM sr_teams
         WHERE tournament_id = $1 AND status = 'approved' AND id <> $2`,
        [team.tournament_id, teamId],
      );
      if (approvedRows[0].c >= (team.tournament_max_teams as number)) {
        throw new Error(`Tournament is capped at ${team.tournament_max_teams} approved teams.`);
      }
    }
    await client.query(`UPDATE sr_teams SET status = $2 WHERE id = $1`, [teamId, status]);
    if (status !== "rejected" && team.status === "rejected") {
      // Reactivating a rejected team: re-check every player against the SAME
      // reservation surface addRosterPlayer/isDiscordIdReserved use (active
      // rosters + live application slots) before flipping reservations back
      // on, so a person who joined elsewhere while this team was rejected
      // can't be silently double-booked.
      const { rows: playerRows } = await client.query(
        `SELECT id, discord_id FROM sr_team_players WHERE team_id = $1`,
        [teamId],
      );
      for (const p of playerRows) {
        const { rows: conflictRows } = await client.query(
          `SELECT 1 FROM sr_team_players
           WHERE tournament_id = $1 AND discord_id = $2 AND reservation_active AND id <> $3
           UNION ALL
           SELECT 1 FROM sr_team_application_slots s
           JOIN sr_team_applications a ON a.id = s.application_id
           WHERE a.tournament_id = $1 AND s.member_discord_id = $2
             AND (s.status = 'confirmed'
                  OR (s.status = 'pending' AND (s.confirm_token_expires_at IS NULL OR s.confirm_token_expires_at > now())))`,
          [team.tournament_id, p.discord_id, p.id],
        );
        if (conflictRows.length > 0) {
          throw new Error(
            "Can't reactivate: one or more players joined another team or application while this team was rejected.",
          );
        }
      }
    }
    try {
      await client.query(
        `UPDATE sr_team_players SET reservation_active = $2 WHERE team_id = $1`,
        [teamId, status !== "rejected"],
      );
    } catch (error) {
      if ((error as Error).message.includes("sr_team_players_active_team_per_tournament")) {
        throw new Error("One or more players joined another team while this team was rejected.");
      }
      throw error;
    }
    await insertSrAudit(
      client,
      team.tournament_id,
      "team.status",
      { teamId, name: team.name, status },
      actor,
    );
    return team.tournament_slug as string;
  });
  refresh(slug);
}
