"use server";

import { sql, type VercelPoolClient } from "@vercel/postgres";
import { revalidatePath } from "next/cache";
import { isToolsSession } from "@/lib/tools-auth";
import { ensureSchema, getMayhemFull, newId, SINGLETON_EVENT_ID } from "@/lib/mayhem-db";
import { pickTeamIdentities, shuffle } from "@/lib/mayhem-icons";
import { buildKnockoutBracket } from "@/lib/mayhem-bracket";
import {
  applyBracketResult,
  retractBracketResult,
  type BracketMatch,
} from "@/lib/bracket-engine";
import { buildGroupRoundRobin, computeGroupStandings } from "@/lib/mayhem-groups";
import type { MayhemFormatConfig, MayhemScene, MayhemTeamFormat } from "@/types/mayhem";
import { PREMADE_ROSTER_SIZE } from "@/types/mayhem";

async function requireAdmin() {
  const ok = await isToolsSession();
  if (!ok) throw new Error("Not authorized.");
}

function touch() {
  return sql`UPDATE mayhem_events SET updated_at = now() WHERE id = ${SINGLETON_EVENT_ID}`;
}

function refresh() {
  revalidatePath("/tools/mayhem");
  revalidatePath("/mayhemlive");
}

async function persistMayhemBracket(matches: BracketMatch[]): Promise<void> {
  for (const match of matches) {
    await sql.query(
      `UPDATE mayhem_matches SET team_a_id = $2, team_b_id = $3,
         team_a_score = $4, team_b_score = $5, winner_id = $6, status = $7
       WHERE id = $1 AND event_id = $8`,
      [
        match.id,
        match.team_a_id,
        match.team_b_id,
        match.team_a_score,
        match.team_b_score,
        match.winner_id,
        match.status,
        SINGLETON_EVENT_ID,
      ],
    );
  }
}

async function withEventLock<T>(fn: (client: VercelPoolClient) => Promise<T>): Promise<T> {
  const client = await sql.connect();
  try {
    await client.query("BEGIN");
    // Serializes every mutation that touches this event's roster/teams —
    // bulk import, single add, self-join, team create/join, randomize,
    // reset, and registration open/close all take this same row lock, so
    // two concurrent requests (e.g. two admins pasting a list at once, or
    // a 20th and 21st self-join landing together) can't both read a
    // stale MAX(entry_order)/player-count and then both insert.
    await client.query(`SELECT id FROM mayhem_events WHERE id = $1 FOR UPDATE`, [SINGLETON_EVENT_ID]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export async function addPlayer(displayName: string) {
  await requireAdmin();
  await ensureSchema();
  const name = displayName.trim();
  if (!name) return;
  await withEventLock(async (client) => {
    const { rows: modeRows } = await client.query(
      `SELECT team_format FROM mayhem_events WHERE id = $1`,
      [SINGLETON_EVENT_ID],
    );
    if (modeRows[0]?.team_format === "premade") {
      throw new Error("This event uses premade team signups — add players through a team, not solo.");
    }
    const { rows } = await client.query(
      `SELECT COALESCE(MAX(entry_order), -1) + 1 AS next FROM mayhem_players WHERE event_id = $1`,
      [SINGLETON_EVENT_ID],
    );
    await client.query(
      `INSERT INTO mayhem_players (id, event_id, display_name, entry_order, team_id, member_discord_id)
       VALUES ($1, $2, $3, $4, NULL, NULL)`,
      [newId("player"), SINGLETON_EVENT_ID, name, rows[0].next],
    );
  });
  await touch();
  refresh();
}

const MAX_BULK_NAMES = 300;
const MAX_NAME_LENGTH = 40;
/** Guards against a pathological paste (e.g. a whole file dropped in) before it's even split into lines. */
const MAX_BULK_TEXT_LENGTH = 20_000;

export interface BulkAddResult {
  added: number;
  skippedBlank: number;
  skippedDuplicate: number;
  skippedTooLong: number;
  errors: string[];
}

/**
 * Bulk-import a pasted player list, one name per line. Runs entirely under
 * the same event row lock as every other roster mutation (see
 * withEventLock) — the existing-name lookup and MAX(entry_order) read used
 * to happen outside any transaction, so two concurrent imports (or an
 * import racing a self-join) could both compute the same "next order" or
 * both miss each other's in-flight duplicate names. Locked, this becomes
 * one atomic batch: either every non-duplicate name lands, or (on an
 * unexpected failure) none of it does.
 */
export async function bulkAddPlayers(rawText: string): Promise<BulkAddResult> {
  await requireAdmin();
  await ensureSchema();
  if (typeof rawText !== "string") throw new Error("Invalid input.");
  if (rawText.length > MAX_BULK_TEXT_LENGTH) {
    throw new Error(`That paste is too large (max ${MAX_BULK_TEXT_LENGTH.toLocaleString()} characters).`);
  }

  const lines = rawText.split("\n").map((l) => l.trim());
  if (lines.length > MAX_BULK_NAMES) {
    throw new Error(`Paste at most ${MAX_BULK_NAMES} names at a time (got ${lines.length}).`);
  }

  return withEventLock(async (client) => {
    const { rows: modeRows } = await client.query(
      `SELECT team_format FROM mayhem_events WHERE id = $1`,
      [SINGLETON_EVENT_ID],
    );
    if (modeRows[0]?.team_format === "premade") {
      throw new Error("This event uses premade team signups — bulk-add doesn't apply.");
    }

    const { rows: existingRows } = await client.query(
      `SELECT display_name FROM mayhem_players WHERE event_id = $1`,
      [SINGLETON_EVENT_ID],
    );
    const existingLower = new Set(existingRows.map((r) => (r.display_name as string).toLowerCase()));
    const { rows: startRows } = await client.query(
      `SELECT COALESCE(MAX(entry_order), -1) + 1 AS next FROM mayhem_players WHERE event_id = $1`,
      [SINGLETON_EVENT_ID],
    );
    let nextOrder = startRows[0].next as number;

    const result: BulkAddResult = { added: 0, skippedBlank: 0, skippedDuplicate: 0, skippedTooLong: 0, errors: [] };
    const seenThisBatch = new Set<string>();

    for (const line of lines) {
      if (!line) {
        result.skippedBlank++;
        continue;
      }
      if (line.length > MAX_NAME_LENGTH) {
        result.skippedTooLong++;
        continue;
      }
      const lower = line.toLowerCase();
      if (existingLower.has(lower) || seenThisBatch.has(lower)) {
        result.skippedDuplicate++;
        continue;
      }
      seenThisBatch.add(lower);
      await client.query(
        `INSERT INTO mayhem_players (id, event_id, display_name, entry_order, team_id, member_discord_id)
         VALUES ($1, $2, $3, $4, NULL, NULL)`,
        [newId("player"), SINGLETON_EVENT_ID, line, nextOrder++],
      );
      result.added++;
    }

    if (result.added > 0) {
      await client.query(`UPDATE mayhem_events SET updated_at = now() WHERE id = $1`, [SINGLETON_EVENT_ID]);
    }
    return result;
  }).finally(() => {
    // refresh() calls revalidatePath, which is safe to run even if the
    // transaction above threw (nothing to revalidate then, but harmless).
    refresh();
  });
}

export async function removePlayer(playerId: string) {
  await requireAdmin();
  await sql`DELETE FROM mayhem_players WHERE id = ${playerId} AND event_id = ${SINGLETON_EVENT_ID}`;
  await touch();
  refresh();
}

export async function renamePlayer(playerId: string, displayName: string) {
  await requireAdmin();
  const name = displayName.trim();
  if (!name) return;
  await sql`
    UPDATE mayhem_players SET display_name = ${name}
    WHERE id = ${playerId} AND event_id = ${SINGLETON_EVENT_ID}
  `;
  await touch();
  refresh();
}

/**
 * Rename existing teams to fresh icon identities without touching rosters
 * or match state. Use this to fix teams that were created before the
 * filesystem-icon-discovery bug was fixed (see mayhem-icons.ts) and ended up
 * with generic "Team 1"-style names instead of real icon names. Skips any
 * team with a captain_discord_id — a premade team's name was chosen by its
 * captain, not auto-generated, and its icon was already the deliberate
 * server-picked default at creation; overwriting either here would stomp a
 * real team identity, not fix a generic placeholder.
 */
export async function refreshTeamIdentities() {
  await requireAdmin();
  const full = await getMayhemFull();
  const randomizedTeams = full.teams.filter((t) => !t.captain_discord_id);
  if (randomizedTeams.length === 0) return;

  const identities = shuffle(pickTeamIdentities(randomizedTeams.length));
  const orderedTeams = [...randomizedTeams].sort((a, b) => a.reveal_order - b.reveal_order);
  for (let i = 0; i < orderedTeams.length; i++) {
    const identity = identities[i];
    await sql`
      UPDATE mayhem_teams SET name = ${identity.name}, icon_url = ${identity.iconUrl}
      WHERE id = ${orderedTeams[i].id}
    `;
  }
  await touch();
  refresh();
}

export async function clearAllPlayers() {
  await requireAdmin();
  await withEventLock(async (client) => {
    await client.query(`DELETE FROM mayhem_matches WHERE event_id = $1`, [SINGLETON_EVENT_ID]);
    await client.query(`DELETE FROM mayhem_teams WHERE event_id = $1`, [SINGLETON_EVENT_ID]);
    await client.query(`DELETE FROM mayhem_groups WHERE event_id = $1`, [SINGLETON_EVENT_ID]);
    await client.query(`DELETE FROM mayhem_players WHERE event_id = $1`, [SINGLETON_EVENT_ID]);
    // Pending applications/invites are scoped to a registration_generation —
    // a reset must not leave them reachable against the fresh generation.
    await client.query(
      `DELETE FROM mayhem_team_applications WHERE event_id = $1`,
      [SINGLETON_EVENT_ID],
    );
    // Bumping registration_generation invalidates any invite link/session
    // holding the old generation number — see joinTeam()/createPremadeTeam()
    // below, which check it before writing. Without this, a browser tab
    // left open on an old invite link (or a slow request already in
    // flight when Reset is clicked) could land a join against the fresh
    // event as if it were still targeting the one that got wiped.
    await client.query(
      `UPDATE mayhem_events
       SET stage = 'collecting', scene = 'idle', reveal_index = 0,
           active_match_id = NULL, champion_team_id = NULL, countdown_ends_at = NULL,
           registration_open = false, registration_generation = registration_generation + 1
       WHERE id = $1`,
      [SINGLETON_EVENT_ID],
    );
  });
  refresh();
}

// ---------------------------------------------------------------------------
// Registration controls
// ---------------------------------------------------------------------------

/**
 * Locks in randomized vs premade for the event. Blocked (not "confirm and
 * wipe") the moment any player or team already exists — per the product
 * decision, changing formats mid-signup must go through Reset everything
 * first, never a silent format-preserving wipe of just the roster.
 */
export async function setTeamFormat(format: MayhemTeamFormat) {
  await requireAdmin();
  await ensureSchema();
  await withEventLock(async (client) => {
    const { rows: countRows } = await client.query(
      `SELECT
         (SELECT count(*) FROM mayhem_players WHERE event_id = $1) AS players,
         (SELECT count(*) FROM mayhem_teams WHERE event_id = $1) AS teams,
         (SELECT count(*) FROM mayhem_team_applications WHERE event_id = $1) AS applications`,
      [SINGLETON_EVENT_ID],
    );
    const players = Number(countRows[0].players);
    const teams = Number(countRows[0].teams);
    const applications = Number(countRows[0].applications);
    if (players > 0 || teams > 0 || applications > 0) {
      throw new Error("Can't change team format with players, teams, or pending applications already registered. Reset everything first.");
    }
    await client.query(`UPDATE mayhem_events SET team_format = $1 WHERE id = $2`, [format, SINGLETON_EVENT_ID]);
  });
  refresh();
}

/**
 * Opens or closes public self-service signup (verified-member join, or
 * premade team create/join). Admin bulk-add/paste is unaffected — it
 * checks team_format, never registration_open. Opening is only allowed
 * while still collecting entrants; closing is always allowed (e.g. to cut
 * off signups right before randomizing, even mid-stage).
 */
export async function setRegistrationOpen(open: boolean) {
  await requireAdmin();
  await ensureSchema();
  await withEventLock(async (client) => {
    if (open) {
      const { rows } = await client.query(`SELECT stage FROM mayhem_events WHERE id = $1`, [SINGLETON_EVENT_ID]);
      if (rows[0]?.stage !== "collecting") {
        throw new Error("Registration can only be opened while still collecting entrants.");
      }
    }
    await client.query(`UPDATE mayhem_events SET registration_open = $1 WHERE id = $2`, [open, SINGLETON_EVENT_ID]);
  });
  refresh();
}

// ---------------------------------------------------------------------------
// Public self-service actions (no admin auth — verified Discord identity only)
// ---------------------------------------------------------------------------

/**
 * Verified-member self-signup for randomized-format events (also used in
 * "mixed" mode's solo path). Never trusts a client-submitted name or id —
 * the entrant's identity and display name come from getMemberSession()
 * (server-verified against live Discord role membership), not from any
 * request field. Rejected outright if:
 *   - member auth isn't configured / caller isn't a verified member,
 *   - the event doesn't accept solo signups (pure "premade" mode),
 *   - registration is closed,
 *   - the caller's registration_generation is stale (a reset happened
 *     since the page loaded — see clearAllPlayers()'s doc comment),
 *   - this Discord account already has an entrant row OR a confirmed/
 *     pending premade application slot for this event (checked across
 *     both tables so nobody double-registers via the two different paths
 *     "mixed" mode exposes at once).
 */
export async function joinMayhemAsMember(
  expectedGeneration: number,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { getMemberSession } = await import("@/lib/discord-auth");
  const member = await getMemberSession();
  if (!member) return { ok: false, reason: "You need to sign in with a verified Discord account first." };

  await ensureSchema();
  try {
    return await withEventLock(async (client) => {
      const { rows: eventRows } = await client.query(
        `SELECT team_format, registration_open, stage, registration_generation FROM mayhem_events WHERE id = $1`,
        [SINGLETON_EVENT_ID],
      );
      const ev = eventRows[0];
      if (!ev) return { ok: false, reason: "No tournament is set up right now." };
      if (ev.team_format === "premade") {
        return { ok: false, reason: "This event uses premade team signups — join or create a team instead." };
      }
      if (!ev.registration_open || ev.stage !== "collecting") {
        return { ok: false, reason: "Signups are closed right now." };
      }
      if (Number(ev.registration_generation) !== expectedGeneration) {
        return { ok: false, reason: "This event was reset since you loaded the page — refresh and try again." };
      }

      const { rows: existing } = await client.query(
        `SELECT id FROM mayhem_players WHERE event_id = $1 AND member_discord_id = $2`,
        [SINGLETON_EVENT_ID, member.discordUserId],
      );
      if (existing.length > 0) return { ok: false, reason: "You're already signed up." };

      const { rows: applied } = await client.query(
        `SELECT s.id FROM mayhem_team_application_slots s
         JOIN mayhem_team_applications a ON a.id = s.application_id
         WHERE a.event_id = $1 AND s.member_discord_id = $2 AND s.status IN ('pending','confirmed')`,
        [SINGLETON_EVENT_ID, member.discordUserId],
      );
      if (applied.length > 0) {
        return { ok: false, reason: "You already have a pending or confirmed premade team application." };
      }

      const { rows: orderRows } = await client.query(
        `SELECT COALESCE(MAX(entry_order), -1) + 1 AS next FROM mayhem_players WHERE event_id = $1`,
        [SINGLETON_EVENT_ID],
      );
      await client.query(
        `INSERT INTO mayhem_players (id, event_id, display_name, entry_order, team_id, member_discord_id)
         VALUES ($1, $2, $3, $4, NULL, $5)`,
        [newId("player"), SINGLETON_EVENT_ID, member.displayName, orderRows[0].next, member.discordUserId],
      );
      return { ok: true };
    });
  } finally {
    refresh();
  }
}

/** Lets a verified member withdraw their own self-joined entry (not admin-added/guest rows, not teammates'). */
export async function leaveMayhemAsMember(): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { getMemberSession } = await import("@/lib/discord-auth");
  const member = await getMemberSession();
  if (!member) return { ok: false, reason: "You need to sign in with a verified Discord account first." };

  await ensureSchema();
  try {
    return await withEventLock(async (client) => {
      const { rows } = await client.query(
        `SELECT id, team_id FROM mayhem_players WHERE event_id = $1 AND member_discord_id = $2`,
        [SINGLETON_EVENT_ID, member.discordUserId],
      );
      if (rows.length === 0) return { ok: false, reason: "You're not signed up." };
      if (rows[0].team_id) {
        return { ok: false, reason: "Teams have already been drawn — ask an admin to remove you." };
      }
      await client.query(`DELETE FROM mayhem_players WHERE id = $1`, [rows[0].id]);
      return { ok: true };
    });
  } finally {
    refresh();
  }
}

/** Read-only: has the signed-in member self-joined a solo slot (not a premade roster) for this event? A promoted premade teammate also has a mayhem_players row (team_id set) — that's a different registration state, not a "solo" signup, so it's excluded here explicitly rather than conflating the two. */
export async function getMySoloSignupStatus(): Promise<{ joined: boolean; registrationGeneration: number } | null> {
  const { getMemberSession } = await import("@/lib/discord-auth");
  const member = await getMemberSession();
  if (!member) return null;
  await ensureSchema();
  const { rows: eventRows } = await sql`SELECT registration_generation FROM mayhem_events WHERE id = ${SINGLETON_EVENT_ID}`;
  const { rows } = await sql`
    SELECT id FROM mayhem_players
    WHERE event_id = ${SINGLETON_EVENT_ID} AND member_discord_id = ${member.discordUserId} AND team_id IS NULL
  `;
  return { joined: rows.length > 0, registrationGeneration: eventRows[0]?.registration_generation ?? 0 };
}

/** Read-only: the signed-in member's own in-progress premade application (as captain) — a slot, not a team, so no roster leaks to anyone but the captain and (elsewhere) each invited member's own slot. */
export async function getMyPremadeApplication(): Promise<
  { id: string; teamName: string; registrationGeneration: number; slots: PremadeApplicationSlotView[] } | null
> {
  const { getMemberSession } = await import("@/lib/discord-auth");
  const member = await getMemberSession();
  if (!member) return null;
  await ensureSchema();
  const { rows: appRows } = await sql`
    SELECT id, team_name, registration_generation FROM mayhem_team_applications
    WHERE event_id = ${SINGLETON_EVENT_ID} AND captain_discord_id = ${member.discordUserId}
  `;
  if (appRows.length === 0) return null;
  const app = appRows[0];
  const { rows: slotRows } = await sql`
    SELECT id, member_discord_id, display_name, avatar_url, status, is_captain, delivery_status, delivery_error
    FROM mayhem_team_application_slots
    WHERE application_id = ${app.id}
    ORDER BY is_captain DESC, created_at ASC
  `;
  return {
    id: app.id,
    teamName: app.team_name,
    registrationGeneration: app.registration_generation,
    slots: slotRows.map((s) => ({
      id: s.id,
      memberDiscordId: s.member_discord_id,
      displayName: s.display_name,
      avatarUrl: s.avatar_url,
      status: s.status,
      deliveryStatus: s.delivery_status ?? "not_sent",
      deliveryError: s.delivery_error ?? null,
      isCaptain: Boolean(s.is_captain),
    })),
  };
}



// ---------------------------------------------------------------------------
// Premade team applications (pending, require every slot's own confirmation)
// ---------------------------------------------------------------------------

const CONFIRM_TOKEN_BYTES = 24;

async function hashConfirmToken(token: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(token).digest("hex");
}

function randomConfirmToken(): string {
  const { randomBytes } = require("node:crypto") as typeof import("node:crypto");
  return randomBytes(CONFIRM_TOKEN_BYTES).toString("base64url");
}

/** Whether this event's team_format currently accepts premade applications ("premade" or "mixed"). */
function acceptsPremade(teamFormat: string): boolean {
  return teamFormat === "premade" || teamFormat === "mixed";
}

/** Whether this event's team_format currently accepts solo signups ("randomized" or "mixed"). */
function acceptsSolo(teamFormat: string): boolean {
  return teamFormat === "randomized" || teamFormat === "mixed";
}

/**
 * Is this Discord account reserved anywhere for this event — a real
 * entrant row, or a pending/confirmed slot on ANY application (their own
 * or someone else's invite)? Checked before every write that would double
 * up a person across the two signup paths "mixed" mode exposes at once.
 */
async function isDiscordIdReserved(
  client: VercelPoolClient,
  discordUserId: string,
  excludeSlotId?: string,
): Promise<boolean> {
  const { rows: playerRows } = await client.query(
    `SELECT id FROM mayhem_players WHERE event_id = $1 AND member_discord_id = $2`,
    [SINGLETON_EVENT_ID, discordUserId],
  );
  if (playerRows.length > 0) return true;
  // Expired pending invites must not reserve a person forever — an
  // unconfirmed slot whose token already lapsed is functionally dead
  // (confirmApplicationSlot would reject it too), so it shouldn't be able
  // to block that person from signing up solo or joining a different team.
  // Drafts (no token issued yet) never reserve at all, by construction —
  // only 'pending' (token live) and 'confirmed' count here.
  const { rows: slotRows } = await client.query(
    `SELECT s.id FROM mayhem_team_application_slots s
     JOIN mayhem_team_applications a ON a.id = s.application_id
     WHERE a.event_id = $1 AND s.member_discord_id = $2
       AND (
         s.status = 'confirmed'
         OR (s.status = 'pending' AND (s.confirm_token_expires_at IS NULL OR s.confirm_token_expires_at > now()))
       )
       AND ($3::text IS NULL OR s.id != $3)`,
    [SINGLETON_EVENT_ID, discordUserId, excludeSlotId ?? null],
  );
  return slotRows.length > 0;
}

export interface PremadeApplicationSlotView {
  id: string;
  memberDiscordId: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  status: "draft" | "pending" | "confirmed" | "declined";
  deliveryStatus: "not_sent" | "sending" | "sent" | "failed";
  deliveryError: string | null;
  isCaptain: boolean;
}

export interface PremadeApplicationView {
  id: string;
  teamName: string;
  slots: PremadeApplicationSlotView[];
}

/**
 * Captain starts a premade team application. Occupies slot 1 with their own
 * (already-confirmed, no token needed) identity; the remaining
 * PREMADE_ROSTER_SIZE - 1 slots start empty and are filled one at a time by
 * inviteToApplication(). Nothing here touches mayhem_teams/mayhem_players —
 * an application is not a team until every slot confirms (see
 * confirmApplicationSlot()'s promotion logic).
 */
export async function createPremadeApplication(
  teamName: string,
  expectedGeneration: number,
): Promise<{ ok: true; applicationId: string } | { ok: false; reason: string }> {
  const { getMemberSession } = await import("@/lib/discord-auth");
  const member = await getMemberSession();
  if (!member) return { ok: false, reason: "You need to sign in with a verified Discord account first." };

  const name = teamName.trim().slice(0, 40);
  if (!name) return { ok: false, reason: "Team name can't be empty." };

  await ensureSchema();
  try {
    return await withEventLock(async (client) => {
      const { rows: eventRows } = await client.query(
        `SELECT team_format, registration_open, stage, registration_generation FROM mayhem_events WHERE id = $1`,
        [SINGLETON_EVENT_ID],
      );
      const ev = eventRows[0];
      if (!ev) return { ok: false, reason: "No tournament is set up right now." };
      if (!acceptsPremade(ev.team_format)) {
        return { ok: false, reason: "This event doesn't accept premade team applications." };
      }
      if (!ev.registration_open || ev.stage !== "collecting") {
        return { ok: false, reason: "Signups are closed right now." };
      }
      if (Number(ev.registration_generation) !== expectedGeneration) {
        return { ok: false, reason: "This event was reset since you loaded the page — refresh and try again." };
      }

      if (await isDiscordIdReserved(client, member.discordUserId)) {
        return { ok: false, reason: "You're already signed up or on a pending application for this event." };
      }
      const { rows: existingApp } = await client.query(
        `SELECT id FROM mayhem_team_applications WHERE event_id = $1 AND captain_discord_id = $2`,
        [SINGLETON_EVENT_ID, member.discordUserId],
      );
      if (existingApp.length > 0) {
        return { ok: false, reason: "You already have an application in progress. Withdraw it first to start a new one." };
      }
      const { rows: existingTeamName } = await client.query(
        `SELECT id FROM mayhem_teams WHERE event_id = $1 AND lower(name) = lower($2)
         UNION SELECT id FROM mayhem_team_applications WHERE event_id = $1 AND lower(team_name) = lower($2)`,
        [SINGLETON_EVENT_ID, name],
      );
      if (existingTeamName.length > 0) {
        return { ok: false, reason: "That team name is already taken for this event." };
      }

      const applicationId = newId("mapp");
      await client.query(
        `INSERT INTO mayhem_team_applications (id, event_id, team_name, captain_discord_id, registration_generation)
         VALUES ($1, $2, $3, $4, $5)`,
        [applicationId, SINGLETON_EVENT_ID, name, member.discordUserId, expectedGeneration],
      );
      await client.query(
        `INSERT INTO mayhem_team_application_slots
           (id, application_id, member_discord_id, display_name, avatar_url, status, is_captain, confirm_token_hash)
         VALUES ($1, $2, $3, $4, $5, 'confirmed', true, NULL)`,
        [newId("maslot"), applicationId, member.discordUserId, member.displayName, member.avatarUrl],
      );
      return { ok: true, applicationId };
    });
  } finally {
    refresh();
  }
}

const INVITE_TOKEN_TTL_MS = 72 * 60 * 60 * 1000;

function buildInviteMessage(teamName: string, captainName: string, url: string): string {
  return (
    `You've been invited to join **${teamName}** for ARAM Mayhem, by ${captainName}.\n\n` +
    `Confirm your spot here (expires in 72 hours): ${url}\n\n` +
    `If this wasn't meant for you, you can ignore this or decline on that page.`
  );
}

/**
 * Captain adds a verified guild member (found via searchGuildMembers) to
 * their roster as a DRAFT pick — no DM, no token, nothing sent anywhere.
 * Only a Discord user id is trusted from the client; display name/avatar
 * are re-resolved server-side against the live guild roster via the bot
 * token, never accepted as client-submitted strings. Bots are rejected.
 * A draft slot never reserves the person against other applications (see
 * isDiscordIdReserved's doc comment) — only once sendApplicationInvites()
 * actually issues a token does the slot become 'pending' and reserving.
 */
export async function addDraftMember(
  applicationId: string,
  inviteeDiscordId: string,
): Promise<{ ok: true; slotId: string; displayName: string } | { ok: false; reason: string }> {
  const { getMemberSession } = await import("@/lib/discord-auth");
  const member = await getMemberSession();
  if (!member) return { ok: false, reason: "You need to sign in with a verified Discord account first." };
  if (!/^\d{5,25}$/.test(inviteeDiscordId)) return { ok: false, reason: "Invalid Discord user id." };

  const { fetchGuildMemberById } = await import("@/lib/discord-bot");
  const invitee = await fetchGuildMemberById(inviteeDiscordId);
  if (!invitee) return { ok: false, reason: "Couldn't find that person in the server right now — try searching again." };
  if (invitee.isBot) return { ok: false, reason: "Can't add a bot account." };

  await ensureSchema();
  try {
    return await withEventLock(async (client) => {
      const { rows: appRows } = await client.query(
        `SELECT a.id, a.captain_discord_id, a.send_in_progress, e.registration_open, e.stage
         FROM mayhem_team_applications a JOIN mayhem_events e ON e.id = a.event_id
         WHERE a.id = $1 AND a.event_id = $2`,
        [applicationId, SINGLETON_EVENT_ID],
      );
      if (appRows.length === 0) return { ok: false, reason: "Application not found." };
      if (appRows[0].captain_discord_id !== member.discordUserId) {
        return { ok: false, reason: "Only the captain can add teammates." };
      }
      if (!appRows[0].registration_open || appRows[0].stage !== "collecting") {
        return { ok: false, reason: "Signups are closed right now." };
      }
      if (appRows[0].send_in_progress) {
        return { ok: false, reason: "Invites are currently being sent — wait for that to finish before editing the roster." };
      }

      const { rows: slotCountRows } = await client.query(
        `SELECT count(*)::int AS c FROM mayhem_team_application_slots WHERE application_id = $1`,
        [applicationId],
      );
      if (slotCountRows[0].c >= PREMADE_ROSTER_SIZE) {
        return { ok: false, reason: "This roster is already full." };
      }
      if (inviteeDiscordId === member.discordUserId) {
        return { ok: false, reason: "You're already the captain's own slot." };
      }
      if (await isDiscordIdReserved(client, inviteeDiscordId)) {
        return { ok: false, reason: "That person is already signed up or on another application." };
      }

      const slotId = newId("maslot");
      await client.query(
        `INSERT INTO mayhem_team_application_slots
           (id, application_id, member_discord_id, display_name, avatar_url, status, is_captain, delivery_status)
         VALUES ($1, $2, $3, $4, $5, 'draft', false, 'not_sent')`,
        [slotId, applicationId, inviteeDiscordId, invitee.displayName, invitee.avatarUrl],
      );
      return { ok: true, slotId, displayName: invitee.displayName };
    });
  } finally {
    refresh();
  }
}

interface SendInviteResult {
  slotId: string;
  displayName: string;
  delivered: boolean;
  error?: string;
  /** Only set when delivery failed because DMs are closed/blocked — a manual copy-paste fallback for the captain to hand off some other way. Never set on a successful send, so a live link is never shown once Discord has already delivered it. */
  manualLink?: string;
}

/**
 * Batch-sends confirmation DMs to every 'draft' slot on the application,
 * once all PREMADE_ROSTER_SIZE slots (captain + picks) exist. Two phases,
 * deliberately split across the event lock boundary:
 *
 *   1. Under withEventLock: validate ownership/registration state, claim
 *      the application via send_in_progress (rejects a concurrent second
 *      send outright), mint+hash a fresh token per draft slot, flip each
 *      to 'pending'. Committed and lock released before any network call.
 *   2. Outside any lock: one Discord DM per prepared slot. A slow or
 *      rate-limited Discord call here must never hold up every other
 *      roster mutation for the whole event — only THIS application is
 *      blocked (via send_in_progress) against a second concurrent send.
 *
 * Per-slot delivery status (sent/failed + reason) is persisted
 * individually as each DM resolves, so a partial failure (2 of 4 sent)
 * is never lost on refresh — the failed two show a Retry action.
 */
export async function sendApplicationInvites(applicationId: string): Promise<
  { ok: true; results: SendInviteResult[] } | { ok: false; reason: string }
> {
  const { getMemberSession } = await import("@/lib/discord-auth");
  const member = await getMemberSession();
  if (!member) return { ok: false, reason: "You need to sign in with a verified Discord account first." };
  await ensureSchema();

  type Prepared = { slotId: string; discordUserId: string; displayName: string; token: string };
  const prep = await withEventLock(
    async (
      client,
    ): Promise<{ ok: true; teamName: string; items: Prepared[] } | { ok: false; reason: string }> => {
      const { rows: appRows } = await client.query(
        `SELECT a.team_name, a.captain_discord_id, a.send_in_progress, e.registration_open, e.stage
         FROM mayhem_team_applications a JOIN mayhem_events e ON e.id = a.event_id
         WHERE a.id = $1 AND a.event_id = $2`,
        [applicationId, SINGLETON_EVENT_ID],
      );
      if (appRows.length === 0) return { ok: false, reason: "Application not found." };
      if (appRows[0].captain_discord_id !== member.discordUserId) {
        return { ok: false, reason: "Only the captain can send invites." };
      }
      if (appRows[0].send_in_progress) {
        return { ok: false, reason: "Invites are already being sent — wait for that to finish first." };
      }
      if (!appRows[0].registration_open || appRows[0].stage !== "collecting") {
        return { ok: false, reason: "Signups are closed right now." };
      }

      const { rows: slotRows } = await client.query(
        `SELECT id, member_discord_id, display_name, status FROM mayhem_team_application_slots WHERE application_id = $1`,
        [applicationId],
      );
      if (slotRows.length !== PREMADE_ROSTER_SIZE) {
        return {
          ok: false,
          reason: `Add all ${PREMADE_ROSTER_SIZE} teammates before sending invites (${slotRows.length}/${PREMADE_ROSTER_SIZE} so far).`,
        };
      }
      const draftRows = slotRows.filter((s) => s.status === "draft");
      if (draftRows.length === 0) {
        return { ok: false, reason: "Every slot already has an invite out — use Retry on a failed one instead." };
      }
      // Re-validate every draft's reservation status now, under this same
      // lock — a draft slot deliberately does NOT reserve its person (see
      // isDiscordIdReserved's doc comment), so time may have passed since
      // addDraftMember() since another application could have since
      // confirmed that same Discord id. Catching it here, right before
      // tokens go out, is the only point that actually matters.
      for (const slot of draftRows) {
        if (await isDiscordIdReserved(client, slot.member_discord_id, slot.id)) {
          return {
            ok: false,
            reason: `${slot.display_name} signed up elsewhere since you added them — remove them and pick someone else.`,
          };
        }
      }

      await client.query(
        `UPDATE mayhem_team_applications SET send_in_progress = true, roster_version = roster_version + 1 WHERE id = $1`,
        [applicationId],
      );

      const { rows: versionRows } = await client.query(
        `SELECT roster_version FROM mayhem_team_applications WHERE id = $1`,
        [applicationId],
      );
      const rosterVersion = versionRows[0].roster_version as number;

      const items: Prepared[] = [];
      for (const slot of draftRows) {
        const token = randomConfirmToken();
        const expiresAt = new Date(Date.now() + INVITE_TOKEN_TTL_MS).toISOString();
        await client.query(
          `UPDATE mayhem_team_application_slots
           SET status = 'pending', confirm_token_hash = $1, confirm_token_expires_at = $2,
               delivery_status = 'sending', delivery_error = NULL, token_roster_version = $3, updated_at = now()
           WHERE id = $4`,
          [await hashConfirmToken(token), expiresAt, rosterVersion, slot.id],
        );
        items.push({ slotId: slot.id, discordUserId: slot.member_discord_id, displayName: slot.display_name, token });
      }
      return { ok: true, teamName: appRows[0].team_name, items };
    },
  );
  refresh();
  if (!prep.ok) return prep;

  const { sendDirectMessage } = await import("@/lib/discord-bot");
  const { trustedOrigin } = await import("@/lib/discord-auth");

  const results: SendInviteResult[] = [];
  for (const item of prep.items) {
    const url = `${trustedOrigin()}/tournaments/aram/confirm?slot=${item.slotId}&token=${encodeURIComponent(item.token)}`;
    const content = buildInviteMessage(prep.teamName, member.displayName, url);
    const dm = await sendDirectMessage(item.discordUserId, content);

    if (dm.ok) {
      await sql`UPDATE mayhem_team_application_slots SET delivery_status = 'sent', delivery_error = NULL WHERE id = ${item.slotId}`;
      results.push({ slotId: item.slotId, displayName: item.displayName, delivered: true });
    } else {
      const error =
        dm.status === "dm_unavailable"
          ? "DMs are closed, or they've blocked the bot."
          : dm.status === "rate_limited"
            ? `Discord rate-limited the bot — retry in ~${Math.ceil((dm.retryAfterMs ?? 1000) / 1000)}s.`
            : "Discord DM failed unexpectedly.";
      await sql`UPDATE mayhem_team_application_slots SET delivery_status = 'failed', delivery_error = ${error} WHERE id = ${item.slotId}`;
      results.push({
        slotId: item.slotId,
        displayName: item.displayName,
        delivered: false,
        error,
        manualLink: dm.status === "dm_unavailable" ? url : undefined,
      });
    }
  }

  await sql`UPDATE mayhem_team_applications SET send_in_progress = false WHERE id = ${applicationId}`;
  refresh();
  return { ok: true, results };
}

/**
 * Resends exactly one failed invite — rotates a fresh token (the old one's
 * hash can never be reversed back into a usable link, so retry always
 * mints new) and re-attempts the DM. The UPDATE ... WHERE delivery_status
 * = 'failed' clause is the concurrency guard here: it atomically claims
 * the slot for this retry attempt, so a double-click can't fire two DMs
 * for the same recipient — the second click's UPDATE matches zero rows
 * and is rejected outright, no separate event lock needed since nothing
 * about roster shape/counts changes, only this slot's own delivery state.
 */
export async function retryInviteDelivery(
  applicationId: string,
  slotId: string,
): Promise<{ ok: true; delivered: boolean; error?: string; manualLink?: string } | { ok: false; reason: string }> {
  const { getMemberSession } = await import("@/lib/discord-auth");
  const member = await getMemberSession();
  if (!member) return { ok: false, reason: "You need to sign in with a verified Discord account first." };
  await ensureSchema();

  const { rows: appRows } = await sql`
    SELECT a.captain_discord_id, a.team_name, e.registration_open, e.stage
    FROM mayhem_team_applications a JOIN mayhem_events e ON e.id = a.event_id
    WHERE a.id = ${applicationId} AND a.event_id = ${SINGLETON_EVENT_ID}
  `;
  if (appRows.length === 0) return { ok: false, reason: "Application not found." };
  if (appRows[0].captain_discord_id !== member.discordUserId) {
    return { ok: false, reason: "Only the captain can resend invites." };
  }
  if (!appRows[0].registration_open || appRows[0].stage !== "collecting") {
    return { ok: false, reason: "Signups are closed right now." };
  }

  const token = randomConfirmToken();
  const expiresAt = new Date(Date.now() + INVITE_TOKEN_TTL_MS).toISOString();
  const { rows: claimed } = await sql`
    UPDATE mayhem_team_application_slots
    SET confirm_token_hash = ${await hashConfirmToken(token)}, confirm_token_expires_at = ${expiresAt},
        delivery_status = 'sending', delivery_error = NULL, updated_at = now()
    WHERE id = ${slotId} AND application_id = ${applicationId} AND status = 'pending' AND delivery_status = 'failed'
    RETURNING id, member_discord_id
  `;
  if (claimed.length === 0) {
    return { ok: false, reason: "This invite isn't in a retryable state right now — refresh and try again." };
  }
  refresh();

  const { sendDirectMessage } = await import("@/lib/discord-bot");
  const { trustedOrigin } = await import("@/lib/discord-auth");
  const url = `${trustedOrigin()}/tournaments/aram/confirm?slot=${slotId}&token=${encodeURIComponent(token)}`;
  const content = buildInviteMessage(appRows[0].team_name, member.displayName, url);
  const dm = await sendDirectMessage(claimed[0].member_discord_id, content);

  if (dm.ok) {
    await sql`UPDATE mayhem_team_application_slots SET delivery_status = 'sent', delivery_error = NULL WHERE id = ${slotId}`;
    refresh();
    return { ok: true, delivered: true };
  }
  const error =
    dm.status === "dm_unavailable"
      ? "DMs are closed, or they've blocked the bot."
      : dm.status === "rate_limited"
        ? `Discord rate-limited the bot — retry in ~${Math.ceil((dm.retryAfterMs ?? 1000) / 1000)}s.`
        : "Discord DM failed unexpectedly.";
  await sql`UPDATE mayhem_team_application_slots SET delivery_status = 'failed', delivery_error = ${error} WHERE id = ${slotId}`;
  refresh();
  return { ok: true, delivered: false, error, manualLink: dm.status === "dm_unavailable" ? url : undefined };
}

/** Captain removes an invite before it's been accepted. Confirmed slots (including the captain's own) can never be removed here — captain leaving/dissolving the team is a separate flow (leavePremadeTeam). */
export async function withdrawApplicationSlot(
  applicationId: string,
  slotId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { getMemberSession } = await import("@/lib/discord-auth");
  const member = await getMemberSession();
  if (!member) return { ok: false, reason: "You need to sign in with a verified Discord account first." };

  await ensureSchema();
  try {
    return await withEventLock(async (client) => {
      const { rows: appRows } = await client.query(
        `SELECT a.captain_discord_id, e.registration_open, e.stage
         FROM mayhem_team_applications a JOIN mayhem_events e ON e.id = a.event_id
         WHERE a.id = $1 AND a.event_id = $2`,
        [applicationId, SINGLETON_EVENT_ID],
      );
      if (appRows.length === 0) return { ok: false, reason: "Application not found." };
      if (appRows[0].captain_discord_id !== member.discordUserId) {
        return { ok: false, reason: "Only the captain can manage invites." };
      }
      if (!appRows[0].registration_open || appRows[0].stage !== "collecting") {
        return { ok: false, reason: "Signups are closed right now." };
      }
      const { rows: slotRows } = await client.query(
        `SELECT is_captain, status FROM mayhem_team_application_slots WHERE id = $1 AND application_id = $2`,
        [slotId, applicationId],
      );
      if (slotRows.length === 0) return { ok: false, reason: "Slot not found." };
      if (slotRows[0].is_captain) return { ok: false, reason: "Can't remove the captain's own slot." };
      if (slotRows[0].status === "confirmed") {
        return { ok: false, reason: "This person already confirmed — remove them from the team after it's formed instead." };
      }
      await client.query(`DELETE FROM mayhem_team_application_slots WHERE id = $1`, [slotId]);
      return { ok: true };
    });
  } finally {
    refresh();
  }
}

/**
 * Invited member confirms their slot via the link generated by
 * inviteToApplication(). Token is compared by hash, never stored/logged in
 * plaintext server-side after the invite response. If this confirmation
 * completes the last open slot, promotes the whole application into a real
 * mayhem_teams/mayhem_players roster inside the same transaction — an
 * application is either fully pending or fully promoted, never a
 * half-migrated state visible to any other query.
 */
export async function confirmApplicationSlot(
  slotId: string,
  rawToken: string,
): Promise<{ ok: true; promoted: boolean } | { ok: false; reason: string }> {
  const { getMemberSession } = await import("@/lib/discord-auth");
  const member = await getMemberSession();
  if (!member) return { ok: false, reason: "You need to sign in with a verified Discord account first." };

  await ensureSchema();
  try {
    return await withEventLock(async (client) => {
      const { rows: slotRows } = await client.query(
        `SELECT s.*, a.event_id, a.team_name, a.captain_discord_id, e.registration_open, e.stage
         FROM mayhem_team_application_slots s
         JOIN mayhem_team_applications a ON a.id = s.application_id
         JOIN mayhem_events e ON e.id = a.event_id
         WHERE s.id = $1`,
        [slotId],
      );
      if (slotRows.length === 0) return { ok: false, reason: "Invite not found." };
      const slot = slotRows[0];
      if (slot.event_id !== SINGLETON_EVENT_ID) return { ok: false, reason: "Invite not found." };
      if (slot.member_discord_id !== member.discordUserId) {
        return { ok: false, reason: "This invite isn't addressed to your account." };
      }
      if (slot.status !== "pending") {
        return { ok: false, reason: slot.status === "confirmed" ? "Already confirmed." : "This invite was declined or withdrawn." };
      }
      if (!slot.confirm_token_hash || slot.confirm_token_hash !== (await hashConfirmToken(rawToken))) {
        return { ok: false, reason: "Invalid or expired invite link." };
      }
      if (slot.confirm_token_expires_at && new Date(slot.confirm_token_expires_at).getTime() < Date.now()) {
        return { ok: false, reason: "This invite link has expired — ask the captain to resend it." };
      }
      if (!slot.registration_open || slot.stage !== "collecting") {
        return { ok: false, reason: "Signups have closed since you were invited." };
      }
      if (await isDiscordIdReserved(client, member.discordUserId, slotId)) {
        return { ok: false, reason: "You're already signed up elsewhere for this event." };
      }

      await client.query(
        `UPDATE mayhem_team_application_slots SET status = 'confirmed', confirm_token_hash = NULL WHERE id = $1`,
        [slotId],
      );

      const { rows: statusRows } = await client.query(
        `SELECT status FROM mayhem_team_application_slots WHERE application_id = $1`,
        [slot.application_id],
      );
      const allConfirmed = statusRows.length === PREMADE_ROSTER_SIZE && statusRows.every((r) => r.status === "confirmed");
      if (!allConfirmed) return { ok: true, promoted: false };

      // Every slot confirmed — promote to a real team atomically.
      const { rows: memberRows } = await client.query(
        `SELECT member_discord_id, display_name FROM mayhem_team_application_slots WHERE application_id = $1`,
        [slot.application_id],
      );
      const { rows: teamCountRows } = await client.query(
        `SELECT count(*)::int AS c FROM mayhem_teams WHERE event_id = $1`,
        [SINGLETON_EVENT_ID],
      );
      const teamId = newId("team");
      const defaultIcon = pickTeamIdentities(1)[0].iconUrl;
      await client.query(
        `INSERT INTO mayhem_teams (id, event_id, name, icon_url, seed, reveal_order, group_id, is_ready, captain_discord_id)
         VALUES ($1, $2, $3, $4, NULL, $5, NULL, true, $6)`,
        [teamId, SINGLETON_EVENT_ID, slot.team_name, defaultIcon, teamCountRows[0].c, slot.captain_discord_id],
      );
      const { rows: orderRows } = await client.query(
        `SELECT COALESCE(MAX(entry_order), -1) + 1 AS next FROM mayhem_players WHERE event_id = $1`,
        [SINGLETON_EVENT_ID],
      );
      let nextOrder = orderRows[0].next as number;
      for (const m of memberRows) {
        await client.query(
          `INSERT INTO mayhem_players (id, event_id, display_name, entry_order, team_id, member_discord_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [newId("player"), SINGLETON_EVENT_ID, m.display_name, nextOrder++, teamId, m.member_discord_id],
        );
      }
      await client.query(`DELETE FROM mayhem_team_applications WHERE id = $1`, [slot.application_id]);
      return { ok: true, promoted: true };
    });
  } finally {
    refresh();
  }
}

/** Invited member declines. Frees their reservation immediately so the captain can invite someone else into that slot. Requires the invite's own recipient to be signed in — the token alone (which the captain also holds, since they generate the invite link) is not sufficient authorization to act on someone else's slot. */
export async function declineApplicationSlot(
  slotId: string,
  rawToken: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { getMemberSession } = await import("@/lib/discord-auth");
  const member = await getMemberSession();
  if (!member) return { ok: false, reason: "You need to sign in with a verified Discord account first." };

  await ensureSchema();
  return withEventLock(async (client): Promise<{ ok: true } | { ok: false; reason: string }> => {
    const { rows } = await client.query(
      `SELECT confirm_token_hash, confirm_token_expires_at, status, member_discord_id FROM mayhem_team_application_slots WHERE id = $1`,
      [slotId],
    );
    if (rows.length === 0) return { ok: false, reason: "Invite not found." };
    if (rows[0].member_discord_id !== member.discordUserId) {
      return { ok: false, reason: "This invite isn't addressed to your account." };
    }
    if (rows[0].status !== "pending") return { ok: false, reason: "This invite was already resolved." };
    if (!rows[0].confirm_token_hash || rows[0].confirm_token_hash !== (await hashConfirmToken(rawToken))) {
      return { ok: false, reason: "Invalid or expired invite link." };
    }
    // Deleted, not marked 'declined' + kept — a declined slot must free the
    // reservation immediately (isDiscordIdReserved only excludes rows that
    // no longer exist or aren't pending/confirmed; deleting is the
    // unambiguous way to guarantee that without a second write path).
    await client.query(`DELETE FROM mayhem_team_application_slots WHERE id = $1`, [slotId]);
    return { ok: true };
  }).finally(() => refresh());
}

/** Captain (or admin) withdraws the whole application, freeing every reserved slot. */
export async function withdrawApplication(applicationId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { getMemberSession } = await import("@/lib/discord-auth");
  const member = await getMemberSession();
  if (!member) return { ok: false, reason: "You need to sign in with a verified Discord account first." };

  await ensureSchema();
  return withEventLock(async (client): Promise<{ ok: true } | { ok: false; reason: string }> => {
    const { rows } = await client.query(
      `SELECT captain_discord_id FROM mayhem_team_applications WHERE id = $1 AND event_id = $2`,
      [applicationId, SINGLETON_EVENT_ID],
    );
    if (rows.length === 0) return { ok: false, reason: "Application not found." };
    if (rows[0].captain_discord_id !== member.discordUserId) {
      return { ok: false, reason: "Only the captain can withdraw this application." };
    }
    await client.query(`DELETE FROM mayhem_team_applications WHERE id = $1`, [applicationId]);
    return { ok: true };
  }).finally(() => refresh());
}


/**
 * A member leaves their premade team before the tournament starts. If
 * they were the captain, the whole team is dissolved and every teammate's
 * entrant row is deleted outright (not just detached via team_id = NULL) —
 * createPremadeTeam()/joinPremadeTeam() both reject a Discord account that
 * already has ANY entrant row, so a detached-but-still-present row would
 * permanently strand that member: unable to solo-join (already has a row)
 * and unable to join another team (same check). Deleting the row on
 * dissolution is what lets a dissolved team's members re-register cleanly.
 */
export async function leavePremadeTeam(): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { getMemberSession } = await import("@/lib/discord-auth");
  const member = await getMemberSession();
  if (!member) return { ok: false, reason: "You need to sign in with a verified Discord account first." };

  await ensureSchema();
  try {
    return await withEventLock(async (client) => {
      const { rows: stageRows } = await client.query(`SELECT stage FROM mayhem_events WHERE id = $1`, [SINGLETON_EVENT_ID]);
      if (stageRows[0]?.stage !== "collecting") {
        return { ok: false, reason: "Teams have already been finalized — ask an admin to make changes." };
      }

      const { rows: playerRows } = await client.query(
        `SELECT id, team_id FROM mayhem_players WHERE event_id = $1 AND member_discord_id = $2`,
        [SINGLETON_EVENT_ID, member.discordUserId],
      );
      if (playerRows.length === 0 || !playerRows[0].team_id) {
        return { ok: false, reason: "You're not on a team." };
      }
      const teamId = playerRows[0].team_id as string;

      const { rows: teamRows } = await client.query(
        `SELECT captain_discord_id FROM mayhem_teams WHERE id = $1`,
        [teamId],
      );
      const isCaptain = teamRows[0]?.captain_discord_id === member.discordUserId;

      if (isCaptain) {
        // Dissolve: delete every teammate's entrant row outright (see doc
        // comment above for why NULL-ing team_id alone would strand them),
        // then delete the team itself.
        await client.query(`DELETE FROM mayhem_players WHERE team_id = $1`, [teamId]);
        await client.query(`DELETE FROM mayhem_teams WHERE id = $1`, [teamId]);
      } else {
        await client.query(`DELETE FROM mayhem_players WHERE id = $1`, [playerRows[0].id]);
        await client.query(`UPDATE mayhem_teams SET is_ready = false WHERE id = $1`, [teamId]);
      }
      return { ok: true };
    });
  } finally {
    refresh();
  }
}



/**
 * Confirm the entrant list and randomize teams. In "randomized" mode, all
 * players are solo entrants. In "mixed" mode, confirmed premade teams
 * (created via createPremadeApplication/confirmApplicationSlot) are left
 * completely untouched — their roster, name, icon, captain are preserved
 * exactly — and ONLY players with team_id IS NULL (solo entrants) are
 * shuffled into freshly-generated teams. Reveal order/seed span BOTH
 * groups together so the live reveal treats them as one unified pool.
 * Requires solo-entrant count to be a multiple of 5, or zero (pure
 * premade mixed event with no solo signups is valid — nothing to
 * randomize, existing premade teams alone move to "randomized" stage).
 * Rejected outright in pure "premade" mode — those teams are seeded
 * directly from captain-built rosters via finalizePremadeTeams(), never
 * shuffled. Runs entirely inside withEventLock so a concurrent
 * signup/reset can't interleave with the read-then-write here.
 */
export async function randomizeTeams() {
  await requireAdmin();
  await ensureSchema();

  await withEventLock(async (client) => {
    const { rows: modeRows } = await client.query(
      `SELECT team_format FROM mayhem_events WHERE id = $1`,
      [SINGLETON_EVENT_ID],
    );
    const teamFormat = modeRows[0]?.team_format;
    if (teamFormat === "premade") {
      throw new Error('This event uses premade team signups — use "Finalize premade teams" instead.');
    }

    // Existing confirmed premade teams (mixed mode only — always empty in
    // pure randomized mode) are preserved untouched; only solo players
    // (team_id IS NULL) get shuffled into new teams.
    const { rows: premadeTeamRows } = await client.query(
      `SELECT id FROM mayhem_teams WHERE event_id = $1 AND captain_discord_id IS NOT NULL`,
      [SINGLETON_EVENT_ID],
    );
    const premadeTeamCount = premadeTeamRows.length;

    const { rows: playerRows } = await client.query(
      `SELECT id, display_name FROM mayhem_players WHERE event_id = $1 AND team_id IS NULL ORDER BY entry_order ASC`,
      [SINGLETON_EVENT_ID],
    );
    const soloCount = playerRows.length;
    if (soloCount === 0 && premadeTeamCount === 0) {
      throw new Error("No entrants to randomize yet.");
    }
    if (soloCount > 0 && soloCount < 20) {
      throw new Error("Need at least 20 solo entrants (4 teams of 5) to randomize, or none at all.");
    }
    if (soloCount % 5 !== 0) throw new Error("Solo entrant count must be a multiple of 5.");

    const soloTeamCount = soloCount / 5;
    const shuffledPlayers = shuffle(playerRows);
    const identities = shuffle(pickTeamIdentities(soloTeamCount));

    // Wipe only prior RANDOMIZED-team match/group state (a reroll case) —
    // never touch premade teams or their rosters.
    await client.query(`DELETE FROM mayhem_matches WHERE event_id = $1`, [SINGLETON_EVENT_ID]);
    await client.query(`DELETE FROM mayhem_groups WHERE event_id = $1`, [SINGLETON_EVENT_ID]);
    await client.query(
      `DELETE FROM mayhem_teams WHERE event_id = $1 AND captain_discord_id IS NULL`,
      [SINGLETON_EVENT_ID],
    );

    for (let t = 0; t < soloTeamCount; t++) {
      const teamId = newId("team");
      const identity = identities[t];
      await client.query(
        `INSERT INTO mayhem_teams (id, event_id, name, icon_url, seed, reveal_order, group_id, is_ready, captain_discord_id)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, true, NULL)`,
        [teamId, SINGLETON_EVENT_ID, identity.name, identity.iconUrl, premadeTeamCount + t + 1, premadeTeamCount + t],
      );
      const roster = shuffledPlayers.slice(t * 5, t * 5 + 5);
      for (const p of roster) {
        await client.query(`UPDATE mayhem_players SET team_id = $1 WHERE id = $2`, [teamId, p.id]);
      }
    }

    // Give every premade team its own seed/reveal_order too, so the whole
    // pool (premade + freshly randomized) reveals as one shuffled sequence
    // rather than "all premade teams first, then randomized ones".
    if (premadeTeamCount > 0) {
      const allTeamIds = shuffle([
        ...premadeTeamRows.map((r) => r.id as string),
        ...Array.from({ length: soloTeamCount }, (_, i) => `__solo_placeholder_${i}`),
      ]);
      // Re-fetch actual ids now that solo teams exist, then assign a single
      // shuffled order across all of them.
      const { rows: allTeams } = await client.query(
        `SELECT id FROM mayhem_teams WHERE event_id = $1`,
        [SINGLETON_EVENT_ID],
      );
      const shuffledAll = shuffle(allTeams.map((r) => r.id as string));
      for (let i = 0; i < shuffledAll.length; i++) {
        await client.query(
          `UPDATE mayhem_teams SET reveal_order = $1, seed = $2 WHERE id = $3`,
          [i, i + 1, shuffledAll[i]],
        );
      }
      void allTeamIds; // scratch var above only used to keep intent obvious; real assignment re-fetches ids
    }

    await client.query(
      `UPDATE mayhem_events
       SET stage = 'randomized', scene = 'reveal', reveal_index = 0, registration_open = false
       WHERE id = $1`,
      [SINGLETON_EVENT_ID],
    );
  });
  refresh();
}

/**
 * Premade-mode equivalent of randomizeTeams(): closes registration and
 * moves the event into the "randomized" stage (reusing that stage name for
 * "teams are locked, ready for reveal/bracket" regardless of team_format —
 * every downstream stage transition already keys off `stage`, not
 * `team_format`). Only ready (full 5-player) teams are eligible; the admin
 * must resolve incomplete teams (via admin removal/reassignment) before
 * finalizing, since there's no randomizer here to backfill empty slots.
 * Recounts every team's roster inside the lock rather than trusting the
 * cached `is_ready` flag — it can only ever be as fresh as the last write
 * that touched it, and finalize is the one place a stale flag would do
 * real damage (locking in a short-handed team).
 */
/**
 * Locks in confirmed premade teams. In pure "premade" mode this is the
 * only path to "randomized" stage. In "mixed" mode, use this ONLY when
 * there are no solo entrants to randomize — randomizeTeams() already
 * handles the mixed case (it preserves existing premade teams untouched
 * and shuffles solos alongside them in one step), so calling both against
 * the same event is never necessary and this rejects "mixed" outright to
 * avoid a confusing double-path. Only ready (full 5-player, confirmed)
 * teams are eligible — there is no draft/backfill step here since every
 * premade team promoted via confirmApplicationSlot() is already full by
 * construction (see that function's promotion logic). Recounts every
 * team's roster inside the lock rather than trusting the cached
 * `is_ready` flag — it can only ever be as fresh as the last write that
 * touched it, and finalize is the one place a stale flag would do real
 * damage (locking in a short-handed team).
 */
export async function finalizePremadeTeams() {
  await requireAdmin();
  await ensureSchema();

  await withEventLock(async (client) => {
    const { rows: modeRows } = await client.query(
      `SELECT team_format FROM mayhem_events WHERE id = $1`,
      [SINGLETON_EVENT_ID],
    );
    if (modeRows[0]?.team_format !== "premade") {
      throw new Error('This event isn\'t in pure premade mode — use "Randomize teams" instead, which also preserves existing premade teams.');
    }

    const { rows: teamRows } = await client.query(
      `SELECT t.id, count(p.id)::int AS roster_size
       FROM mayhem_teams t LEFT JOIN mayhem_players p ON p.team_id = t.id
       WHERE t.event_id = $1 GROUP BY t.id`,
      [SINGLETON_EVENT_ID],
    );
    if (teamRows.length === 0) throw new Error("No teams have been created yet.");
    const notReady = teamRows.filter((t) => t.roster_size !== PREMADE_ROSTER_SIZE);
    if (notReady.length > 0) {
      throw new Error(`${notReady.length} team(s) aren't full yet (need ${PREMADE_ROSTER_SIZE} players each).`);
    }
    // Bring is_ready in line with what was just verified, in case any team
    // drifted (e.g. an admin manually removed a player) without going
    // through leavePremadeTeam()'s own is_ready update.
    await client.query(
      `UPDATE mayhem_teams SET is_ready = true WHERE event_id = $1`,
      [SINGLETON_EVENT_ID],
    );

    // Assign reveal order now — teams were created in signup order, not a
    // presentation-worthy order, so shuffle purely for the reveal sequence
    // (rosters and identities are untouched).
    const revealOrder = shuffle(teamRows.map((t) => t.id));
    for (let i = 0; i < revealOrder.length; i++) {
      await client.query(
        `UPDATE mayhem_teams SET reveal_order = $1, seed = $2 WHERE id = $3`,
        [i, i + 1, revealOrder[i]],
      );
    }

    await client.query(
      `UPDATE mayhem_events
       SET stage = 'randomized', scene = 'reveal', reveal_index = 0, registration_open = false
       WHERE id = $1`,
      [SINGLETON_EVENT_ID],
    );
  });
  refresh();
}

// ---------------------------------------------------------------------------
// Presentation / scene control
// ---------------------------------------------------------------------------

export async function setScene(scene: MayhemScene) {
  await requireAdmin();
  await sql`UPDATE mayhem_events SET scene = ${scene} WHERE id = ${SINGLETON_EVENT_ID}`;
  refresh();
}

export async function startCountdown(seconds: number) {
  await requireAdmin();
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) {
    throw new Error("Countdown must be between 1 and 3600 seconds.");
  }
  const endsAt = new Date(Date.now() + seconds * 1000).toISOString();
  await sql`
    UPDATE mayhem_events
    SET scene = 'starting_soon', countdown_ends_at = ${endsAt}
    WHERE id = ${SINGLETON_EVENT_ID}
  `;
  refresh();
}

/** Manual single-step reveal advance. Only meaningful when auto_reveal is off — turns it off explicitly so a stray manual click can't fight a running auto-reveal timer. */
export async function advanceReveal() {
  await requireAdmin();
  const full = await getMayhemFull();
  const next = Math.min(full.event.reveal_index + 1, full.teams.length);
  const scene = next >= full.teams.length ? "teams" : "reveal";
  await sql`
    UPDATE mayhem_events SET reveal_index = ${next}, scene = ${scene}, auto_reveal = false
    WHERE id = ${SINGLETON_EVENT_ID}
  `;
  refresh();
}

const MIN_REVEAL_INTERVAL_S = 2;
const MAX_REVEAL_INTERVAL_S = 60;

/**
 * Arms timestamp-based auto-reveal. Persists reveal_started_at as the
 * single source of truth every reader derives elapsed-time reveal count
 * from (see computeAutoRevealIndex in mayhem-reveal.ts) — there is no
 * server timer/cron ticking this forward, so it keeps advancing correctly
 * with zero admin browser tabs open. `startOnCountdownEnd: true` defers
 * the actual start to countdown_ends_at (requires an active countdown);
 * otherwise it starts immediately.
 */
export async function startAutoReveal(intervalSeconds: number, startOnCountdownEnd: boolean) {
  await requireAdmin();
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < MIN_REVEAL_INTERVAL_S || intervalSeconds > MAX_REVEAL_INTERVAL_S) {
    throw new Error(`Reveal interval must be between ${MIN_REVEAL_INTERVAL_S} and ${MAX_REVEAL_INTERVAL_S} seconds.`);
  }
  const full = await getMayhemFull();
  if (full.teams.length === 0) throw new Error("No teams to reveal yet.");
  if (startOnCountdownEnd && !full.event.countdown_ends_at) {
    throw new Error("Start a countdown first, or start the reveal immediately instead.");
  }

  await sql`
    UPDATE mayhem_events
    SET auto_reveal = true,
        reveal_interval_ms = ${intervalSeconds * 1000},
        reveal_start_on_countdown = ${startOnCountdownEnd},
        reveal_started_at = ${startOnCountdownEnd ? null : new Date().toISOString()},
        reveal_index = 0,
        scene = ${startOnCountdownEnd ? "starting_soon" : "reveal"}
    WHERE id = ${SINGLETON_EVENT_ID}
  `;
  refresh();
}

/** Freezes auto-reveal at its current derived count and hands control back to manual advanceReveal(). */
export async function pauseAutoReveal() {
  await requireAdmin();
  const full = await getMayhemFull();
  await sql`
    UPDATE mayhem_events
    SET auto_reveal = false, reveal_index = ${full.event.reveal_index}
    WHERE id = ${SINGLETON_EVENT_ID}
  `;
  refresh();
}

// ---------------------------------------------------------------------------
// Format config
// ---------------------------------------------------------------------------

export async function updateFormat(format: MayhemFormatConfig) {
  await requireAdmin();
  if (format.knockout.doubleElimination && format.knockout.thirdPlaceMatch) {
    throw new Error("Third-place matches are not supported for double elimination.");
  }
  const full = await getMayhemFull();
  if (full.matches.some((match) => match.bracket !== "group")) {
    throw new Error("Knockout settings can't be changed after the bracket is generated.");
  }
  await sql`
    UPDATE mayhem_events SET format = ${JSON.stringify(format)}::jsonb
    WHERE id = ${SINGLETON_EVENT_ID}
  `;
  refresh();
}

// ---------------------------------------------------------------------------
// Group stage
// ---------------------------------------------------------------------------

export async function generateGroups() {
  await requireAdmin();
  const full = await getMayhemFull();
  const { groupCount, seeding, seriesLength, advancePerGroup } = full.event.format.groupStage;
  if (full.teams.length < groupCount * 2) {
    throw new Error("Not enough teams for that many groups.");
  }

  await sql`DELETE FROM mayhem_matches WHERE event_id = ${SINGLETON_EVENT_ID}`;
  await sql`DELETE FROM mayhem_groups WHERE event_id = ${SINGLETON_EVENT_ID}`;
  await sql`UPDATE mayhem_teams SET group_id = NULL WHERE event_id = ${SINGLETON_EVENT_ID}`;

  const orderedTeams =
    seeding === "random" ? shuffle(full.teams) : [...full.teams].sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0));

  const groupIds: string[] = [];
  for (let g = 0; g < groupCount; g++) {
    const groupId = newId("group");
    groupIds.push(groupId);
    const label = `Group ${String.fromCharCode(65 + g)}`;
    await sql`
      INSERT INTO mayhem_groups (id, event_id, label, advance_count)
      VALUES (${groupId}, ${SINGLETON_EVENT_ID}, ${label}, ${advancePerGroup})
    `;
  }

  // Snake-distribute teams across groups for balance.
  const buckets: string[][] = groupIds.map(() => []);
  orderedTeams.forEach((team, i) => {
    const g = i % groupCount;
    buckets[g].push(team.id);
  });
  for (let g = 0; g < groupCount; g++) {
    for (const teamId of buckets[g]) {
      await sql`UPDATE mayhem_teams SET group_id = ${groupIds[g]} WHERE id = ${teamId}`;
    }
  }

  let matchNumber = 1;
  for (let g = 0; g < groupCount; g++) {
    const matches = buildGroupRoundRobin(buckets[g], groupIds[g], seriesLength, matchNumber, () =>
      newId("match"),
    );
    matchNumber += matches.length;
    for (const m of matches) {
      await sql`
        INSERT INTO mayhem_matches (
          id, event_id, bracket, group_id, round_number, match_number, best_of,
          team_a_id, team_b_id, team_a_score, team_b_score, winner_id, status,
          advances_to_match_id, advances_to_slot, drops_to_match_id, drops_to_slot
        ) VALUES (
          ${m.id}, ${SINGLETON_EVENT_ID}, ${m.bracket}, ${m.group_id}, ${m.round_number}, ${m.match_number}, ${m.best_of},
          ${m.team_a_id}, ${m.team_b_id}, ${m.team_a_score}, ${m.team_b_score}, ${m.winner_id}, ${m.status},
          ${m.advances_to_match_id}, ${m.advances_to_slot}, ${m.drops_to_match_id}, ${m.drops_to_slot}
        )
      `;
    }
  }

  await sql`UPDATE mayhem_events SET stage = 'group_stage', scene = 'groups' WHERE id = ${SINGLETON_EVENT_ID}`;
  refresh();
}

/** Take group standings, seed qualifiers into the knockout bracket. */
export async function generateKnockoutFromGroups() {
  await requireAdmin();
  const full = await getMayhemFull();
  const qualifiers: string[] = [];

  for (const group of full.groups) {
    const teamIds = full.teams.filter((t) => t.group_id === group.id).map((t) => t.id);
    const groupMatches = full.matches.filter((m) => m.group_id === group.id);
    const standings = computeGroupStandings(teamIds, groupMatches);
    qualifiers.push(...standings.slice(0, group.advance_count).map((s) => s.teamId));
  }

  await generateKnockoutBracket(qualifiers);
}

/** Generate a knockout bracket directly (no group stage) from all teams, seeded by `seed`. */
export async function generateKnockoutFromAllTeams() {
  await requireAdmin();
  const full = await getMayhemFull();
  const seeded = [...full.teams].sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0)).map((t) => t.id);
  await generateKnockoutBracket(seeded);
}

async function generateKnockoutBracket(teamIdsBySeed: string[]) {
  const full = await getMayhemFull();
  const { knockout } = full.event.format;

  // Only clear knockout-stage matches (upper/lower/grand_final/third_place),
  // preserve group-stage match history.
  await sql`
    DELETE FROM mayhem_matches
    WHERE event_id = ${SINGLETON_EVENT_ID} AND bracket != 'group'
  `;

  const startNumber =
    full.matches.filter((m) => m.bracket === "group").reduce((max, m) => Math.max(max, m.match_number), 0) + 1;

  const matches = buildKnockoutBracket(teamIdsBySeed, {
    knockoutBestOf: knockout.seriesLength,
    doubleElimination: knockout.doubleElimination,
    thirdPlaceMatch: knockout.thirdPlaceMatch,
    grandFinalReset: knockout.grandFinalReset,
    startMatchNumber: startNumber,
    idFactory: () => newId("match"),
  });

  for (const m of matches) {
    await sql`
      INSERT INTO mayhem_matches (
        id, event_id, bracket, group_id, round_number, match_number, best_of,
        team_a_id, team_b_id, team_a_score, team_b_score, winner_id, status,
        advances_to_match_id, advances_to_slot, drops_to_match_id, drops_to_slot
      ) VALUES (
        ${m.id}, ${SINGLETON_EVENT_ID}, ${m.bracket}, ${m.group_id}, ${m.round_number}, ${m.match_number}, ${m.best_of},
        ${m.team_a_id}, ${m.team_b_id}, ${m.team_a_score}, ${m.team_b_score}, ${m.winner_id}, ${m.status},
        ${m.advances_to_match_id}, ${m.advances_to_slot}, ${m.drops_to_match_id}, ${m.drops_to_slot}
      )
    `;
  }

  await sql`UPDATE mayhem_events SET stage = 'knockout', scene = 'bracket' WHERE id = ${SINGLETON_EVENT_ID}`;
  refresh();
}

// ---------------------------------------------------------------------------
// Live match control
// ---------------------------------------------------------------------------

export async function setActiveMatch(matchId: string | null) {
  await requireAdmin();
  await sql`
    UPDATE mayhem_events SET active_match_id = ${matchId}, scene = ${matchId ? "match" : "bracket"}
    WHERE id = ${SINGLETON_EVENT_ID}
  `;
  refresh();
}

/** Record a clinching result and persist all advancement/reset/bye effects. */
export async function recordMatchResult(matchId: string, teamAScore: number, teamBScore: number) {
  await requireAdmin();
  if (!Number.isInteger(teamAScore) || !Number.isInteger(teamBScore) || teamAScore < 0 || teamBScore < 0) {
    throw new Error("Scores must be non-negative whole numbers.");
  }
  if (teamAScore === teamBScore) throw new Error("Match can't end in a tie.");
  const full = await getMayhemFull();
  const match = full.matches.find((m) => m.id === matchId);
  if (!match) throw new Error("Match not found.");
  if (!match.team_a_id || !match.team_b_id) throw new Error("Both teams must be set before reporting a result.");
  if (match.status === "completed") throw new Error("This match already has a result — undo it first to change it.");
  const maxScore = Math.ceil(match.best_of / 2);
  if (teamAScore > maxScore || teamBScore > maxScore) {
    throw new Error(`Bo${match.best_of} can't have a score above ${maxScore}.`);
  }
  const graph = full.matches as unknown as BracketMatch[];
  const result = applyBracketResult(graph, matchId, teamAScore, teamBScore);
  await persistMayhemBracket(graph);

  if (result.championId) {
    await sql`
      UPDATE mayhem_events
      SET champion_team_id = ${result.championId}, scene = 'champion', active_match_id = NULL, stage = 'completed'
      WHERE id = ${SINGLETON_EVENT_ID}
    `;
  } else if (full.event.stage !== "completed") {
    await sql`UPDATE mayhem_events SET active_match_id = NULL, scene = 'bracket' WHERE id = ${SINGLETON_EVENT_ID}`;
  }

  refresh();
}

/**
 * One-click winner report for a Bo1 match — equivalent to
 * recordMatchResult(matchId, 1, 0) / (0, 1) but named for what the button
 * actually means, and rejects outright on anything but a true single-game
 * series so it can never be reached for a Bo3/Bo5 UI by mistake.
 */
export async function reportBo1Winner(matchId: string, winnerTeamId: string) {
  await requireAdmin();
  const full = await getMayhemFull();
  const match = full.matches.find((m) => m.id === matchId);
  if (!match) throw new Error("Match not found.");
  if (match.best_of !== 1) throw new Error("This match isn't a Bo1 — report a score instead.");
  if (winnerTeamId !== match.team_a_id && winnerTeamId !== match.team_b_id) {
    throw new Error("That team isn't in this match.");
  }
  const teamAScore = winnerTeamId === match.team_a_id ? 1 : 0;
  const teamBScore = winnerTeamId === match.team_b_id ? 1 : 0;
  await recordMatchResult(matchId, teamAScore, teamBScore);
}

/** Undo a result and retract dependent auto-resolved byes transitively. */
export async function undoMatchResult(matchId: string) {
  await requireAdmin();
  const full = await getMayhemFull();
  const graph = full.matches as unknown as BracketMatch[];
  const match = graph.find((candidate) => candidate.id === matchId);
  const previousWinner = match?.winner_id ?? null;
  retractBracketResult(graph, matchId);
  await persistMayhemBracket(graph);

  if (previousWinner && full.event.champion_team_id === previousWinner) {
    await sql`
      UPDATE mayhem_events SET champion_team_id = NULL, stage = 'knockout',
        scene = 'bracket', active_match_id = NULL
      WHERE id = ${SINGLETON_EVENT_ID}
    `;
  }
  refresh();
}
