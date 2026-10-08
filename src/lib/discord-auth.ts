import { cookies } from "next/headers";
import { sql } from "@vercel/postgres";
import {
  createOAuthState,
  consumeOAuthState,
  createSession,
  getSession,
  getSessionByHash,
  touchSessionVerified,
  deleteSessionByHash,
  deleteSession,
  encryptField,
  decryptField,
  type AdminSession,
} from "@/lib/admin-session-db";
import {
  consumeCaptainOAuthState,
  createCaptainOAuthState,
  createCaptainSession,
  deleteCaptainSession,
  deleteCaptainSessionByHash,
  getCaptainSessionByToken,
  touchCaptainVerified,
  type CaptainSession,
} from "@/lib/captain-session-db";
import {
  consumeMemberOAuthState,
  createMemberOAuthState,
  createMemberSession,
  deleteMemberSession,
  deleteMemberSessionByHash,
  getMemberSessionByToken,
  touchMemberVerified,
  type MemberSession,
} from "@/lib/member-session-db";
import { upsertLoginProfile } from "@/lib/member-db";

/**
 * Discord OAuth admin login. No bot token, no privileged Server Members
 * Intent: this uses the signed-in admin's OWN OAuth access token
 * (identify + guilds.members.read scopes) against
 * GET /users/@me/guilds/{guild.id}/member. Reusing an existing Discord
 * Application for this is fine — the app's bot permissions are irrelevant
 * to this flow entirely, since no bot token is ever used here.
 */

export const SESSION_COOKIE_NAME = "lolmk-admin-session";
export const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24; // 24h

// Short-lived cookie that binds the OAuth `state` to THIS browser. See
// admin-session-db.ts's comment on createOAuthState for why a DB row alone
// (single-use, unexpired) is replay protection but not login-CSRF
// protection: an attacker can complete their own OAuth flow, capture a
// valid `state` value tied to their own account, then trick a victim into
// visiting `/api/auth/discord/callback?code=...&state=<attacker's state>`.
// Without a cookie check, that callback would exchange the attacker's code
// on the victim's browser and — depending on what a caller does with a
// successful callback — could bind the victim's session to the attacker's
// Discord identity. Requiring the state to match a cookie set on the SAME
// browser that started the flow closes that gap.
const STATE_COOKIE_NAME = "lolmk-oauth-state";
const STATE_COOKIE_MAX_AGE = 60 * 10; // 10 minutes — matches the DB-side 15 min expiry with margin

function configuredOrigin(): string | null {
  const siteUrl = process.env.SITE_URL?.trim();
  const raw = process.env.NODE_ENV === "production"
    ? siteUrl
    : siteUrl || process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return process.env.NODE_ENV === "production" ? null : "http://localhost:3001";

  try {
    const url = new URL(raw);
    const normalized = raw.replace(/\/$/, "");
    // This value is an origin, not an arbitrary base URL. Reject credentials,
    // paths, query strings and fragments so redirect_uri remains predictable.
    if (url.origin !== normalized || url.username || url.password) return null;
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") return null;
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return normalized;
  } catch {
    return null;
  }
}

function hasValidEncryptionKey(): boolean {
  return /^[0-9a-fA-F]{64}$/.test(process.env.SESSION_ENCRYPTION_KEY?.trim() ?? "");
}

function getConfig() {
  const clientId = process.env.DISCORD_CLIENT_ID?.trim();
  const clientSecret = process.env.DISCORD_CLIENT_SECRET?.trim();
  const guildId = process.env.DISCORD_GUILD_ID?.trim();
  const adminRoleId = process.env.DISCORD_ADMIN_ROLE_ID?.trim();
  if (
    !clientId ||
    !clientSecret ||
    !guildId ||
    !adminRoleId ||
    !hasValidEncryptionKey() ||
    !configuredOrigin()
  ) return null;
  return { clientId, clientSecret, guildId, adminRoleId };
}

export function isDiscordAuthConfigured(): boolean {
  return getConfig() !== null;
}

// The redirect_uri Discord will use MUST exactly match what's registered in
// the Discord Developer Portal. Deriving it from the (spoofable) request
// Host header would let a request with a forged Host claim a different
// redirect_uri than what's configured — Discord would reject the mismatch
// at the token-exchange step in practice, but there's no reason to trust
// the header at all here. Use an explicit, deployment-configured origin.
function trustedOrigin(): string {
  // Callers first validate auth configuration, so null is reachable only if a
  // future caller bypasses that guard. Keep the development fallback benign.
  return configuredOrigin() ?? "http://localhost:3001";
}

// Exported for building absolute links from contexts that aren't part of an
// OAuth flow (e.g. the DM invite confirmation URL in mayhem actions) but
// still need the same trusted, deployment-configured origin — never derived
// from a request Host header, for the same reason redirectUri() isn't.
export { trustedOrigin };

function redirectUri(): string {
  return `${trustedOrigin()}/api/auth/discord/callback`;
}

export interface AuthorizeResult {
  url: string;
  stateCookieValue: string;
}

/** Step 1: build the Discord authorize URL and persist a single-use, browser-bound CSRF state. */
export async function buildAuthorize(nextPath: string): Promise<AuthorizeResult | null> {
  const config = getConfig();
  if (!config) return null;
  // Only ever redirect back into our own /tools tree — never let an
  // attacker-controlled `next` param bounce a logged-in admin off-site.
  // Reject backslashes/control chars too (some browsers/proxies treat a
  // leading "/\" as protocol-relative, which could resolve off-origin).
  const safeNext =
    /^\/tools(\/[^\s\\]*)?$/.test(nextPath) && !nextPath.includes("\\") ? nextPath : "/tools";
  const state = await createOAuthState(safeNext);

  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify guilds.members.read");
  url.searchParams.set("state", state);
  // No `prompt=none` — that suppresses Discord's consent screen and fails
  // outright for any admin who hasn't already granted this app's exact
  // scope set (i.e. every admin the first time). Let Discord show its
  // normal authorize screen.
  return { url: url.toString(), stateCookieValue: state };
}

interface DiscordTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

interface DiscordGuildMember {
  roles: string[];
}

export type CallbackResult =
  | { ok: true; sessionToken: string; nextPath: string }
  | {
      ok: false;
      reason: "config" | "state" | "denied" | "not_member" | "no_role" | "discord_error";
    };

/** Step 2: validate browser-bound state, exchange the code, verify guild+role membership, create a session. */
export async function handleCallback(
  params: { code?: string; state?: string; error?: string },
  stateCookie: string | undefined,
): Promise<CallbackResult> {
  const config = getConfig();
  if (!config) return { ok: false, reason: "config" };
  if (params.error) return { ok: false, reason: "denied" };
  if (!params.code || !params.state) return { ok: false, reason: "state" };

  // The state must match what was set in THIS browser's cookie before we
  // even touch the DB / consume the row — a mismatch here means the
  // request didn't originate from the browser that started the flow.
  if (!stateCookie || stateCookie !== params.state) return { ok: false, reason: "state" };

  const nextPath = await consumeOAuthState(params.state);
  if (!nextPath) return { ok: false, reason: "state" }; // missing, expired, or already used

  let tokenRes: Response;
  try {
    tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "authorization_code",
        code: params.code,
        redirect_uri: redirectUri(),
      }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "discord_error" };
  }
  if (!tokenRes.ok) return { ok: false, reason: "discord_error" };
  const token = (await tokenRes.json()) as DiscordTokenResponse;

  const membership = await fetchMembership(config.guildId, token.access_token);
  if (membership === "not_member") return { ok: false, reason: "not_member" };
  if (membership === "error") return { ok: false, reason: "discord_error" };
  if (!membership.roles.includes(config.adminRoleId)) return { ok: false, reason: "no_role" };

  let userRes: Response;
  try {
    userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${token.access_token}` },
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "discord_error" };
  }
  if (!userRes.ok) return { ok: false, reason: "discord_error" };
  const user = (await userRes.json()) as { id: string; username: string; avatar: string | null };

  const sessionToken = await createSession({
    discordUserId: user.id,
    discordUsername: user.username,
    discordAvatar: user.avatar,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    tokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
  });

  return { ok: true, sessionToken, nextPath };
}

async function fetchMembership(
  guildId: string,
  accessToken: string,
): Promise<DiscordGuildMember | "not_member" | "error"> {
  try {
    const res = await fetch(`https://discord.com/api/users/@me/guilds/${guildId}/member`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (res.status === 404) return "not_member";
    // Includes 429: fail closed rather than grant/retain access on a
    // rate-limited or otherwise failed membership check.
    if (!res.ok) return "error";
    return (await res.json()) as DiscordGuildMember;
  } catch {
    return "error";
  }
}

async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date } | null> {
  const config = getConfig();
  if (!config) return null;
  try {
    const res = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const token = (await res.json()) as DiscordTokenResponse;
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
    };
  } catch {
    return null;
  }
}

// How long a verified session is trusted before re-checking role/membership
// with Discord. Bounds how long a revoked role/kick takes to lock an admin
// out; short enough to matter, long enough not to hammer Discord's API on
// every page load/action.
const REVERIFY_INTERVAL_MS = 5 * 60 * 1000;

// Per-token in-flight refresh dedup: if two requests both find the session
// due for reverify within the same tick, only one should actually call
// Discord's token endpoint. Discord's refresh_token grant ROTATES the
// refresh token on use — two concurrent, uncoordinated refreshes would each
// try to redeem the same (now-stale-after-the-first-succeeds) refresh
// token, and the loser's request would invalidate a session that should
// still be good. This map is process-local (fine: it's a race-avoidance
// optimization, not a correctness guarantee across multiple server
// instances — worst case under true cross-instance concurrency is an
// extra, harmless re-login, not a security hole).
const inFlightReverify = new Map<string, Promise<boolean>>();

/**
 * Authoritative session check for Node-runtime code (server actions, route
 * handlers, server components). Fails closed: if Discord is unreachable or
 * rate-limited during a due re-check, access is DENIED, not silently
 * allowed through on a stale cached "yes".
 *
 * Two ways in: a dedicated admin session (lolmk-admin-session, unchanged
 * from before), OR a verified-member session whose cached is_admin flag is
 * true. The member fallback is never a bare trust of that cached flag in
 * isolation — getMemberSession() itself re-verifies the Tournament Admin
 * role against live Discord membership on the exact same
 * REVERIFY_INTERVAL_MS cadence this function uses for its own admin
 * sessions, and deletes the member session outright if the admin role (and
 * the verified-member role) are both gone. A role revoked on Discord's side
 * is caught the next time either session is due for recheck — there is no
 * looser trust window for the member path than for the dedicated admin one.
 * This is what lets someone who signed in once via "Verified members
 * login" reach /tools without a second OAuth round-trip, without admin
 * authorization ever depending on UI-only state.
 */
export async function isToolsSession(): Promise<boolean> {
  const config = getConfig();
  if (config) {
    const store = await cookies();
    const rawToken = store.get(SESSION_COOKIE_NAME)?.value;
    if (rawToken) {
      const session = await getSession(rawToken);
      if (session) {
        const dueForRecheck = Date.now() - session.lastVerifiedAt.getTime() > REVERIFY_INTERVAL_MS;
        if (!dueForRecheck) return true;

        const inFlight = inFlightReverify.get(session.tokenHash);
        if (inFlight) return inFlight;

        const promise = reverifySession(session, config).finally(() => {
          inFlightReverify.delete(session.tokenHash);
        });
        inFlightReverify.set(session.tokenHash, promise);
        return promise;
      }
    }
  }

  const member = await getMemberSession();
  return member?.isAdmin ?? false;
}

async function reverifySession(
  session: AdminSession,
  config: { guildId: string; adminRoleId: string },
): Promise<boolean> {
  let accessToken = session.accessToken;
  let refreshToken = session.refreshToken;
  let tokenExpiresAt = session.tokenExpiresAt;

  if (tokenExpiresAt.getTime() < Date.now() + 60_000) {
    // Serialize concurrent refreshes on ONE checked-out client, inside an
    // explicit transaction, from the row lock through to the persisted
    // update. A bare `sql\`...\`` advisory-lock call releases the lock the
    // moment that single statement completes (it is not inside a
    // transaction), so it would NOT actually block a second caller's
    // subsequent statements — only FOR UPDATE + BEGIN/COMMIT on the same
    // client serializes this correctly. Discord's refresh_token grant
    // ROTATES the token on use, so two uncoordinated refreshes would have
    // one succeed and one redeem an already-invalidated token.
    const client = await sql.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        "SELECT * FROM admin_sessions WHERE token_hash = $1 FOR UPDATE",
        [session.tokenHash],
      );
      if (rows.length === 0) {
        await client.query("ROLLBACK");
        return false; // deleted by whoever held the lock first
      }
      const row = rows[0];
      const currentRefreshToken = decryptField(row.refresh_token_enc);
      const currentTokenExpiresAt = new Date(row.token_expires_at);

      if (currentRefreshToken !== refreshToken || currentTokenExpiresAt.getTime() >= Date.now() + 60_000) {
        // Another worker already refreshed this session (either token
        // rotated, or it's simply fresh enough now) while we waited for
        // the lock — use their result instead of touching Discord again.
        accessToken = decryptField(row.access_token_enc);
        refreshToken = currentRefreshToken;
        tokenExpiresAt = currentTokenExpiresAt;
        await client.query("COMMIT");
      } else {
        const refreshed = await refreshAccessToken(refreshToken);
        if (!refreshed) {
          await client.query("DELETE FROM admin_sessions WHERE token_hash = $1", [session.tokenHash]);
          await client.query("COMMIT");
          return false;
        }
        accessToken = refreshed.accessToken;
        refreshToken = refreshed.refreshToken;
        tokenExpiresAt = refreshed.expiresAt;
        // Persist the rotated credentials in the SAME transaction that
        // holds the row lock — Discord already invalidated the old
        // refresh token server-side, so losing the new one here would
        // strand the session permanently. Does not advance
        // last_verified_at: that only happens after membership is
        // confirmed below, so a concurrent reader mid-refresh never sees
        // a fresh timestamp on a not-yet-verified session.
        await client.query(
          `UPDATE admin_sessions SET access_token_enc = $1, refresh_token_enc = $2, token_expires_at = $3
           WHERE token_hash = $4`,
          [encryptField(accessToken), encryptField(refreshToken), tokenExpiresAt.toISOString(), session.tokenHash],
        );
        await client.query("COMMIT");
      }
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  const membership = await fetchMembership(config.guildId, accessToken);
  if (membership === "not_member") {
    await deleteSessionByHash(session.tokenHash);
    return false;
  }
  if (membership === "error") {
    // Discord unreachable/rate-limited: fail closed for THIS request, but
    // don't delete the session — a transient outage shouldn't force a
    // fresh login once Discord recovers within the same reverify window.
    // Deliberately does NOT advance last_verified_at — a failed check
    // must not be recorded as a successful one, whether or not the token
    // was rotated above.
    return false;
  }
  if (!membership.roles.includes(config.adminRoleId)) {
    await deleteSessionByHash(session.tokenHash);
    return false;
  }

  // Advance last_verified_at on every successful membership check,
  // unconditionally — a rotated session must still get its timestamp
  // bumped here, or it would be treated as due-for-recheck (and hit
  // Discord) on every single subsequent request forever.
  await touchSessionVerified(session.tokenHash);
  return true;
}

export async function getCurrentAdmin(): Promise<{
  discordUserId: string;
  username: string;
  avatar: string | null;
} | null> {
  const store = await cookies();
  const rawToken = store.get(SESSION_COOKIE_NAME)?.value;
  if (rawToken) {
    const session = await getSession(rawToken);
    if (session) {
      return {
        discordUserId: session.discordUserId,
        username: session.discordUsername,
        avatar: session.discordAvatar,
      };
    }
  }
  // Fall back to a verified-member session that is currently admin. Mirrors
  // isToolsSession()'s dual path — see its doc comment for why this never
  // trusts a cached flag without getMemberSession()'s live re-verification.
  const member = await getMemberSession();
  if (member?.isAdmin) {
    return { discordUserId: member.discordUserId, username: member.displayName, avatar: member.avatarUrl };
  }
  return null;
}

export async function endSession(rawToken: string): Promise<void> {
  await deleteSession(rawToken);
}

export { STATE_COOKIE_NAME, STATE_COOKIE_MAX_AGE };

// ===========================================================================
// Team-captain authentication — a SEPARATE capability, not a weaker admin.
// ===========================================================================
//
// Everything above this line is the admin gate and is untouched by what
// follows. The captain flow has its own config, its own OAuth state cookie,
// its own session cookie, and its own session table (captain-session-db.ts).
// `isToolsSession()` cannot be satisfied by anything created down here, and
// `getCaptainSession()` cannot be satisfied by an admin session — the two
// read different cookies backed by different tables.
//
// FAIL CLOSED ON MISSING CONFIG: getCaptainConfig() returns null unless
// CAPTAIN_ROLE_ID is set to a non-empty value, and every captain entry point
// treats null config as "denied", never as "unrestricted". Until the role id
// is supplied there is simply no way to obtain a captain session — there is
// no default-allow branch and no dev bypass.

export const CAPTAIN_SESSION_COOKIE_NAME = "lolmk-captain-session";
export const CAPTAIN_SESSION_COOKIE_MAX_AGE = 60 * 60 * 24; // 24h
const CAPTAIN_STATE_COOKIE_NAME = "lolmk-captain-oauth-state";

function getCaptainConfig() {
  const clientId = process.env.DISCORD_CLIENT_ID?.trim();
  const clientSecret = process.env.DISCORD_CLIENT_SECRET?.trim();
  const guildId = process.env.DISCORD_GUILD_ID?.trim();
  const captainRoleId = process.env.CAPTAIN_ROLE_ID?.trim();
  if (
    !clientId ||
    !clientSecret ||
    !guildId ||
    !captainRoleId ||
    !hasValidEncryptionKey() ||
    !configuredOrigin()
  ) return null;
  return { clientId, clientSecret, guildId, captainRoleId };
}

export function isCaptainAuthConfigured(): boolean {
  return getCaptainConfig() !== null;
}

function captainRedirectUri(): string {
  return `${trustedOrigin()}/api/auth/captain/callback`;
}

/** Step 1 of the captain OAuth round-trip. Returns null when captain auth isn't configured. */
export async function buildCaptainAuthorize(nextPath: string): Promise<AuthorizeResult | null> {
  const config = getCaptainConfig();
  if (!config) return null;
  // Captains may only ever be bounced back into /captain — never /tools, and
  // never off-origin. Same shape as the admin check, different allowed root.
  const safeNext =
    /^\/captain(\/[^\s\\]*)?$/.test(nextPath) && !nextPath.includes("\\") ? nextPath : "/captain";
  const state = await createCaptainOAuthState(safeNext);

  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", captainRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify guilds.members.read");
  url.searchParams.set("state", state);
  return { url: url.toString(), stateCookieValue: state };
}

export type CaptainCallbackResult =
  | { ok: true; sessionToken: string; nextPath: string }
  | { ok: false; reason: "config" | "state" | "denied" | "not_member" | "no_role" | "discord_error" };

/** Step 2: validate the browser-bound state, exchange the code, require the CAPTAIN role. */
export async function handleCaptainCallback(
  params: { code?: string; state?: string; error?: string },
  stateCookie: string | undefined,
): Promise<CaptainCallbackResult> {
  const config = getCaptainConfig();
  if (!config) return { ok: false, reason: "config" };
  if (params.error) return { ok: false, reason: "denied" };
  if (!params.code || !params.state) return { ok: false, reason: "state" };
  if (!stateCookie || stateCookie !== params.state) return { ok: false, reason: "state" };

  const nextPath = await consumeCaptainOAuthState(params.state);
  if (!nextPath) return { ok: false, reason: "state" };

  let tokenRes: Response;
  try {
    tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "authorization_code",
        code: params.code,
        redirect_uri: captainRedirectUri(),
      }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "discord_error" };
  }
  if (!tokenRes.ok) return { ok: false, reason: "discord_error" };
  const token = (await tokenRes.json()) as DiscordTokenResponse;

  const membership = await fetchMembership(config.guildId, token.access_token);
  if (membership === "not_member") return { ok: false, reason: "not_member" };
  if (membership === "error") return { ok: false, reason: "discord_error" };
  if (!membership.roles.includes(config.captainRoleId)) return { ok: false, reason: "no_role" };

  let userRes: Response;
  try {
    userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${token.access_token}` },
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "discord_error" };
  }
  if (!userRes.ok) return { ok: false, reason: "discord_error" };
  const user = (await userRes.json()) as { id: string; username: string; avatar: string | null };

  const sessionToken = await createCaptainSession({
    discordUserId: user.id,
    discordUsername: user.username,
    discordAvatar: user.avatar,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    tokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
  });

  return { ok: true, sessionToken, nextPath };
}

export interface CaptainIdentity {
  discordUserId: string;
  username: string;
  avatar: string | null;
}

const inFlightCaptainReverify = new Map<string, Promise<CaptainIdentity | null>>();

/**
 * Authoritative captain check. Returns the caller's Discord identity — which
 * is what every captain action scopes ownership against
 * (sr_teams.captain_discord_id) — or null.
 *
 * Returns null, never throws, when CAPTAIN_ROLE_ID is unset: captain routes
 * are simply closed until the role id is configured.
 */
export async function getCaptainSession(): Promise<CaptainIdentity | null> {
  const config = getCaptainConfig();
  if (!config) return null;
  const store = await cookies();
  const rawToken = store.get(CAPTAIN_SESSION_COOKIE_NAME)?.value;
  if (!rawToken) return null;

  const session = await getCaptainSessionByToken(rawToken);
  if (!session) return null;

  const dueForRecheck = Date.now() - session.lastVerifiedAt.getTime() > REVERIFY_INTERVAL_MS;
  if (!dueForRecheck) {
    return {
      discordUserId: session.discordUserId,
      username: session.discordUsername,
      avatar: session.discordAvatar,
    };
  }

  const inFlight = inFlightCaptainReverify.get(session.tokenHash);
  if (inFlight) return inFlight;

  const promise = reverifyCaptain(session, config).finally(() => {
    inFlightCaptainReverify.delete(session.tokenHash);
  });
  inFlightCaptainReverify.set(session.tokenHash, promise);
  return promise;
}

/** Convenience boolean for UI gating. Authorization decisions should use getCaptainSession(). */
export async function isCaptainSession(): Promise<boolean> {
  return (await getCaptainSession()) !== null;
}

async function reverifyCaptain(
  session: CaptainSession,
  config: { guildId: string; captainRoleId: string },
): Promise<CaptainIdentity | null> {
  let accessToken = session.accessToken;
  let refreshToken = session.refreshToken;
  let tokenExpiresAt = session.tokenExpiresAt;

  if (tokenExpiresAt.getTime() < Date.now() + 60_000) {
    // The process-local in-flight map cannot coordinate separate Vercel
    // instances. Hold a row lock in a real transaction so exactly one worker
    // redeems Discord's rotating refresh token and persists its replacement.
    const client = await sql.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        "SELECT * FROM captain_sessions WHERE token_hash = $1 FOR UPDATE",
        [session.tokenHash],
      );
      if (rows.length === 0) {
        await client.query("ROLLBACK");
        return null;
      }

      const row = rows[0];
      const currentRefreshToken = decryptField(row.refresh_token_enc);
      const currentTokenExpiresAt = new Date(row.token_expires_at);
      if (
        currentRefreshToken !== refreshToken ||
        currentTokenExpiresAt.getTime() >= Date.now() + 60_000
      ) {
        // Another worker refreshed while this request waited for the lock.
        accessToken = decryptField(row.access_token_enc);
        refreshToken = currentRefreshToken;
        tokenExpiresAt = currentTokenExpiresAt;
        await client.query("COMMIT");
      } else {
        const refreshed = await refreshAccessToken(refreshToken);
        if (!refreshed) {
          await client.query("DELETE FROM captain_sessions WHERE token_hash = $1", [session.tokenHash]);
          await client.query("COMMIT");
          return null;
        }
        accessToken = refreshed.accessToken;
        refreshToken = refreshed.refreshToken;
        tokenExpiresAt = refreshed.expiresAt;
        await client.query(
          `UPDATE captain_sessions SET access_token_enc = $1, refresh_token_enc = $2, token_expires_at = $3
           WHERE token_hash = $4`,
          [encryptField(accessToken), encryptField(refreshToken), tokenExpiresAt.toISOString(), session.tokenHash],
        );
        await client.query("COMMIT");
      }
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  const membership = await fetchMembership(config.guildId, accessToken);
  if (membership === "not_member") {
    await deleteCaptainSessionByHash(session.tokenHash);
    return null;
  }
  // Fails closed on a Discord outage/rate-limit, same as the admin path: no
  // access this request, but the session survives a transient blip.
  if (membership === "error") return null;
  if (!membership.roles.includes(config.captainRoleId)) {
    await deleteCaptainSessionByHash(session.tokenHash);
    return null;
  }

  await touchCaptainVerified(session.tokenHash);
  return {
    discordUserId: session.discordUserId,
    username: session.discordUsername,
    avatar: session.discordAvatar,
  };
}

export async function endCaptainSession(rawToken: string): Promise<void> {
  await deleteCaptainSession(rawToken);
}

export { CAPTAIN_STATE_COOKIE_NAME };

// ===========================================================================
// Verified-member authentication — a THIRD, separate capability.
// ===========================================================================
//
// Same isolation rule as the captain block above: its own config, its own
// OAuth state cookie, its own session cookie, its own session table
// (member-session-db.ts). A member session satisfies neither the admin gate
// nor the captain gate, and vice versa.
//
// GATING TODAY: login succeeds only for a Discord account holding the
// Tournament Admin role (DISCORD_ADMIN_ROLE_ID, the same role isToolsSession()
// checks) OR the verified-member role once DISCORD_VERIFIED_ROLE_ID is set.
// That second env var ships blank on purpose — dropping in its value later
// is the ENTIRE migration needed to open member login to every verified
// regular member; nothing else about this flow changes. Until then this is
// admin-only by construction, not by a special-cased branch.
//
// A session's is_admin flag is for UI only ("show the Admin Tools nav
// entry") — it is never consulted by isToolsSession() or any /tools code
// path, which continue to authenticate purely through admin_sessions.
// DISCORD_COORDINATOR_ROLE_ID (also blank by default) additionally
// classifies a member's directory_category as "coordinator"; it grants no
// login capability of its own, only a label.

export const MEMBER_SESSION_COOKIE_NAME = "lolmk-member-session";
export const MEMBER_SESSION_COOKIE_MAX_AGE = 60 * 60 * 24; // 24h
const MEMBER_STATE_COOKIE_NAME = "lolmk-member-oauth-state";

function getMemberConfig() {
  const clientId = process.env.DISCORD_CLIENT_ID?.trim();
  const clientSecret = process.env.DISCORD_CLIENT_SECRET?.trim();
  const guildId = process.env.DISCORD_GUILD_ID?.trim();
  const adminRoleId = process.env.DISCORD_ADMIN_ROLE_ID?.trim();
  const verifiedRoleId = process.env.DISCORD_VERIFIED_ROLE_ID?.trim() || null;
  const coordinatorRoleId = process.env.DISCORD_COORDINATOR_ROLE_ID?.trim() || null;
  if (
    !clientId ||
    !clientSecret ||
    !guildId ||
    !adminRoleId ||
    !hasValidEncryptionKey() ||
    !configuredOrigin()
  ) return null;
  return { clientId, clientSecret, guildId, adminRoleId, verifiedRoleId, coordinatorRoleId };
}

export function isMemberAuthConfigured(): boolean {
  return getMemberConfig() !== null;
}

function memberRedirectUri(): string {
  return `${trustedOrigin()}/api/auth/member/callback`;
}

/**
 * Only ever redirects back into a same-origin, in-app relative path — never
 * off-origin, never protocol-relative. Unlike the admin/captain checks
 * (which pin the destination to one fixed subtree), member login can return
 * to wherever the visitor started — `/`, `/tournaments`, `/members`, etc. —
 * so this validates shape instead of a fixed prefix: must start with a
 * single `/`, never `//` or `/\` (both of which some browsers treat as
 * protocol-relative), and contain no whitespace/control characters.
 */
function isSafeMemberNext(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return false;
  if (/[\s\u0000-\u001f\\]/.test(value)) return false;
  return true;
}

/** Step 1 of the member OAuth round-trip. Returns null when member auth isn't configured. */
export async function buildMemberAuthorize(nextPath: string): Promise<AuthorizeResult | null> {
  const config = getMemberConfig();
  if (!config) return null;
  const safeNext = isSafeMemberNext(nextPath) ? nextPath : "/members";
  const state = await createMemberOAuthState(safeNext);

  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", memberRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify guilds.members.read");
  url.searchParams.set("state", state);
  return { url: url.toString(), stateCookieValue: state };
}

interface DiscordGuildMemberFull {
  nick: string | null;
  avatar: string | null; // guild-specific avatar hash
  roles: string[];
  user: {
    id: string;
    username: string;
    global_name: string | null;
    avatar: string | null; // global avatar hash
  };
}

async function fetchFullMembership(
  guildId: string,
  accessToken: string,
): Promise<DiscordGuildMemberFull | "not_member" | "error"> {
  try {
    const res = await fetch(`https://discord.com/api/users/@me/guilds/${guildId}/member`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (res.status === 404) return "not_member";
    if (!res.ok) return "error";
    return (await res.json()) as DiscordGuildMemberFull;
  } catch {
    return "error";
  }
}

/**
 * Display name priority: guild nickname > global display name > username.
 * Avatar priority: guild-specific avatar > global avatar > null (caller
 * falls back to Discord's generic default avatar image).
 */
function resolveMemberIdentity(
  guildId: string,
  member: DiscordGuildMemberFull,
): { displayName: string; avatarUrl: string | null } {
  const displayName = member.nick?.trim() || member.user.global_name?.trim() || member.user.username;
  const avatarUrl = member.avatar
    ? `https://cdn.discordapp.com/guilds/${guildId}/users/${member.user.id}/avatars/${member.avatar}.png`
    : member.user.avatar
      ? `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png`
      : null;
  return { displayName, avatarUrl };
}

export type MemberCallbackResult =
  | { ok: true; sessionToken: string; nextPath: string }
  | { ok: false; reason: "config" | "state" | "denied" | "not_member" | "no_role" | "discord_error" };

/** Step 2: validate state, exchange the code, require admin OR (if configured) verified-member role. */
export async function handleMemberCallback(
  params: { code?: string; state?: string; error?: string },
  stateCookie: string | undefined,
): Promise<MemberCallbackResult> {
  const config = getMemberConfig();
  if (!config) return { ok: false, reason: "config" };
  if (params.error) return { ok: false, reason: "denied" };
  if (!params.code || !params.state) return { ok: false, reason: "state" };
  if (!stateCookie || stateCookie !== params.state) return { ok: false, reason: "state" };

  const nextPath = await consumeMemberOAuthState(params.state);
  if (!nextPath) return { ok: false, reason: "state" };

  let tokenRes: Response;
  try {
    tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "authorization_code",
        code: params.code,
        redirect_uri: memberRedirectUri(),
      }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "discord_error" };
  }
  if (!tokenRes.ok) return { ok: false, reason: "discord_error" };
  const token = (await tokenRes.json()) as DiscordTokenResponse;

  const membership = await fetchFullMembership(config.guildId, token.access_token);
  if (membership === "not_member") return { ok: false, reason: "not_member" };
  if (membership === "error") return { ok: false, reason: "discord_error" };

  const isAdmin = membership.roles.includes(config.adminRoleId);
  const isVerified = Boolean(config.verifiedRoleId && membership.roles.includes(config.verifiedRoleId));
  if (!isAdmin && !isVerified) return { ok: false, reason: "no_role" };

  const isCoordinator = Boolean(
    config.coordinatorRoleId && membership.roles.includes(config.coordinatorRoleId),
  );
  const directoryCategory: "admin" | "coordinator" | null = isAdmin
    ? "admin"
    : isCoordinator
      ? "coordinator"
      : null;

  const { displayName, avatarUrl } = resolveMemberIdentity(config.guildId, membership);

  // Enrollment happens here, on every successful login — see
  // upsertLoginProfile's doc comment for why this is the only write path
  // for cached identity, and why it never touches directory_opt_in.
  await upsertLoginProfile({
    discordUserId: membership.user.id,
    displayName,
    avatarUrl,
    isAdmin,
    directoryCategory,
  });

  const sessionToken = await createMemberSession({
    discordUserId: membership.user.id,
    displayName,
    avatarUrl,
    isAdmin,
    directoryCategory,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    tokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
  });

  return { ok: true, sessionToken, nextPath };
}

export interface MemberIdentity {
  discordUserId: string;
  displayName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  directoryCategory: "admin" | "coordinator" | null;
}

const inFlightMemberReverify = new Map<string, Promise<MemberIdentity | null>>();

/**
 * Authoritative member check. Returns null — never throws — whenever member
 * auth isn't configured, the cookie is missing/invalid, or reverification
 * fails (fails closed on a Discord outage, same as the admin/captain gates).
 */
export async function getMemberSession(): Promise<MemberIdentity | null> {
  const config = getMemberConfig();
  if (!config) return null;
  const store = await cookies();
  const rawToken = store.get(MEMBER_SESSION_COOKIE_NAME)?.value;
  if (!rawToken) return null;

  const session = await getMemberSessionByToken(rawToken);
  if (!session) return null;

  const dueForRecheck = Date.now() - session.lastVerifiedAt.getTime() > REVERIFY_INTERVAL_MS;
  if (!dueForRecheck) {
    return {
      discordUserId: session.discordUserId,
      displayName: session.displayName,
      avatarUrl: session.avatarUrl,
      isAdmin: session.isAdmin,
      directoryCategory: session.directoryCategory,
    };
  }

  const inFlight = inFlightMemberReverify.get(session.tokenHash);
  if (inFlight) return inFlight;

  const promise = reverifyMember(session, config).finally(() => {
    inFlightMemberReverify.delete(session.tokenHash);
  });
  inFlightMemberReverify.set(session.tokenHash, promise);
  return promise;
}

export async function isMemberSession(): Promise<boolean> {
  return (await getMemberSession()) !== null;
}

async function reverifyMember(
  session: MemberSession,
  config: {
    guildId: string;
    adminRoleId: string;
    verifiedRoleId: string | null;
    coordinatorRoleId: string | null;
  },
): Promise<MemberIdentity | null> {
  let accessToken = session.accessToken;
  let refreshToken = session.refreshToken;
  let tokenExpiresAt = session.tokenExpiresAt;

  if (tokenExpiresAt.getTime() < Date.now() + 60_000) {
    const client = await sql.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        "SELECT * FROM member_sessions WHERE token_hash = $1 FOR UPDATE",
        [session.tokenHash],
      );
      if (rows.length === 0) {
        await client.query("ROLLBACK");
        return null;
      }
      const row = rows[0];
      const currentRefreshToken = decryptField(row.refresh_token_enc);
      const currentTokenExpiresAt = new Date(row.token_expires_at);
      if (
        currentRefreshToken !== refreshToken ||
        currentTokenExpiresAt.getTime() >= Date.now() + 60_000
      ) {
        accessToken = decryptField(row.access_token_enc);
        refreshToken = currentRefreshToken;
        tokenExpiresAt = currentTokenExpiresAt;
        await client.query("COMMIT");
      } else {
        const refreshed = await refreshAccessToken(refreshToken);
        if (!refreshed) {
          await client.query("DELETE FROM member_sessions WHERE token_hash = $1", [session.tokenHash]);
          await client.query("COMMIT");
          return null;
        }
        accessToken = refreshed.accessToken;
        refreshToken = refreshed.refreshToken;
        tokenExpiresAt = refreshed.expiresAt;
        await client.query(
          `UPDATE member_sessions SET access_token_enc = $1, refresh_token_enc = $2, token_expires_at = $3
           WHERE token_hash = $4`,
          [encryptField(accessToken), encryptField(refreshToken), tokenExpiresAt.toISOString(), session.tokenHash],
        );
        await client.query("COMMIT");
      }
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  const membership = await fetchFullMembership(config.guildId, accessToken);
  if (membership === "not_member") {
    await deleteMemberSessionByHash(session.tokenHash);
    return null;
  }
  if (membership === "error") return null; // fail closed on a transient Discord outage

  const isAdmin = membership.roles.includes(config.adminRoleId);
  const isVerified = Boolean(config.verifiedRoleId && membership.roles.includes(config.verifiedRoleId));
  if (!isAdmin && !isVerified) {
    await deleteMemberSessionByHash(session.tokenHash);
    return null;
  }
  const isCoordinator = Boolean(
    config.coordinatorRoleId && membership.roles.includes(config.coordinatorRoleId),
  );
  const directoryCategory: "admin" | "coordinator" | null = isAdmin
    ? "admin"
    : isCoordinator
      ? "coordinator"
      : null;
  const { displayName, avatarUrl } = resolveMemberIdentity(config.guildId, membership);

  // Keep the cached identity (name/avatar/roles) fresh on every successful
  // reverify, not just at login — a nickname or role change should surface
  // without forcing a full re-login.
  await upsertLoginProfile({
    discordUserId: membership.user.id,
    displayName,
    avatarUrl,
    isAdmin,
    directoryCategory,
  });
  await touchMemberVerified(session.tokenHash, { displayName, avatarUrl, isAdmin, directoryCategory });

  return {
    discordUserId: session.discordUserId,
    displayName,
    avatarUrl,
    isAdmin,
    directoryCategory,
  };
}

export async function endMemberSession(rawToken: string): Promise<void> {
  await deleteMemberSession(rawToken);
}

export { MEMBER_STATE_COOKIE_NAME };
