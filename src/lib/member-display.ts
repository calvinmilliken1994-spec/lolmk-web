/**
 * Presentation helpers for member names and Discord avatars. Pure functions,
 * no data access, safe in server and client components.
 */

/**
 * Many members set their Discord server nickname to "RiotName#TAG (Name)".
 * The cached display_name is that nickname verbatim, which is why cards used
 * to render "Calvin#lolmk (Calvin)". Split it so the card title is the name
 * and the Riot ID becomes a secondary line. Anything that doesn't match the
 * pattern is returned unchanged as the name.
 */
export function splitDisplayName(raw: string): { name: string; riotId: string | null } {
  const trimmed = raw.trim();
  const match = /^(.+?#[^\s()]+)\s*\((.+)\)$/.exec(trimmed);
  if (!match) return { name: trimmed, riotId: null };
  return { name: match[2].trim(), riotId: match[1].trim() };
}

/**
 * Discord's CDN serves 128px by default, which is why member photos looked
 * soft. Request an explicit size (power of two, 16 to 4096). Non-Discord URLs
 * pass through untouched.
 */
export function discordAvatarUrl(url: string | null, size = 512): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "cdn.discordapp.com") return url;
    parsed.searchParams.set("size", String(size));
    return parsed.toString();
  } catch {
    return url;
  }
}
