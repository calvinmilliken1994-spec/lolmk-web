// Pure logic behind the venue screen (/rblive/[slug]): which scene to draw,
// the alphabetical pairing pages, the standings split, the round rail and the
// time-called table list. Public data only (RbPublicTournamentFull plus the
// standings /api/rb/state adds). Relative imports so scripts/test-rb-venue.ts
// runs under node --experimental-strip-types.

import type {
  RbPublicMatch,
  RbPublicPlayer,
  RbPublicRound,
  RbPublicTournamentFull,
  RbScene,
} from "../../types/riftbound";
import { clockRemainingMs, isTimeCalled } from "../../lib/rb-clock";
import { rbCutView, type CutView, type RbChampionSummary } from "../../lib/rb-cut";
import { resolveRoundCount, resolveTopCutSize, type SwissStanding } from "../../lib/swiss-engine";

export type RbVenueData = RbPublicTournamentFull & {
  standings: SwissStanding[];
  /** Set once the event is completed: the winner with Legend, seed and records. */
  champion?: RbChampionSummary | null;
  serverNow?: number;
};

/** Everything the screen can draw. The last two exist only as `?scene=` overrides. */
export type RbVenueScene = RbScene | "time-called" | "starting_soon" | "announcement";

export const RB_VENUE_SCENES: RbVenueScene[] = [
  "idle",
  "pairings",
  "pairings_clock",
  "clock",
  "time-called",
  "standings",
  "top_cut",
  "champion",
  "starting_soon",
  "announcement",
];

export const PAIRING_COLUMNS = 3;
export const PAIRING_ROWS = 11;
export const PAIRING_PAGE_SIZE = PAIRING_COLUMNS * PAIRING_ROWS;
export const PAGE_MS = 12_000;
export const STANDINGS_MID_ROWS = 16;

const byNumber = (a: RbPublicRound, b: RbPublicRound) => a.number - b.number;

export function rbParseScene(raw: string | null | undefined): RbVenueScene | null {
  return raw && (RB_VENUE_SCENES as string[]).includes(raw) ? (raw as RbVenueScene) : null;
}

/** Round-offset from the server's clock: add it to Date.now() to get server time. */
export const rbVenueOffset = (serverNow: number | undefined, localNow: number): number =>
  typeof serverNow === "number" ? serverNow - localNow : 0;

/**
 * The round the venue talks about: the running Swiss round, else the latest
 * Swiss round (e.g. just closed, pairings still on the wall), else the latest.
 */
export function rbVenueRound(data: Pick<RbVenueData, "rounds">): RbPublicRound | null {
  const swiss = data.rounds.filter((r) => r.stage === "swiss").sort(byNumber);
  const running = swiss.filter((r) => r.status !== "closed");
  return running.at(-1) ?? swiss.at(-1) ?? [...data.rounds].sort(byNumber).at(-1) ?? null;
}

/**
 * The scene to draw. `override` (from ?scene=) wins and is never written.
 * Otherwise the stored scene, except that pairings_clock / clock turn into the
 * derived time-called scene once the round end has passed. Nothing is stored.
 */
export function rbRenderScene(
  data: Pick<RbVenueData, "tournament" | "rounds">,
  now: number,
  override: RbVenueScene | null = null,
): RbVenueScene {
  if (override) return override;
  const scene = data.tournament.scene;
  if (scene === "pairings_clock" || scene === "clock") {
    const round = rbVenueRound(data);
    if (round && round.status !== "closed" && round.stage === "swiss" && isTimeCalled(round, null, now)) {
      return "time-called";
    }
  }
  return scene;
}

// ---------------------------------------------------------------------------
// Pairings
// ---------------------------------------------------------------------------

export interface RbPairingRow {
  playerId: string;
  name: string;
  /** Opponent's name, or null for a bye. */
  opponent: string | null;
  table: number;
}

const nameKey = (s: string) => s.toLocaleLowerCase("en");

/** One row per seated player, alphabetical by display name (ties by table). */
export function rbPairingRows(
  data: Pick<RbVenueData, "players" | "matches">,
  round: Pick<RbPublicRound, "id"> | null,
): RbPairingRow[] {
  if (!round) return [];
  const name = new Map(data.players.map((p) => [p.id, p.display_name]));
  const rows: RbPairingRow[] = [];
  for (const m of data.matches) {
    if (m.round_id !== round.id) continue;
    const a = name.get(m.player_a_id) ?? "—";
    const b = m.player_b_id ? (name.get(m.player_b_id) ?? "—") : null;
    rows.push({ playerId: m.player_a_id, name: a, opponent: b, table: m.table_number });
    if (m.player_b_id) rows.push({ playerId: m.player_b_id, name: b ?? "—", opponent: a, table: m.table_number });
  }
  return rows.sort(
    (x, y) => nameKey(x.name).localeCompare(nameKey(y.name), "en") || x.table - y.table,
  );
}

export const rbPageCount = (rows: number): number => Math.max(1, Math.ceil(rows / PAIRING_PAGE_SIZE));

/**
 * One page, split into columns that fill top to bottom (A–… down the first
 * column, then the second), like the reference.
 */
export function rbPairingColumns(rows: RbPairingRow[], page: number): RbPairingRow[][] {
  const pages = rbPageCount(rows.length);
  const start = (((page % pages) + pages) % pages) * PAIRING_PAGE_SIZE;
  const slice = rows.slice(start, start + PAIRING_PAGE_SIZE);
  return Array.from({ length: PAIRING_COLUMNS }, (_, c) =>
    slice.slice(c * PAIRING_ROWS, (c + 1) * PAIRING_ROWS),
  );
}

// ---------------------------------------------------------------------------
// Rail
// ---------------------------------------------------------------------------

export interface RbRailItem {
  label: string;
  /** 0..1 */
  progress: number;
  state: "done" | "current" | "upcoming";
}

const isParticipant = (p: RbPublicPlayer) => p.status === "active" || p.status === "dropped";

export function rbSwissTotal(data: Pick<RbVenueData, "tournament" | "players">): number {
  const { config } = data.tournament;
  if (typeof config.swissRounds === "number") return config.swissRounds;
  const n = data.players.filter((p) => p.status !== "dropped").length;
  return resolveRoundCount(Math.max(2, n), { swissRounds: "auto" });
}

export function rbCutSize(data: Pick<RbVenueData, "tournament" | "players">): 0 | 4 | 8 {
  const started = data.tournament.status !== "registration" && data.tournament.status !== "draft";
  const field = started
    ? data.players.filter(isParticipant)
    : data.players.filter((p) => p.status !== "dropped");
  return resolveTopCutSize(field.length, { topCut: data.tournament.config.topCut });
}

/** Share of the round's clock used, 0..1 (1 once closed or past time). */
export function rbRoundProgress(round: RbPublicRound | undefined, now: number): number {
  if (!round) return 0;
  if (round.status === "closed") return 1;
  if (!round.started_at || round.duration_ms === null) return 0;
  const left = clockRemainingMs(round, null, now);
  if (left === null) return 0;
  return Math.min(1, Math.max(0, 1 - left / round.duration_ms));
}

/** Swiss rounds plus the cut. The running round is "current"; earlier ones "done". */
export function rbRail(data: RbVenueData, now: number): RbRailItem[] {
  const total = rbSwissTotal(data);
  const cut = rbCutSize(data);
  const current = rbVenueRound(data);
  const swiss = data.rounds.filter((r) => r.stage === "swiss");
  const items: RbRailItem[] = [];
  for (let n = 1; n <= total; n++) {
    const r = swiss.find((x) => x.number === n);
    const isCurrent = !!current && current.stage === "swiss" && current.number === n && r?.status !== "closed";
    items.push({
      label: `ROUND ${n}`,
      progress: rbRoundProgress(r, now),
      state: r?.status === "closed" ? "done" : isCurrent ? "current" : "upcoming",
    });
  }
  if (cut > 0) {
    const cutRounds = data.rounds.filter((r) => r.stage === "top_cut");
    const running = cutRounds.some((r) => r.status !== "closed");
    items.push({
      label: `TOP ${cut}`,
      progress: cutRounds.length > 0 && !running ? 1 : 0,
      state: running ? "current" : cutRounds.length > 0 ? "done" : "upcoming",
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Time called
// ---------------------------------------------------------------------------

export interface RbTimeCalled {
  /** Tables whose own time is up and whose result isn't in yet, ascending. */
  tables: number[];
  /** Tables still playing on an extension (not yet out of time), ascending. */
  extensions: { table: number; ms: number }[];
}

/**
 * Pending tables of the round, split by their own clock: out of time (listed
 * as still playing) or running on an extension (noted underneath). Time is
 * called for the round, so an extended table is the only way a pending table
 * still has time left.
 */
export function rbTimeCalled(
  data: Pick<RbVenueData, "matches">,
  round: Pick<RbPublicRound, "id" | "started_at" | "paused_at" | "paused_total_ms" | "duration_ms"> | null,
  now: number,
): RbTimeCalled {
  if (!round) return { tables: [], extensions: [] };
  const pending: RbPublicMatch[] = data.matches.filter((m) => m.round_id === round.id && m.status === "pending");
  const over = (m: RbPublicMatch) => {
    const left = clockRemainingMs(round, m, now);
    return left === null || left <= 0;
  };
  const tables = pending.filter(over).map((m) => m.table_number).sort((a, b) => a - b);
  const extensions = pending
    .filter((m) => m.extension_ms > 0 && !over(m))
    .map((m) => ({ table: m.table_number, ms: m.extension_ms }))
    .sort((a, b) => a.table - b.table);
  return { tables, extensions };
}

/** "Table 6 has +3:00 extension" lines. */
export function rbExtensionLine(e: { table: number; ms: number }): string {
  const total = Math.round(e.ms / 1000);
  return `Table ${e.table} has +${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")} extension`;
}

// ---------------------------------------------------------------------------
// Top cut
// ---------------------------------------------------------------------------

/** The bracket for the venue, or null when no cut has been made (the scene then shows standings). */
export function rbVenueCut(data: RbVenueData): CutView | null {
  const seeds = data.tournament.config.topCutSeedIds;
  if (!seeds || seeds.length < 2) return null;
  const names = new Map(data.players.map((p) => [p.id, p.display_name]));
  const records = new Map(data.standings.map((s) => [s.playerId, s.record]));
  try {
    return rbCutView(seeds, data.tournament.config.bestOf, data.rounds, data.matches, names, records);
  } catch {
    // A round that doesn't fit the bracket (should not happen): show standings rather than nothing.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

export interface RbStandingRow {
  rank: number;
  name: string;
  record: string;
  points: number;
  omw: string;
  gw: string;
}

export interface RbVenueStandings {
  title: string;
  subtitle: string;
  /** Number of players advancing when the Swiss is over; 0 otherwise. */
  advancing: number;
  leftHeader: string;
  rightHeader: string;
  left: RbStandingRow[];
  right: RbStandingRow[];
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function rbVenueStandings(data: RbVenueData): RbVenueStandings {
  const names = new Map(data.players.map((p) => [p.id, p.display_name]));
  const total = rbSwissTotal(data);
  const closed = data.rounds.filter((r) => r.stage === "swiss" && r.status === "closed").length;
  const isFinal = closed >= total && total > 0;
  const cut = rbCutSize(data);
  const rows: RbStandingRow[] = [...data.standings]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, STANDINGS_MID_ROWS)
    .map((s) => ({
      rank: s.rank,
      name: names.get(s.playerId) ?? "—",
      record: s.record,
      points: s.matchPoints,
      omw: pct(s.omwp),
      gw: pct(s.gwp),
    }));
  const advancing = isFinal ? cut : 0;
  const left = rows.slice(0, 8);
  const right = rows.slice(8, 16);
  return {
    title: isFinal ? "FINAL SWISS STANDINGS" : "STANDINGS",
    subtitle: `After round ${Math.min(closed, total)} of ${total}`,
    advancing,
    leftHeader: advancing > 0 ? `TOP ${advancing} · ADVANCING` : "1 – 8",
    rightHeader: right.length > 0 ? `${right[0].rank} – ${right[right.length - 1].rank}` : "",
    left,
    right,
  };
}

/** Whether a left-column row sits inside the advancing cut (red rank). */
export const rbAdvances = (rank: number, advancing: number): boolean => advancing > 0 && rank <= advancing;
