import championsData from "@/data/champions.json";
import type { ChampionRecord } from "@/types/champion";

const records = championsData as ChampionRecord[];

/** All past champions, most recent final first. */
export async function getChampions(): Promise<ChampionRecord[]> {
  return records
    .slice()
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

/** The most recent tournament winner, or null if none recorded yet. */
export async function getLatestChampion(): Promise<ChampionRecord | null> {
  const all = await getChampions();
  return all[0] ?? null;
}
