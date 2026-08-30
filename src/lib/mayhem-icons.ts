import fs from "node:fs";
import path from "node:path";

/**
 * Team identity icons for the ARAM Mayhem randomizer.
 *
 * Source: public/images/aramteamicons/*.png — filenames are the display
 * names directly ("Team Krug.png" -> "Team Krug"). When an event needs more
 * teams than there are unique icons, we cycle back through the set with a
 * roman-numeral suffix ("Team Krug II") rather than silently reusing an
 * identical name for two different teams.
 */

const ICON_DIR = path.join(process.cwd(), "public", "images", "aramteamicons");

export interface TeamIdentity {
  /** Display name, e.g. "Team Krug" or "Team Krug II" on a second lap. */
  name: string;
  /** Public URL to the icon, e.g. "/images/aramteamicons/Team Krug.png". */
  iconUrl: string;
}

let cachedBaseNames: string[] | null = null;

function loadBaseNames(): string[] {
  if (cachedBaseNames) return cachedBaseNames;
  try {
    const files = fs
      .readdirSync(ICON_DIR)
      .filter((f) => f.toLowerCase().endsWith(".png"))
      .sort();
    cachedBaseNames = files.map((f) => f.replace(/\.png$/i, ""));
  } catch {
    cachedBaseNames = [];
  }
  return cachedBaseNames;
}

const ROMAN = ["", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

/**
 * Return `count` team identities, shuffled, cycling through the icon set
 * with a roman-numeral suffix once we've used every unique icon once.
 */
export function pickTeamIdentities(count: number): TeamIdentity[] {
  const base = loadBaseNames();
  if (base.length === 0) {
    // Fallback so the tool never hard-fails if the folder is empty/missing.
    return Array.from({ length: count }, (_, i) => ({
      name: `Team ${i + 1}`,
      iconUrl: "",
    }));
  }

  const shuffled = shuffle(base);
  const identities: TeamIdentity[] = [];
  for (let i = 0; i < count; i++) {
    const lap = Math.floor(i / shuffled.length);
    const baseName = shuffled[i % shuffled.length];
    const suffix = ROMAN[lap] ? ` ${ROMAN[lap]}` : "";
    identities.push({
      name: `${baseName}${suffix}`,
      iconUrl: `/images/aramteamicons/${encodeURIComponent(baseName)}.png`,
    });
  }
  return identities;
}

/** Fisher-Yates shuffle. Does not mutate the input. */
export function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
