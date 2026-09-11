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
