/**
 * Riot Data Dragon — champion metadata + official CDN art.
 *
 * Data Dragon is Riot's own static asset CDN (ddragon.leagueoflegends.com),
 * versioned per patch. This is the correct source for champion icons/names —
 * NOT the League wiki, which is fan-run, not versioned per-patch, and not
 * safe to scrape for hotlinked images (unpredictable paths, no CDN
 * guarantees, attribution/ToS uncertainty). Everything here reads straight
 * from Riot's own CDN URLs at request time; nothing is downloaded into the
 * repo, so there is nothing to keep in sync with new champion releases.
 *
 * Two lookups this module exists to serve:
 *   1. Champion select UI (main champions / favorite champion) needs the
 *      full roster: id ("Ahri"), display name, and a square icon URL.
 *   2. Champion mastery from the Riot API returns numeric championId values
 *      (e.g. 103 for Ahri) that must be mapped to a champion's square icon —
 *      champion.json does not key by numeric id, so a reverse index is
 *      built from its `key` field (Riot's numeric id, confusingly stored as
 *      a string) once per cache load.
 */

const VERSIONS_URL = "https://ddragon.leagueoflegends.com/api/versions.json";
const REQUEST_TIMEOUT_MS = 6000;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h — patches ship far less often than this

export interface ChampionSummary {
  /** Data Dragon's string id, e.g. "Ahri" — also what we store as favorite_champion/main_champions. */
  id: string;
  /** Riot's numeric champion id as a string, e.g. "103" — what champion-mastery-v4 returns. */
  key: string;
  name: string;
}

interface DDragonCache {
  version: string;
  byId: Map<string, ChampionSummary>;
  byKey: Map<string, ChampionSummary>;
  fetchedAt: number;
}

let cache: DDragonCache | null = null;
let inFlight: Promise<DDragonCache | null> | null = null;

async function ddFetch(url: string): Promise<Response | null> {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), next: { revalidate: 43200 } });
  } catch {
    return null;
  }
}

async function loadCache(): Promise<DDragonCache | null> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const versionsRes = await ddFetch(VERSIONS_URL);
      if (!versionsRes?.ok) return cache; // fall back to a stale cache over throwing
      const versions = (await versionsRes.json()) as string[];
      const version = versions[0];
      if (!version) return cache;

      const championRes = await ddFetch(
        `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`,
      );
      if (!championRes?.ok) return cache;
      const data = (await championRes.json()) as {
        data: Record<string, { id: string; key: string; name: string }>;
      };

      const byId = new Map<string, ChampionSummary>();
      const byKey = new Map<string, ChampionSummary>();
      for (const c of Object.values(data.data)) {
        const summary: ChampionSummary = { id: c.id, key: c.key, name: c.name };
        byId.set(c.id, summary);
        byKey.set(c.key, summary);
      }
      const next: DDragonCache = { version, byId, byKey, fetchedAt: Date.now() };
      cache = next;
      return next;
    } catch {
      return cache;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** All champions, sorted by display name, for a select control. Empty if Data Dragon is unreachable and nothing is cached yet. */
export async function listChampions(): Promise<ChampionSummary[]> {
  const c = await loadCache();
  if (!c) return [];
  return Array.from(c.byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/** True if `championId` (Data Dragon string id, e.g. "Ahri") is a real champion — used to validate profile writes. */
export function isKnownChampionId(championId: string): boolean {
  // Validated lazily against whatever is cached; a cold cache (first request
  // after a deploy) would otherwise reject every write. Falling open here
  // only matters for the brief window before the first successful fetch —
  // once populated, unknown ids are rejected normally.
  if (!cache) return true;
  return cache.byId.has(championId);
}

export async function getChampionByKey(key: string): Promise<ChampionSummary | null> {
  const c = await loadCache();
  return c?.byKey.get(key) ?? null;
}

export async function getChampionById(id: string): Promise<ChampionSummary | null> {
  const c = await loadCache();
  return c?.byId.get(id) ?? null;
}

export async function getDdragonVersion(): Promise<string | null> {
  const c = await loadCache();
  return c?.version ?? null;
}

/** Square champion icon, e.g. https://ddragon.leagueoflegends.com/cdn/14.20.1/img/champion/Ahri.png */
export function championIconUrl(version: string, championId: string): string {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${championId}.png`;
}

/** Summoner profile icon, e.g. https://ddragon.leagueoflegends.com/cdn/14.20.1/img/profileicon/29.png */
export function profileIconUrl(version: string, profileIconId: number): string {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/profileicon/${profileIconId}.png`;
}
