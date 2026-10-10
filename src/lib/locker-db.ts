import "server-only";
import { sql } from "@vercel/postgres";
import { computeBracketGraph, decidingFinalId, type LayoutMatch } from "@/lib/bracket-layout";
import { getTournamentFull } from "@/lib/rb-db";
import { rbChampionSummary } from "@/lib/rb-cut";
import { computeRbStandings } from "@/lib/rb-service";
import type { FormatKey } from "@/lib/tournament-status";

/**
 * Read-only data for /locker: one member's tournament history and current
 * team, from the same Postgres tables the tournament tools write. Nothing
 * here writes; test tournaments and drafts are excluded in SQL.
 *
 * Placements are derived from recorded results only: champion, runner-up
 * (loser of the deciding final), third where the bracket decides it, and
 * otherwise the round the team went out in. Nothing is estimated.
 */

export interface LockerHistoryRow {
  id: string;
  formatKey: FormatKey;
  tournament: string;
  /** ISO date used for ordering and the When column. */
  date: string;
  /** Team name (SR) or null for solo formats. */
  team: string | null;
  placement: string | null;
  /** 1 champion, 2 runner-up, 3 third, 4 fourth; null otherwise. */
  rank: number | null;
  finished: boolean;
  href: string | null;
}

export interface LockerTeam {
  tournament: string;
  tournamentHref: string;
  name: string;
  logoUrl: string | null;
  players: { name: string; role: string | null; isCaptain: boolean; isSub: boolean; isYou: boolean }[];
}

const SR_FINISHED = new Set(["completed", "archived"]);

interface SrRow {
  tournament_id: string;
  slug: string;
  name: string;
  status: string;
  start_at: string | null;
  end_at: string | null;
  updated_at: string;
  champion_team_id: string | null;
  team_id: string;
  team_name: string;
}

interface SrMatchRow extends LayoutMatch {
  tournament_id: string;
  team_a_id: string | null;
  team_b_id: string | null;
  winner_id: string | null;
}

function iso(v: unknown): string | null {
  return v ? new Date(v as string).toISOString() : null;
}

async function srHistory(discordId: string): Promise<LockerHistoryRow[]> {
  const { rows } = await sql`
    SELECT t.id AS tournament_id, t.slug, t.name, t.status, t.start_at, t.end_at, t.updated_at,
           t.champion_team_id, tm.id AS team_id, tm.name AS team_name
    FROM sr_team_players p
    JOIN sr_teams tm ON tm.id = p.team_id
    JOIN sr_tournaments t ON t.id = tm.tournament_id
    WHERE p.discord_id = ${discordId}
      AND t.is_test = false
      AND t.status <> 'draft'
      AND tm.status = 'approved'
  `;
  if (rows.length === 0) return [];
  const list = rows.map((r) => ({
    ...(r as unknown as SrRow),
    start_at: iso(r.start_at),
    end_at: iso(r.end_at),
    updated_at: iso(r.updated_at) as string,
  }));
  const ids = list.map((r) => r.tournament_id);
  const { rows: matchRows } = await sql.query(
    `SELECT id, tournament_id, bracket, round_number, match_number, status,
            team_a_id, team_b_id, winner_id, advances_to_match_id, drops_to_match_id
     FROM sr_matches WHERE tournament_id = ANY($1)`,
    [ids],
  );
  const byTournament = new Map<string, SrMatchRow[]>();
  for (const m of matchRows as SrMatchRow[]) {
    const arr = byTournament.get(m.tournament_id) ?? [];
    arr.push(m);
    byTournament.set(m.tournament_id, arr);
  }

  return list.map((r) => {
    const finished = SR_FINISHED.has(r.status);
    const { placement, rank } = srPlacement(r, byTournament.get(r.tournament_id) ?? [], finished);
    return {
      id: `sr:${r.tournament_id}`,
      formatKey: "sr",
      tournament: r.name,
      date: r.end_at ?? r.start_at ?? r.updated_at,
      team: r.team_name,
      placement,
      rank,
      finished,
      href: `/tournaments/summoners-rift/${r.slug}`,
    };
  });
}

function srPlacement(
  r: SrRow,
  matches: SrMatchRow[],
  finished: boolean,
): { placement: string | null; rank: number | null } {
  const team = r.team_id;
  if (finished && r.champion_team_id === team) return { placement: "Champion", rank: 1 };
  const played = matches.filter(
    (m) => (m.team_a_id === team || m.team_b_id === team) && m.status === "completed",
  );
  const decider = decidingFinalId(matches);
  if (finished && decider && played.some((m) => m.id === decider && m.winner_id !== team)) {
    return { placement: "Runner-up", rank: 2 };
  }
  const third = matches.find((m) => m.bracket === "third_place" && m.status === "completed");
  if (third && (third.team_a_id === team || third.team_b_id === team)) {
    return third.winner_id === team ? { placement: "Third", rank: 3 } : { placement: "Fourth", rank: 4 };
  }
  // Out: a completed loss with nowhere to drop to.
  // A grand-final loss that forced a reset isn't elimination, so the team must
  // not appear in any later or still-open match.
  const appearsAfter = (lost: SrMatchRow) =>
    matches.some(
      (m) =>
        m.id !== lost.id &&
        (m.team_a_id === team || m.team_b_id === team) &&
        (m.status !== "completed" || (m.bracket === lost.bracket && m.round_number > lost.round_number)),
    );
  const out = played.find(
    (m) => m.winner_id && m.winner_id !== team && !m.drops_to_match_id && !appearsAfter(m),
  );
  if (out) {
    const hasLower = matches.some((m) => m.bracket === "lower");
    if (hasLower && out.bracket === "lower") {
      const lowerRounds = matches.filter((m) => m.bracket === "lower").map((m) => m.round_number);
      if (out.round_number === Math.max(...lowerRounds)) return { placement: "Third", rank: 3 };
    }
    const graph = computeBracketGraph(matches);
    const pos = graph.positioned.find((p) => p.match.id === out.id);
    const band = out.bracket === "upper" ? "upper" : "lower";
    const label = pos ? graph.headers.find((h) => h.col === pos.col && h.band === band)?.label : null;
    return { placement: label ? `Out in ${label}` : "Knocked out", rank: null };
  }
  if (!finished) return { placement: matches.length > 0 ? "Still in" : null, rank: null };
  return { placement: null, rank: null };
}

async function rbHistory(discordId: string): Promise<LockerHistoryRow[]> {
  const { rows } = await sql`
    SELECT t.slug
    FROM rb_players p
    JOIN rb_tournaments t ON t.id = p.tournament_id
    WHERE p.member_discord_id = ${discordId}
      AND t.is_test = false
      AND t.status <> 'draft'
      AND p.status NOT IN ('dropped', 'dq')
  `;
  const out: LockerHistoryRow[] = [];
  for (const { slug } of rows as { slug: string }[]) {
    const full = await getTournamentFull(slug);
    if (!full) continue;
    const me = full.players.find((p) => p.member_discord_id === discordId);
    if (!me) continue;
    const t = full.tournament;
    const finished = t.status === "completed" || t.status === "archived";
    let placement: string | null = null;
    let rank: number | null = null;
    if (finished) {
      const standings = computeRbStandings(full);
      const summary = rbChampionSummary(full, standings);
      if (t.champion_player_id === me.id) {
        placement = "Champion";
        rank = 1;
      } else if (summary?.finalOpponent && summary.finalOpponent === me.display_name) {
        placement = "Runner-up";
        rank = 2;
      } else {
        const s = standings.find((x) => x.playerId === me.id);
        if (s) placement = `${ordinal(s.rank)} after Swiss, ${s.record}`;
      }
    } else if (t.status === "in_progress") {
      placement = "In progress";
    }
    out.push({
      id: `rb:${t.id}`,
      formatKey: "rb",
      tournament: t.name,
      date: t.config.date ?? t.updated_at,
      team: null,
      placement,
      rank,
      finished,
      href: `/rblive/${t.slug}`,
    });
  }
  return out;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** Every public tournament the member played, newest first. */
export async function getMemberHistory(discordId: string): Promise<LockerHistoryRow[]> {
  const [sr, rb] = await Promise.all([
    srHistory(discordId).catch(() => [] as LockerHistoryRow[]),
    rbHistory(discordId).catch(() => [] as LockerHistoryRow[]),
  ]);
  return [...sr, ...rb].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

/**
 * The member's team in a Summoner's Rift tournament that hasn't finished
 * (signups through bracket), with its roster. Null when they have none.
 */
export async function getMemberCurrentTeam(discordId: string): Promise<LockerTeam | null> {
  const { rows } = await sql`
    SELECT tm.id AS team_id, tm.name AS team_name, tm.logo_url, t.name AS tournament, t.slug, t.status
    FROM sr_team_players p
    JOIN sr_teams tm ON tm.id = p.team_id
    JOIN sr_tournaments t ON t.id = tm.tournament_id
    WHERE p.discord_id = ${discordId}
      AND t.is_test = false
      AND t.status NOT IN ('draft', 'completed', 'archived')
      AND tm.status = 'approved'
    ORDER BY t.start_at ASC NULLS LAST
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  const { rows: players } = await sql`
    SELECT discord_id, ign, role, is_captain, is_substitute
    FROM sr_team_players
    WHERE team_id = ${row.team_id as string}
    ORDER BY is_substitute ASC, is_captain DESC, created_at ASC
  `;
  return {
    tournament: row.tournament as string,
    tournamentHref: `/tournaments/summoners-rift/${row.slug as string}`,
    name: row.team_name as string,
    logoUrl: (row.logo_url as string) ?? null,
    players: players.map((p) => ({
      name: p.ign as string,
      role: (p.role as string) ?? null,
      isCaptain: Boolean(p.is_captain),
      isSub: Boolean(p.is_substitute),
      isYou: p.discord_id === discordId,
    })),
  };
}
