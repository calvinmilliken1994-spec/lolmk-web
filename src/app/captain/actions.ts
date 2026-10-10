"use server";

import { sql, type VercelPoolClient } from "@vercel/postgres";
import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { getCaptainSession } from "@/lib/discord-auth";
import { ensureSchema, insertSrAudit, newId } from "@/lib/sr-db";
import { assertOwnBlobUrl, deleteTeamLogo, uploadTeamLogo } from "@/lib/team-logo";
import { lookupKrRank } from "@/lib/riot";
import { SR_PLAYER_ROLES, SR_PREMADE_ROSTER_SIZE, SR_RANKS } from "@/types/sr-tournament";
import type { SrActor, SrPlayerRole, SrRank } from "@/types/sr-tournament";

/**
 * Captain self-service write layer.
 *
 * Auth boundary: every captain-facing action begins with requireCaptain(),
 * which reads the `lolmk-captain-session` cookie and validates it against
 * `captain_sessions` + the live CAPTAIN_ROLE_ID membership check. It does NOT
 * call isToolsSession() and nothing here can be reached with an admin cookie
 * alone — the two systems share a Discord app and nothing else.
 *
 * The two exceptions are confirmApplicationSlot/declineApplicationSlot, which
 * are acted on by the *invitee*, not the captain. Those require
 * getMemberSession() — the verified-member system, a third independent cookie
 * — because an invited player is an ordinary member with no reason to hold
 * the captain role. A captain session does not satisfy that gate and a member
 * session does not satisfy requireCaptain(); neither is ever accepted in place
 * of the other.
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

// Audit actors for this file. Everything here is a member acting for
// themselves (captain or invited player), never an admin: kind "member".
function captainActor(captain: { discordUserId: string; username: string }): SrActor {
  return { discordId: captain.discordUserId, name: captain.username, kind: "member" };
}

function memberActor(member: { discordUserId: string; displayName: string }): SrActor {
  return { discordId: member.discordUserId, name: member.displayName, kind: "member" };
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

/**
 * Shape check ONLY — "is this a plausible Discord snowflake", nothing more.
 *
 * It used to be the entire verification an initial roster got. It isn't any
 * more: every id that reaches a write path below is additionally resolved
 * against live guild membership with the bot token
 * (fetchGuildMemberById), and initial rosters are built purely from guild
 * search results that each recipient then confirms themselves. This stays as
 * a cheap pre-filter so a garbage string never costs a Discord round-trip.
 */
function cleanDiscordId(value: unknown): string {
  const v = String(value ?? "").trim();
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
  // Tournament-first lock ordering: every application code path
  // (withTournamentLock) locks the tournament row before anything else, so
  // this does too — otherwise a captain edit and an application mutation on
  // the same tournament could lock in opposite orders and deadlock.
  const { rows: preRows } = await client.query(
    `SELECT tournament_id FROM sr_teams WHERE id = $1 AND captain_discord_id = $2`,
    [teamId, discordId],
  );
  if (preRows.length === 0) throw new Error("Team not found.");
  await client.query(`SELECT id FROM sr_tournaments WHERE id = $1 FOR UPDATE`, [
    preRows[0].tournament_id,
  ]);

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
 * the tournament is still in draft, and while the team hasn't been rejected —
 * a rejected roster is frozen until an admin reactivates it, otherwise a
 * captain could add/edit players whose reservation status is inconsistent
 * with the team's own (released) reservation state.
 */
function assertEditable(team: Record<string, unknown>) {
  if (team.status === "rejected") {
    throw new Error("This team was rejected. Ask an admin before making further changes.");
  }
  if (team.seed !== null && team.seed !== undefined) {
    throw new Error("Your team has been seeded into the bracket. Ask an admin for any changes.");
  }
  if (team.tournament_status !== "draft") {
    throw new Error("The tournament has moved past setup. Ask an admin for any changes.");
  }
}

// ---------------------------------------------------------------------------
// Verified premade signup
// ---------------------------------------------------------------------------
//
// Summoner's Rift is premade-only: there is no solo queue, no randomizer, and
// no path by which a captain's typing alone produces a team. A signup is an
// *application* — a draft roster of five Discord accounts, each found by
// server-side guild search — and it only becomes an `sr_teams` row once all
// five have individually clicked a confirmation link DM'd to them. Until
// then nothing exists in sr_teams/sr_team_players, so a half-assembled roster
// can never be seeded, reported on, or counted toward capacity.
//
// This replaced createTeam(), which created a team plus its first roster slot
// straight from form fields. No code path here writes sr_teams from
// unverified captain input any more.

/**
 * Row lock on one tournament — the SR analogue of ARAM Mayhem's
 * withEventLock, except SR has no singleton row to lock, so the tournament
 * itself is the serialization point. Every application mutation for THIS
 * tournament queues behind it; other tournaments proceed in parallel.
 */
async function withTournamentLock<T>(
  tournamentId: string,
  fn: (client: VercelPoolClient) => Promise<T>,
): Promise<T> {
  const client = await sql.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT id FROM sr_tournaments WHERE id = $1 FOR UPDATE`, [tournamentId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Connection may already be dead; nothing further to do.
    }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Is this Discord account already spoken for in this tournament — rostered
 * on a real team, or holding a live slot on any application (their own or
 * someone else's invite)?
 *
 * The sr_team_players half deliberately has NO status filter. `sr_team_players`
 * carries a unique index on (tournament_id, discord_id) that counts rejected
 * teams too, so narrowing this to pending/approved teams would let a check
 * pass here and then explode on that index at promotion time, mid-transaction,
 * with nothing the captain could do about it. Whatever the index enforces is
 * what this must report.
 *
 * Draft slots reserve nobody: a captain can pencil someone in while that
 * person is still deciding on another roster, and the reservation is only
 * taken when an invite actually goes out. Expired pending invites stop
 * reserving as well — confirmApplicationSlot would reject them anyway, so
 * leaving them to block that person forever would be a dead hand.
 */
async function isDiscordIdReserved(
  client: VercelPoolClient,
  tournamentId: string,
  discordUserId: string,
  excludeSlotId?: string,
): Promise<boolean> {
  const { rows: playerRows } = await client.query(
    `SELECT id FROM sr_team_players
     WHERE tournament_id = $1 AND discord_id = $2 AND reservation_active`,
    [tournamentId, discordUserId],
  );
  if (playerRows.length > 0) return true;
  const { rows: slotRows } = await client.query(
    `SELECT s.id FROM sr_team_application_slots s
     JOIN sr_team_applications a ON a.id = s.application_id
     WHERE a.tournament_id = $1 AND s.member_discord_id = $2
       AND (
         s.status = 'confirmed'
         OR (s.status = 'pending' AND (s.confirm_token_expires_at IS NULL OR s.confirm_token_expires_at > now()))
       )
       AND ($3::text IS NULL OR s.id != $3)`,
    [tournamentId, discordUserId, excludeSlotId ?? null],
  );
  return slotRows.length > 0;
}

const CONFIRM_TOKEN_BYTES = 24;
const INVITE_TOKEN_TTL_MS = 72 * 60 * 60 * 1000;

async function hashConfirmToken(token: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(token).digest("hex");
}

function randomConfirmToken(): string {
  return randomBytes(CONFIRM_TOKEN_BYTES).toString("base64url");
}

function buildInviteMessage(
  teamName: string,
  tournamentName: string,
  captainName: string,
  url: string,
): string {
  return (
    `You've been invited to join **${teamName}** for ${tournamentName}, by ${captainName}.\n\n` +
    `Confirm your spot here (expires in 72 hours): ${url}\n\n` +
    `If this wasn't meant for you, you can ignore this or decline on that page.`
  );
}

/**
 * The signup gate, in one place: signups_open is the admin's switch, and the
 * draft check stops a stale open flag from admitting anyone into a tournament
 * that has already been seeded. Deliberately NOT a "registration generation"
 * — SR gates on these two columns and nothing else.
 */
function signupsAreOpen(row: Record<string, unknown>): boolean {
  return Boolean(row.signups_open) && row.status === "draft";
}

/**
 * Captain starts an application. Their own slot is filled immediately and
 * already-confirmed — they're the one doing the asking, so there is nothing
 * for them to consent to and no token is ever minted for it. Identity comes
 * from the live guild roster rather than the session, because the captain
 * session carries a raw avatar *hash* while every other slot carries a
 * resolved URL, and the roster UI has to render them side by side.
 */
export async function createPremadeApplication(
  tournamentId: string,
  teamName: string,
): Promise<{ ok: true; applicationId: string } | { ok: false; reason: string }> {
  const captain = await requireCaptain();
  const actor = captainActor(captain);
  const name = teamName.trim().slice(0, 60);
  if (!name) return { ok: false, reason: "Team name can't be empty." };

  const { fetchGuildMemberById } = await import("@/lib/discord-bot");
  const self = await fetchGuildMemberById(captain.discordUserId);

  await ensureSchema();
  try {
    return await withTournamentLock(tournamentId, async (client) => {
      const { rows: tRows } = await client.query(
        `SELECT id, slug, status, signups_open, max_teams FROM sr_tournaments WHERE id = $1`,
        [tournamentId],
      );
      if (tRows.length === 0) return { ok: false, reason: "Tournament not found." };
      if (!signupsAreOpen(tRows[0])) {
        return { ok: false, reason: "Signups are not open for this tournament." };
      }

      const { rows: countRows } = await client.query(
        `SELECT count(*)::int AS c FROM sr_teams WHERE tournament_id = $1 AND status <> 'rejected'`,
        [tournamentId],
      );
      if (countRows[0].c >= (tRows[0].max_teams as number)) {
        return { ok: false, reason: "This tournament is full." };
      }

      if (await isDiscordIdReserved(client, tournamentId, captain.discordUserId)) {
        return { ok: false, reason: "You're already rostered or invited on a team in this tournament." };
      }
      const { rows: existingApp } = await client.query(
        `SELECT id FROM sr_team_applications WHERE tournament_id = $1 AND captain_discord_id = $2`,
        [tournamentId, captain.discordUserId],
      );
      if (existingApp.length > 0) {
        return {
          ok: false,
          reason: "You already have an application in progress. Withdraw it first to start a new one.",
        };
      }
      // The unique index on sr_team_applications can't see sr_teams, so the
      // cross-table half of "this name is taken" has to be an explicit check.
      const { rows: nameClash } = await client.query(
        `SELECT id FROM sr_teams WHERE tournament_id = $1 AND lower(name) = lower($2)
         UNION SELECT id FROM sr_team_applications WHERE tournament_id = $1 AND lower(team_name) = lower($2)`,
        [tournamentId, name],
      );
      if (nameClash.length > 0) {
        return { ok: false, reason: `A team named "${name}" is already registered.` };
      }

      const applicationId = newId("srapp");
      await client.query(
        `INSERT INTO sr_team_applications (id, tournament_id, team_name, captain_discord_id)
         VALUES ($1, $2, $3, $4)`,
        [applicationId, tournamentId, name, captain.discordUserId],
      );
      await client.query(
        `INSERT INTO sr_team_application_slots
           (id, application_id, member_discord_id, display_name, avatar_url, status, is_captain, confirm_token_hash)
         VALUES ($1, $2, $3, $4, $5, 'confirmed', true, NULL)`,
        [
          newId("srslot"),
          applicationId,
          captain.discordUserId,
          self?.displayName ?? captain.username,
          self?.avatarUrl ?? null,
        ],
      );
      await insertSrAudit(
        client,
        tournamentId,
        "team.application_create",
        { applicationId, name, captain: captain.discordUserId },
        actor,
      );
      return { ok: true, applicationId };
    });
  } finally {
    refresh();
  }
}

/**
 * Captain pencils in one of the other four, chosen from guild search. The
 * ONLY thing trusted from the client is a Discord user id; the display name
 * and avatar are re-resolved server-side against the live guild, never
 * accepted as submitted strings, and an account that isn't currently in the
 * server can't be added at all. No DM, no token — that's sendApplicationInvites.
 */
export async function addDraftMember(
  applicationId: string,
  inviteeDiscordId: string,
): Promise<{ ok: true; slotId: string; displayName: string } | { ok: false; reason: string }> {
  const captain = await requireCaptain();
  if (!/^\d{15,25}$/.test(inviteeDiscordId)) return { ok: false, reason: "Invalid Discord user id." };

  const { fetchGuildMemberById, isVerifiedMemberCandidate } = await import("@/lib/discord-bot");
  const invitee = await fetchGuildMemberById(inviteeDiscordId);
  if (!invitee) {
    return { ok: false, reason: "Couldn't find that person in the server right now — try searching again." };
  }
  if (invitee.isBot) return { ok: false, reason: "Can't add a bot account." };
  if (!isVerifiedMemberCandidate(invitee)) {
    return { ok: false, reason: "That member does not have a role allowed to confirm tournament invites." };
  }

  await ensureSchema();
  const tournamentId = await applicationTournamentId(applicationId);
  if (!tournamentId) return { ok: false, reason: "Application not found." };

  try {
    return await withTournamentLock(tournamentId, async (client) => {
      const app = await loadOwnApplication(client, applicationId, captain.discordUserId);
      if (!app.ok) return app;
      if (app.row.send_in_progress) {
        return {
          ok: false,
          reason: "Invites are currently being sent — wait for that to finish before editing the roster.",
        };
      }

      const { rows: slotCountRows } = await client.query(
        `SELECT count(*)::int AS c FROM sr_team_application_slots WHERE application_id = $1`,
        [applicationId],
      );
      if (slotCountRows[0].c >= SR_PREMADE_ROSTER_SIZE) {
        return { ok: false, reason: "This roster is already full." };
      }
      if (inviteeDiscordId === captain.discordUserId) {
        return { ok: false, reason: "You already hold the captain's slot." };
      }
      if (await isDiscordIdReserved(client, tournamentId, inviteeDiscordId)) {
        return { ok: false, reason: "That person is already rostered or invited on another team." };
      }

      const slotId = newId("srslot");
      await client.query(
        `INSERT INTO sr_team_application_slots
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

/**
 * Captain drops a pick before it's been accepted. A confirmed slot — anyone
 * else's, or their own — can't be removed here; that's withdrawApplication.
 */
export async function removeDraftSlot(
  applicationId: string,
  slotId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const captain = await requireCaptain();
  await ensureSchema();
  const tournamentId = await applicationTournamentId(applicationId);
  if (!tournamentId) return { ok: false, reason: "Application not found." };

  try {
    return await withTournamentLock(tournamentId, async (client) => {
      const app = await loadOwnApplication(client, applicationId, captain.discordUserId);
      if (!app.ok) return app;

      const { rows } = await client.query(
        `SELECT is_captain, status FROM sr_team_application_slots WHERE id = $1 AND application_id = $2`,
        [slotId, applicationId],
      );
      if (rows.length === 0) return { ok: false, reason: "Slot not found." };
      if (rows[0].is_captain) return { ok: false, reason: "Can't remove your own captain slot." };
      if (rows[0].status === "confirmed") {
        return { ok: false, reason: "That player already confirmed — withdraw the whole application instead." };
      }
      await client.query(`DELETE FROM sr_team_application_slots WHERE id = $1`, [slotId]);
      return { ok: true };
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
  /**
   * Only set when the DM bounced because that account's DMs are closed — a
   * copy-paste fallback the captain can hand over some other way. Never set
   * on success, so a live confirmation link is never surfaced in the UI once
   * Discord has already delivered it privately.
   */
  manualLink?: string;
}

/**
 * Sends one confirmation DM per draft slot, once all five slots exist. Two
 * phases, split across the lock boundary on purpose:
 *
 *   1. Under withTournamentLock: prove ownership and the signup gate, claim
 *      the application with send_in_progress (which rejects a concurrent
 *      second send outright), mint and hash one token per draft slot, flip
 *      each to 'pending'. Committed and the lock released before any network
 *      call happens.
 *   2. Outside every lock: the actual DMs. A rate-limited Discord call must
 *      never hold the tournament row lock and stall every other captain's
 *      roster edits — only THIS application is blocked, by send_in_progress.
 *
 * Per-slot delivery state is written as each DM resolves, so "2 of 4 sent"
 * survives a refresh and the failed two get a Retry.
 */
export async function sendApplicationInvites(
  applicationId: string,
): Promise<{ ok: true; results: SendInviteResult[] } | { ok: false; reason: string }> {
  const captain = await requireCaptain();
  const actor = captainActor(captain);
  await ensureSchema();
  const tournamentId = await applicationTournamentId(applicationId);
  if (!tournamentId) return { ok: false, reason: "Application not found." };

  type Prepared = { slotId: string; discordUserId: string; displayName: string; token: string };
  const prep = await withTournamentLock(
    tournamentId,
    async (
      client,
    ): Promise<
      { ok: true; teamName: string; tournamentName: string; items: Prepared[] } | { ok: false; reason: string }
    > => {
      const app = await loadOwnApplication(client, applicationId, captain.discordUserId);
      if (!app.ok) return app;
      if (app.row.send_in_progress) {
        return { ok: false, reason: "Invites are already being sent — wait for that to finish first." };
      }

      const { rows: slotRows } = await client.query(
        `SELECT id, member_discord_id, display_name, status FROM sr_team_application_slots WHERE application_id = $1`,
        [applicationId],
      );
      if (slotRows.length !== SR_PREMADE_ROSTER_SIZE) {
        return {
          ok: false,
          reason: `Add all ${SR_PREMADE_ROSTER_SIZE} players before sending invites (${slotRows.length}/${SR_PREMADE_ROSTER_SIZE} so far).`,
        };
      }
      const draftRows = slotRows.filter((s) => s.status === "draft");
      if (draftRows.length === 0) {
        return { ok: false, reason: "Every slot already has an invite out — use Retry on a failed one instead." };
      }
      // Re-check every draft's reservation now, under this lock. A draft
      // deliberately reserves nobody, so an arbitrary amount of time may have
      // passed since the pick was made and someone else's application could
      // have confirmed that same account in between. Right before tokens go
      // out is the only moment where catching it matters.
      for (const slot of draftRows) {
        if (await isDiscordIdReserved(client, tournamentId, slot.member_discord_id, slot.id)) {
          return {
            ok: false,
            reason: `${slot.display_name} joined another team since you added them — remove them and pick someone else.`,
          };
        }
      }

      await client.query(
        `UPDATE sr_team_applications SET send_in_progress = true, roster_version = roster_version + 1 WHERE id = $1`,
        [applicationId],
      );
      const { rows: versionRows } = await client.query(
        `SELECT roster_version FROM sr_team_applications WHERE id = $1`,
        [applicationId],
      );
      const rosterVersion = versionRows[0].roster_version as number;

      const items: Prepared[] = [];
      for (const slot of draftRows) {
        const token = randomConfirmToken();
        const expiresAt = new Date(Date.now() + INVITE_TOKEN_TTL_MS).toISOString();
        await client.query(
          `UPDATE sr_team_application_slots
           SET status = 'pending', confirm_token_hash = $1, confirm_token_expires_at = $2,
               delivery_status = 'sending', delivery_error = NULL, token_roster_version = $3, updated_at = now()
           WHERE id = $4`,
          [await hashConfirmToken(token), expiresAt, rosterVersion, slot.id],
        );
        items.push({
          slotId: slot.id,
          discordUserId: slot.member_discord_id,
          displayName: slot.display_name,
          token,
        });
      }

      const { rows: nameRows } = await client.query(`SELECT name FROM sr_tournaments WHERE id = $1`, [
        tournamentId,
      ]);
      await insertSrAudit(
        client,
        tournamentId,
        "roster.invite_send",
        { applicationId, count: items.length, rosterVersion },
        actor,
      );
      return {
        ok: true,
        teamName: app.row.team_name as string,
        tournamentName: (nameRows[0]?.name as string) ?? "Summoner's Rift",
        items,
      };
    },
  );
  refresh();
  if (!prep.ok) return prep;

  const { sendDirectMessage } = await import("@/lib/discord-bot");
  const { trustedOrigin } = await import("@/lib/discord-auth");

  const results: SendInviteResult[] = [];
  for (const item of prep.items) {
    const url = `${trustedOrigin()}/tournaments/summoners-rift/confirm?slot=${item.slotId}&token=${encodeURIComponent(item.token)}`;
    const dm = await sendDirectMessage(
      item.discordUserId,
      buildInviteMessage(prep.teamName, prep.tournamentName, captain.username, url),
    );

    if (dm.ok) {
      await sql`UPDATE sr_team_application_slots SET delivery_status = 'sent', delivery_error = NULL WHERE id = ${item.slotId}`;
      results.push({ slotId: item.slotId, displayName: item.displayName, delivered: true });
    } else {
      const error = deliveryErrorMessage(dm);
      await sql`UPDATE sr_team_application_slots SET delivery_status = 'failed', delivery_error = ${error} WHERE id = ${item.slotId}`;
      results.push({
        slotId: item.slotId,
        displayName: item.displayName,
        delivered: false,
        error,
        manualLink: dm.status === "dm_unavailable" ? url : undefined,
      });
    }
  }

  await sql`UPDATE sr_team_applications SET send_in_progress = false WHERE id = ${applicationId}`;
  refresh();
  return { ok: true, results };
}

/**
 * Resends exactly one failed invite. A retry always mints a fresh token —
 * the stored hash can't be reversed back into a usable link, so there is
 * nothing to resend otherwise.
 *
 * `WHERE ... AND delivery_status = 'failed'` is the concurrency guard: it
 * atomically claims the slot, so a double-click can't fire two DMs at the
 * same person. The second click matches zero rows and is rejected. No
 * tournament lock is needed because nothing about roster shape changes here,
 * only this one slot's delivery state.
 */
export async function retryInviteDelivery(
  applicationId: string,
  slotId: string,
): Promise<
  { ok: true; delivered: boolean; error?: string; manualLink?: string } | { ok: false; reason: string }
> {
  const captain = await requireCaptain();
  const actor = captainActor(captain);
  await ensureSchema();
  const tournamentId = await applicationTournamentId(applicationId);
  if (!tournamentId) return { ok: false, reason: "Application not found." };

  const token = randomConfirmToken();
  const tokenHash = await hashConfirmToken(token);
  const expiresAt = new Date(Date.now() + INVITE_TOKEN_TTL_MS).toISOString();
  const prep = await withTournamentLock(tournamentId, async (client) => {
    const app = await loadOwnApplication(client, applicationId, captain.discordUserId);
    if (!app.ok) return app;

    const { rows: claimed } = await client.query(
      `UPDATE sr_team_application_slots
       SET confirm_token_hash = $1, confirm_token_expires_at = $2,
           delivery_status = 'sending', delivery_error = NULL, updated_at = now()
       WHERE id = $3 AND application_id = $4
         AND status = 'pending' AND delivery_status = 'failed'
       RETURNING id, member_discord_id`,
      [tokenHash, expiresAt, slotId, applicationId],
    );
    if (claimed.length === 0) {
      return { ok: false as const, reason: "This invite isn't in a retryable state right now — refresh and try again." };
    }
    const { rows: tournamentRows } = await client.query(`SELECT name FROM sr_tournaments WHERE id = $1`, [
      tournamentId,
    ]);
    await insertSrAudit(client, tournamentId, "roster.invite_retry", { applicationId, slotId }, actor);
    return {
      ok: true as const,
      discordUserId: claimed[0].member_discord_id as string,
      teamName: app.row.team_name as string,
      tournamentName: (tournamentRows[0]?.name as string) ?? "Summoner's Rift",
    };
  });
  refresh();
  if (!prep.ok) return prep;

  const { sendDirectMessage } = await import("@/lib/discord-bot");
  const { trustedOrigin } = await import("@/lib/discord-auth");
  const url = `${trustedOrigin()}/tournaments/summoners-rift/confirm?slot=${slotId}&token=${encodeURIComponent(token)}`;
  const dm = await sendDirectMessage(
    prep.discordUserId,
    buildInviteMessage(prep.teamName, prep.tournamentName, captain.username, url),
  );

  if (dm.ok) {
    await sql`
      UPDATE sr_team_application_slots
      SET delivery_status = 'sent', delivery_error = NULL
      WHERE id = ${slotId} AND status = 'pending' AND delivery_status = 'sending'
        AND confirm_token_hash = ${tokenHash}
    `;
    refresh();
    return { ok: true, delivered: true };
  }
  const error = deliveryErrorMessage(dm);
  await sql`
    UPDATE sr_team_application_slots
    SET delivery_status = 'failed', delivery_error = ${error}
    WHERE id = ${slotId} AND status = 'pending' AND delivery_status = 'sending'
      AND confirm_token_hash = ${tokenHash}
  `;
  refresh();
  return { ok: true, delivered: false, error, manualLink: dm.status === "dm_unavailable" ? url : undefined };
}

/**
 * The invited player accepts, from the link in their own DM.
 *
 * Authorization is deliberately two-part: the token proves the link is the
 * one that was sent, and getMemberSession() proves the person clicking it is
 * its addressee. The token alone is not enough — the captain generated it and
 * may still be holding the manual-fallback copy, and they must not be able to
 * accept on someone else's behalf. Note this is the verified-member session,
 * NOT the captain session: the four invitees are ordinary members and have no
 * reason to hold the captain role.
 *
 * If this is the fifth confirmation, the application is promoted into a real
 * sr_teams row and five sr_team_players rows in the same transaction. There
 * is no intermediate state in which some of a roster exists.
 */
export async function confirmApplicationSlot(
  slotId: string,
  rawToken: string,
): Promise<{ ok: true; promoted: boolean; teamName: string } | { ok: false; reason: string }> {
  const { getMemberSession } = await import("@/lib/discord-auth");
  const member = await getMemberSession();
  if (!member) {
    return { ok: false, reason: "You need to sign in with a verified Discord account first." };
  }
  const actor = memberActor(member);

  await ensureSchema();
  const tournamentId = await slotTournamentId(slotId);
  if (!tournamentId) return { ok: false, reason: "Invite not found." };

  let slug: string | undefined;
  try {
    return await withTournamentLock(tournamentId, async (client) => {
      const { rows: slotRows } = await client.query(
        `SELECT s.*, a.tournament_id, a.team_name, a.captain_discord_id,
                t.slug, t.status AS tournament_status, t.signups_open, t.max_teams
         FROM sr_team_application_slots s
         JOIN sr_team_applications a ON a.id = s.application_id
         JOIN sr_tournaments t ON t.id = a.tournament_id
         WHERE s.id = $1`,
        [slotId],
      );
      if (slotRows.length === 0) return { ok: false, reason: "Invite not found." };
      const slot = slotRows[0];
      slug = slot.slug as string;

      if (slot.member_discord_id !== member.discordUserId) {
        return { ok: false, reason: "This invite isn't addressed to your account." };
      }
      if (slot.status !== "pending") {
        return {
          ok: false,
          reason: slot.status === "confirmed" ? "Already confirmed." : "This invite was declined or withdrawn.",
        };
      }
      if (!slot.confirm_token_hash || slot.confirm_token_hash !== (await hashConfirmToken(rawToken))) {
        return { ok: false, reason: "Invalid or expired invite link." };
      }
      if (slot.confirm_token_expires_at && new Date(slot.confirm_token_expires_at).getTime() < Date.now()) {
        return { ok: false, reason: "This invite link has expired — ask your captain to resend it." };
      }
      if (!signupsAreOpen({ status: slot.tournament_status, signups_open: slot.signups_open })) {
        return { ok: false, reason: "Signups have closed since you were invited." };
      }
      if (await isDiscordIdReserved(client, tournamentId, member.discordUserId, slotId)) {
        return { ok: false, reason: "You're already rostered on a team in this tournament." };
      }

      // Would this confirmation be the fifth? Read the other four BEFORE
      // writing, so the capacity and name checks below can run while the
      // invite is still retryable. If they ran after the UPDATE, a full
      // tournament would strand the application at 5/5 confirmed with no
      // action left that could fix it.
      const { rows: otherRows } = await client.query(
        `SELECT status FROM sr_team_application_slots WHERE application_id = $1 AND id <> $2`,
        [slot.application_id, slotId],
      );
      const completesRoster =
        otherRows.length === SR_PREMADE_ROSTER_SIZE - 1 && otherRows.every((r) => r.status === "confirmed");

      if (completesRoster) {
        const { rows: countRows } = await client.query(
          `SELECT count(*)::int AS c FROM sr_teams WHERE tournament_id = $1 AND status <> 'rejected'`,
          [tournamentId],
        );
        if (countRows[0].c >= (slot.max_teams as number)) {
          return { ok: false, reason: "This tournament filled up before your team completed its roster." };
        }
        const { rows: nameClash } = await client.query(
          `SELECT id FROM sr_teams WHERE tournament_id = $1 AND lower(name) = lower($2)`,
          [tournamentId, slot.team_name],
        );
        if (nameClash.length > 0) {
          return {
            ok: false,
            reason: `A team named "${slot.team_name}" registered first — ask your captain to rename and resend.`,
          };
        }
      }

      await client.query(
        `UPDATE sr_team_application_slots
         SET status = 'confirmed', confirm_token_hash = NULL, confirm_token_expires_at = NULL, updated_at = now()
         WHERE id = $1`,
        [slotId],
      );
      await insertSrAudit(
        client,
        tournamentId,
        "roster.slot_confirm",
        { applicationId: slot.application_id, slotId, member: member.discordUserId },
        actor,
      );
      if (!completesRoster) return { ok: true, promoted: false, teamName: slot.team_name as string };

      // Fifth confirmation: promote. Only now does an sr_teams row exist.
      const { rows: memberRows } = await client.query(
        `SELECT member_discord_id, display_name, is_captain
         FROM sr_team_application_slots WHERE application_id = $1
         ORDER BY is_captain DESC, created_at ASC`,
        [slot.application_id],
      );
      const teamId = newId("srteam");
      await client.query(
        `INSERT INTO sr_teams (id, tournament_id, name, captain_discord_id, status)
         VALUES ($1, $2, $3, $4, 'pending')`,
        [teamId, tournamentId, slot.team_name, slot.captain_discord_id],
      );
      for (const m of memberRows) {
        // IGN defaults to the Discord display name and role to FILL; the
        // captain fills in real Riot IDs and roles afterwards from their own
        // dashboard via updateRosterPlayer. Nothing is invented here.
        await client.query(
          `INSERT INTO sr_team_players
             (id, team_id, tournament_id, discord_id, ign, role, current_rank, peak_rank, is_captain)
           VALUES ($1, $2, $3, $4, $5, 'FILL', NULL, NULL, $6)`,
          [
            newId("srplayer"),
            teamId,
            tournamentId,
            m.member_discord_id,
            m.display_name,
            Boolean(m.is_captain),
          ],
        );
      }
      await client.query(`DELETE FROM sr_team_applications WHERE id = $1`, [slot.application_id]);
      await insertSrAudit(
        client,
        tournamentId,
        "team.signup",
        { teamId, name: slot.team_name, captain: slot.captain_discord_id, via: "premade_application" },
        actor,
      );
      return { ok: true, promoted: true, teamName: slot.team_name as string };
    });
  } finally {
    refresh(slug);
  }
}

/**
 * The invited player declines. Same two-part authorization as confirm.
 *
 * The row is DELETED rather than marked 'declined' and kept: the reservation
 * has to be released the instant someone says no, and a row that no longer
 * exists is the one representation isDiscordIdReserved can't get wrong. The
 * captain simply sees an empty slot to fill again.
 */
export async function declineApplicationSlot(
  slotId: string,
  rawToken: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { getMemberSession } = await import("@/lib/discord-auth");
  const member = await getMemberSession();
  if (!member) {
    return { ok: false, reason: "You need to sign in with a verified Discord account first." };
  }
  const actor = memberActor(member);

  await ensureSchema();
  const tournamentId = await slotTournamentId(slotId);
  if (!tournamentId) return { ok: false, reason: "Invite not found." };

  try {
    return await withTournamentLock(tournamentId, async (client) => {
      const { rows } = await client.query(
        `SELECT s.application_id, s.confirm_token_hash, s.confirm_token_expires_at, s.status, s.member_discord_id
         FROM sr_team_application_slots s WHERE s.id = $1`,
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
      await client.query(`DELETE FROM sr_team_application_slots WHERE id = $1`, [slotId]);
      await insertSrAudit(
        client,
        tournamentId,
        "roster.slot_decline",
        { applicationId: rows[0].application_id, slotId, member: member.discordUserId },
        actor,
      );
      return { ok: true };
    });
  } finally {
    refresh();
  }
}

/** Captain scraps the whole application. Slots cascade, freeing every reservation it held. */
export async function withdrawApplication(
  applicationId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const captain = await requireCaptain();
  const actor = captainActor(captain);
  await ensureSchema();
  const tournamentId = await applicationTournamentId(applicationId);
  if (!tournamentId) return { ok: false, reason: "Application not found." };

  try {
    return await withTournamentLock(tournamentId, async (client) => {
      const { rows } = await client.query(
        `SELECT captain_discord_id, team_name FROM sr_team_applications WHERE id = $1`,
        [applicationId],
      );
      if (rows.length === 0) return { ok: false, reason: "Application not found." };
      if (rows[0].captain_discord_id !== captain.discordUserId) {
        return { ok: false, reason: "Only the captain can withdraw this application." };
      }
      await client.query(`DELETE FROM sr_team_applications WHERE id = $1`, [applicationId]);
      await insertSrAudit(
        client,
        tournamentId,
        "team.application_withdraw",
        { applicationId, name: rows[0].team_name, by: "captain" },
        actor,
      );
      return { ok: true };
    });
  } finally {
    refresh();
  }
}

// --- application helpers ---------------------------------------------------

/**
 * Which tournament does this application belong to? Read before taking the
 * lock, because the lock is keyed on the tournament and we don't know it yet.
 * Returning null here is indistinguishable from "no such application", which
 * is the answer an unauthenticated guess deserves.
 */
async function applicationTournamentId(applicationId: string): Promise<string | null> {
  const { rows } = await sql`SELECT tournament_id FROM sr_team_applications WHERE id = ${applicationId}`;
  return rows.length > 0 ? (rows[0].tournament_id as string) : null;
}

async function slotTournamentId(slotId: string): Promise<string | null> {
  const { rows } = await sql`
    SELECT a.tournament_id FROM sr_team_application_slots s
    JOIN sr_team_applications a ON a.id = s.application_id
    WHERE s.id = ${slotId}
  `;
  return rows.length > 0 ? (rows[0].tournament_id as string) : null;
}

/**
 * Load an application the caller owns, with the signup gate already applied.
 * Ownership is re-proved inside the lock rather than carried from the
 * pre-lock lookup, so a withdrawal that landed in between can't be missed.
 */
async function loadOwnApplication(
  client: VercelPoolClient,
  applicationId: string,
  captainDiscordId: string,
): Promise<{ ok: true; row: Record<string, unknown> } | { ok: false; reason: string }> {
  const { rows } = await client.query(
    `SELECT a.*, t.status, t.signups_open
     FROM sr_team_applications a JOIN sr_tournaments t ON t.id = a.tournament_id
     WHERE a.id = $1`,
    [applicationId],
  );
  if (rows.length === 0) return { ok: false, reason: "Application not found." };
  if (rows[0].captain_discord_id !== captainDiscordId) {
    return { ok: false, reason: "Only the captain can manage this application." };
  }
  if (!signupsAreOpen(rows[0])) {
    return { ok: false, reason: "Signups are not open for this tournament." };
  }
  return { ok: true, row: rows[0] };
}

function deliveryErrorMessage(dm: { status: string; retryAfterMs?: number }): string {
  if (dm.status === "dm_unavailable") return "DMs are closed, or they've blocked the bot.";
  if (dm.status === "rate_limited") {
    return `Discord rate-limited the bot — retry in ~${Math.ceil((dm.retryAfterMs ?? 1000) / 1000)}s.`;
  }
  return "Discord DM failed unexpectedly.";
}

// ---------------------------------------------------------------------------
// My team
// ---------------------------------------------------------------------------

export async function updateMyTeam(teamId: string, input: { name: string }): Promise<void> {
  const captain = await requireCaptain();
  const actor = captainActor(captain);
  const name = input.name.trim();
  if (!name) throw new Error("Team name cannot be blank.");
  if (name.length > 60) throw new Error("Team name is too long.");

  const slug = await withTransaction(async (client) => {
    const team = await lockOwnTeam(client, teamId, captain.discordUserId);
    assertEditable(team);
    const { rows: applicationClash } = await client.query(
      `SELECT id FROM sr_team_applications
       WHERE tournament_id = $1 AND lower(team_name) = lower($2)`,
      [team.tournament_id, name],
    );
    if (applicationClash.length > 0) {
      throw new Error(`A team named "${name}" already has an application in progress.`);
    }
    try {
      await client.query(`UPDATE sr_teams SET name = $2 WHERE id = $1`, [teamId, name]);
    } catch (e) {
      if ((e as Error).message.includes("sr_teams_name_unique")) {
        throw new Error(`A team named "${name}" is already registered.`);
      }
      throw e;
    }
    await insertSrAudit(client, team.tournament_id, "team.update", { teamId, name, by: "captain" }, actor);
    return team.tournament_slug as string;
  });
  refresh(slug);
}

export async function disbandMyTeam(teamId: string): Promise<void> {
  const captain = await requireCaptain();
  const actor = captainActor(captain);
  const { slug, logoUrl } = await withTransaction(async (client) => {
    const team = await lockOwnTeam(client, teamId, captain.discordUserId);
    assertEditable(team);
    // Roster rows cascade on the composite FK; the delete is one statement.
    await client.query(`DELETE FROM sr_teams WHERE id = $1`, [teamId]);
    await insertSrAudit(
      client,
      team.tournament_id,
      "team.disband",
      { teamId, name: team.name, by: "captain" },
      actor,
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

/**
 * Add a SUBSTITUTE to an already-registered team.
 *
 * The starting five never come through here — they come from the application
 * flow above, where every one of them confirmed their own invite. This is the
 * tail end of roster management: a sixth-through-tenth player the captain
 * adds after the team exists.
 *
 * Even so, the Discord id is not taken on trust. It is resolved against live
 * guild membership with the bot token, and the stored identity is whatever
 * the guild says it is — an account that has left the server, or a bot, is
 * rejected outright. The captain still types the IGN, because the Riot ID is
 * something only they know; that is a label, not an identity claim, and
 * lookupRosterRank is what corroborates it.
 */
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
  const actor = captainActor(captain);
  const discordId = cleanDiscordId(input.discordId);
  const ign = cleanIgn(input.ign);
  const role = normaliseRole(input.role);
  const currentRank = normaliseRank(input.currentRank);
  const peakRank = normaliseRank(input.peakRank);

  const { fetchGuildMemberById } = await import("@/lib/discord-bot");
  const guildMember = await fetchGuildMemberById(discordId);
  if (!guildMember) {
    throw new Error("That account isn't in the LoLMK Discord server — they need to join first.");
  }
  if (guildMember.isBot) throw new Error("Can't add a bot account.");

  const { rows: ownedRows } = await sql`
    SELECT tournament_id FROM sr_teams
    WHERE id = ${teamId} AND captain_discord_id = ${captain.discordUserId}
  `;
  if (ownedRows.length === 0) throw new Error("Team not found.");
  const tournamentId = ownedRows[0].tournament_id as string;

  const slug = await withTournamentLock(tournamentId, async (client) => {
    const team = await lockOwnTeam(client, teamId, captain.discordUserId);
    assertEditable(team);

    const { rows: countRows } = await client.query(
      `SELECT count(*)::int AS c FROM sr_team_players WHERE team_id = $1`,
      [teamId],
    );
    if (countRows[0].c >= MAX_ROSTER) {
      throw new Error(`Rosters are capped at ${MAX_ROSTER} players.`);
    }
    // A sub who is mid-invite on someone else's application would pass the
    // sr_team_players unique index (no row yet) and then break that
    // application at its promotion step. Block it here instead.
    if (await isDiscordIdReserved(client, team.tournament_id as string, discordId)) {
      throw new Error("That player is already rostered or invited on a team in this tournament.");
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
      if ((e as Error).message.includes("sr_team_players_active_team_per_tournament")) {
        throw new Error("That player is already rostered on a team in this tournament.");
      }
      throw e;
    }

    await insertSrAudit(client, team.tournament_id, "roster.add", { teamId, ign, role, discordId }, actor);
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
  const actor = captainActor(captain);
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
    await insertSrAudit(client, player.tournament_id, "roster.remove", { playerId, ign: player.ign }, actor);
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
  const actor = captainActor(captain);
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
    await insertSrAudit(
      client,
      team.tournament_id,
      "team.update",
      { teamId, logoUrl: url, by: "captain" },
      actor,
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
