import { sql } from "@vercel/postgres";
import championsData from "@/data/champions.json";
import type { ChampionRecord } from "@/types/champion";
import {
  ensureSchema,
  getChampionTeams,
  getRunnerUpTeams,
  getTeamCounts,
} from "@/lib/sr-db";
import type { SrPublicTeam, SrTournament } from "@/types/sr-tournament";

/**
 * Hall of Champions data source.
 *
 * Two origins, merged, and the distinction between them is preserved all the
 * way to the UI:
 *
 *   - LIVE: completed Summoner's Rift tournaments read from Postgres. These
 *     are real results with a bracket and an audit trail behind them.
 *   - LEGACY: src/data/champions.json. Results that predate the tournament
 *     system, entered by hand. Every entry gets `source: "legacy"`.
 *
 * The seeded sample record in champions.json carries `"placeholder": true`.
 * That flag is load-bearing and is deliberately NOT stripped or overwritten
 * here: HallOfChampions renders a "Sample, replace with results" badge off
 * it, and presenting that row as a genuine past winner would be a lie about
 * the community's history. `placeholder` (this isn't a real result) and
 * `source` (where the record was read from) answer different questions and
 * are tracked separately.
 *
 * ARAM Mayhem is not merged in. mayhem-db.ts models a SINGLE live event
 * (one `mayhem-main` row, overwritten each meetup) — there is no completed-
 * tournament history table to read, so there is nothing to merge without
 * inventing it. When Mayhem grows persistent per-event rows, it plugs in
 * here alongside `srRecords`.
 */

const legacyRecords: ChampionRecord[] = (championsData as ChampionRecord[]).map((r) => ({
  ...r,
  source: "legacy",
}));

type ChampionTournament = Pick<
  SrTournament,
  "id" | "slug" | "name" | "format" | "best_of" | "end_at" | "updated_at"
>;

type ChampionQueries = {
  listTournaments: () => Promise<ChampionTournament[]>;
  getChampions: (ids: string[]) => Promise<Map<string, SrPublicTeam>>;
  getRunnersUp: (ids: string[]) => Promise<Map<string, SrPublicTeam>>;
  getCounts: (ids: string[]) => Promise<Map<string, number>>;
};

/**
 * Completed rows may later be archived to keep active admin listings tidy;
 * archiving must not erase their historical champion from the public hall.
 */
async function listChampionTournaments(): Promise<ChampionTournament[]> {
  await ensureSchema();
  const { rows } = await sql`
    SELECT id, slug, name, format, best_of, end_at, updated_at
    FROM sr_tournaments
    WHERE status IN ('completed', 'archived') AND champion_team_id IS NOT NULL
    ORDER BY end_at DESC NULLS LAST, updated_at DESC
  `;
  return rows.map((row) => ({
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    format: row.format as SrTournament["format"],
    best_of: row.best_of as SrTournament["best_of"],
    end_at: row.end_at ? new Date(row.end_at as string).toISOString() : null,
    updated_at: new Date(row.updated_at as string).toISOString(),
  }));
}

const defaultQueries: ChampionQueries = {
  listTournaments: listChampionTournaments,
  getChampions: getChampionTeams,
  getRunnersUp: getRunnerUpTeams,
  getCounts: getTeamCounts,
};

function formatSummary(t: ChampionTournament): string {
  const shape = t.format === "double_elim" ? "Double elimination" : "Single elimination";
  return `${shape}, best-of-${t.best_of} throughout`;
}

/**
 * `date` on a ChampionRecord is the date of the final. `end_at` is the
 * tournament's scheduled finish, which is the closest thing we store;
 * `updated_at` (when the deciding result was reported) is the fallback for
 * a tournament that never had dates set.
 */
function championDate(t: ChampionTournament): string {
  return t.end_at ?? t.updated_at;
}

export async function getLiveChampions(
  queries: ChampionQueries = defaultQueries,
): Promise<ChampionRecord[]> {
  try {
    const completed = await queries.listTournaments();
    if (completed.length === 0) return [];

    const ids = completed.map((t) => t.id);
    const [champions, runnersUp, teamCounts] = await Promise.all([
      queries.getChampions(ids),
      queries.getRunnersUp(ids),
      queries.getCounts(ids),
    ]);

    return completed.flatMap<ChampionRecord>((t) => {
      const champion = champions.get(t.id);
      // A historical tournament without a resolvable champion team is not a
      // renderable champion record. Skip it rather than inventing a winner.
      if (!champion) return [];
      const runnerUp = runnersUp.get(t.id);
      return [
        {
          id: `sr-${t.slug}`,
          tournament: t.name,
          game: "League of Legends",
          date: championDate(t),
          format: formatSummary(t),
          teams: teamCounts.get(t.id),
          champion: {
            name: champion.name,
            logo: champion.logo_url ?? undefined,
          },
          runnerUp: runnerUp ? { name: runnerUp.name } : undefined,
          links: [
            { label: "Full bracket", href: `/tournaments/summoners-rift/${t.slug}` },
          ],
          source: "live",
        },
      ];
    });
  } catch {
    // Every DB call belongs inside this boundary. Schema/list failures and
    // any of the aggregate lookups all degrade to the legacy history rather
    // than taking down /tournaments.
    return [];
  }
}

/** All past champions, most recent final first. Live DB results and legacy backfill merged. */
export async function getChampions(): Promise<ChampionRecord[]> {
  const live = await getLiveChampions();
  return [...live, ...legacyRecords].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
}

/**
 * The most recent tournament winner, or null if none recorded yet.
 *
 * "Real" means: not seeded sample data. A caller asking for THE reigning
 * champion (a homepage banner, a stats strip) must not be handed the
 * placeholder row — it would read as a genuine claim about who holds the
 * title. Callers that want the full list including the sample, badged as
 * such, use getChampions().
 */
export async function getLatestChampion(): Promise<ChampionRecord | null> {
  const all = await getChampions();
  return all.find((r) => !r.placeholder) ?? null;
}

/** Real results only — no seeded sample data. */
export async function getRealChampions(): Promise<ChampionRecord[]> {
  const all = await getChampions();
  return all.filter((r) => !r.placeholder);
}
