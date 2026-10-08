// Deterministic tests for the Riftbound round desk's pure logic
// (src/components/riftbound/rb-round-model.ts): table tile states, filters,
// the keyboard result keys, draft pairing warnings, the activity log and its
// Undo rule, the "auto-follow next" panel and the desk idempotency key. No
// database, no React. Run directly:
//   node --experimental-strip-types scripts/test-rb-round.ts

import { registerHooks } from "node:module";
import type { RbAuditAction, RbAuditLogEntry, RbMatch, RbPlayer, RbRound } from "../src/types/riftbound";
import type { RbDeskState } from "../src/components/riftbound/rb-deck-model";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        // Fall through to the default resolution.
      }
    }
    return nextResolve(specifier, context);
  },
});

const model = await import("../src/components/riftbound/rb-round-model");
const deck = await import("../src/components/riftbound/rb-deck-model");
const { DEFAULT_RB_CONFIG } = await import("../src/types/riftbound");

let checks = 0;
let failures = 0;
function eq<T>(actual: T, expected: T, msg: string) {
  checks++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures++;
    console.error(`FAIL: ${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  }
}

const START = Date.parse("2026-12-12T05:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000;

const NAMES = ["Aria", "Bok", "Calder", "Dami", "Eun", "Finn", "Gyu", "Hana", "Iris", "Jun"];
const players: RbPlayer[] = NAMES.map((n, i) => ({
  id: `p${i}`,
  tournament_id: "t1",
  display_name: n,
  member_discord_id: null,
  legend: null,
  status: "active",
  dropped_after_round: null,
  created_at: iso(START),
}));

function round(number: number, status: RbRound["status"], over: Partial<RbRound> = {}): RbRound {
  return {
    id: `r${number}`,
    tournament_id: "t1",
    number,
    stage: "swiss",
    status,
    started_at: status === "live" || status === "closed" ? iso(START) : null,
    paused_at: null,
    paused_total_ms: 0,
    duration_ms: 60 * MIN,
    pairing_seed: null,
    created_at: iso(START),
    ...over,
  };
}

function match(r: number, table: number, a: number, b: number | null, over: Partial<RbMatch> = {}): RbMatch {
  const status = over.status ?? (b === null ? "bye" : "pending");
  return {
    id: `m${r}-${table}`,
    tournament_id: "t1",
    round_id: `r${r}`,
    table_number: table,
    player_a_id: `p${a}`,
    player_b_id: b === null ? null : `p${b}`,
    games_a: 0,
    games_b: 0,
    games_drawn: 0,
    decided_on_time: false,
    extension_ms: 0,
    started_at: null,
    status,
    reported_by_id: null,
    reported_by_name: null,
    reported_at: null,
    idempotency_key: null,
    flags: [],
    ...over,
  };
}

const reported = (r: number, table: number, a: number, b: number, ga: number, gb: number, by = "Ray"): RbMatch =>
  match(r, table, a, b, {
    status: "completed",
    games_a: ga,
    games_b: gb,
    reported_by_id: "9",
    reported_by_name: by,
    reported_at: iso(START + 5 * MIN),
  });

let auditId = 0;
const audit = (action: RbAuditAction, detail: Record<string, unknown>, actor = "Ray", at = START + auditId * 1000): RbAuditLogEntry => ({
  id: ++auditId,
  tournament_id: "t1",
  action,
  detail,
  actor_discord_id: "9",
  actor_name: actor,
  created_at: iso(at),
});

function state(over: {
  rounds?: RbRound[];
  matches?: RbMatch[];
  players?: RbPlayer[];
  audit?: RbAuditLogEntry[];
  standings?: RbDeskState["standings"];
  config?: Partial<RbDeskState["tournament"]["config"]>;
  status?: RbDeskState["tournament"]["status"];
  auto_follow?: boolean;
}): RbDeskState {
  return {
    tournament: {
      id: "t1",
      slug: "poro",
      name: "Poro Cup",
      status: over.status ?? "in_progress",
      config: { ...DEFAULT_RB_CONFIG, swissRounds: 3, tiebreakSeed: "s", ...over.config },
      scene: "idle",
      auto_follow: over.auto_follow ?? true,
      auto_follow_paused: false,
      champion_player_id: null,
      created_at: iso(START),
      updated_at: iso(START),
    },
    players: over.players ?? players,
    rounds: over.rounds ?? [],
    matches: over.matches ?? [],
    standings: over.standings ?? [],
    audit: over.audit ?? [],
  };
}

const standing = (i: number, matchPoints: number) => ({
  playerId: `p${i}`, rank: i + 1, matchPoints, wins: 0, losses: 0, draws: 0, record: "0-0-0", byes: 0, matchesPlayed: 0,
  gamesWon: 0, gamesLost: 0, gamesDrawn: 0, mwp: 0, omwp: 0, gwp: 0, ogwp: 0, dropped: false,
});

// ---- Formatting ------------------------------------------------------------

eq(model.formatClock(4 * MIN + 12_000), "04:12", "clock mm:ss");
eq(model.formatClock(60 * MIN), "60:00", "clock keeps minutes past 59");
eq(model.formatClock(0), "00:00", "clock zero");
eq(model.formatClock(-5000), "00:00", "clock never negative");
eq(model.formatClock(null), "--:--", "no time limit shows dashes");
eq(model.formatClock(1), "00:01", "a started second rounds up");
eq(model.formatDelta(3 * MIN), "+3:00", "extension format");
eq(model.formatDelta(-5 * MIN), "−5:00", "negative adjustment format");

// ---- Idempotency key -------------------------------------------------------

{
  const keys = new Set(Array.from({ length: 200 }, () => model.newDeskKey()));
  eq(keys.size, 200, "desk keys are unique");
  eq([...keys].every((k) => k.startsWith("desk-") && k.length >= 20 && k.length <= 100), true, "desk key shape fits the server's 1–100 limit");
  const g = globalThis as { crypto?: unknown };
  const real = g.crypto;
  Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
  const fallback = model.newDeskKey();
  eq(/^desk-[0-9a-f]{32}$/.test(fallback), true, "desk key without crypto (plain-http LAN page) still works");
  Object.defineProperty(globalThis, "crypto", { value: { getRandomValues: real && (real as Crypto).getRandomValues.bind(real) }, configurable: true });
  eq(/^desk-[0-9a-f]{32}$/.test(model.newDeskKey()), true, "desk key with getRandomValues but no randomUUID");
  Object.defineProperty(globalThis, "crypto", { value: real, configurable: true });
}

// ---- Time-out results and result keys --------------------------------------

eq(model.isTimeOutResult(3, 1, 0), true, "Bo3 1–0 is a time-out result");
eq(model.isTimeOutResult(3, 2, 0), false, "Bo3 2–0 is a full result");
eq(model.isTimeOutResult(3, 1, 1), false, "level games are a draw, not a time-out win");
eq(model.isTimeOutResult(3, 0, 0), false, "0–0 is a draw");
eq(model.isTimeOutResult(1, 1, 0), false, "Bo1 1–0 is a full result");
eq(model.rbResultKeys(3).map((k) => k.key).join(""), "askld", "Bo3 keys");
eq(model.rbResultKeys(1).map((k) => k.key).join(""), "ald", "Bo1 keys");
eq(JSON.stringify(model.rbResultForKey(3, "S")), JSON.stringify({ key: "s", label: "A 2–1", gamesA: 2, gamesB: 1 }), "keys are case-insensitive");
eq(model.rbResultForKey(3, "z"), null, "unknown key");
eq(model.rbResultForKey(1, "s"), null, "Bo1 has no 2–1");

// ---- Tile states -----------------------------------------------------------

{
  const live = round(3, "live");
  const flag = { kind: "judge_call" as const, id: "f1", note: "rules", raised_by_name: "Joe", raised_at: iso(START), acknowledged_by_name: null, acknowledged_at: null };
  const ms = [
    reported(3, 1, 0, 1, 2, 0, "Ray"),
    match(3, 2, 2, 3),
    match(3, 3, 4, 5, { extension_ms: 3 * MIN, flags: [flag] }),
    match(3, 4, 6, null),
    reported(3, 5, 8, 9, 1, 1, "Jin"),
    reported(3, 6, 2, 3, 0, 1, "Joe"),
    reported(3, 7, 4, 5, 1, 0, "Joe"),
  ];
  ms[6].decided_on_time = true;
  const s = state({ rounds: [live], matches: ms });
  const t = (i: number, now: number | null) => model.rbTile(s, live, ms[i], now);

  const at10 = START + 10 * MIN;
  eq(t(0, at10).kind, "reported", "reported tile");
  eq(t(0, at10).line, "Aria 2–0 · Ray", "reported line shows winner, score and reporter (reference)");
  eq(t(4, at10).line, "Draw 1–1 · Jin", "draw line (reference)");
  eq(t(5, at10).line, "Dami 1–0 · Joe".replace("Dami", "Dami"), "B-side winner is named");
  eq(t(6, at10).line, "Eun 1–0 (time) · Joe", "time-out win is marked");
  eq(t(1, at10).kind, "playing", "playing tile");
  eq(t(1, at10).line, "50:00 left", "playing line counts down from the server timestamps");
  eq(t(2, at10).kind, "flagged", "an open flag wins over playing");
  eq(t(2, at10).tag, "JUDGE CALL", "flag tag");
  eq(t(2, at10).line, "Judge call · +3:00", "flagged line with extension (reference)");
  eq(t(3, at10).kind, "bye", "bye tile");
  eq(t(3, at10).line, "Bye · auto 2–0", "bye line (reference)");
  eq(t(1, START + 61 * MIN).kind, "over_time", "past the round end the table is over time");
  eq(t(1, START + 61 * MIN).tag, "OVER TIME", "over time tag");
  eq(t(2, START + 62 * MIN).kind, "flagged", "a flagged table stays flagged over time");
  eq(model.rbTile(s, live, { ...ms[1], extension_ms: 5 * MIN }, START + 62 * MIN).kind, "playing", "an extension keeps its table in time");
  eq(model.rbTile(s, live, { ...ms[1], extension_ms: 5 * MIN }, START + 66 * MIN).kind, "over_time", "…until the extension runs out");
  eq(t(0, START + 99 * MIN).kind, "reported", "a reported table is never over time");
  eq(t(1, null).kind, "waiting", "before the first tick (no clock) it isn't called over time");
  eq(model.rbTile(s, round(3, "published"), ms[1], at10).kind, "waiting", "published, clock not started");
  eq(model.rbTile(s, round(3, "published"), ms[1], at10).line, "Clock not started", "waiting line");
  eq(model.rbTile(s, round(3, "live", { paused_at: iso(START + 20 * MIN) }), ms[1], at10).line, "Paused · 40:00 left", "paused clock freezes");
  const acked = { ...ms[2], flags: [{ ...flag, acknowledged_at: iso(START), acknowledged_by_name: "Ray" }] };
  eq(model.rbTile(s, live, acked, at10).kind, "playing", "an acknowledged flag no longer flags the tile");

  const tiles = model.rbRoundTiles(s, live, at10);
  const c = model.rbTileCounts(tiles);
  eq(JSON.stringify(c), JSON.stringify({ all: 7, outstanding: 2, flagged: 1, reported: 5 }), "counts: byes count as reported");
  eq(model.rbFilterTiles(tiles, "outstanding").map((x) => x.table).join(), "2,3", "Outstanding filter");
  eq(model.rbFilterTiles(tiles, "flagged").map((x) => x.table).join(), "3", "Flagged filter");
  eq(model.rbFilterTiles(tiles, "all").length, 7, "All filter");
}

// ---- Status chip: TIME is derived ------------------------------------------

{
  const s = state({ rounds: [round(1, "closed"), round(2, "closed"), round(3, "live")], config: { swissRounds: 5 } });
  eq(deck.rbStatusChip(s, START + 10 * MIN), "ROUND 3 / 5 · LIVE", "chip live");
  eq(deck.rbStatusChip(s, START + 61 * MIN), "ROUND 3 / 5 · TIME", "chip time once the clock is out");
  eq(deck.rbStatusChip(s), "ROUND 3 / 5 · LIVE", "chip without a clock reading");
  eq(model.rbClockRound(s)?.id, "r3", "clock belongs to the live round");
  eq(model.rbClockRound(state({ rounds: [round(1, "closed")] })), null, "no clock for a closed round");
  eq(model.rbClockRound(state({ rounds: [round(1, "draft")] })), null, "no clock for a draft");
  eq(model.rbClockRound(state({ rounds: [round(1, "published")] }))?.id, "r1", "a published round shows its full time");
}

// ---- Draft pairing warnings ------------------------------------------------

{
  // Round 1 played: p0–p1 and p2–p3; p8 had a bye. Round 2 draft below.
  const r1 = round(1, "closed");
  const r2 = round(2, "draft");
  const past = [reported(1, 1, 0, 1, 2, 0), reported(1, 2, 2, 3, 2, 1), match(1, 3, 8, null, { status: "bye" })];
  const standings = [standing(0, 3), standing(2, 3), standing(8, 3), standing(1, 0), standing(3, 0), standing(4, 0)];
  const draft = [
    match(2, 1, 0, 1), // rematch, 3 vs 0 points
    match(2, 2, 2, 4), // 3 vs 0 points
    match(2, 3, 8, null, { status: "bye" }), // second bye
    match(2, 4, 3, 5), // 0 vs 0, clean
  ];
  const s = state({ rounds: [r1, r2], matches: [...past, ...draft], standings });
  const w = model.rbDraftWarnings(s, r2);
  const kinds = w.map((x) => `${x.code}@${s.matches.find((m) => m.id === x.matchId)?.table_number}`).sort();
  eq(kinds.join(), "point_mismatch@1,point_mismatch@2,rematch@1,second_bye@3", "draft warnings: rematch, points, second bye, each on its table");
  eq(w.find((x) => x.code === "rematch")?.message, "Aria and Bok have already played each other.", "rematch message uses names");
  eq(w.find((x) => x.code === "point_mismatch" && x.matchId === "m2-2")?.message, "Calder (3 pts) is paired with Eun (0 pts).", "points message uses names and points");
  eq(w.find((x) => x.code === "second_bye")?.message, "Iris already had a bye this event.", "second bye message");
  const rows = model.rbDraftRows(s, r2);
  eq(rows.map((r) => r.warnings.length).join(), "2,1,1,0", "warnings attach to their rows");
  eq(rows[3].aName + " " + rows[3].bName, "Dami Finn", "row names");
  eq(rows[2].bId, null, "bye row has no opponent");
  eq(model.rbDraftWarnings(state({ rounds: [round(1, "draft")], matches: [match(1, 1, 0, 1)] }), round(1, "draft")).length, 0, "round 1 draft has no warnings");
}

// ---- Activity log and Undo -------------------------------------------------

{
  auditId = 0;
  const live = round(3, "live");
  const ms = [reported(3, 1, 0, 1, 2, 0), reported(3, 2, 2, 3, 2, 1), match(3, 3, 4, 5)];
  const log = [
    audit("round.publish", { round: 3, stage: "swiss" }),
    audit("clock.start", { round: 3 }),
    audit("match.report", { matchId: "m3-1", round: 3, table: 1, gamesA: 2, gamesB: 0, gamesDrawn: 0, decidedOnTime: false, drops: [] }, "Ray"),
    audit("match.report", { matchId: "m3-2", round: 3, table: 2, gamesA: 2, gamesB: 1, gamesDrawn: 0, decidedOnTime: false, drops: ["p3"] }, "Joe"),
    audit("player.drop", { playerId: "p3", afterRound: 3, viaReport: "m3-2" }, "Joe"),
    audit("match.extension", { matchId: "m3-3", table: 3, ms: 3 * MIN, reason: "Judge call" }, "Joe"),
    audit("tournament.update", { x: 1 }, "Ray"),
  ];
  const dropped = players.map((p) => (p.id === "p3" ? { ...p, status: "dropped" as const, dropped_after_round: 3 } : p));
  const s = state({ rounds: [round(1, "closed"), round(2, "closed"), live], matches: ms, audit: log, players: dropped });
  const rows = model.rbActivity(s, 50);

  eq(rows[0].text, "Table 3 · +3:00 extension (Judge call)", "newest first; extension line");
  eq(model.rbActivity(s).length, 4, "the log shows four lines by default (reference)");
  eq(model.rbActivity(s)[1].text.startsWith("Table 2"), true, "…and the newest reversible entry is among them");
  eq(rows.some((r) => r.text.includes("tournament")), false, "setup-only audit entries aren't logged");
  const table2 = rows.find((r) => r.text.startsWith("Table 2"))!;
  eq(table2.text, "Table 2 · Calder wins 2–1 · Dami drops after round", "report line carries the drop (reference style)");
  eq(rows.filter((r) => r.text.includes("drops after round 3")).length, 0, "the via-report drop isn't a second line");
  eq(table2.reversible, true, "newest report is reversible");
  eq(JSON.stringify(table2.undo), JSON.stringify({ kind: "report", matchId: "m3-2", stage: "swiss", dropPlayerIds: ["p3"] }), "undoing a report also undoes its drops");
  eq(rows.find((r) => r.text.startsWith("Table 1"))!.reversible, true, "an older report is reversible on its own");
  eq(rows.find((r) => r.text === "Round 3 published")!.reversible, false, "publish isn't reversible once results exist");
  eq(rows.find((r) => r.text === "Round 3 clock started")!.reversible, false, "clock start has no undo");

  // Undo never hides behind newer lines: seven newer non-reversible entries still leave it visible.
  auditId = 0;
  const burst = [
    audit("match.report", { matchId: "m3-1", round: 3, table: 1, gamesA: 2, gamesB: 0, gamesDrawn: 0, decidedOnTime: false, drops: [] }),
    ...Array.from({ length: 6 }, (_, i) => audit("match.extension", { matchId: "m3-3", table: 3, ms: MIN, reason: `n${i}` })),
  ];
  const stretched = model.rbActivity(state({ rounds: [live], matches: [reported(3, 1, 0, 1, 2, 0)], audit: burst }));
  eq(stretched.length, 7, "the log stretches to include the newest undoable entry");
  eq(stretched.at(-1)?.reversible, true, "…which is the last visible line");

  // The component shows Undo on the newest reversible entry only.
  const first = rows.find((r) => r.reversible);
  eq(first?.text.startsWith("Table 2"), true, "the newest reversible row is the latest report");

  // Undone then re-reported: only the new report is reversible.
  auditId = 0;
  const log2 = [
    audit("match.report", { matchId: "m3-1", round: 3, table: 1, gamesA: 2, gamesB: 0, gamesDrawn: 0, decidedOnTime: false, drops: [] }),
    audit("match.undo", { matchId: "m3-1", round: 3, table: 1 }),
    audit("match.report", { matchId: "m3-1", round: 3, table: 1, gamesA: 2, gamesB: 1, gamesDrawn: 0, decidedOnTime: false, drops: [] }),
  ];
  const r2 = model.rbActivity(state({ rounds: [live], matches: [reported(3, 1, 0, 1, 2, 1)], audit: log2 }), 50);
  eq(r2.map((r) => (r.reversible ? "U" : "-")).join(""), "U--", "only the newest report of a table can be undone");
  eq(r2[1].text, "Table 1 · result undone", "undo line");

  // Round closed → reports are final.
  const closed = model.rbActivity(state({ rounds: [round(3, "closed")], matches: [reported(3, 1, 0, 1, 2, 0)], audit: [audit("match.report", { matchId: "m3-1", round: 3, table: 1, gamesA: 2, gamesB: 0, gamesDrawn: 0, drops: [] })] }));
  eq(closed[0].reversible, false, "no undo once the round is closed");

  // Publish with no results → un-publish; stops once the clock starts.
  auditId = 0;
  const pub = [audit("round.publish", { round: 2, stage: "swiss" })];
  const published = state({ rounds: [round(1, "closed"), round(2, "published")], matches: [match(2, 1, 0, 1)], audit: pub });
  eq(JSON.stringify(model.rbActivity(published)[0].undo), JSON.stringify({ kind: "unpublish", roundId: "r2" }), "un-publish is offered for a published round with no results");
  eq(model.rbActivity(state({ rounds: [round(1, "closed"), round(2, "live")], matches: [match(2, 1, 0, 1)], audit: pub }))[0].reversible, false, "…not once the clock is running");

  // Drops: plain drop reversible, DQ never.
  auditId = 0;
  const dropLog = [audit("player.drop", { playerId: "p4", afterRound: 2 }), audit("player.dq", { playerId: "p5", afterRound: 2 })];
  const ps = players.map((p) => (p.id === "p4" ? { ...p, status: "dropped" as const, dropped_after_round: 2 } : p.id === "p5" ? { ...p, status: "dq" as const, dropped_after_round: 2 } : p));
  const dr = model.rbActivity(state({ rounds: [round(1, "closed"), round(2, "closed"), round(3, "draft")], players: ps, audit: dropLog }), 50);
  eq(dr.find((r) => r.text.startsWith("Eun"))?.undo?.kind, "drop", "a drop can be undone while only a draft round exists after it");
  eq(dr.find((r) => r.text.includes("disqualified"))?.reversible, false, "disqualification is one-way");
  const late = model.rbActivity(state({ rounds: [round(1, "closed"), round(2, "closed"), round(3, "live")], players: ps, audit: dropLog }), 50);
  eq(late.find((r) => r.text.startsWith("Eun"))?.reversible, false, "a drop can't be undone once a later round has started");
}

// ---- Auto-follow next ------------------------------------------------------

{
  const names = (s: RbDeskState, now: number | null = START + 10 * MIN) => model.rbAutoFollowNext(s, now).map((x) => `${x.event} → ${x.scene}`).join(" | ");
  const m = (r: number) => [match(r, 1, 0, 1), match(r, 2, 2, 3)];
  eq(names(state({ rounds: [round(1, "draft")], matches: m(1) })), "Round 1 published → Pairings | Clock started → Pairings + clock", "draft: published, then clock started");
  eq(names(state({ rounds: [round(1, "published")], matches: m(1) })), "Clock started → Pairings + clock | Clock reaches 0 → Time called", "published: clock started, then time called");
  eq(names(state({ rounds: [round(1, "live")], matches: m(1) })), "Clock reaches 0 → Time called | Round closed → Standings", "live: time called, then closed (reference panel)");
  eq(names(state({ rounds: [round(1, "live")], matches: m(1) }), START + 61 * MIN), "Round closed → Standings | Round 2 published → Pairings", "after time is called: closed, then the next round");
  eq(names(state({ rounds: [round(1, "closed")], matches: m(1) })), "Round 2 published → Pairings | Clock started → Pairings + clock", "closed, rounds left: next round");
  const lastClosed = state({ rounds: [round(1, "closed"), round(2, "closed"), round(3, "closed")], matches: m(3), config: { swissRounds: 3 } });
  eq(names(lastClosed), "Cut made → Top 4 bracket | Event completed → Champion", "last Swiss round closed with a cut: cut, then champion");
  const noCut = state({ rounds: [round(1, "closed"), round(2, "closed"), round(3, "closed")], matches: m(3), config: { swissRounds: 3, topCut: 0 } });
  eq(names(noCut), "Event completed → Champion", "no cut: only the champion is left");
  eq(names(state({ status: "completed", rounds: [round(1, "closed")] })), "", "nothing after completion");
  const final = round(7, "live", { stage: "top_cut", duration_ms: null });
  eq(names(state({ rounds: [round(1, "closed"), final], matches: [match(7, 1, 0, 1)] })), "Round closed → Top-cut bracket | Event completed → Champion", "final: no timer, the bracket stays up, then the champion");
  eq(model.rbAutoFollowNext(state({ rounds: [] }), null).length, 2, "no round yet still lists two steps");
}

if (failures > 0) {
  console.error(`\n${failures} of ${checks} checks failed.`);
  process.exit(1);
}
console.log(`ok: ${checks} checks passed.`);
