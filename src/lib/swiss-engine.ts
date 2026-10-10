// Swiss engine for the Riftbound tournament tool: standings with
// tiebreakers, round pairing, manual-pairing validation, round count and
// top-cut sizing. The rules implemented here are the Scoring and Pairing
// sections of docs/RIFTBOUND.md; change that document first if a rule
// changes.
//
// Pure TypeScript: no database, no React, no Next. Every function is
// deterministic for identical inputs (randomness only ever comes from a
// caller-supplied seed). Tested by scripts/test-swiss-engine.ts.

import { maxWeightMatching, type WeightedEdge } from "./max-weight-matching";
import { suggestedRoundsForPlayers } from "./timer-schedule";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SwissPlayer {
  id: string;
  /** Dropped or disqualified. Kept in standings, never paired again. */
  dropped?: boolean;
}

/**
 * One reported match. `playerB === null` is a bye: the stored game counts
 * are ignored and the configured bye score is used instead.
 *
 * The match result is derived from game wins only: more games won wins the
 * match; equal game wins (including a time-out on equal games and an
 * intentional draw reported as 0-0) is a match draw. Drawn games never count
 * toward a win. `decidedOnTime` is informational and does not change scoring.
 */
export interface SwissMatchResult {
  round: number;
  playerA: string;
  playerB: string | null;
  gamesA: number;
  gamesB: number;
  gamesDrawn: number;
  decidedOnTime?: boolean;
}

/** The part of a match the pairer needs: who played whom, and who had a bye. */
export type PairingHistoryEntry = Pick<SwissMatchResult, "playerA" | "playerB">;

export interface SwissConfig {
  winPoints: number;
  drawPoints: number;
  lossPoints: number;
  /** Floor applied to an opponent's MW% and GW% when averaging (OMW%/OGW%). */
  winPercentFloor: number;
  /** A bye is recorded as this game score. */
  byeGamesWon: number;
  byeGamesLost: number;
  /** Swiss round count, or "auto" (suggestedRoundsForPlayers). */
  swissRounds: "auto" | number;
  /** Top cut size, or "auto" (none for 4–6 players, 4 for 7–16, 8 for 17+). */
  topCut: "auto" | 0 | 4 | 8;
}

export const DEFAULT_SWISS_CONFIG: SwissConfig = {
  winPoints: 3,
  drawPoints: 1,
  lossPoints: 0,
  winPercentFloor: 0.33,
  byeGamesWon: 2,
  byeGamesLost: 0,
  swissRounds: "auto",
  topCut: "auto",
};

export interface SwissStanding {
  playerId: string;
  /** 1-based, unique. */
  rank: number;
  matchPoints: number;
  wins: number;
  losses: number;
  draws: number;
  /** "W-L-D". Byes count as wins. */
  record: string;
  byes: number;
  /** Rounds with a result, byes included. */
  matchesPlayed: number;
  gamesWon: number;
  gamesLost: number;
  gamesDrawn: number;
  /** Own match-win %, byes included, unfloored. */
  mwp: number;
  /** Opponents' average MW% (byes excluded, floor applied). */
  omwp: number;
  /** Own game-win %, bye games included, unfloored. */
  gwp: number;
  /** Opponents' average GW% (byes excluded, floor applied). */
  ogwp: number;
  dropped: boolean;
}

export type SwissWarningCode = "rematch" | "second_bye" | "point_mismatch" | "duplicate_player";

export interface SwissWarning {
  code: SwissWarningCode;
  message: string;
  playerIds: string[];
}

export type Pairing = [string, string | null];

export interface PairRoundInput {
  players: SwissPlayer[];
  matchHistory: PairingHistoryEntry[];
  standings: SwissStanding[];
  roundNumber: number;
  isFinalRound: boolean;
  powerPairFinal: boolean;
  seed: string | number;
}

export interface PairRoundResult {
  /** Table order (table 1 first). The bye, if any, is the last entry as [id, null]. */
  pairings: Pairing[];
  byeId: string | null;
  warnings: SwissWarning[];
}

// ---------------------------------------------------------------------------
// Seeded RNG
// ---------------------------------------------------------------------------

export type Rng = () => number;

/** Deterministic PRNG (cyrb53 hash of the seed feeding mulberry32). Returns [0, 1). */
export function createRng(seed: string | number): Rng {
  const str = String(seed);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  let state = h1 >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle into a new array. */
export function seededShuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

/** Percentages that differ by less than this are treated as equal. */
const EPS = 1e-9;

function resolveConfig(config: Partial<SwissConfig> | undefined): SwissConfig {
  return { ...DEFAULT_SWISS_CONFIG, ...(config ?? {}) };
}

interface Tally {
  wins: number;
  losses: number;
  draws: number;
  byes: number;
  gamesWon: number;
  gamesLost: number;
  gamesDrawn: number;
  /** Real opponents, one entry per match (byes excluded). */
  opponents: string[];
}

function emptyTally(): Tally {
  return { wins: 0, losses: 0, draws: 0, byes: 0, gamesWon: 0, gamesLost: 0, gamesDrawn: 0, opponents: [] };
}

/** Game points: 3 per game won, 1 per drawn game, over 3 per game played. */
function gameWinPercent(won: number, lost: number, drawn: number): number {
  const played = won + lost + drawn;
  return played === 0 ? 0 : (3 * won + drawn) / (3 * played);
}

/**
 * Compute standings for every player (dropped players included, flagged).
 *
 * - Match points: win/draw/loss points from config; a bye is a win.
 * - MW% = match points / (win points × rounds played). Own MW% and GW%
 *   include byes (bye = win, recorded as the configured game score).
 * - Byes are excluded from opponents' win-percentage calculations: a bye is
 *   not an opponent, and when a player's MW%/GW% feeds someone else's
 *   OMW%/OGW% it is recomputed without that player's bye rounds.
 * - The floor (default 0.33) is applied to each opponent's MW% and GW% before
 *   averaging. A player with no real opponents has OMW% = OGW% = 0.
 * - Order: match points, OMW%, GW%, OGW%, then random. The random key is
 *   drawn from `rng` once per player in ascending player-id order, so a
 *   stored seed reproduces the standings exactly.
 */
export function computeStandings(
  players: SwissPlayer[],
  matches: SwissMatchResult[],
  config: Partial<SwissConfig>,
  rng: Rng,
): SwissStanding[] {
  const cfg = resolveConfig(config);
  const tallies = new Map<string, Tally>();
  for (const p of players) {
    if (tallies.has(p.id)) throw new Error(`computeStandings: duplicate player ${p.id}`);
    tallies.set(p.id, emptyTally());
  }
  const tallyOf = (id: string): Tally => {
    const t = tallies.get(id);
    if (!t) throw new Error(`computeStandings: match references unknown player ${id}`);
    return t;
  };

  for (const m of matches) {
    const a = tallyOf(m.playerA);
    if (m.playerB === null) {
      a.wins++;
      a.byes++;
      a.gamesWon += cfg.byeGamesWon;
      a.gamesLost += cfg.byeGamesLost;
      continue;
    }
    if (m.playerB === m.playerA) throw new Error(`computeStandings: ${m.playerA} paired with itself`);
    const b = tallyOf(m.playerB);
    a.gamesWon += m.gamesA;
    a.gamesLost += m.gamesB;
    a.gamesDrawn += m.gamesDrawn;
    b.gamesWon += m.gamesB;
    b.gamesLost += m.gamesA;
    b.gamesDrawn += m.gamesDrawn;
    if (m.gamesA > m.gamesB) {
      a.wins++;
      b.losses++;
    } else if (m.gamesB > m.gamesA) {
      b.wins++;
      a.losses++;
    } else {
      a.draws++;
      b.draws++;
    }
    a.opponents.push(m.playerB);
    b.opponents.push(m.playerA);
  }

  const points = (t: Tally) => t.wins * cfg.winPoints + t.draws * cfg.drawPoints + t.losses * cfg.lossPoints;
  const roundsOf = (t: Tally) => t.wins + t.losses + t.draws;

  // MW%/GW% as seen by opponents: bye rounds removed, then floored.
  const oppMwp = new Map<string, number>();
  const oppGwp = new Map<string, number>();
  for (const [id, t] of tallies) {
    const rounds = roundsOf(t) - t.byes;
    const pts = points(t) - t.byes * cfg.winPoints;
    const mwp = rounds === 0 ? 0 : pts / (cfg.winPoints * rounds);
    const gwp = gameWinPercent(
      t.gamesWon - t.byes * cfg.byeGamesWon,
      t.gamesLost - t.byes * cfg.byeGamesLost,
      t.gamesDrawn,
    );
    oppMwp.set(id, Math.max(cfg.winPercentFloor, mwp));
    oppGwp.set(id, Math.max(cfg.winPercentFloor, gwp));
  }

  const avg = (ids: string[], table: Map<string, number>) =>
    ids.length === 0 ? 0 : ids.reduce((s, id) => s + (table.get(id) as number), 0) / ids.length;

  // Random tiebreak keys, drawn in a fixed order.
  const randomKey = new Map<string, number>();
  for (const id of [...tallies.keys()].sort()) randomKey.set(id, rng());

  const dropped = new Map(players.map((p) => [p.id, Boolean(p.dropped)]));
  const rows: SwissStanding[] = [...tallies].map(([id, t]) => {
    const rounds = roundsOf(t);
    const mp = points(t);
    return {
      playerId: id,
      rank: 0,
      matchPoints: mp,
      wins: t.wins,
      losses: t.losses,
      draws: t.draws,
      record: `${t.wins}-${t.losses}-${t.draws}`,
      byes: t.byes,
      matchesPlayed: rounds,
      gamesWon: t.gamesWon,
      gamesLost: t.gamesLost,
      gamesDrawn: t.gamesDrawn,
      mwp: rounds === 0 ? 0 : mp / (cfg.winPoints * rounds),
      omwp: avg(t.opponents, oppMwp),
      gwp: gameWinPercent(t.gamesWon, t.gamesLost, t.gamesDrawn),
      ogwp: avg(t.opponents, oppGwp),
      dropped: dropped.get(id) ?? false,
    };
  });

  const cmpPct = (x: number, y: number) => (Math.abs(x - y) < EPS ? 0 : y - x);
  rows.sort(
    (x, y) =>
      y.matchPoints - x.matchPoints ||
      cmpPct(x.omwp, y.omwp) ||
      cmpPct(x.gwp, y.gwp) ||
      cmpPct(x.ogwp, y.ogwp) ||
      (randomKey.get(x.playerId) as number) - (randomKey.get(y.playerId) as number) ||
      (x.playerId < y.playerId ? -1 : x.playerId > y.playerId ? 1 : 0),
  );
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

// ---------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------

// Cost tiers. Each tier dominates the sum of every tier below it for fields
// up to 512 players and 9 rounds (max point gap 27 → 729 per pair).
/** Rematch, only in the fallback when no rematch-free perfect pairing exists. */
const COST_REMATCH = 1e12;
/** Giving a player a second (or later) bye. */
const COST_SECOND_BYE = 1e10;
/** Per rank position above the bottom for the bye recipient. */
const COST_BYE_RANK = 1e6;
/** Multiplied by the squared match-point gap of a pair. */
const COST_GAP = 1;
/** Every edge weight is BASE − cost, so all weights stay positive. */
const WEIGHT_BASE = COST_REMATCH + COST_SECOND_BYE + 1e9;

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

interface History {
  played: Set<string>;
  byeCount: Map<string, number>;
}

function buildHistory(history: PairingHistoryEntry[]): History {
  const played = new Set<string>();
  const byeCount = new Map<string, number>();
  for (const m of history) {
    if (m.playerB === null) byeCount.set(m.playerA, (byeCount.get(m.playerA) ?? 0) + 1);
    else played.add(pairKey(m.playerA, m.playerB));
  }
  return { played, byeCount };
}

interface Entrant {
  id: string;
  points: number;
  /** Standings rank; unranked players sort after everyone. */
  rank: number;
  hadBye: boolean;
}

/**
 * Active players best-first: standings rank, unranked players last in id
 * order. Returns entrants and an index by id.
 */
function rankedEntrants(players: SwissPlayer[], standings: SwissStanding[], hist: History): Entrant[] {
  const byId = new Map(standings.map((s) => [s.playerId, s]));
  const seen = new Set<string>();
  const out: Entrant[] = [];
  for (const p of players) {
    if (p.dropped) continue;
    if (seen.has(p.id)) throw new Error(`pairRound: duplicate player ${p.id}`);
    seen.add(p.id);
    const s = byId.get(p.id);
    out.push({
      id: p.id,
      points: s?.matchPoints ?? 0,
      rank: s?.rank ?? Number.POSITIVE_INFINITY,
      hadBye: (hist.byeCount.get(p.id) ?? 0) > 0,
    });
  }
  out.sort((a, b) => a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/**
 * Min-cost perfect matching over `order` (+ a bye vertex when odd).
 * Returns null when no perfect matching exists under `allowRematch`.
 */
function weightedPairing(
  order: Entrant[],
  hist: History,
  allowRematch: boolean,
): { pairs: [Entrant, Entrant][]; bye: Entrant | null } | null {
  const n = order.length;
  const odd = n % 2 === 1;
  const byeVertex = n;
  const edges: WeightedEdge[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const rematch = hist.played.has(pairKey(order[i].id, order[j].id));
      if (rematch && !allowRematch) continue;
      const gap = order[i].points - order[j].points;
      const cost = COST_GAP * gap * gap + (rematch ? COST_REMATCH : 0);
      edges.push([i, j, WEIGHT_BASE - cost]);
    }
  }
  if (odd) {
    // Rank position from the bottom: the lowest-ranked player costs 0.
    const byRank = [...order].sort((a, b) => b.rank - a.rank || (a.id < b.id ? 1 : -1));
    const fromBottom = new Map(byRank.map((e, idx) => [e.id, idx]));
    for (let i = 0; i < n; i++) {
      const e = order[i];
      const cost = (e.hadBye ? COST_SECOND_BYE : 0) + COST_BYE_RANK * (fromBottom.get(e.id) as number);
      edges.push([i, byeVertex, WEIGHT_BASE - cost]);
    }
  }
  const vertexCount = n + (odd ? 1 : 0);
  const mate = maxWeightMatching(edges, true, vertexCount);
  if (mate.some((m) => m === -1)) return null;

  const pairs: [Entrant, Entrant][] = [];
  let bye: Entrant | null = null;
  for (let i = 0; i < n; i++) {
    const m = mate[i];
    if (m === byeVertex && odd) bye = order[i];
    else if (m > i) pairs.push([order[i], order[m]]);
  }
  return { pairs, bye };
}

/** True when the given players admit a rematch-free perfect matching. */
function rematchFreeExists(group: Entrant[], hist: History): boolean {
  if (group.length === 0) return true;
  if (group.length % 2 === 1) return false;
  const edges: WeightedEdge[] = [];
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      if (!hist.played.has(pairKey(group[i].id, group[j].id))) edges.push([i, j, 1]);
    }
  }
  const mate = maxWeightMatching(edges, true, group.length);
  return mate.every((m) => m !== -1);
}

/**
 * Final-round power pairing: 1v2, 3v4, ... in rank order, each player taking
 * the best-ranked remaining opponent that is not a rematch and still leaves a
 * rematch-free pairing for everyone below. Null when no rematch-free pairing
 * exists at all.
 */
function powerPairing(
  ranked: Entrant[],
  hist: History,
): { pairs: [Entrant, Entrant][]; bye: Entrant | null } | null {
  let pool = ranked;
  let bye: Entrant | null = null;
  if (pool.length % 2 === 1) {
    // Bye: lowest-ranked player without a bye, then lowest-ranked overall,
    // as long as the rest can still be paired without rematches.
    const candidates = [
      ...[...pool].reverse().filter((e) => !e.hadBye),
      ...[...pool].reverse().filter((e) => e.hadBye),
    ];
    for (const c of candidates) {
      const rest = pool.filter((e) => e !== c);
      if (rematchFreeExists(rest, hist)) {
        bye = c;
        pool = rest;
        break;
      }
    }
    if (!bye) return null;
  } else if (!rematchFreeExists(pool, hist)) {
    return null;
  }

  const pairs: [Entrant, Entrant][] = [];
  let remaining = pool;
  while (remaining.length) {
    const top = remaining[0];
    let chosen: Entrant | null = null;
    for (let k = 1; k < remaining.length; k++) {
      const cand = remaining[k];
      if (hist.played.has(pairKey(top.id, cand.id))) continue;
      const rest = remaining.filter((e) => e !== top && e !== cand);
      if (rematchFreeExists(rest, hist)) {
        chosen = cand;
        break;
      }
    }
    // Unreachable: feasibility was established before the loop.
    if (!chosen) return null;
    pairs.push([top, chosen]);
    remaining = remaining.filter((e) => e !== top && e !== chosen);
  }
  return { pairs, bye };
}

/**
 * Pair a round.
 *
 * - Round 1: seeded shuffle; with an odd count the last shuffled player gets the bye.
 * - Later rounds: maximum-weight perfect matching over all active players.
 *   Rematch edges are left out entirely; only if that leaves no perfect
 *   matching are they added back with a very heavy penalty. Within that,
 *   costs are (most to least important) second bye, bye not going to the
 *   lowest-ranked player, squared match-point gap. Equal-cost choices are
 *   broken by a seeded order of players within each score group.
 * - Final round with power pairing: 1v2, 3v4, ... skipping rematches
 *   (see powerPairing); falls back to the weighted pairing if no
 *   rematch-free pairing exists.
 *
 * Dropped players are never paired. Pairs are returned best table first,
 * higher-ranked player as A.
 */
export function pairRound(input: PairRoundInput): PairRoundResult {
  const { players, matchHistory, standings, roundNumber, isFinalRound, powerPairFinal, seed } = input;
  const hist = buildHistory(roundNumber === 1 ? [] : matchHistory);
  const ranked = rankedEntrants(players, standings, hist);
  const rng = createRng(`${seed}:round:${roundNumber}`);

  let pairs: [Entrant, Entrant][];
  let bye: Entrant | null;

  if (roundNumber === 1) {
    const byId = [...ranked].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const shuffled = seededShuffle(byId, rng);
    bye = shuffled.length % 2 === 1 ? (shuffled.pop() as Entrant) : null;
    pairs = [];
    for (let i = 0; i < shuffled.length; i += 2) pairs.push([shuffled[i], shuffled[i + 1]]);
    return finish(pairs, bye, hist, false);
  }

  const power = isFinalRound && powerPairFinal ? powerPairing(ranked, hist) : null;
  if (power) {
    ({ pairs, bye } = power);
  } else {
    // Seeded order within each score group, best group first.
    const keys = new Map<string, number>();
    for (const e of [...ranked].sort((a, b) => (a.id < b.id ? -1 : 1))) keys.set(e.id, rng());
    const order = [...ranked].sort(
      (a, b) => b.points - a.points || (keys.get(a.id) as number) - (keys.get(b.id) as number),
    );
    const result = weightedPairing(order, hist, false) ?? weightedPairing(order, hist, true);
    if (!result) throw new Error("pairRound: no pairing found (internal error)");
    ({ pairs, bye } = result);
  }
  return finish(pairs, bye, hist, true);
}

function finish(
  rawPairs: [Entrant, Entrant][],
  bye: Entrant | null,
  hist: History,
  sortByRank: boolean,
): PairRoundResult {
  const pairs = rawPairs.map(([a, b]) => (sortByRank && b.rank < a.rank ? [b, a] : [a, b]) as [Entrant, Entrant]);
  if (sortByRank) pairs.sort((x, y) => x[0].rank - y[0].rank || (x[0].id < y[0].id ? -1 : 1));
  const warnings: SwissWarning[] = [];
  for (const [a, b] of pairs) {
    if (hist.played.has(pairKey(a.id, b.id))) {
      warnings.push({
        code: "rematch",
        message: `${a.id} and ${b.id} have already played; no rematch-free pairing exists.`,
        playerIds: [a.id, b.id],
      });
    }
  }
  if (bye && bye.hadBye) {
    warnings.push({
      code: "second_bye",
      message: `${bye.id} receives a second bye; no alternative exists.`,
      playerIds: [bye.id],
    });
  }
  const pairings: Pairing[] = pairs.map(([a, b]) => [a.id, b.id]);
  if (bye) pairings.push([bye.id, null]);
  return { pairings, byeId: bye ? bye.id : null, warnings };
}

/**
 * Check operator-edited pairings. Warns on players appearing more than once,
 * rematches, and opponents on different match points. Never throws.
 */
export function validateManualPairings(
  pairings: Pairing[],
  history: PairingHistoryEntry[],
  standings: SwissStanding[],
): SwissWarning[] {
  const hist = buildHistory(history);
  const pointsOf = new Map(standings.map((s) => [s.playerId, s.matchPoints]));
  const warnings: SwissWarning[] = [];

  const count = new Map<string, number>();
  for (const [a, b] of pairings) {
    count.set(a, (count.get(a) ?? 0) + 1);
    if (b !== null) count.set(b, (count.get(b) ?? 0) + 1);
  }
  for (const [id, c] of count) {
    if (c > 1) {
      warnings.push({
        code: "duplicate_player",
        message: `${id} appears ${c} times in this round.`,
        playerIds: [id],
      });
    }
  }

  for (const [a, b] of pairings) {
    if (b === null || a === b) continue;
    if (hist.played.has(pairKey(a, b))) {
      warnings.push({ code: "rematch", message: `${a} and ${b} have already played.`, playerIds: [a, b] });
    }
    const pa = pointsOf.get(a) ?? 0;
    const pb = pointsOf.get(b) ?? 0;
    if (pa !== pb) {
      warnings.push({
        code: "point_mismatch",
        message: `${a} (${pa} pts) is paired with ${b} (${pb} pts).`,
        playerIds: [a, b],
      });
    }
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Event shape
// ---------------------------------------------------------------------------

/** Swiss round count: the configured number, or the player-count preset. */
export function resolveRoundCount(playerCount: number, config: Partial<SwissConfig>): number {
  const cfg = resolveConfig(config);
  if (cfg.swissRounds !== "auto") return cfg.swissRounds;
  return suggestedRoundsForPlayers(playerCount) ?? Math.max(1, Math.ceil(Math.log2(Math.max(playerCount, 2))));
}

/**
 * Top-cut size. "auto": none for up to 6 players, top 4 for 7–16, top 8 for
 * 17+. An explicit size larger than the field shrinks to the largest of
 * 8 / 4 / 0 that fits.
 */
export function resolveTopCutSize(playerCount: number, config: Partial<SwissConfig>): 0 | 4 | 8 {
  const cfg = resolveConfig(config);
  if (cfg.topCut === "auto") {
    if (playerCount >= 17) return 8;
    if (playerCount >= 7) return 4;
    return 0;
  }
  if (cfg.topCut === 8 && playerCount >= 8) return 8;
  if (cfg.topCut >= 4 && playerCount >= 4) return 4;
  return 0;
}

/**
 * Player ids for the top cut in seed order (index 0 = seed 1), ready for
 * buildKnockoutBracket in src/lib/bracket-engine.ts. Dropped players are
 * skipped and the next-ranked player moves up.
 */
export function topCutSeeds(standings: SwissStanding[], size: number): string[] {
  return [...standings]
    .sort((a, b) => a.rank - b.rank)
    .filter((s) => !s.dropped)
    .slice(0, size)
    .map((s) => s.playerId);
}
