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
}
