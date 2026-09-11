// Past-tournament results for the Hall of Champions. These are the historical
// records shown on /tournaments. When the tournament bot ships, this becomes
// the contract for the completed-tournament payload; for now it is read from
// src/data/champions.json via src/lib/champions.ts.

export interface ChampionTeam {
  name: string;
  /** Short team tag, e.g. "SF". */
  tag?: string;
  /** Logo path in /public/images or an absolute URL. */
  logo?: string;
  /** Roster, in whatever order the team lists it. */
  players?: string[];
}

export interface ChampionRecord {
  id: string;
  /** Tournament name, e.g. "Season Opener". */
  tournament: string;
  /** Game played, e.g. "League of Legends". */
  game: string;
  /** ISO date of the final. */
  date: string;
  champion: ChampionTeam;
  runnerUp?: ChampionTeam;
  /** Human-readable format summary, e.g. "Swiss into Top 8, best-of-5 final". */
  format?: string;
  /** Number of teams/players that entered. */
  teams?: number;
  /** Bracket, VOD, recap links. */
  links?: { label: string; href: string }[];
  /** Marks seeded sample data so the UI can flag it until real results land. */
  placeholder?: boolean;
  /**
   * Where this record came from.
   *
   *   "live"   — read out of the tournament DB (a real, completed tournament
   *              run through the admin tool; the result is auditable).
   *   "legacy" — read from src/data/champions.json: results that predate the
   *              system, hand-entered as a backfill. A `legacy` record whose
   *              `placeholder` is also true is SEEDED SAMPLE DATA and is not
   *              a real historical winner at all — the two flags mean
   *              different things and both must survive the merge.
   *
   * Optional so the raw JSON file doesn't have to carry it; the loader
   * stamps it.
   */
  source?: "live" | "legacy";
}
