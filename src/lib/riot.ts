import type { SrRank } from "@/types/sr-tournament";

/**
 * Optional Riot API lookup for KR ranked tiers.
 *
 * WHAT THIS IS: a convenience that can corroborate the tier a player typed
 * into their roster row, so an admin glancing at a signup can see "they said
 * Diamond, the API says Diamond" instead of taking every entry on faith.
 *
 * WHAT THIS IS NOT: proof of identity. Looking up `Name#KR1` tells you that
 * summoner's rank. It tells you nothing about whether the Discord account
 * that typed it owns that summoner — anyone can type a challenger's Riot ID.
 * Establishing that link is Riot RSO account linking, which is deliberately
 * out of scope here. Nothing in this module may ever be treated as an
 * ownership or authorization signal, and the UI labels every rank as
 * self-reported regardless of what this returns.
 *
 * WITHOUT RIOT_API_KEY: every function here returns a "not configured"
 * result. It never throws, never blocks a signup, and the roster simply
 * keeps the self-reported value. A development key also expires every 24h,
 * so "configured but rejected" is a normal state and is reported as such
 * rather than as a crash.
 */

// Riot splits its API across two host families. account-v1 (Riot ID -> puuid)
// lives on the REGIONAL routing hosts; league-v4 (puuid -> ranked entries)
// lives on the PLATFORM hosts. KR maps to asia + kr respectively.
const ACCOUNT_HOST = "https://asia.api.riotgames.com";
const PLATFORM_HOST = "https://kr.api.riotgames.com";

const REQUEST_TIMEOUT_MS = 6000;

/**
 * Platform (e.g. "na1", "euw1") -> regional routing host for account-v1.
 * account-v1 and champion-mastery-v4 live on different host families:
 * account-v1 is REGIONAL (americas/asia/europe), everything else
 * (league-v4, champion-mastery-v4, summoner-v4) is PLATFORM-specific. This
 * map exists because member profiles let a member pick their own platform
 * (unlike the KR-only roster lookup above), so the regional host can no
 * longer be hardcoded to "asia".
 */
const REGIONAL_ROUTING: Record<string, string> = {
  na1: "americas",
  br1: "americas",
  la1: "americas",
  la2: "americas",
  euw1: "europe",
  eun1: "europe",
  tr1: "europe",
  ru: "europe",
  kr: "asia",
  jp1: "asia",
  oc1: "sea",
};

function platformHost(platform: string): string {
  return `https://${platform}.api.riotgames.com`;
}

function regionalHost(platform: string): string {
  const region = REGIONAL_ROUTING[platform] ?? "americas";
  return `https://${region}.api.riotgames.com`;
}

export function isRiotConfigured(): boolean {
  return Boolean(process.env.RIOT_API_KEY?.trim());
}

export type RiotLookupResult =
  | { ok: true; tier: SrRank; division: string | null; leaguePoints: number; summonerName: string }
  | { ok: true; tier: "UNRANKED"; division: null; leaguePoints: 0; summonerName: string }
  | {
      ok: false;
      reason: "not_configured" | "bad_format" | "not_found" | "rate_limited" | "riot_error";
    };

/** Split "GameName#TAG" into its parts. KR IDs commonly use the KR1 tag. */
function parseRiotId(riotId: string): { gameName: string; tagLine: string } | null {
  const trimmed = riotId.trim();
  const hash = trimmed.lastIndexOf("#");
  if (hash <= 0 || hash === trimmed.length - 1) return null;
  const gameName = trimmed.slice(0, hash).trim();
  const tagLine = trimmed.slice(hash + 1).trim();
  if (!gameName || !tagLine) return null;
  return { gameName, tagLine };
}

async function riotFetch(url: string, key: string): Promise<Response | null> {
  // AbortSignal.timeout rather than an open-ended fetch: this runs inline in
  // a server action, and a hung Riot request would hold the request open
  // for the platform's full function timeout.
  try {
    return await fetch(url, {
      headers: { "X-Riot-Token": key },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
}

/**
 * Look up the current KR solo-queue tier for a Riot ID ("Name#TAG").
 *
 * Returns a discriminated result rather than throwing so callers can render
 * "not configured" / "not found" as ordinary UI states.
 */
export async function lookupKrRank(riotId: string): Promise<RiotLookupResult> {
  const key = process.env.RIOT_API_KEY?.trim();
  if (!key) return { ok: false, reason: "not_configured" };

  const parsed = parseRiotId(riotId);
  if (!parsed) return { ok: false, reason: "bad_format" };

  const accountRes = await riotFetch(
    `${ACCOUNT_HOST}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(parsed.gameName)}/${encodeURIComponent(parsed.tagLine)}`,
    key,
  );
  if (!accountRes) return { ok: false, reason: "riot_error" };
  if (accountRes.status === 404) return { ok: false, reason: "not_found" };
  if (accountRes.status === 429) return { ok: false, reason: "rate_limited" };
  if (!accountRes.ok) return { ok: false, reason: "riot_error" };
  const account = (await accountRes.json()) as { puuid?: string };
  if (!account.puuid) return { ok: false, reason: "riot_error" };

  const leagueRes = await riotFetch(
    `${PLATFORM_HOST}/lol/league/v4/entries/by-puuid/${encodeURIComponent(account.puuid)}`,
    key,
  );
  if (!leagueRes) return { ok: false, reason: "riot_error" };
  if (leagueRes.status === 429) return { ok: false, reason: "rate_limited" };
  // 404 here means "no ranked entries", i.e. genuinely unranked — not a
  // lookup failure, so it is reported as a successful UNRANKED result.
  if (leagueRes.status === 404) {
    return { ok: true, tier: "UNRANKED", division: null, leaguePoints: 0, summonerName: riotId };
  }
  if (!leagueRes.ok) return { ok: false, reason: "riot_error" };

  const entries = (await leagueRes.json()) as Array<{
    queueType?: string;
    tier?: string;
    rank?: string;
    leaguePoints?: number;
  }>;
  const solo = entries.find((e) => e.queueType === "RANKED_SOLO_5x5") ?? entries[0];
  if (!solo?.tier) {
    return { ok: true, tier: "UNRANKED", division: null, leaguePoints: 0, summonerName: riotId };
  }

  return {
    ok: true,
    // Riot returns tiers uppercased already ("EMERALD"), which is exactly the
    // SR_RANKS vocabulary. Cast rather than validate: an unrecognised tier
    // would only ever be a new Riot tier, and showing it verbatim beats
    // silently reporting UNRANKED.
    tier: solo.tier.toUpperCase() as SrRank,
    division: solo.rank ?? null,
    leaguePoints: solo.leaguePoints ?? 0,
    summonerName: riotId,
  };
}

// ---------------------------------------------------------------------------
// Member profile Riot enrichment — separate from the KR-only roster lookup
// above. These functions take an explicit platform (member's own choice, any
// region) rather than hardcoding KR, and never touch sr_team_players.
// ---------------------------------------------------------------------------

export type RiotAccountResult = { ok: true; puuid: string } | { ok: false; reason: string };

/** Resolve a Riot ID ("gameName#tagLine") + platform to a PUUID. Corroboration only — see file header. */
export async function resolveRiotAccount(
  gameName: string,
  tagLine: string,
  platform: string,
): Promise<RiotAccountResult> {
  const key = process.env.RIOT_API_KEY?.trim();
  if (!key) return { ok: false, reason: "Rank lookup isn't configured on this site yet (no Riot API key)." };

  const res = await riotFetch(
    `${regionalHost(platform)}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    key,
  );
  if (!res) return { ok: false, reason: "Riot's API didn't respond. Try again in a moment." };
  if (res.status === 404) return { ok: false, reason: "No account found with that Riot ID in that region." };
  if (res.status === 429) return { ok: false, reason: "Riot's API is rate-limiting right now. Try again in a minute." };
  if (!res.ok) return { ok: false, reason: "Riot's API didn't respond. Try again in a moment." };
  const account = (await res.json()) as { puuid?: string };
  if (!account.puuid) return { ok: false, reason: "Riot's API didn't respond. Try again in a moment." };
  return { ok: true, puuid: account.puuid };
}

export interface ChampionMasteryEntry {
  championId: number;
  championPoints: number;
  championLevel: number;
}

export interface RiotEnrichment {
  profileIconId: number | null;
  topMasteries: ChampionMasteryEntry[];
}

export type RiotEnrichmentResult = { ok: true; data: RiotEnrichment } | { ok: false; reason: string };

/**
 * Summoner icon + top-3 champion masteries for an already-resolved PUUID.
 * Read-only, best-effort: a Riot outage or rate-limit here must never break
 * a profile page — callers render whatever partial data comes back (e.g.
 * icon present, masteries empty) rather than treating this as all-or-nothing.
 */
export async function getRiotEnrichment(puuid: string, platform: string): Promise<RiotEnrichmentResult> {
  const key = process.env.RIOT_API_KEY?.trim();
  if (!key) return { ok: false, reason: "not_configured" };

  const host = platformHost(platform);
  const [summonerRes, masteryRes] = await Promise.all([
    riotFetch(`${host}/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`, key),
    riotFetch(
      `${host}/lol/champion-mastery/v4/champion-masteries/by-puuid/${encodeURIComponent(puuid)}/top?count=3`,
      key,
    ),
  ]);

  // 429/5xx on either call: report the failure rather than a silently
  // empty-looking success — the profile UI distinguishes "Riot is down" from
  // "genuinely no mastery data yet".
  if (summonerRes?.status === 429 || masteryRes?.status === 429) {
    return { ok: false, reason: "rate_limited" };
  }

  let profileIconId: number | null = null;
  if (summonerRes?.ok) {
    const summoner = (await summonerRes.json()) as { profileIconId?: number };
    profileIconId = summoner.profileIconId ?? null;
  }

  let topMasteries: ChampionMasteryEntry[] = [];
  if (masteryRes?.ok) {
    const entries = (await masteryRes.json()) as Array<{
      championId?: number;
      championPoints?: number;
      championLevel?: number;
    }>;
    topMasteries = entries
      .filter((e): e is Required<typeof e> => typeof e.championId === "number")
      .map((e) => ({
        championId: e.championId!,
        championPoints: e.championPoints ?? 0,
        championLevel: e.championLevel ?? 0,
      }));
  }

  if (!summonerRes?.ok && !masteryRes?.ok) {
    return { ok: false, reason: "riot_error" };
  }

  return { ok: true, data: { profileIconId, topMasteries } };
}
