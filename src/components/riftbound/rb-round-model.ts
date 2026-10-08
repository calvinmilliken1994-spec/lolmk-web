// Pure logic for the Riftbound round desk (Swiss rounds workspace): table
// tiles and their states, filters, the keyboard table jump, draft pairing
// warnings, the activity log with its Undo rule, the "auto-follow next"
// panel and the desk-side idempotency key. No React, no server actions, so
// scripts/test-rb-round.ts can load it under node.
//
// Relative imports (not "@/") for the same reason as rb-deck-model.ts.
// The clock comes from rb-clock.ts, not rb-db.ts: rb-db pulls in the
// Postgres driver and can't be bundled for the client.

import { isTimeCalled, clockRemainingMs } from "../../lib/rb-clock";
import { validateManualPairings, type Pairing, type SwissWarningCode } from "../../lib/swiss-engine";
import {
  RB_DESK_FLAG_KINDS,
  type RbAuditLogEntry,
  type RbDeskFlag,
  type RbDeskFlagKind,
  type RbMatch,
  type RbMatchFlag,
  type RbPlayer,
  type RbRound,
  type RbRoundStage,
  type RbScene,
} from "../../types/riftbound";
import { rbCutSize, rbSwissTotal, RB_SCENE_LABEL, type RbDeskState } from "./rb-deck-model";

// ---------------------------------------------------------------------------
// Lookups and formatting
// ---------------------------------------------------------------------------

export const playerName = (state: Pick<RbDeskState, "players">, id: string | null | undefined): string =>
  (id && state.players.find((p) => p.id === id)?.display_name) || "—";

export const roundMatches = (state: Pick<RbDeskState, "matches">, round: RbRound): RbMatch[] =>
  state.matches.filter((m) => m.round_id === round.id).sort((a, b) => a.table_number - b.table_number);

/** The Swiss round the round desk shows: the latest one. */
export function rbSwissRound(state: Pick<RbDeskState, "rounds">): RbRound | null {
  return [...state.rounds].filter((r) => r.stage === "swiss").sort((a, b) => a.number - b.number).at(-1) ?? null;
}

/** The round the top-bar clock belongs to: the latest round, while it is published or live. */
export function rbClockRound(state: Pick<RbDeskState, "rounds">): RbRound | null {
  const latest = [...state.rounds].sort((a, b) => a.number - b.number).at(-1) ?? null;
  return latest && (latest.status === "published" || latest.status === "live") ? latest : null;
}

/** mm:ss, minutes unbounded ("60:00"). Null (no time limit) shows dashes. */
export function formatClock(ms: number | null): string {
  if (ms === null) return "--:--";
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** "+3:00" for an extension or clock adjustment (sign included). */
export function formatDelta(ms: number): string {
  const sign = ms < 0 ? "−" : "+";
  const total = Math.round(Math.abs(ms) / 1000);
  return `${sign}${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export const kstTime = (iso: string | number): string =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(iso)) + " KST";

/**
 * A key for one desk submission. Generated when the score sheet opens and
 * reused for its retries, so a double tap or a retry after a lost response
 * is a duplicate the server ignores. `crypto.randomUUID` only exists in
 * secure contexts and the desk is often opened over plain http on the LAN,
 * hence the fallback. The floor passes its own prefix.
 */
export function newDeskKey(prefix = "desk"): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return `${prefix}-${c.randomUUID()}`;
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return `${prefix}-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

export const isDeskFlag = (f: RbMatchFlag): f is RbDeskFlag =>
  "id" in f && RB_DESK_FLAG_KINDS.includes(f.kind as RbDeskFlagKind);

/** Desk flags nobody has acknowledged yet. */
export const openFlags = (m: RbMatch): RbDeskFlag[] => m.flags.filter(isDeskFlag).filter((f) => !f.acknowledged_at);

export const FLAG_LABEL: Record<RbDeskFlagKind, string> = {
  no_show: "No-show",
  judge_call: "Judge call",
  deck_check: "Deck check",
  head_judge: "Need head judge",
  dispute: "Dispute",
  other: "Flagged",
};

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** Games needed to win the match. */
export const winsNeeded = (bestOf: 1 | 3): number => (bestOf === 3 ? 2 : 1);

/**
 * Whether a result was decided on time: nobody reached the wins needed and
 * the games aren't level. The server requires the flag for exactly these
 * scores (a time-out lead such as 1–0), so the desk derives it instead of
 * asking.
 */
export function isTimeOutResult(bestOf: 1 | 3, gamesA: number, gamesB: number): boolean {
  const needed = winsNeeded(bestOf);
  return gamesA < needed && gamesB < needed && gamesA !== gamesB;
}

/** "Aria wins 2–0", "Draw 1–1", "Aria wins 1–0 on time". */
export function resultPhrase(nameA: string, nameB: string, a: number, b: number, onTime: boolean): string {
  if (a === b) return `Draw ${a}–${b}`;
  const aWins = a > b;
  return `${aWins ? nameA : nameB} wins ${aWins ? a : b}–${aWins ? b : a}${onTime ? " on time" : ""}`;
}

// ---------------------------------------------------------------------------
// Table tiles
// ---------------------------------------------------------------------------

/**
 * reported — result in; playing — clock running; waiting — published, clock
 * not started; flagged — an open desk flag; over_time — time called for this
 * table (derived, never stored); bye.
 */
export type RbTileKind = "reported" | "playing" | "waiting" | "flagged" | "over_time" | "bye";

export interface RbTile {
  matchId: string;
  table: number;
  kind: RbTileKind;
  /** The mono tag on the tile: REPORTED, PLAYING, JUDGE CALL, … */
  tag: string;
  nameA: string;
  /** Null = bye. */
  nameB: string | null;
  line: string;
  /** Has an open desk flag (reported tables can still carry one). */
  flagged: boolean;
  /** No result yet and not a bye. */
  outstanding: boolean;
}

export function rbTile(state: RbDeskState, round: RbRound, m: RbMatch, now: number | null): RbTile {
  const nameA = playerName(state, m.player_a_id);
  const nameB = m.player_b_id ? playerName(state, m.player_b_id) : null;
  const flags = openFlags(m);
  const ext = m.extension_ms > 0 ? ` · ${formatDelta(m.extension_ms)}` : "";
  const base = { matchId: m.id, table: m.table_number, nameA, nameB, flagged: flags.length > 0 };

  if (m.status === "bye") {
    const { byeGamesWon, byeGamesLost } = state.tournament.config.scoring;
    return { ...base, kind: "bye", tag: "BYE", line: `Bye · auto ${byeGamesWon}–${byeGamesLost}`, outstanding: false };
  }

  if (m.status === "completed") {
    const a = m.games_a;
    const b = m.games_b;
    const who = a === b ? "Draw" : a > b ? nameA : (nameB ?? "—");
    const score = `${Math.max(a, b)}–${Math.min(a, b)}`;
    const timeOut = m.decided_on_time && a !== b ? " (time)" : "";
    return {
      ...base,
      kind: "reported",
      tag: "REPORTED",
      line: `${who} ${score}${timeOut} · ${m.reported_by_name ?? "?"}`,
      outstanding: false,
    };
  }

  if (flags.length > 0) {
    const f = flags[0];
    return {
      ...base,
      kind: "flagged",
      tag: FLAG_LABEL[f.kind].toUpperCase(),
      line: `${FLAG_LABEL[f.kind]}${ext}`,
      outstanding: true,
    };
  }

  if (round.status === "live" && round.started_at && now !== null) {
    if (isTimeCalled(round, m, now)) {
      return { ...base, kind: "over_time", tag: "OVER TIME", line: `Time called${ext}`, outstanding: true };
    }
    const left = formatClock(clockRemainingMs(round, m, now));
    return {
      ...base,
      kind: "playing",
      tag: "PLAYING",
      line: `${round.paused_at ? "Paused · " : ""}${left} left${ext}`,
      outstanding: true,
    };
  }
  return { ...base, kind: "waiting", tag: "WAITING", line: `Clock not started${ext}`, outstanding: true };
}

export function rbRoundTiles(state: RbDeskState, round: RbRound, now: number | null): RbTile[] {
  return roundMatches(state, round).map((m) => rbTile(state, round, m, now));
}

export type RbFilter = "all" | "outstanding" | "flagged";

export function rbFilterTiles(tiles: RbTile[], filter: RbFilter): RbTile[] {
  if (filter === "outstanding") return tiles.filter((t) => t.outstanding);
  if (filter === "flagged") return tiles.filter((t) => t.flagged);
  return tiles;
}

export function rbTileCounts(tiles: RbTile[]): { all: number; outstanding: number; flagged: number; reported: number } {
  const outstanding = tiles.filter((t) => t.outstanding).length;
  return {
    all: tiles.length,
    outstanding,
    flagged: tiles.filter((t) => t.flagged).length,
    // Byes count as reported, as in the reference ("11 of 16 reported").
    reported: tiles.length - outstanding,
  };
}

// ---------------------------------------------------------------------------
// Keyboard table jump
// ---------------------------------------------------------------------------

export interface RbResultKey {
  key: string;
  label: string;
  gamesA: number;
  gamesB: number;
}

/**
 * The result keys after a table number, left to right as on the pad: `a`
 * A wins 2–0, `s` A 2–1, `k` B 2–1, `l` B 2–0, `d` draw. Best of 1 has `a`,
 * `l` and `d`. Time-out leads and other scores go through the sheet.
 */
export function rbResultKeys(bestOf: 1 | 3): RbResultKey[] {
  if (bestOf === 1) {
    return [
      { key: "a", label: "A wins", gamesA: 1, gamesB: 0 },
      { key: "l", label: "B wins", gamesA: 0, gamesB: 1 },
      { key: "d", label: "Draw", gamesA: 0, gamesB: 0 },
    ];
  }
  return [
    { key: "a", label: "A 2–0", gamesA: 2, gamesB: 0 },
    { key: "s", label: "A 2–1", gamesA: 2, gamesB: 1 },
    { key: "k", label: "B 2–1", gamesA: 1, gamesB: 2 },
    { key: "l", label: "B 2–0", gamesA: 0, gamesB: 2 },
    { key: "d", label: "Draw 1–1", gamesA: 1, gamesB: 1 },
  ];
}

export function rbResultForKey(bestOf: 1 | 3, key: string): RbResultKey | null {
  return rbResultKeys(bestOf).find((k) => k.key === key.toLowerCase()) ?? null;
}

// ---------------------------------------------------------------------------
// Draft round: pairings and their warnings
// ---------------------------------------------------------------------------

export type RbDraftWarningCode = SwissWarningCode;

export interface RbDraftWarning {
  code: RbDraftWarningCode;
  message: string;
  /** The table the warning belongs to (null if it can't be placed). */
  matchId: string | null;
  playerIds: string[];
}

const matchPointsOf = (state: RbDeskState, id: string): number =>
  state.standings.find((s) => s.playerId === id)?.matchPoints ?? 0;

/**
 * validateManualPairings over the draft round (the same check swapDraftPairing
 * runs server-side), with names instead of ids, plus the second-bye check the
 * manual validator doesn't do. Computed from state rather than kept from the
 * swap response so the warnings are still there after a reload.
 */
export function rbDraftWarnings(state: RbDeskState, round: RbRound): RbDraftWarning[] {
  const ms = roundMatches(state, round);
  const pairings: Pairing[] = ms.map((m) => [m.player_a_id, m.player_b_id]);

  const visible = new Set(state.rounds.filter((r) => r.stage === "swiss" && r.status !== "draft").map((r) => r.id));
  const past = state.matches.filter((m) => visible.has(m.round_id) && m.status !== "pending");
  const history = past.map((m) => ({ playerA: m.player_a_id, playerB: m.player_b_id }));

  const tableOf = (ids: string[]): string | null =>
    ms.find((m) => ids.some((id) => m.player_a_id === id || m.player_b_id === id))?.id ?? null;
  const n = (id: string) => playerName(state, id);

  const out: RbDraftWarning[] = validateManualPairings(pairings, history, state.standings).map((w) => {
    const [a, b] = w.playerIds;
    let message = w.message;
    if (w.code === "rematch") message = `${n(a)} and ${n(b)} have already played each other.`;
    else if (w.code === "point_mismatch") {
      message = `${n(a)} (${matchPointsOf(state, a)} pts) is paired with ${n(b)} (${matchPointsOf(state, b)} pts).`;
    } else if (w.code === "duplicate_player") message = `${n(a)} appears more than once in this round.`;
    return { code: w.code, message, matchId: tableOf(w.playerIds), playerIds: w.playerIds };
  });

  for (const m of ms) {
    if (m.player_b_id !== null) continue;
    if (past.some((p) => p.status === "bye" && p.player_a_id === m.player_a_id)) {
      out.push({
        code: "second_bye",
        message: `${n(m.player_a_id)} already had a bye this event.`,
        matchId: m.id,
        playerIds: [m.player_a_id],
      });
    }
  }
  return out;
}

export interface RbDraftRow {
  matchId: string;
  table: number;
  aId: string;
  aName: string;
  aPoints: number;
  bId: string | null;
  bName: string | null;
  bPoints: number | null;
  warnings: RbDraftWarning[];
}

export function rbDraftRows(state: RbDeskState, round: RbRound): RbDraftRow[] {
  const warnings = rbDraftWarnings(state, round);
  return roundMatches(state, round).map((m) => ({
    matchId: m.id,
    table: m.table_number,
    aId: m.player_a_id,
    aName: playerName(state, m.player_a_id),
    aPoints: matchPointsOf(state, m.player_a_id),
    bId: m.player_b_id,
    bName: m.player_b_id ? playerName(state, m.player_b_id) : null,
    bPoints: m.player_b_id ? matchPointsOf(state, m.player_b_id) : null,
    warnings: warnings.filter((w) => w.matchId === m.id),
  }));
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

/** What Undo does for an entry. */
export type RbUndo =
  | {
      kind: "report";
      matchId: string;
      /** Which undo applies: a top-cut table is undone by its own action. */
      stage: RbRoundStage;
      /** Drops recorded with the report, undone with it. */
      dropPlayerIds: string[];
    }
  | { kind: "unpublish"; roundId: string }
  | { kind: "drop"; playerId: string };

export interface RbActivityRow {
  id: string;
  at: string;
  actor: string;
  text: string;
  reversible: boolean;
  undo: RbUndo | null;
}

const asNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const asStr = (v: unknown): string | null => (typeof v === "string" ? v : null);
const asIds = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * The newest audit entries as log lines. An entry is reversible when what it
 * did is still the current state of its subject and the server would accept
 * the undo (behaviour.md: result reports, un-publishing a round with no
 * results, drops; cuts, completes and disqualifications are one-way). The
 * ActivityLog component then shows Undo on the newest reversible one only.
 */
export function rbActivity(state: RbDeskState, visible = 4): RbActivityRow[] {
  const audit = [...state.audit].sort((a, b) => b.id - a.id);
  const roundByNumber = (n: number | null) => (n === null ? undefined : state.rounds.find((r) => r.number === n));
  const playerById = (id: string | null) => (id ? state.players.find((p) => p.id === id) : undefined);

  // The newest report/undo and publish/unpublish and drop/undrop entry per subject.
  const newestFor = (actions: string[], subject: (e: RbAuditLogEntry) => string | null) => {
    const seen = new Map<string, number>();
    for (const e of audit) {
      if (!actions.includes(e.action)) continue;
      const key = subject(e);
      if (key !== null && !seen.has(key)) seen.set(key, e.id);
    }
    return seen;
  };
  const newestMatch = newestFor(["match.report", "match.undo"], (e) => asStr(e.detail?.matchId));
  const newestPublish = newestFor(["round.publish", "round.unpublish"], (e) => String(asNum(e.detail?.round)));
  const newestDrop = newestFor(["player.drop", "player.undrop"], (e) => asStr(e.detail?.playerId));

  const rows: RbActivityRow[] = [];
  for (const e of audit) {
    const d = e.detail ?? {};
    const table = asNum(d.table);
    const roundNo = asNum(d.round);
    let text: string | null = null;
    let undo: RbUndo | null = null;

    switch (e.action) {
      case "match.report": {
        const matchId = asStr(d.matchId);
        const m = state.matches.find((x) => x.id === matchId);
        const a = asNum(d.gamesA) ?? 0;
        const b = asNum(d.gamesB) ?? 0;
        const drops = asIds(d.drops);
        const result = m
          ? resultPhrase(playerName(state, m.player_a_id), playerName(state, m.player_b_id), a, b, d.decidedOnTime === true && a !== b)
          : `${a}–${b} reported`;
        const dropText = drops.length ? ` · ${drops.map((id) => playerName(state, id)).join(", ")} drop${drops.length === 1 ? "s" : ""} after round` : "";
        text = `Table ${table ?? "?"} · ${result}${dropText}`;
        const round = m ? state.rounds.find((r) => r.id === m.round_id) : undefined;
        if (m && round && matchId && m.status === "completed" && round.status !== "closed" && newestMatch.get(matchId) === e.id) {
          undo = {
            kind: "report",
            matchId,
            stage: round.stage,
            dropPlayerIds: drops.filter((id) => playerById(id)?.status === "dropped"),
          };
        }
        break;
      }
      case "match.undo":
        text = `Table ${table ?? "?"} · result undone`;
        break;
      case "match.start":
        text = `Table ${table ?? "?"} · marked live`;
        break;
      case "match.unstart":
        text = `Table ${table ?? "?"} · live mark removed`;
        break;
      case "match.extension":
        text = `Table ${table ?? "?"} · ${formatDelta(asNum(d.ms) ?? 0)} extension${asStr(d.reason) ? ` (${asStr(d.reason)})` : ""}`;
        break;
      case "match.flag":
        text = `Table ${table ?? "?"} · ${FLAG_LABEL[(asStr(d.kind) as RbDeskFlagKind) ?? "other"] ?? "Flagged"}${asStr(d.note) ? `: ${asStr(d.note)}` : ""}`;
        break;
      case "match.flag_ack":
        text = `Table ${table ?? "?"} · flag acknowledged`;
        break;
      case "player.drop": {
        if (asStr(d.viaReport)) break; // shown on the report line
        const id = asStr(d.playerId);
        const p = playerById(id);
        text = `${playerName(state, id)} drops after round ${asNum(d.afterRound) ?? "?"}`;
        if (p && id && p.status === "dropped" && newestDrop.get(id) === e.id && !state.tournament.config.topCutSeedIds) {
          const after = p.dropped_after_round ?? 0;
          if (state.rounds.filter((r) => r.number > after).every((r) => r.status === "draft")) undo = { kind: "drop", playerId: id };
        }
        break;
      }
      case "player.dq":
        text = `${playerName(state, asStr(d.playerId))} disqualified`;
        break;
      case "player.undrop":
        text = `${playerName(state, asStr(d.playerId))} re-entered`;
        break;
      case "round.pair":
        text = `Round ${roundNo ?? "?"} paired · ${asNum(d.tables) ?? "?"} tables`;
        break;
      case "round.override": {
        const swap = asIds(d.swap);
        text = `Round ${roundNo ?? "?"} · swapped ${swap.map((id) => playerName(state, id)).join(" and ")}`;
        break;
      }
      case "round.publish": {
        text = `Round ${roundNo ?? "?"} published`;
        const r = roundByNumber(roundNo);
        if (
          r &&
          roundNo !== null &&
          r.status === "published" &&
          newestPublish.get(String(roundNo)) === e.id &&
          !state.matches.some((m) => m.round_id === r.id && m.status === "completed")
        ) {
          undo = { kind: "unpublish", roundId: r.id };
        }
        break;
      }
      case "round.unpublish":
        text = `Round ${roundNo ?? "?"} unpublished`;
        break;
      case "round.close":
        text = `Round ${roundNo ?? "?"} closed`;
        break;
      case "clock.start":
        text = `Round ${roundNo ?? "?"} clock started`;
        break;
      case "clock.pause":
        text = `Round ${roundNo ?? "?"} clock paused`;
        break;
      case "clock.resume":
        text = `Round ${roundNo ?? "?"} clock resumed`;
        break;
      case "clock.adjust":
        text = `Round ${roundNo ?? "?"} clock ${formatDelta(asNum(d.deltaMs) ?? 0)}`;
        break;
      case "scene.set": {
        const to = asStr(d.to) as RbScene | null;
        text = `Program scene → ${to ? (RB_SCENE_LABEL[to] ?? to) : "?"}`;
        break;
      }
      case "auto_follow.toggle":
        text = `Auto-follow ${d.enabled === true ? "on" : "off"}`;
        break;
      default:
        break;
    }
    if (text === null) continue;
    rows.push({ id: String(e.id), at: e.created_at, actor: e.actor_name, text, reversible: undo !== null, undo });
  }
  // The reference shows four lines. Show more only when the newest undoable entry is further
  // down, so Undo never disappears behind a burst of newer, non-reversible entries.
  const firstUndo = rows.findIndex((r) => r.reversible);
  return rows.slice(0, Math.max(visible, firstUndo + 1));
}

// ---------------------------------------------------------------------------
// Auto-follow next
// ---------------------------------------------------------------------------

export interface RbFollowStep {
  event: string;
  scene: string;
}

const STEP = {
  published: (n: number): RbFollowStep => ({ event: `Round ${n} published`, scene: "Pairings" }),
  started: { event: "Clock started", scene: "Pairings + clock" } as RbFollowStep,
  zero: { event: "Clock reaches 0", scene: "Time called" } as RbFollowStep,
  closed: { event: "Round closed", scene: "Standings" } as RbFollowStep,
  /** Top-cut rounds keep the bracket up (the venue shows the whole cut on one scene). */
  cutPublished: (n: number): RbFollowStep => ({ event: `Round ${n} published`, scene: "Top-cut bracket" }),
  cutClosed: { event: "Round closed", scene: "Top-cut bracket" } as RbFollowStep,
  cut: (size: number): RbFollowStep => ({ event: "Cut made", scene: `Top ${size} bracket` }),
  done: { event: "Event completed", scene: "Champion" } as RbFollowStep,
};

/**
 * The next two scene changes auto-follow will make from here, in the order
 * of behaviour.md "Auto-follow": published → started → time called → closed
 * → (next round published | cut made) → completed.
 */
export function rbAutoFollowNext(state: RbDeskState, now: number | null): RbFollowStep[] {
  const status = state.tournament.status;
  if (status === "completed" || status === "archived") return [];
  const latest = [...state.rounds].sort((a, b) => a.number - b.number).at(-1) ?? null;
  const steps: RbFollowStep[] = [];

  if (!latest) return [STEP.published(1), STEP.started];

  const timed = latest.duration_ms !== null;
  const cut = latest.stage === "top_cut";
  if (latest.status === "draft") steps.push(cut ? STEP.cutPublished(latest.number) : STEP.published(latest.number), ...(timed ? [STEP.started] : []));
  if (latest.status === "published" && timed) steps.push(STEP.started);
  if (latest.status === "draft" || latest.status === "published") {
    if (timed) steps.push(STEP.zero);
    steps.push(cut ? STEP.cutClosed : STEP.closed);
  } else if (latest.status === "live") {
    const called = now !== null && isTimeCalled(latest, null, now);
    if (timed && !called) steps.push(STEP.zero);
    steps.push(cut ? STEP.cutClosed : STEP.closed);
  }

  // After the round closes.
  const isFinalCutRound = latest.stage === "top_cut" && roundMatches(state, latest).length === 1;
  const swissLeft = latest.stage === "swiss" && state.rounds.filter((r) => r.stage === "swiss").length < rbSwissTotal(state);
  if (isFinalCutRound) steps.push(STEP.done);
  else if (latest.stage === "top_cut") steps.push(STEP.cutPublished(latest.number + 1));
  else if (swissLeft) steps.push(STEP.published(latest.number + 1), STEP.started);
  else {
    const size = state.tournament.config.topCutSeedIds ? 0 : rbCutSize(state);
    if (size > 0) steps.push(STEP.cut(size));
    steps.push(STEP.done);
  }
  return steps.slice(0, 2);
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export const isActivePlayer = (p: RbPlayer | undefined): boolean => p?.status === "active";
