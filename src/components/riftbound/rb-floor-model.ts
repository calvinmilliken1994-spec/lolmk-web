// Pure logic for the judges' floor view (src/components/riftbound/rb-floor.tsx):
// which round the floor shows, the judge's table range, the table list order
// and search, going-in records, the review card text and the submission
// queue. No React, no database, so scripts/test-rb-floor.ts can load it under
// node --experimental-strip-types (relative imports for the same reason).

import { clockRemainingMs, isTimeCalled } from "../../lib/rb-clock";
import type { RbJudge, RbMatch, RbPlayer, RbRound } from "../../types/riftbound";
import type { RbDeskState } from "./rb-deck-model";
import { FLAG_LABEL, formatClock, formatDelta, isTimeOutResult, openFlags, playerName, roundMatches } from "./rb-round-model";

// ---------------------------------------------------------------------------
// The round on the floor, and who is judging
// ---------------------------------------------------------------------------

/**
 * The round the floor works on: the latest Swiss round that is published or
 * live. Falls back to the latest closed one (read-only: everything is
 * reported) so the screen isn't blank between rounds; a draft round is never
 * shown, its pairings aren't public yet.
 */
export function rbFloorRound(state: Pick<RbDeskState, "rounds">): RbRound | null {
  const swiss = state.rounds.filter((r) => r.stage === "swiss").sort((a, b) => a.number - b.number);
  const running = swiss.filter((r) => r.status === "published" || r.status === "live").at(-1);
  if (running) return running;
  return swiss.filter((r) => r.status === "closed").at(-1) ?? null;
}

/** The roster entry for the signed-in admin, by name (case-insensitive), or null. */
export function rbJudgeFor(judges: RbJudge[], adminName: string, pickedId: string | null = null): RbJudge | null {
  const picked = pickedId ? judges.find((j) => j.id === pickedId) : undefined;
  if (picked) return picked;
  const name = adminName.trim().toLowerCase();
  return judges.find((j) => j.name.trim().toLowerCase() === name) ?? null;
}

/** A judge with no range, or no judge at all, covers every table. */
export const rbHasRange = (judge: RbJudge | null): boolean => !!judge && (judge.from !== null || judge.to !== null);

export function rbInRange(judge: RbJudge | null, table: number): boolean {
  if (!judge || !rbHasRange(judge)) return true;
  if (judge.from !== null && table < judge.from) return false;
  if (judge.to !== null && table > judge.to) return false;
  return true;
}

/** "tables 1–6", "tables 12+", "all tables". */
export function rbRangeLabel(judge: RbJudge | null): string {
  if (!judge || !rbHasRange(judge)) return "all tables";
  if (judge.from !== null && judge.to !== null) return judge.from === judge.to ? `table ${judge.from}` : `tables ${judge.from}–${judge.to}`;
  if (judge.from !== null) return `tables ${judge.from}+`;
  return `tables 1–${judge.to}`;
}

// ---------------------------------------------------------------------------
// Table list
// ---------------------------------------------------------------------------

export type RbFloorFilter = "mine" | "all" | "flagged";

export type RbFloorRowKind = "flagged" | "playing" | "over_time" | "waiting" | "reported";

export interface RbFloorRow {
  matchId: string;
  table: number;
  kind: RbFloorRowKind;
  /** "Kai vs Lumi" for outstanding tables, "Aria 2–0 Bok" for reported ones. */
  nameA: string;
  nameB: string;
  /** Second line of an outstanding row; the whole text of a reported row. */
  line: string;
  mine: boolean;
  /** Reported rows: this judge sent the result. */
  reportedByMe: boolean;
}

/** Everything the Reported section shows for a result: "Aria 2–0 Bok", "Gyu 1–1 Hana · draw", "Iris 2–0 Jun · Jin". */
export function rbReportedLine(state: RbDeskState, m: RbMatch, adminName: string): string {
  const a = playerName(state, m.player_a_id);
  const b = playerName(state, m.player_b_id);
  const draw = m.games_a === m.games_b;
  const time = m.decided_on_time && !draw ? " (time)" : "";
  const by = m.reported_by_name && m.reported_by_name.toLowerCase() !== adminName.trim().toLowerCase() ? ` · ${m.reported_by_name}` : "";
  return `${a} ${m.games_a}–${m.games_b} ${b}${draw ? " · draw" : ""}${time}${by}`;
}

export function rbFloorRow(
  state: RbDeskState,
  round: RbRound,
  m: RbMatch,
  now: number | null,
  judge: RbJudge | null,
  adminName: string,
): RbFloorRow {
  const nameA = playerName(state, m.player_a_id);
  const nameB = playerName(state, m.player_b_id);
  const mine = rbInRange(judge, m.table_number);
  const base = { matchId: m.id, table: m.table_number, nameA, nameB, mine, reportedByMe: false };
  if (m.status === "completed") {
    return {
      ...base,
      kind: "reported",
      line: rbReportedLine(state, m, adminName),
      reportedByMe: (m.reported_by_name ?? "").toLowerCase() === adminName.trim().toLowerCase(),
    };
  }
  const ext = m.extension_ms > 0 ? ` · ${formatDelta(m.extension_ms)}` : "";
  const away = mine ? "" : " · not your table";
  const flags = openFlags(m);
  if (flags.length > 0) {
    const kinds = Array.from(new Set(flags.map((f) => FLAG_LABEL[f.kind])));
    return { ...base, kind: "flagged", line: `${kinds.join(", ")} open${ext}${away}` };
  }
  if (round.status === "live" && round.started_at && now !== null) {
    if (isTimeCalled(round, m, now)) return { ...base, kind: "over_time", line: `Time called${ext}${away}` };
    const left = formatClock(clockRemainingMs(round, m, now));
    return { ...base, kind: "playing", line: `${round.paused_at ? "Paused" : "Playing"} · ${left} left${ext}${away}` };
  }
  return { ...base, kind: "waiting", line: `Clock not started${ext}${away}` };
}

export interface RbFloorList {
  outstanding: RbFloorRow[];
  reported: RbFloorRow[];
  /** All outstanding tables in the round, whatever the filter (the header's "5 of 16"). */
  outstandingTotal: number;
  total: number;
}

/**
 * The table list: outstanding tables first (open flags at the top, then by
 * table number), reported tables below them.
 *
 * - Mine: tables in the judge's range. A judge with no range sees everything.
 * - All: every table.
 * - Flagged: tables with an open flag.
 * - Search (table number prefix or player name) looks at every table, so a
 *   judge can find a table outside their range ("not your table").
 * - Byes are never listed: there is nothing to report.
 */
export function rbFloorList(
  state: RbDeskState,
  round: RbRound,
  now: number | null,
  opts: { query: string; filter: RbFloorFilter; judge: RbJudge | null; adminName: string },
): RbFloorList {
  const rows = roundMatches(state, round)
    .filter((m) => m.status !== "bye")
    .map((m) => rbFloorRow(state, round, m, now, opts.judge, opts.adminName));
  const q = opts.query.trim().toLowerCase();
  let shown = rows;
  if (q) {
    shown = rows.filter((r) =>
      /^\d+$/.test(q) ? String(r.table).startsWith(q) : `${r.nameA} ${r.nameB}`.toLowerCase().includes(q),
    );
  } else if (opts.filter === "mine") {
    shown = rows.filter((r) => r.mine);
  } else if (opts.filter === "flagged") {
    shown = rows.filter((r) => r.kind === "flagged");
  }
  const rank = (r: RbFloorRow) => (r.kind === "flagged" ? 0 : 1);
  const outstanding = shown
    .filter((r) => r.kind !== "reported")
    .sort((a, b) => rank(a) - rank(b) || a.table - b.table);
  const reported = shown.filter((r) => r.kind === "reported").sort((a, b) => a.table - b.table);
  return {
    outstanding,
    reported,
    outstandingTotal: rows.filter((r) => r.kind !== "reported").length,
    total: rows.length,
  };
}

// ---------------------------------------------------------------------------
// Score pad and review card
// ---------------------------------------------------------------------------

/** "2-0 going in": the record from the standings, which cover every closed round (this table has no result yet). */
export function rbGoingIn(state: Pick<RbDeskState, "standings">, player: RbPlayer | undefined): string {
  const s = state.standings.find((x) => x.playerId === player?.id);
  const w = s?.wins ?? 0;
  const l = s?.losses ?? 0;
  const d = s?.draws ?? 0;
  return `${w}-${l}${d > 0 ? `-${d}` : ""} going in`;
}

export interface RbReview {
  /** "Mina wins", "Draw". */
  headline: string;
  gamesA: number;
  gamesB: number;
  nameA: string;
  nameB: string;
  /** Which side is the winner: the big numbers highlight them. */
  winner: "a" | "b" | null;
  timeLine: string;
  dropLine: string;
}

/** What the review card says. The caller passes the toggles as the server will receive them. */
export function rbReview(
  nameA: string,
  nameB: string,
  score: { gamesA: number; gamesB: number },
  decidedOnTime: boolean,
  dropA: boolean,
  dropB: boolean,
): RbReview {
  const winner = score.gamesA === score.gamesB ? null : score.gamesA > score.gamesB ? "a" : "b";
  const drops = [dropA ? nameA : null, dropB ? nameB : null].filter((n): n is string => !!n);
  return {
    headline: winner === null ? "Draw" : `${winner === "a" ? nameA : nameB} wins`,
    gamesA: score.gamesA,
    gamesB: score.gamesB,
    nameA,
    nameB,
    winner,
    timeLine: decidedOnTime ? "Decided on time" : "Not decided on time",
    dropLine: drops.length ? `${drops.join(" and ")} drop${drops.length === 1 ? "s" : ""} after this round` : "No drops",
  };
}

/** The server needs "decided on time" for a lead that nobody converted; the toggle can't switch it off. */
export const rbDecidedOnTime = (bestOf: 1 | 3, gamesA: number, gamesB: number, toggle: boolean): boolean =>
  toggle || isTimeOutResult(bestOf, gamesA, gamesB);

/** A short id for the review card ("7f3a"): the first four characters after the key's prefix (`floor-`, `desk-`). */
export const rbShortId = (key: string): string => key.replace(/^[a-z]+-/, "").replace(/-/g, "").slice(0, 4);

/** Round-offset from the server's clock: add it to Date.now() to get server time. */
export const rbClockOffset = (serverNow: number | undefined, localNow: number): number =>
  typeof serverNow === "number" ? serverNow - localNow : 0;

// ---------------------------------------------------------------------------
// Submissions: the queue behind "Sending / Sent / Failed"
// ---------------------------------------------------------------------------

export type RbSubmissionStatus = "sending" | "failed" | "rejected" | "conflict" | "sent";

export interface RbSubmissionPayload {
  gamesA: number;
  gamesB: number;
  gamesDrawn: number;
  decidedOnTime: boolean;
  dropA: boolean;
  dropB: boolean;
}

export interface RbSubmission {
  /** The idempotency key. Never changes between retries. */
  key: string;
  matchId: string;
  table: number;
  /** "Mina wins 2–1", for the status line. */
  label: string;
  payload: RbSubmissionPayload;
  status: RbSubmissionStatus;
  /** failed: why the last attempt failed; rejected/conflict: the server's message. */
  error: string | null;
  attempts: number;
  createdAt: number;
}

/** Still has to reach the server (or be given up on by the judge). */
export const rbIsActive = (s: RbSubmission): boolean => s.status === "sending" || s.status === "failed" || s.status === "rejected";

/** The active submission for a table, if any. A second one must not be created while it exists. */
export const rbActiveFor = (list: RbSubmission[], matchId: string): RbSubmission | undefined =>
  list.find((s) => s.matchId === matchId && rbIsActive(s));

/** Adds a submission unless the table already has an active one (a double tap). Returns the list and the one that counts. */
export function rbEnqueue(list: RbSubmission[], sub: RbSubmission): { list: RbSubmission[]; sub: RbSubmission; added: boolean } {
  const existing = rbActiveFor(list, sub.matchId) ?? list.find((s) => s.key === sub.key);
  if (existing) return { list, sub: existing, added: false };
  return { list: [...list, sub], sub, added: true };
}

export type RbSendOutcome =
  | { kind: "sent" }
  | { kind: "conflict"; message: string }
  | { kind: "rejected"; message: string }
  | { kind: "failed"; message: string };

/**
 * What an action result (or a thrown error) means for the queue.
 *  - ok → sent
 *  - "Reported by …" → conflict: someone else got there first. Never retried.
 *  - any other { ok: false } → rejected: the server read the request and
 *    said no (round closed, bad score). Retrying the same thing can't
 *    help, so it waits for the judge instead of looping.
 *  - thrown → failed: the request never got an answer (offline, 5xx). Retried
 *    with the same key, which is safe because the server ignores a key it
 *    has already recorded.
 */
export function rbClassify(result: unknown, thrown?: unknown): RbSendOutcome {
  if (thrown !== undefined) {
    const message = thrown instanceof Error && thrown.message ? thrown.message : "No connection.";
    return { kind: "failed", message };
  }
  const r = result as { ok?: unknown; error?: unknown } | null;
  if (r && r.ok === true) return { kind: "sent" };
  const message = r && typeof r.error === "string" && r.error ? r.error : "The server didn't accept the result.";
  return /^Reported by /.test(message) ? { kind: "conflict", message } : { kind: "rejected", message };
}

export function rbApplyOutcome(list: RbSubmission[], key: string, outcome: RbSendOutcome): RbSubmission[] {
  return list.map((s) =>
    s.key !== key
      ? s
      : outcome.kind === "sent"
        ? { ...s, status: "sent", error: null }
        : { ...s, status: outcome.kind, error: outcome.message },
  );
}

export const rbMarkSending = (list: RbSubmission[], key: string): RbSubmission[] =>
  list.map((s) => (s.key === key ? { ...s, status: "sending", error: null, attempts: s.attempts + 1 } : s));

// sessionStorage ------------------------------------------------------------

export const rbQueueStorageKey = (slug: string): string => `rb-floor-pending:${slug}`;

/** Only what still has to be delivered is kept across a refresh. */
export function rbSaveQueue(storage: Pick<Storage, "setItem" | "removeItem">, slug: string, list: RbSubmission[]): void {
  const keep = list.filter(rbIsActive);
  try {
    if (keep.length === 0) storage.removeItem(rbQueueStorageKey(slug));
    else storage.setItem(rbQueueStorageKey(slug), JSON.stringify(keep));
  } catch {
    // Storage full or blocked (private mode): the in-memory queue still works.
  }
}

/**
 * Reads the queue back after a refresh. Whatever was mid-flight becomes
 * `failed`: the page that was sending it is gone and nobody knows whether
 * the request landed, so it is sent again with the same key and the server
 * says if it already had it.
 */
export function rbLoadQueue(storage: Pick<Storage, "getItem">, slug: string): RbSubmission[] {
  try {
    const raw = storage.getItem(rbQueueStorageKey(slug));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isSubmission)
      .map((s) => (s.status === "sending" ? { ...s, status: "failed" as const, error: "Interrupted by a refresh." } : s));
  } catch {
    return [];
  }
}

function isSubmission(v: unknown): v is RbSubmission {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Partial<RbSubmission>;
  const p = s.payload as Partial<RbSubmissionPayload> | undefined;
  return (
    typeof s.key === "string" &&
    s.key.length > 0 &&
    s.key.length <= 100 &&
    typeof s.matchId === "string" &&
    typeof s.table === "number" &&
    (s.status === "sending" || s.status === "failed" || s.status === "rejected") &&
    !!p &&
    Number.isInteger(p.gamesA) &&
    Number.isInteger(p.gamesB) &&
    Number.isInteger(p.gamesDrawn) &&
    typeof p.decidedOnTime === "boolean"
  );
}
