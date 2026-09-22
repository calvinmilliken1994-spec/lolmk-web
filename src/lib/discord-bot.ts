import "server-only";

/**
 * Bot-token Discord calls — Server Members Intent required, confirmed
 * enabled by the user. Distinct from every OAuth flow in discord-auth.ts:
 * those act as a signed-in human (their own access token); this acts as
 * the application itself, which is the only way to look up or search an
 * arbitrary guild member who hasn't signed into lolmk.gg.
 *
 * Never used for anything write/auth-granting — bot lookups only ever
 * populate "who could this be" UI. Every real authorization decision
 * (does 어user own this slot, are they verified) still goes through
 * discord-auth.ts's session-bound checks.
 */

const DISCORD_API_BASE = "https://discord.com/api/v10";

function botToken(): string | null {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  return token || null;
}

function guildId(): string | null {
  const id = process.env.DISCORD_GUILD_ID?.trim();
  return id || null;
}

export function isBotSearchConfigured(): boolean {
  return Boolean(botToken() && guildId());
}

/**
 * Matches verified-member OAuth eligibility: Tournament Admin OR configured
 * verified-member role. Fails closed when neither configured role is present.
 */
export function isVerifiedMemberCandidate(member: Pick<BotMemberResult, "roles">): boolean {
  const adminRoleId = process.env.DISCORD_ADMIN_ROLE_ID?.trim();
  const verifiedRoleId = process.env.DISCORD_VERIFIED_ROLE_ID?.trim();
  return Boolean(
    (adminRoleId && member.roles.includes(adminRoleId)) ||
      (verifiedRoleId && member.roles.includes(verifiedRoleId)),
  );
}

interface DiscordApiMember {
  user: { id: string; username: string; global_name: string | null; avatar: string | null; bot?: boolean };
  nick: string | null;
  avatar: string | null;
  roles: string[];
}

export interface BotMemberResult {
  discordUserId: string;
  displayName: string;
  avatarUrl: string | null;
  roles: string[];
  isBot: boolean;
}

function resolveBotIdentity(m: DiscordApiMember, gid: string): BotMemberResult {
  const displayName = m.nick?.trim() || m.user.global_name?.trim() || m.user.username;
  const avatarUrl = m.avatar
    ? `https://cdn.discordapp.com/guilds/${gid}/users/${m.user.id}/avatars/${m.avatar}.png`
    : m.user.avatar
      ? `https://cdn.discordapp.com/avatars/${m.user.id}/${m.user.avatar}.png`
      : null;
  return { discordUserId: m.user.id, displayName, avatarUrl, roles: m.roles, isBot: Boolean(m.user.bot) };
}

async function botFetch(path: string): Promise<Response | null> {
  const token = botToken();
  if (!token) return null;
  try {
    return await fetch(`${DISCORD_API_BASE}${path}`, {
      headers: { Authorization: `Bot ${token}` },
      cache: "no-store",
    });
  } catch {
    return null;
  }
}

/**
 * Search guild members by username/nickname prefix (Discord's own
 * `query` search — case-insensitive prefix match on username OR
 * nickname, does not require exact case). Bots excluded from results.
 * Returns null on any failure (missing config, network error, 401/403 —
 * e.g. intent not actually propagated yet, 429) so the caller can show a
 * clear "search unavailable" state rather than a false empty result.
 */
export async function searchGuildMembers(query: string, limit: number): Promise<BotMemberResult[] | null> {
  const gid = guildId();
  if (!gid) return null;
  const q = query.trim().slice(0, 100);
  if (q.length < 2) return null;
  const boundedLimit = Math.max(1, Math.min(limit, 10));

  const res = await botFetch(
    `/guilds/${gid}/members/search?query=${encodeURIComponent(q)}&limit=${boundedLimit}`,
  );
  if (!res) return null;
  if (res.status === 429) return null; // rate-limited — fail to "unavailable", never retry-loop here
  if (!res.ok) return null; // 401/403 (missing intent/perms) or anything else — fail closed, no partial leak
  const members = (await res.json()) as DiscordApiMember[];
  if (!Array.isArray(members)) return null;
  return members
    .map((m) => resolveBotIdentity(m, gid))
    .filter((m) => !m.isBot);
}

/** Look up one member by Discord user id — used to server-verify an invite target rather than trusting client-submitted name/avatar. */
export async function fetchGuildMemberById(discordUserId: string): Promise<BotMemberResult | null> {
  const gid = guildId();
  if (!gid) return null;
  if (!/^\d{5,25}$/.test(discordUserId)) return null;
  const res = await botFetch(`/guilds/${gid}/members/${discordUserId}`);
  if (!res || !res.ok) return null;
  const m = (await res.json()) as DiscordApiMember;
  return resolveBotIdentity(m, gid);
}

export interface DmSendResult {
  ok: boolean;
  status: "sent" | "dm_unavailable" | "rate_limited" | "error";
  /** Only set when status === "rate_limited", from Discord's retry_after (seconds, converted to ms). */
  retryAfterMs?: number;
}

/**
 * Sends a DM as the bot user: opens (or reuses) a DM channel via
 * POST /users/@me/channels, then posts the message into it. Two
 * network calls, two independent failure points — a closed-DM or
 * blocked-bot rejection can surface at either step (channel creation
 * for some privacy configs, message posting for others), so both are
 * checked the same way. allowed_mentions is pinned to {parse: []} so a
 * team/display name that happens to contain @everyone or a raw mention
 * syntax can never actually ping anyone through this bot.
 */
export async function sendDirectMessage(discordUserId: string, content: string): Promise<DmSendResult> {
  const token = botToken();
  if (!token) return { ok: false, status: "error" };
  try {
    const channelRes = await fetch(`${DISCORD_API_BASE}/users/@me/channels`, {
      method: "POST",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recipient_id: discordUserId }),
      cache: "no-store",
    });
    if (channelRes.status === 429) {
      const body = await channelRes.json().catch(() => ({}) as { retry_after?: number });
      return { ok: false, status: "rate_limited", retryAfterMs: Math.ceil((body.retry_after ?? 1) * 1000) };
    }
    if (channelRes.status === 403) return { ok: false, status: "dm_unavailable" };
    if (!channelRes.ok) return { ok: false, status: "error" };
    const channel = (await channelRes.json()) as { id: string };

    const messageRes = await fetch(`${DISCORD_API_BASE}/channels/${channel.id}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
      cache: "no-store",
    });
    if (messageRes.status === 429) {
      const body = await messageRes.json().catch(() => ({}) as { retry_after?: number });
      return { ok: false, status: "rate_limited", retryAfterMs: Math.ceil((body.retry_after ?? 1) * 1000) };
    }
    if (messageRes.status === 403) return { ok: false, status: "dm_unavailable" };
    if (!messageRes.ok) return { ok: false, status: "error" };
    return { ok: true, status: "sent" };
  } catch {
    return { ok: false, status: "error" };
  }
}
