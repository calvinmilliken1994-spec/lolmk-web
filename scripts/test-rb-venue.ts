// Deterministic tests for the venue screen's logic
// (src/components/riftbound/rb-venue-model.ts): scene choice and the derived
// time-called scene, alphabetical paging, the round rail, tables still playing
// and the standings split. No database, no React. Run:
//   node --experimental-strip-types scripts/test-rb-venue.ts

import { registerHooks } from "node:module";
import type { RbPublicMatch, RbPublicPlayer, RbPublicRound, RbScene } from "../src/types/riftbound";
import type { SwissStanding } from "../src/lib/swiss-engine";

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

const m = await import("../src/components/riftbound/rb-venue-model");
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
const MIN = 60_000;

function player(i: number, name: string, status: RbPublicPlayer["status"] = "active"): RbPublicPlayer {
  return { id: `p${i}`, display_name: name, status, dropped_after_round: null };
}
function round(n: number, status: RbPublicRound["status"], extra: Partial<RbPublicRound> = {}): RbPublicRound {
  return {
    id: `r${n}`,
    number: n,
    stage: "swiss",
    status,
    started_at: status === "published" ? null : new Date(START).toISOString(),
    paused_at: null,
    paused_total_ms: 0,
    duration_ms: 50 * MIN,
    ...extra,
  };
}
function match(r: number, table: number, a: string, b: string | null, extra: Partial<RbPublicMatch> = {}): RbPublicMatch {
  return {
    id: `m${r}-${table}`,
    round_id: `r${r}`,
    table_number: table,
    player_a_id: a,
    player_b_id: b,
    games_a: 0,
    games_b: 0,
    games_drawn: 0,
    decided_on_time: false,
    extension_ms: 0,
    status: "pending",
    ...extra,
  };
}
function data(over: Record<string, unknown> = {}) {
  const base = {
    tournament: {
      slug: "poro-cup",
      name: "Poro Cup",
      status: "live" as const,
      config: { ...DEFAULT_RB_CONFIG, swissRounds: 5, topCut: 8 as const },
      scene: "pairings" as RbScene,
      champion_player_id: null,
    },
    players: [] as RbPublicPlayer[],
    rounds: [] as RbPublicRound[],
    matches: [] as RbPublicMatch[],
    standings: [] as SwissStanding[],
  };
  return { ...base, ...over } as unknown as import("../src/components/riftbound/rb-venue-model").RbVenueData;
}
const withScene = (d: ReturnType<typeof data>, scene: RbScene) => ({ ...d, tournament: { ...d.tournament, scene } });

// --- scene choice -----------------------------------------------------------
{
  const live = data({ rounds: [round(3, "live")] });
  const at = (min: number) => START + min * MIN;
  eq(m.rbRenderScene(withScene(live, "clock"), at(10)), "clock", "clock while time remains");
  eq(m.rbRenderScene(withScene(live, "pairings_clock"), at(49)), "pairings_clock", "pairings_clock a minute before the end");
  eq(m.rbRenderScene(withScene(live, "clock"), at(50)), "time-called", "clock turns into time-called at the end");
  eq(m.rbRenderScene(withScene(live, "pairings_clock"), at(75)), "time-called", "pairings_clock turns into time-called");
  eq(m.rbRenderScene(withScene(live, "pairings"), at(75)), "pairings", "plain pairings never turns into time-called");
  eq(m.rbRenderScene(withScene(live, "standings"), at(75)), "standings", "standings is never replaced");
  eq(m.rbRenderScene(withScene(live, "clock"), at(10), "standings"), "standings", "?scene= wins");
  eq(m.rbRenderScene(withScene(live, "clock"), at(75), "idle"), "idle", "?scene= wins over time-called");

  const paused = data({ rounds: [round(3, "live", { paused_at: new Date(at(20)).toISOString() })] });
  eq(m.rbRenderScene(withScene(paused, "clock"), at(120)), "clock", "a paused clock never calls time");

  const published = data({ rounds: [round(3, "published", { started_at: null })] });
  eq(m.rbRenderScene(withScene(published, "clock"), at(120)), "clock", "an unstarted clock never calls time");

  const noLimit = data({ rounds: [round(3, "live", { duration_ms: null })] });
  eq(m.rbRenderScene(withScene(noLimit, "clock"), at(500)), "clock", "no time limit never calls time");

  const closed = data({ rounds: [round(3, "closed")] });
  eq(m.rbRenderScene(withScene(closed, "clock"), at(500)), "clock", "a closed round doesn't show time-called");

  const extended = data({ rounds: [round(3, "live", { duration_ms: 53 * MIN })] });
  eq(m.rbRenderScene(withScene(extended, "clock"), at(52)), "clock", "a clock adjusted +3:00 holds on");

  eq(m.rbRenderScene(withScene(data(), "idle"), at(1)), "idle", "no rounds: stored scene");
  eq(m.rbParseScene("clock"), "clock", "parse known scene");
  eq(m.rbParseScene("announcement"), "announcement", "parse announcement");
  eq(m.rbParseScene("nope"), null, "parse unknown scene");
  eq(m.rbParseScene(undefined), null, "parse missing scene");
}

// --- round choice and offset ------------------------------------------------
{
  const d = data({ rounds: [round(1, "closed"), round(2, "closed"), round(3, "live")] });
  eq(m.rbVenueRound(d)?.number, 3, "the running round");
  const done = data({ rounds: [round(1, "closed"), round(2, "closed")] });
  eq(m.rbVenueRound(done)?.number, 2, "latest closed round when none is running");
  eq(m.rbVenueRound(data()), null, "no round");
  eq(m.rbVenueOffset(1500, 1000), 500, "offset from server");
  eq(m.rbVenueOffset(undefined, 1000), 0, "no server time");
}

// --- pairings ---------------------------------------------------------------
{
  const players = [player(1, "Zed"), player(2, "ahn"), player(3, "Bok"), player(4, "Cho"), player(5, "Dami")];
  const d = data({
    players,
    rounds: [round(3, "live")],
    matches: [match(3, 1, "p1", "p2"), match(3, 2, "p3", "p4"), match(3, 3, "p5", null, { status: "bye" })],
  });
  const rows = m.rbPairingRows(d, d.rounds[0]);
  eq(rows.map((r) => r.name), ["ahn", "Bok", "Cho", "Dami", "Zed"], "alphabetical, case-insensitive");
  eq(rows.find((r) => r.name === "ahn"), { playerId: "p2", name: "ahn", opponent: "Zed", table: 1 }, "each player lists the opponent and table");
  eq(rows.find((r) => r.name === "Dami")?.opponent, null, "a bye has no opponent");
  eq(m.rbPairingRows(d, null), [], "no round, no rows");
  eq(m.rbPairingRows(d, { id: "r9" }), [], "a round with no matches");

  const many = Array.from({ length: 40 }, (_, i) => player(i, `P${String(i).padStart(2, "0")}`));
  const matches = Array.from({ length: 20 }, (_, i) => match(1, i + 1, `p${i * 2}`, `p${i * 2 + 1}`));
  const big = data({ players: many, rounds: [round(1, "live")], matches });
  const bigRows = m.rbPairingRows(big, big.rounds[0]);
  eq(bigRows.length, 40, "40 players, 40 rows");
  eq(m.rbPageCount(33), 1, "33 rows fit one page (3 x 11)");
  eq(m.rbPageCount(34), 2, "34 rows need two pages");
  eq(m.rbPageCount(0), 1, "an empty list is one page");
  const p0 = m.rbPairingColumns(bigRows, 0);
  eq(p0.map((c) => c.length), [11, 11, 11], "page 1 is 3 x 11");
  eq(p0[0][0].name, "P00", "page 1 starts at the top of column 1");
  eq(p0[1][0].name, "P11", "columns fill top to bottom");
  const p1 = m.rbPairingColumns(bigRows, 1);
  eq(p1.map((c) => c.length), [7, 0, 0], "page 2 holds the remaining 7");
  eq(p1[0][0].name, "P33", "page 2 continues the alphabet");
  eq(m.rbPairingColumns(bigRows, 2)[0][0].name, "P00", "paging wraps");
  eq(m.PAGE_MS, 12000, "12s per page");
}

// --- rail -------------------------------------------------------------------
{
  const players = Array.from({ length: 20 }, (_, i) => player(i, `P${i}`));
  const d = data({
    players,
    rounds: [round(1, "closed"), round(2, "closed"), round(3, "live")],
  });
  const rail = m.rbRail(d, START + 25 * MIN);
  eq(rail.map((r) => r.label), ["ROUND 1", "ROUND 2", "ROUND 3", "ROUND 4", "ROUND 5", "TOP 8"], "Swiss rounds plus the cut");
  eq(rail.map((r) => r.state), ["done", "done", "current", "upcoming", "upcoming", "upcoming"], "rail states");
  eq(rail.map((r) => r.progress), [1, 1, 0.5, 0, 0, 0], "rail progress at half time");
  const small = data({
    players: players.slice(0, 5),
    tournament: { ...d.tournament, config: { ...d.tournament.config, swissRounds: "auto", topCut: "auto" } },
    rounds: [round(1, "live")],
  });
  eq(m.rbCutSize(small), 0, "no cut for five players");
  eq(m.rbRail(small, START).some((r) => r.label.startsWith("TOP")), false, "no cut item without a cut");
  const cutRound = round(1, "live", { stage: "top_cut", id: "c1", duration_ms: null });
  const inCut = data({ players, rounds: [round(1, "closed"), round(2, "closed"), round(3, "closed"), round(4, "closed"), round(5, "closed"), cutRound] });
  eq(m.rbRail(inCut, START).at(-1)?.state, "current", "the cut is current while its round runs");
  eq(m.rbRoundProgress(round(1, "live"), START + 100 * MIN), 1, "progress clamps at 1");
  eq(m.rbRoundProgress(round(1, "published", { started_at: null }), START), 0, "unstarted progress is 0");
  eq(m.rbRoundProgress(undefined, START), 0, "no round, no progress");
}

// --- time called ------------------------------------------------------------
{
  const d = data({
    rounds: [round(3, "live"), round(2, "closed")],
    matches: [
      match(3, 3, "a", "b"),
      match(3, 7, "c", "d", { status: "completed" }),
      match(3, 6, "e", "f", { extension_ms: 3 * MIN }),
      match(3, 10, "g", "h"),
      match(3, 1, "i", null, { status: "bye" }),
      match(2, 4, "a", "b"),
    ],
  });
  const end = START + 50 * MIN;
  const t = m.rbTimeCalled(d, d.rounds[0], end + 30_000);
  eq(t.tables, [3, 10], "pending tables that are out of time, in order");
  eq(t.extensions, [{ table: 6, ms: 3 * MIN }], "a table on an extension is noted, not listed");
  const later = m.rbTimeCalled(d, d.rounds[0], end + 3 * MIN);
  eq(later.tables, [3, 6, 10], "the extended table joins once its extension runs out");
  eq(later.extensions, [], "...and is no longer noted");
  eq(m.rbExtensionLine(t.extensions[0]), "Table 6 has +3:00 extension", "extension line");
  eq(m.rbExtensionLine({ table: 2, ms: 90_000 }), "Table 2 has +1:30 extension", "extension line, odd seconds");
  eq(m.rbTimeCalled(d, null, end), { tables: [], extensions: [] }, "no round");
  const extOnly = data({ rounds: [round(3, "live")], matches: [match(3, 6, "e", "f", { extension_ms: 3 * MIN, status: "completed" })] });
  eq(m.rbTimeCalled(extOnly, extOnly.rounds[0], end + 1000), { tables: [], extensions: [] }, "a reported table is never listed");
}

// --- standings --------------------------------------------------------------
{
  const ids = Array.from({ length: 20 }, (_, i) => `p${i + 1}`);
  const players = ids.map((id, i) => player(i + 1, `Player ${i + 1}`));
  const standings = ids.map((id, i) => ({
    playerId: id,
    rank: i + 1,
    matchPoints: 15 - Math.floor(i / 2),
    wins: 5,
    losses: 0,
    draws: 0,
    record: "5-0-0",
    byes: 0,
    matchesPlayed: 5,
    gamesWon: 10,
    gamesLost: 0,
    gamesDrawn: 0,
    mwp: 1,
    omwp: 0.64,
    gwp: 0.8333,
    ogwp: 0.5,
    dropped: false,
  })) as SwissStanding[];
  const mid = m.rbVenueStandings(
    data({ players, standings, rounds: [round(1, "closed"), round(2, "closed"), round(3, "live")] }),
  );
  eq(mid.title, "STANDINGS", "mid-event title");
  eq(mid.subtitle, "After round 2 of 5", "mid-event subtitle");
  eq(mid.advancing, 0, "no cut mid-event");
  eq(mid.leftHeader, "1 – 8", "no cut header mid-event");
  eq(mid.rightHeader, "9 – 16", "second column header");
  eq([mid.left.length, mid.right.length], [8, 8], "top 16 only");
  eq(mid.left[0], { rank: 1, name: "Player 1", record: "5-0-0", points: 15, omw: "64%", gw: "83%" }, "row content");

  const finalRounds = [1, 2, 3, 4, 5].map((n) => round(n, "closed"));
  const fin = m.rbVenueStandings(data({ players, standings, rounds: finalRounds }));
  eq(fin.title, "FINAL SWISS STANDINGS", "final title");
  eq(fin.advancing, 8, "20 players cut to 8");
  eq(fin.leftHeader, "TOP 8 · ADVANCING", "cut header after the final round");
  eq(fin.subtitle, "After round 5 of 5", "final subtitle");
  eq(m.rbAdvances(8, 8), true, "rank 8 advances");
  eq(m.rbAdvances(9, 8), false, "rank 9 doesn't");
  eq(m.rbAdvances(1, 0), false, "nobody advances without a cut");

  const four = data({
    players: players.slice(0, 12),
    standings: standings.slice(0, 12),
    rounds: finalRounds,
    tournament: { ...data().tournament, config: { ...DEFAULT_RB_CONFIG, swissRounds: 5, topCut: "auto" } },
  });
  eq(m.rbVenueStandings(four).leftHeader, "TOP 4 · ADVANCING", "12 players cut to 4");

  const noCut = data({
    players: players.slice(0, 5),
    standings: standings.slice(0, 5),
    rounds: finalRounds,
    tournament: { ...data().tournament, config: { ...DEFAULT_RB_CONFIG, swissRounds: 5, topCut: "auto" } },
  });
  const nc = m.rbVenueStandings(noCut);
  eq([nc.advancing, nc.leftHeader, nc.right.length], [0, "1 – 8", 0], "final Swiss with no cut has no cut header");

  const empty = m.rbVenueStandings(data({ players, rounds: [round(1, "live")] }));
  eq(empty.left.length, 0, "no standings yet");

  const dropped = data({ players: [player(1, "A"), player(2, "B", "dropped")], standings: standings.slice(0, 2) });
  eq(m.rbVenueStandings(dropped).left.map((r) => r.name), ["A", "B"], "dropped players keep their place");
}

if (failures > 0) {
  console.error(`\n${failures} of ${checks} checks failed.`);
  process.exit(1);
}
console.log(`ok: ${checks} checks passed.`);
