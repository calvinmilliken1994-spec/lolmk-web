// Top cut, pure: rebuild the single-elimination bracket from the stored seeds
// and the reported results, lay it out for the venue screen and the desk, and
// summarise the champion. No storage, no React. Shared by rb-service.ts (which
// pairs and completes the cut), the desk workspace, the venue screen and
// /api/rb/state.
//
// Works on structural subsets of the match and round types so the same code
// reads the admin rows and the public projection.
//
// Relative imports (not "@/") so the Node test scripts can load this file.

import { applyBracketResult, buildKnockoutBracket, type BracketMatch } from "./bracket-engine";
import type { SwissStanding } from "./swiss-engine";
import type { ChampionRecord } from "../types/champion";
import type { RbPublicMatch, RbPublicRound, RbTournamentFull } from "../types/riftbound";

export type CutRoundLike = Pick<RbPublicRound, "id" | "number" | "stage">;
export type CutMatchLike = Pick<
  RbPublicMatch,
  "round_id" | "table_number" | "player_a_id" | "player_b_id" | "games_a" | "games_b" | "status"
> &
  Partial<Pick<RbPublicMatch, "id" | "started_at">>;

const byNumber = (a: { number: number }, b: { number: number }) => a.number - b.number;
const byTable = (a: { table_number: number }, b: { table_number: number }) => a.table_number - b.table_number;

export interface CutReplay {
  /** Bracket matches per cut round (index 0 = first cut round), in table order. */
  levels: BracketMatch[][];
  /** The bracket after every reported result was applied. Look matches up by id here. */
  bracket: BracketMatch[];
  championId: string | null;
}

/**
 * Rebuild the single-elimination bracket from the stored seeds and replay
 * every reported top-cut result in order. Top-cut round k (k-th top_cut
 * rb_round by number) corresponds to bracket level k, and its tables to that
 * level's matches in match-number order.
 */
export function replayTopCut(
  seeds: string[],
  bestOf: 1 | 3,
  rounds: CutRoundLike[],
  matches: CutMatchLike[],
): CutReplay {
  let k = 0;
  const bracket = buildKnockoutBracket(seeds, {
    tournamentId: "top-cut",
    knockoutBestOf: bestOf,
    doubleElimination: false,
    thirdPlaceMatch: false,
    grandFinalReset: false,
    idFactory: () => `cut${++k}`,
  });
  let size = 1;
  while (size < Math.max(seeds.length, 2)) size *= 2;
  const depth = Math.log2(size);
  const levels: BracketMatch[][] = Array.from({ length: depth }, () => []);
  for (const m of bracket) {
    const level = m.bracket === "grand_final" ? depth : m.round_number;
    levels[level - 1].push(m);
  }
  levels.forEach((l) => l.sort((a, b) => a.match_number - b.match_number));

  const needed = bestOf === 3 ? 2 : 1;
  let championId: string | null = null;
  const cutRounds = rounds.filter((r) => r.stage === "top_cut").sort(byNumber);
  cutRounds.forEach((round, i) => {
    const level = levels[i];
    const ms = matches.filter((m) => m.round_id === round.id).sort(byTable);
    if (!level || ms.length !== level.length) throw new Error(`Top-cut round ${round.number} doesn't match the bracket.`);
    ms.forEach((m, j) => {
      // Re-read by id: applyBracketResult/resolveByes may replace array entries.
      const bm = bracket.find((x) => x.id === level[j].id) as BracketMatch;
      if (bm.status === "bye" || bm.status === "completed") return; // structural bye, already resolved
      let winner: string | null = null;
      let w = 0;
      let l = 0;
      if (m.status === "completed") {
        winner = m.games_a > m.games_b ? m.player_a_id : m.player_b_id;
        w = Math.max(m.games_a, m.games_b);
        l = Math.min(m.games_a, m.games_b);
      } else if (m.status === "bye") {
        // The opponent dropped after the cut: player_a advances.
        winner = m.player_a_id;
        w = needed;
      }
      if (!winner) return;
      const res = applyBracketResult(bracket, bm.id, winner === bm.team_a_id ? w : l, winner === bm.team_a_id ? l : w);
      if (res.championId) championId = res.championId;
    });
  });
  return { levels, bracket, championId };
}

// ---------------------------------------------------------------------------
// Bracket view (venue screen and desk)
// ---------------------------------------------------------------------------

export const CUT_CARD_W = 460;
export const CUT_ROW_H = 70;
export const CUT_CANVAS_H = 750;

export type CutSlotState = "open" | "winner" | "loser" | "tbd" | "bye";

export interface CutSlotView {
  playerId: string | null;
  /** 1-based; null for a placeholder. */
  seed: number | null;
  name: string;
  /** Second line: the Swiss record, or "Waiting". */
  sub: string;
  /** Games won once the match has a result. */
  score: number | null;
  state: CutSlotState;
}

export interface CutCardView {
  id: string;
  /** 0 = first cut round. */
  level: number;
  /** Position within the level, top to bottom. */
  index: number;
  /** "QF1", "SF2", "F". */
  short: string;
  left: number;
  top: number;
  slots: [CutSlotView, CutSlotView];
  /** Table's match id once the round exists. */
  matchId: string | null;
  /** Marked in progress and not yet reported. */
  live: boolean;
  done: boolean;
}

export interface CutConnectorView {
  left: number;
  top: number;
  width: number;
  height: number;
  /** "bracket" = the ]-shaped join, "stub" = the line out to the next card. */
  kind: "bracket" | "stub";
}

export interface CutView {
  size: number;
  depth: number;
  labels: { text: string; left: number; width: number }[];
  cards: CutCardView[];
  connectors: CutConnectorView[];
  /** Width of the bracket area. */
  width: number;
  championId: string | null;
}

const LEVEL_NAME: Record<number, [string, string]> = {
  0: ["FINAL", "F"],
  1: ["SEMIFINALS", "SF"],
  2: ["QUARTERFINALS", "QF"],
};

export function cutLevelName(depth: number, level: number): { text: string; short: string } {
  const [text, short] = LEVEL_NAME[depth - 1 - level] ?? [`ROUND OF ${2 ** (depth - level)}`, `R${level + 1}`];
  return { text, short };
}

/** Horizontal distance between columns: wider for a 4-player cut so it fills the screen. */
const columnPitch = (depth: number) => (depth <= 2 ? 800 : 600);

/** Where level-0 cards sit: 200 apart for an 8 cut, 400 apart for a 4 cut (as venue-top8.html). */
function level0Tops(count: number): number[] {
  if (count >= 4) return Array.from({ length: count }, (_, i) => i * 200);
  if (count === 2) return [100, 500];
  return [300];
}

/**
 * The bracket as absolutely positioned cards and connector lines, in the
 * pixels of venue-top8.html (cards 460 wide, 70px rows, columns 600 apart,
 * level-0 cards 200 apart). `records` maps player id to the Swiss record shown
 * under the name.
 */
export function rbCutView(
  seeds: string[],
  bestOf: 1 | 3,
  rounds: CutRoundLike[],
  matches: CutMatchLike[],
  names: Map<string, string>,
  records: Map<string, string>,
): CutView {
  const replay = replayTopCut(seeds, bestOf, rounds, matches);
  const byId = new Map(replay.bracket.map((m) => [m.id, m]));
  const depth = replay.levels.length;
  const pitch = columnPitch(depth);
  const seedOf = (id: string) => seeds.indexOf(id) + 1;
  const cutRounds = rounds.filter((r) => r.stage === "top_cut").sort(byNumber);

  // Positions.
  const tops: number[][] = [level0Tops(replay.levels[0]?.length ?? 1)];
  for (let l = 1; l < depth; l++) {
    tops.push(replay.levels[l].map((_, j) => (tops[l - 1][2 * j] + tops[l - 1][2 * j + 1]) / 2));
  }

  const shortOf = (level: number, index: number) => {
    const n = cutLevelName(depth, level).short;
    return level === depth - 1 ? n : `${n}${index + 1}`;
  };

  const slotFor = (
    bm: BracketMatch,
    side: "a" | "b",
    level: number,
    done: boolean,
  ): { slot: CutSlotView; id: string | null } => {
    const id = side === "a" ? bm.team_a_id : bm.team_b_id;
    const score = side === "a" ? bm.team_a_score : bm.team_b_score;
    if (!id) {
      // Waiting on an earlier match, or an empty seat in the first round.
      const feeder = replay.levels[level - 1]?.find(
        (c) => byId.get(c.id)?.advances_to_match_id === bm.id && byId.get(c.id)?.advances_to_slot === side,
      );
      const text = level === 0 || !feeder ? "Bye" : `Winner ${shortOf(level - 1, replay.levels[level - 1].indexOf(feeder))}`;
      return {
        id: null,
        slot: { playerId: null, seed: null, name: text, sub: level === 0 ? "" : "Waiting", score: null, state: level === 0 ? "bye" : "tbd" },
      };
    }
    const won = bm.winner_id === id;
    return {
      id,
      slot: {
        playerId: id,
        seed: seedOf(id),
        name: names.get(id) ?? "—",
        sub: records.get(id) ?? "",
        score: done ? score : null,
        state: done ? (won ? "winner" : "loser") : "open",
      },
    };
  };

  const cards: CutCardView[] = [];
  replay.levels.forEach((lvl, level) => {
    const round = cutRounds[level];
    const tables = round ? matches.filter((m) => m.round_id === round.id).sort(byTable) : [];
    lvl.forEach((orig, index) => {
      const bm = byId.get(orig.id) as BracketMatch;
      const done = bm.status === "completed" || bm.status === "bye";
      let a = slotFor(bm, "a", level, done);
      let b = slotFor(bm, "b", level, done);
      // Both players known: the higher seed is listed first.
      if (a.id && b.id && seedOf(b.id) < seedOf(a.id)) [a, b] = [b, a];
      const table = tables[index];
      cards.push({
        id: bm.id,
        level,
        index,
        short: shortOf(level, index),
        left: level * pitch,
        top: tops[level][index],
        slots: [a.slot, b.slot],
        matchId: table?.id ?? null,
        live: Boolean(table && table.status === "pending" && table.started_at),
        done,
      });
    });
  });

  const connectors: CutConnectorView[] = [];
  for (let l = 1; l < depth; l++) {
    replay.levels[l].forEach((_, j) => {
      const c1 = tops[l - 1][2 * j];
      const c2 = tops[l - 1][2 * j + 1];
      const parent = tops[l][j];
      const childLeft = (l - 1) * pitch;
      connectors.push({ left: childLeft + 462, top: c1 + CUT_ROW_H, width: 70, height: c2 - c1 + 3, kind: "bracket" });
      connectors.push({ left: childLeft + 530, top: parent + CUT_ROW_H, width: pitch - 530, height: 3, kind: "stub" });
    });
  }

  const labels = Array.from({ length: depth }, (_, l) => ({
    text: cutLevelName(depth, l).text,
    left: l * pitch,
    width: l === depth - 1 ? CUT_CARD_W : pitch,
  }));
  return {
    size: 2 ** depth,
    depth,
    labels,
    cards,
    connectors,
    width: (depth - 1) * pitch + CUT_CARD_W + 4,
    championId: replay.championId,
  };
}

// ---------------------------------------------------------------------------
// Champion
// ---------------------------------------------------------------------------

export interface RbChampionSummary {
  playerId: string;
  name: string;
  /** Deck Legend, if one was registered. Public only through this summary, once the event is over. */
  legend: string | null;
  /** Position in the cut (1 = top seed), or the Swiss rank for an event without a cut. */
  seed: number | null;
  /** Final score from the champion's side, e.g. 2–1 against Iris. Null without a top cut. */
  finalFor: number | null;
  finalAgainst: number | null;
  finalOpponent: string | null;
  /** "4-1-0" */
  swissRecord: string | null;
  /** "3-0": match wins and losses in the cut. Null without a top cut. */
  playoffRecord: string | null;
  players: number;
  swissRounds: number;
  cutSize: number;
}

/**
 * Who won, and how. Null until the event is completed (or archived) with a
 * champion. Reads private data (the Legend), so call it only to build the
 * public summary above.
 */
export function rbChampionSummary(full: RbTournamentFull, standings: SwissStanding[]): RbChampionSummary | null {
  const { tournament: t } = full;
  if ((t.status !== "completed" && t.status !== "archived") || !t.champion_player_id) return null;
  const champ = full.players.find((p) => p.id === t.champion_player_id);
  if (!champ) return null;
  const name = (id: string | null) => full.players.find((p) => p.id === id)?.display_name ?? null;
  const standing = standings.find((s) => s.playerId === champ.id);
  const seeds = t.config.topCutSeedIds;
  const cutRounds = full.rounds.filter((r) => r.stage === "top_cut").sort(byNumber);
  const mine = full.matches.filter(
    (m) =>
      cutRounds.some((r) => r.id === m.round_id) &&
      (m.player_a_id === champ.id || m.player_b_id === champ.id) &&
      (m.status === "completed" || m.status === "bye"),
  );
  let wins = 0;
  let losses = 0;
  for (const m of mine) {
    if (m.status === "bye") {
      wins++;
      continue;
    }
    const isA = m.player_a_id === champ.id;
    if ((isA ? m.games_a : m.games_b) > (isA ? m.games_b : m.games_a)) wins++;
    else losses++;
  }
  const finalRound = cutRounds.at(-1);
  const finalMatch = finalRound ? full.matches.find((m) => m.round_id === finalRound.id) : undefined;
  const isA = finalMatch?.player_a_id === champ.id;
  const hasFinal = Boolean(seeds && finalMatch && finalMatch.status === "completed");
  return {
    playerId: champ.id,
    name: champ.display_name,
    legend: champ.legend,
    seed: seeds ? seeds.indexOf(champ.id) + 1 || null : (standing?.rank ?? null),
    finalFor: hasFinal && finalMatch ? (isA ? finalMatch.games_a : finalMatch.games_b) : null,
    finalAgainst: hasFinal && finalMatch ? (isA ? finalMatch.games_b : finalMatch.games_a) : null,
    finalOpponent: hasFinal && finalMatch ? name(isA ? finalMatch.player_b_id : finalMatch.player_a_id) : null,
    swissRecord: standing?.record ?? null,
    playoffRecord: seeds ? `${wins}-${losses}` : null,
    players: full.players.filter((p) => p.status === "active" || p.status === "dropped" || p.status === "dq").length,
    swissRounds: full.rounds.filter((r) => r.stage === "swiss").length,
    cutSize: seeds ? seeds.length : 0,
  };
}

/**
 * The Hall of Champions row for a completed Riftbound event, or null while it
 * has no champion. Follows SR's pattern: nothing extra is stored, the Hall reads
 * status + champion_player_id back. The runner-up is the other finalist.
 */
export function rbChampionRecord(full: RbTournamentFull, standings: SwissStanding[]): ChampionRecord | null {
  const summary = rbChampionSummary(full, standings);
  if (!summary) return null;
  const t = full.tournament;
  const format =
    summary.cutSize > 0
      ? `Swiss (${summary.swissRounds} rounds) into a top ${summary.cutSize}, best-of-${t.config.bestOf}`
      : `Swiss (${summary.swissRounds} rounds), best-of-${t.config.bestOf}`;
  return {
    id: `rb-${t.slug}`,
    tournament: t.name,
    game: "Riftbound",
    formatKey: "rb",
    // The event day when the admin set one; otherwise when the final was recorded.
    date: t.config.date ?? t.updated_at,
    venue: t.config.venue ?? undefined,
    format,
    teams: summary.players,
    champion: { name: summary.name },
    runnerUp: summary.finalOpponent ? { name: summary.finalOpponent } : undefined,
    source: "live",
  };
}
