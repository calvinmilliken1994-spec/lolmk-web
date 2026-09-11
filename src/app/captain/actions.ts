"use server";

import { sql, type VercelPoolClient } from "@vercel/postgres";
import { revalidatePath } from "next/cache";
import { getCaptainSession } from "@/lib/discord-auth";
import { ensureSchema, newId } from "@/lib/sr-db";
import { assertOwnBlobUrl, deleteTeamLogo, uploadTeamLogo } from "@/lib/team-logo";
import { lookupKrRank } from "@/lib/riot";
import { SR_PLAYER_ROLES, SR_RANKS } from "@/types/sr-tournament";
import type { SrPlayerRole, SrRank } from "@/types/sr-tournament";

/**
 * Captain self-service write layer.
 *
 * Auth boundary: every action begins with requireCaptain(), which reads the
 * `lolmk-captain-session` cookie and validates it against `captain_sessions`
 * + the live CAPTAIN_ROLE_ID membership check. It does NOT call
 * isToolsSession() and nothing here can be reached with an admin cookie
 * alone — the two systems share a Discord app and nothing else.
 *
 * Ownership: authentication only establishes *who* the caller is. Every
 * mutation below additionally proves the row belongs to them, in SQL, in the
 * same statement that locks or writes it — `WHERE captain_discord_id = $x`
 * — rather than fetching the row and checking in JS. A captain who guesses
 * another team's id gets "not found", which is also what they'd get for an
 * id that doesn't exist.
 *
 * Fails closed on missing config: getCaptainSession() returns null whenever
 * CAPTAIN_ROLE_ID is unset, so until the role id is supplied every action
 * here throws "Not authorized." There is no bypass branch.
 */

const MAX_ROSTER = 10; // 5 starters + up to 5 subs

async function requireCaptain() {
  const identity = await getCaptainSession();
  if (!identity) throw new Error("Not authorized.");
  return identity;
}

/** Local copy of the transactional helper — "use server" modules can only export async functions. */
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
      // Connection may already be dead; nothing further to do.
    }
    throw e;
  } finally {
    client.release();
  }
}

function refresh(slug?: string) {
  revalidatePath("/captain");
  // The admin dashboard shows pending signups, so it needs invalidating too.
  revalidatePath("/tools/summoners-rift");
  revalidatePath("/tournaments/summoners-rift");
  if (slug) revalidatePath(`/tournaments/summoners-rift/${slug}`);
}

function normaliseRole(value: unknown): SrPlayerRole {
  const v = String(value ?? "").toUpperCase();
  return (SR_PLAYER_ROLES as string[]).includes(v) ? (v as SrPlayerRole) : "FILL";
}

/** Ranks are free text in the DB; this is where the vocabulary is enforced. */
function normaliseRank(value: unknown): SrRank | null {
  if (value === null || value === undefined || value === "") return null;
  const v = String(value).toUpperCase();
  return (SR_RANKS as readonly string[]).includes(v) ? (v as SrRank) : null;
}

function cleanIgn(value: unknown): string {
  const v = String(value ?? "").trim();
  if (!v) throw new Error("In-game name is required.");
  if (v.length > 60) throw new Error("In-game name is too long.");
  return v;
}

function cleanDiscordId(value: unknown): string {
  const v = String(value ?? "").trim();
  // Discord snowflakes are numeric strings. Typed by hand by the captain, so
  // this is a format check, not a claim that the account exists or consented.
  if (!/^\d{15,25}$/.test(v)) {
    throw new Error("Discord ID must be the numeric user ID (17-19 digits), not a username.");
  }
  return v;
}

/**
 * Load a team the caller owns, FOR UPDATE, inside an existing transaction.
 * The ownership predicate is part of the query — the row is never fetched
 * for anyone but its captain.
 */
async function lockOwnTeam(client: VercelPoolClient, teamId: string, discordId: string) {
  const { rows } = await client.query(
    `SELECT t.*, tr.slug AS tournament_slug, tr.status AS tournament_status,
            tr.signups_open AS tournament_signups_open
     FROM sr_teams t
     JOIN sr_tournaments tr ON tr.id = t.tournament_id
     WHERE t.id = $1 AND t.captain_discord_id = $2
     FOR UPDATE OF t`,
    [teamId, discordId],
  );
  if (rows.length === 0) throw new Error("Team not found.");
  return rows[0];
}

/**
 * A captain may only restructure their team while it hasn't been seeded and
 * the tournament is still in draft. After seeding the field is fixed and any
 * change has to go through an admin.
 */
function assertEditable(team: Record<string, unknown>) {
  if (team.seed !== null && team.seed !== undefined) {
    throw new Error("Your team has been seeded into the bracket. Ask an admin for any changes.");
  }
  if (team.tournament_status !== "draft") {
    throw new Error("The tournament has moved past setup. Ask an admin for any changes.");
  }
}

// ---------------------------------------------------------------------------
// Signup
// ---------------------------------------------------------------------------

export async function createTeam(input: {
  tournamentId: string;
  name: string;
  ign: string;
  role?: string;
  currentRank?: string | null;
  peakRank?: string | null;
}): Promise<string> {
  const captain = await requireCaptain();
  await ensureSchema();

  const name = input.name.trim();
  if (!name) throw new Error("Team name is required.");
  if (name.length > 60) throw new Error("Team name is too long.");
  const ign = cleanIgn(input.ign);
  const role = normaliseRole(input.role);
  const currentRank = normaliseRank(input.currentRank);
  const peakRank = normaliseRank(input.peakRank);

  const { teamId, slug } = await withTransaction(async (client) => {
    const { rows: tRows } = await client.query(
      `SELECT * FROM sr_tournaments WHERE id = $1 FOR UPDATE`,
      [input.tournamentId],
    );
    if (tRows.length === 0) throw new Error("Tournament not found.");
    const tournament = tRows[0];
    // Both gates matter: signups_open is the admin's switch, and the draft
    // check stops a stale open flag from admitting a team into a tournament
    // that has already been seeded.
    if (!tournament.signups_open || tournament.status !== "draft") {
      throw new Error("Signups are not open for this tournament.");
    }

    const { rows: countRows } = await client.query(
      `SELECT count(*)::int AS c FROM sr_teams WHERE tournament_id = $1 AND status <> 'rejected'`,
      [input.tournamentId],
    );
    if (countRows[0].c >= (tournament.max_teams as number)) {
      throw new Error("This tournament is full.");
    }

    const teamId = newId("srteam");
    try {
      await client.query(
        `INSERT INTO sr_teams (id, tournament_id, name, captain_discord_id, status)
         VALUES ($1, $2, $3, $4, 'pending')`,
        [teamId, input.tournamentId, name, captain.discordUserId],
      );
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("sr_teams_name_unique")) {
        throw new Error(`A team named "${name}" is already registered.`);
      }
      if (msg.includes("sr_teams_captain_unique")) {
        throw new Error("You already have a team registered for this tournament.");
      }
      throw e;
    }

    // The captain is automatically the first roster entry.
    try {
      await client.query(
        `INSERT INTO sr_team_players
           (id, team_id, tournament_id, discord_id, ign, role, current_rank, peak_rank, is_captain)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
        [
          newId("srplayer"),
          teamId,
          input.tournamentId,
          captain.discordUserId,
          ign,
          role,
          currentRank,
          peakRank,
        ],
      );
    } catch (e) {
      if ((e as Error).message.includes("sr_team_players_one_team_per_tournament")) {
        throw new Error("You are already rostered on a team in this tournament.");
      }
      throw e;
    }

    await client.query(
      `INSERT INTO sr_audit_log (tournament_id, action, detail) VALUES ($1, 'team.signup', $2::jsonb)`,
      [input.tournamentId, JSON.stringify({ teamId, name, captain: captain.discordUserId })],
    );
    return { teamId, slug: tournament.slug as string };
  });

  refresh(slug);
  return teamId;
}

// ---------------------------------------------------------------------------
// My team
// ---------------------------------------------------------------------------

export async function updateMyTeam(teamId: string, input: { name: string }): Promise<void> {
  const captain = await requireCaptain();
  const name = input.name.trim();
  if (!name) throw new Error("Team name cannot be blank.");
  if (name.length > 60) throw new Error("Team name is too long.");

  const slug = await withTransaction(async (client) => {
    const team = await lockOwnTeam(client, teamId, captain.discordUserId);
    assertEditable(team);
    try {
      await client.query(`UPDATE sr_teams SET name = $2 WHERE id = $1`, [teamId, name]);
    } catch (e) {
      if ((e as Error).message.includes("sr_teams_name_unique")) {
        throw new Error(`A team named "${name}" is already registered.`);
      }
      throw e;
    }
    await client.query(
      `INSERT INTO sr_audit_log (tournament_id, action, detail) VALUES ($1, 'team.update', $2::jsonb)`,
      [team.tournament_id, JSON.stringify({ teamId, name, by: "captain" })],
    );
    return team.tournament_slug as string;
  });
  refresh(slug);
}

export async function disbandMyTeam(teamId: string): Promise<void> {
  const captain = await requireCaptain();
  const { slug, logoUrl } = await withTransaction(async (client) => {
    const team = await lockOwnTeam(client, teamId, captain.discordUserId);
    assertEditable(team);
    // Roster rows cascade on the composite FK; the delete is one statement.
    await client.query(`DELETE FROM sr_teams WHERE id = $1`, [teamId]);
    await client.query(
      `INSERT INTO sr_audit_log (tournament_id, action, detail) VALUES ($1, 'team.disband', $2::jsonb)`,
      [team.tournament_id, JSON.stringify({ teamId, name: team.name, by: "captain" })],
    );
    return {
      slug: team.tournament_slug as string,
      logoUrl: (team.logo_url as string) ?? null,
    };
  });
  // Blob cleanup only after the row is durably gone.
  await deleteTeamLogo(logoUrl);
  refresh(slug);
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

export async function addRosterPlayer(
  teamId: string,
  input: {
    discordId: string;
    ign: string;
    role?: string;
    currentRank?: string | null;
    peakRank?: string | null;
    isSubstitute?: boolean;
  },
): Promise<void> {
  const captain = await requireCaptain();
  const discordId = cleanDiscordId(input.discordId);
  const ign = cleanIgn(input.ign);
  const role = normaliseRole(input.role);
  const currentRank = normaliseRank(input.currentRank);
  const peakRank = normaliseRank(input.peakRank);

  const slug = await withTransaction(async (client) => {
    const team = await lockOwnTeam(client, teamId, captain.discordUserId);
    assertEditable(team);

    const { rows: countRows } = await client.query(
      `SELECT count(*)::int AS c FROM sr_team_players WHERE team_id = $1`,
      [teamId],
    );
    if (countRows[0].c >= MAX_ROSTER) {
      throw new Error(`Rosters are capped at ${MAX_ROSTER} players.`);
    }

    try {
      await client.query(
        `INSERT INTO sr_team_players
           (id, team_id, tournament_id, discord_id, ign, role, current_rank, peak_rank, is_substitute)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          newId("srplayer"),
          teamId,
          team.tournament_id,
          discordId,
          ign,
          role,
          currentRank,
          peakRank,
          Boolean(input.isSubstitute),
        ],
      );
    } catch (e) {
      if ((e as Error).message.includes("sr_team_players_one_team_per_tournament")) {
        throw new Error("That player is already rostered on a team in this tournament.");
      }
      throw e;
    }

    await client.query(
      `INSERT INTO sr_audit_log (tournament_id, action, detail) VALUES ($1, 'roster.add', $2::jsonb)`,
      [team.tournament_id, JSON.stringify({ teamId, ign, role })],
    );
    return team.tournament_slug as string;
  });
  refresh(slug);
}

export async function updateRosterPlayer(
  playerId: string,
  input: {
    ign?: string;
    role?: string;
    currentRank?: string | null;
    peakRank?: string | null;
    isSubstitute?: boolean;
  },
): Promise<void> {
  const captain = await requireCaptain();
  const slug = await withTransaction(async (client) => {
    // Ownership travels through the join: a player row is only reachable via
    // a team whose captain_discord_id is the caller's.
    const { rows } = await client.query(
      `SELECT p.*, t.seed, tr.slug AS tournament_slug, tr.status AS tournament_status
       FROM sr_team_players p
       JOIN sr_teams t ON t.id = p.team_id
       JOIN sr_tournaments tr ON tr.id = t.tournament_id
       WHERE p.id = $1 AND t.captain_discord_id = $2
       FOR UPDATE OF p`,
      [playerId, captain.discordUserId],
    );
    if (rows.length === 0) throw new Error("Player not found.");
    const player = rows[0];
    assertEditable(player);

    const ign = input.ign === undefined ? null : cleanIgn(input.ign);
    await client.query(
      `UPDATE sr_team_players SET
         ign = COALESCE($2, ign),
         role = COALESCE($3, role),
         current_rank = CASE WHEN $4 THEN $5 ELSE current_rank END,
         peak_rank = CASE WHEN $6 THEN $7 ELSE peak_rank END,
         is_substitute = COALESCE($8, is_substitute),
         -- Any hand-edit of the current rank invalidates a previous Riot
         -- corroboration; the badge must not survive the value it described.
         rank_verified_at = CASE WHEN $4 THEN NULL ELSE rank_verified_at END
       WHERE id = $1`,
      [
        playerId,
        ign,
        input.role === undefined ? null : normaliseRole(input.role),
        input.currentRank !== undefined,
        normaliseRank(input.currentRank),
        input.peakRank !== undefined,
        normaliseRank(input.peakRank),
        input.isSubstitute === undefined ? null : input.isSubstitute,
      ],
    );
    return player.tournament_slug as string;
  });
  refresh(slug);
}

export async function removeRosterPlayer(playerId: string): Promise<void> {
  const captain = await requireCaptain();
  const slug = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT p.*, t.seed, tr.slug AS tournament_slug, tr.status AS tournament_status
       FROM sr_team_players p
       JOIN sr_teams t ON t.id = p.team_id
       JOIN sr_tournaments tr ON tr.id = t.tournament_id
       WHERE p.id = $1 AND t.captain_discord_id = $2
       FOR UPDATE OF p`,
      [playerId, captain.discordUserId],
    );
    if (rows.length === 0) throw new Error("Player not found.");
    const player = rows[0];
    assertEditable(player);
    if (player.is_captain) {
      throw new Error("You can't remove yourself. Disband the team instead.");
    }
    await client.query(`DELETE FROM sr_team_players WHERE id = $1`, [playerId]);
    await client.query(
      `INSERT INTO sr_audit_log (tournament_id, action, detail) VALUES ($1, 'roster.remove', $2::jsonb)`,
      [player.tournament_id, JSON.stringify({ playerId, ign: player.ign })],
    );
    return player.tournament_slug as string;
  });
  refresh(slug);
}

// ---------------------------------------------------------------------------
// Logo
// ---------------------------------------------------------------------------

/**
 * Ownership-scoped logo upload. Same storage path and same validation as the
 * admin action, but it can only ever write to a team the caller captains —
 * this is why TeamLogoUpload takes overridable actions instead of importing
 * the admin ones.
 */
export async function uploadMyTeamLogo(
  teamId: string,
  formData: FormData,
): Promise<{ url: string }> {
  const captain = await requireCaptain();
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("No file was uploaded.");

  const { rows } = await sql`
    SELECT tournament_id, logo_url FROM sr_teams
    WHERE id = ${teamId} AND captain_discord_id = ${captain.discordUserId}
  `;
  if (rows.length === 0) throw new Error("Team not found.");
  const previous = (rows[0].logo_url as string) ?? null;
  const tournamentId = rows[0].tournament_id as string;

  // Network I/O happens outside the transaction; only the URL write is
  // transactional (same rationale as the admin upload action).
  const { url } = await uploadTeamLogo(file, `sr/${tournamentId}/${teamId}`);
  assertOwnBlobUrl(url);

  const slug = await withTransaction(async (client) => {
    const team = await lockOwnTeam(client, teamId, captain.discordUserId);
    await client.query(`UPDATE sr_teams SET logo_url = $2 WHERE id = $1`, [teamId, url]);
    await client.query(
      `INSERT INTO sr_audit_log (tournament_id, action, detail) VALUES ($1, 'team.update', $2::jsonb)`,
      [team.tournament_id, JSON.stringify({ teamId, logoUrl: url, by: "captain" })],
    );
    return team.tournament_slug as string;
  });

  await deleteTeamLogo(previous);
  refresh(slug);
  return { url };
}

export async function clearMyTeamLogo(teamId: string): Promise<void> {
  const captain = await requireCaptain();
  const { slug, previous } = await withTransaction(async (client) => {
    const team = await lockOwnTeam(client, teamId, captain.discordUserId);
    await client.query(`UPDATE sr_teams SET logo_url = NULL WHERE id = $1`, [teamId]);
    return {
      slug: team.tournament_slug as string,
      previous: (team.logo_url as string) ?? null,
    };
  });
  await deleteTeamLogo(previous);
  refresh(slug);
}

// ---------------------------------------------------------------------------
// Optional Riot rank lookup
// ---------------------------------------------------------------------------

/**
 * Corroborate a roster row's self-reported current rank against the Riot API,
 * using the IGN the captain typed as a Riot ID ("Name#TAG").
 *
 * This does NOT verify identity: it confirms what tier that summoner is, not
 * that the listed Discord account plays on it. `rank_verified_at` records
 * only "a lookup agreed with this value at this time", and the UI says so.
 * Returns a result object rather than throwing so the caller can show
 * "not configured" as an ordinary state.
 */
export async function lookupRosterRank(
  playerId: string,
): Promise<
  | { ok: true; tier: SrRank; division: string | null; applied: boolean }
  | { ok: false; reason: string }
> {
  const captain = await requireCaptain();
  const { rows } = await sql`
    SELECT p.id, p.ign FROM sr_team_players p
    JOIN sr_teams t ON t.id = p.team_id
    WHERE p.id = ${playerId} AND t.captain_discord_id = ${captain.discordUserId}
  `;
  if (rows.length === 0) throw new Error("Player not found.");

  const result = await lookupKrRank(rows[0].ign as string);
  if (!result.ok) {
    const messages: Record<string, string> = {
      not_configured: "Rank lookup isn't configured on this site yet (no Riot API key).",
      bad_format: 'Enter the IGN as a full Riot ID, e.g. "Name#KR1", to look up a rank.',
      not_found: "No KR account found with that Riot ID.",
      rate_limited: "Riot's API is rate-limiting right now. Try again in a minute.",
      riot_error: "Riot's API didn't respond. The self-reported rank is unchanged.",
    };
    return { ok: false, reason: messages[result.reason] ?? "Lookup failed." };
  }

  const { rows: updatedRows } = await sql`
    UPDATE sr_team_players AS p
    SET current_rank = ${result.tier}, rank_verified_at = now()
    WHERE p.id = ${playerId}
      AND EXISTS (
        SELECT 1 FROM sr_teams t
        WHERE t.id = p.team_id
          AND t.captain_discord_id = ${captain.discordUserId}
      )
    RETURNING p.id
  `;
  // Ownership may have changed while the Riot request was in flight. The
  // write repeats the authorization predicate and must prove it changed the
  // row instead of trusting the earlier lookup.
  if (updatedRows.length === 0) throw new Error("Player not found.");
  refresh();
  return { ok: true, tier: result.tier, division: result.division ?? null, applied: true };
}
