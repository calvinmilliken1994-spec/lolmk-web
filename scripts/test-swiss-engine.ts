// Deterministic tests for the Swiss engine (src/lib/swiss-engine.ts) and the
// blossom matcher it uses (src/lib/max-weight-matching.ts). Not wired into a
// test runner (none installed in this repo — see package.json). Run directly:
//   node --experimental-strip-types scripts/test-swiss-engine.ts
//
// Coverage:
//   1. maxWeightMatching against brute force on random small graphs.
//   2. Known answers: a hand-computed 8-player / 3-round event, the 33%
//      floor, bye exclusion, random tiebreak, final-round power pairing,
//      manual-pairing warnings, round count / top cut sizing.
//   3. Property tests over 500 random events (4–64 players, 3–7 rounds,
//      game/match draws, time-outs, mid-event drops).
//
// Node's ESM loader does not resolve extensionless relative imports, and the
// engine imports its siblings without extensions (as the Next app does). The
// resolve hook below retries such specifiers with ".ts", and the engine is
// loaded with a dynamic import after the hook is registered.

import { registerHooks } from "node:module";
import type {
  Pairing,
  PairRoundInput,
  SwissMatchResult,
  SwissPlayer,
  SwissStanding,
} from "../src/lib/swiss-engine";
import type { WeightedEdge } from "../src/lib/max-weight-matching";

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

const {
  computeStandings,
  createRng,
  pairRound,
  resolveRoundCount,
  resolveTopCutSize,
  topCutSeeds,
  validateManualPairings,
} = await import("../src/lib/swiss-engine");
const { maxWeightMatching } = await import("../src/lib/max-weight-matching");

let failures = 0;
function assert(cond: unknown, msg: string) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}
function near(actual: number, expected: number, msg: string) {
  assert(Math.abs(actual - expected) < 1e-12, `${msg}: expected ${expected}, got ${actual}`);
}

const pk = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function res(
  round: number,
  playerA: string,
  playerB: string | null,
  gamesA = 2,
  gamesB = 0,
  gamesDrawn = 0,
  decidedOnTime = false,
): SwissMatchResult {
  return { round, playerA, playerB, gamesA, gamesB, gamesDrawn, decidedOnTime };
}

function byId(standings: SwissStanding[]): Map<string, SwissStanding> {
  return new Map(standings.map((s) => [s.playerId, s]));
}

// ---------------------------------------------------------------------------
// 1. maxWeightMatching vs brute force.
// ---------------------------------------------------------------------------
console.log("--- maxWeightMatching vs brute force ---");
{
  /** Best [cardinality, weight] over all matchings, by exhaustive search. */
  function bruteBest(n: number, w: Map<string, number>, maxCard: boolean): [number, number] {
    let best: [number, number] = [0, 0];
    const used = new Array<boolean>(n).fill(false);
    const rec = (v: number, card: number, weight: number) => {
      while (v < n && used[v]) v++;
      if (v >= n) {
        const better = maxCard
          ? card > best[0] || (card === best[0] && weight > best[1])
          : weight > best[1];
        if (better) best = [card, weight];
        return;
      }
      used[v] = true;
      rec(v + 1, card, weight); // v unmatched
      for (let u = v + 1; u < n; u++) {
        const key = `${v}|${u}`;
        if (!used[u] && w.has(key)) {
          used[u] = true;
          rec(v + 1, card + 1, weight + (w.get(key) as number));
          used[u] = false;
        }
      }
      used[v] = false;
    };
    rec(0, 0, 0);
    return best;
  }

  const rng = createRng("mwm-brute");
  let graphs = 0;
  for (let g = 0; g < 1500; g++) {
    const n = 2 + Math.floor(rng() * 9); // 2..10 vertices
    const density = 0.2 + rng() * 0.8;
    const edges: WeightedEdge[] = [];
    const w = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (rng() < density) {
          const wt = Math.floor(rng() * 41) - (g % 3 === 0 ? 10 : 0);
          edges.push([i, j, wt]);
          w.set(`${i}|${j}`, wt);
        }
      }
    }
    for (const maxCard of [false, true]) {
      const mate = maxWeightMatching(edges, maxCard, n);
      let card = 0;
      let weight = 0;
      let valid = mate.length === n;
      for (let v = 0; v < n; v++) {
        const m = mate[v];
        if (m === -1) continue;
        if (mate[m] !== v) valid = false;
        if (m > v) {
          const key = `${v}|${m}`;
          if (!w.has(key)) valid = false;
          card++;
          weight += w.get(key) ?? 0;
        }
      }
      const [bc, bw] = bruteBest(n, w, maxCard);
      assert(valid, `graph ${g} (maxCard=${maxCard}): invalid matching ${JSON.stringify(mate)}`);
      if (maxCard) assert(card === bc && weight === bw, `graph ${g} maxCard: got (${card}, ${weight}), best (${bc}, ${bw})`);
      else assert(weight === bw, `graph ${g}: got weight ${weight}, best ${bw}`);
      graphs++;
    }
  }
  console.log(`ok   ${graphs} random graphs (2–10 vertices, incl. negative weights) match brute force`);
}

// ---------------------------------------------------------------------------
// 2a. Hand-computed 8-player, 3-round event.
// ---------------------------------------------------------------------------
console.log("\n--- Known answers: 8 players, 3 rounds ---");
{
  const players: SwissPlayer[] = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"].map((id) => ({ id }));
  const matches = [
    res(1, "P1", "P2", 2, 0),
    res(1, "P3", "P4", 2, 1),
    res(1, "P5", "P6", 2, 0),
    res(1, "P7", "P8", 2, 1),
    res(2, "P1", "P3", 2, 1),
    res(2, "P5", "P7", 2, 0),
    res(2, "P2", "P4", 2, 0),
    res(2, "P6", "P8", 1, 1, 0, true), // time-out on equal games: match draw
    res(3, "P1", "P5", 2, 0),
    res(3, "P3", "P7", 2, 1),
    res(3, "P2", "P6", 2, 1),
    res(3, "P4", "P8", 2, 0),
  ];
  const st = computeStandings(players, matches, {}, createRng("ka8"));
  const s = byId(st);

  // Own MW%: P1 1, P2/P3/P5 6/9, P4/P7 3/9, P6/P8 1/9 (floored to 0.33 as opponents).
  // Own GW%: P1 6/7, P2 4/7, P3 5/9, P4 3/7, P5 4/6, P6 2/7, P7 3/8, P8 2/7.
  const F = 0.33;
  const expected: Record<string, { mp: number; rec: string; mwp: number; gwp: number; omwp: number; ogwp: number }> = {
    P1: { mp: 9, rec: "3-0-0", mwp: 1, gwp: 6 / 7, omwp: (2 / 3 + 2 / 3 + 2 / 3) / 3, ogwp: (4 / 7 + 5 / 9 + 2 / 3) / 3 },
    P2: { mp: 6, rec: "2-1-0", mwp: 2 / 3, gwp: 4 / 7, omwp: (1 + 1 / 3 + F) / 3, ogwp: (6 / 7 + 3 / 7 + F) / 3 },
    P3: { mp: 6, rec: "2-1-0", mwp: 2 / 3, gwp: 5 / 9, omwp: (1 / 3 + 1 + 1 / 3) / 3, ogwp: (3 / 7 + 6 / 7 + 3 / 8) / 3 },
    P4: { mp: 3, rec: "1-2-0", mwp: 1 / 3, gwp: 3 / 7, omwp: (2 / 3 + 2 / 3 + F) / 3, ogwp: (5 / 9 + 4 / 7 + F) / 3 },
    P5: { mp: 6, rec: "2-1-0", mwp: 2 / 3, gwp: 2 / 3, omwp: (F + 1 / 3 + 1) / 3, ogwp: (F + 3 / 8 + 6 / 7) / 3 },
    P6: { mp: 1, rec: "0-2-1", mwp: 1 / 9, gwp: 2 / 7, omwp: (2 / 3 + F + 2 / 3) / 3, ogwp: (2 / 3 + F + 4 / 7) / 3 },
    P7: { mp: 3, rec: "1-2-0", mwp: 1 / 3, gwp: 3 / 8, omwp: (F + 2 / 3 + 2 / 3) / 3, ogwp: (F + 2 / 3 + 5 / 9) / 3 },
    P8: { mp: 1, rec: "0-2-1", mwp: 1 / 9, gwp: 2 / 7, omwp: (1 / 3 + F + 1 / 3) / 3, ogwp: (3 / 8 + F + 3 / 7) / 3 },
  };
  for (const [id, e] of Object.entries(expected)) {
    const row = s.get(id) as SwissStanding;
    assert(row.matchPoints === e.mp, `${id} match points ${row.matchPoints}, expected ${e.mp}`);
    assert(row.record === e.rec, `${id} record ${row.record}, expected ${e.rec}`);
    near(row.mwp, e.mwp, `${id} MW%`);
    near(row.gwp, e.gwp, `${id} GW%`);
    near(row.omwp, e.omwp, `${id} OMW%`);
    near(row.ogwp, e.ogwp, `${id} OGW%`);
  }
  // P3 > P5 = P2 on OMW% (P5 and P2 tie at (1 + 1/3 + 0.33)/3; GW% 2/3 > 4/7).
  // P4 = P7 on OMW%, GW% 3/7 > 3/8. P6 > P8 on OMW%.
  const order = st.map((r) => r.playerId).join(",");
  assert(order === "P1,P3,P5,P2,P4,P7,P6,P8", `8-player order ${order}`);
  assert(st.every((r, i) => r.rank === i + 1), "ranks are 1..8");
  console.log(`ok   records, MW/GW/OMW/OGW for all 8 players; order ${order}`);
}

// ---------------------------------------------------------------------------
// 2b. Win-percentage floor.
// ---------------------------------------------------------------------------
console.log("\n--- Known answers: win-percentage floor ---");
{
  const players: SwissPlayer[] = ["A", "B", "C", "D"].map((id) => ({ id }));
  const matches = [res(1, "A", "B"), res(1, "C", "D"), res(2, "A", "C"), res(2, "B", "D")];
  // D is 0-2 (MW 0, GW 0). B and C are 1-1 (MW 0.5). A is 2-0.
  const st = byId(computeStandings(players, matches, {}, createRng("floor")));
  near((st.get("D") as SwissStanding).mwp, 0, "D own MW% is unfloored");
  near((st.get("D") as SwissStanding).gwp, 0, "D own GW% is unfloored");
  near((st.get("C") as SwissStanding).omwp, (0.33 + 1) / 2, "C OMW% uses D at the 0.33 floor");
  near((st.get("B") as SwissStanding).omwp, (1 + 0.33) / 2, "B OMW% uses D at the 0.33 floor");
  near((st.get("C") as SwissStanding).ogwp, (0.33 + 1) / 2, "C OGW% uses D's GW% at the floor");
  near((st.get("A") as SwissStanding).omwp, 0.5, "A OMW% (opponents above the floor)");

  const custom = byId(computeStandings(players, matches, { winPercentFloor: 0.25 }, createRng("floor")));
  near((custom.get("C") as SwissStanding).omwp, (0.25 + 1) / 2, "configurable floor 0.25");
  const none = byId(computeStandings(players, matches, { winPercentFloor: 0 }, createRng("floor")));
  near((none.get("C") as SwissStanding).omwp, 0.5, "floor 0 leaves D at 0");
  console.log("ok   opponent MW%/GW% floored at 0.33 (configurable); own percentages unfloored");
}

// ---------------------------------------------------------------------------
// 2c. Bye exclusion.
// ---------------------------------------------------------------------------
console.log("\n--- Known answers: bye exclusion ---");
{
  const players: SwissPlayer[] = ["A", "B", "C", "D", "E"].map((id) => ({ id }));
  const matches = [
    res(1, "A", "B", 2, 0),
    res(1, "C", "D", 2, 0),
    res(1, "E", null, 0, 0), // stored game counts are ignored for byes
    res(2, "A", "E", 2, 1),
    res(2, "C", "B", 2, 0),
    res(2, "D", null),
  ];
  const st = computeStandings(players, matches, {}, createRng("bye"));
  const s = byId(st);
  const E = s.get("E") as SwissStanding;
  const D = s.get("D") as SwissStanding;
  const A = s.get("A") as SwissStanding;
  const C = s.get("C") as SwissStanding;

  // E: bye (2-0 win) + loss 1-2. Own MW% 3/6, own GW% (2+1)/(2+1+2) — bye included.
  assert(E.record === "1-1-0" && E.byes === 1 && E.matchPoints === 3, `E record ${E.record}`);
  near(E.mwp, 0.5, "E own MW% includes the bye");
  near(E.gwp, 3 / 5, "E own GW% includes the 2-0 bye");
  // E's only real opponent is A (1.0 MW, GW 4/5). The bye is not an opponent.
  near(E.omwp, 1, "E OMW% ignores the bye round");
  near(E.ogwp, 4 / 5, "E OGW% ignores the bye round");
  // A faced B (0-2 → floor) and E. E's MW% without the bye is 0/3 → floor,
  // not 0.5; E's GW% without the bye is 1/3 (above the floor).
  near(A.omwp, 0.33, "A OMW% uses E's MW% with the bye removed");
  near(A.ogwp, (0.33 + 1 / 3) / 2, "A OGW% uses E's GW% with the bye removed");
  // D: loss to C, then a bye.
  near(D.mwp, 0.5, "D own MW% includes the bye");
  near(D.gwp, 0.5, "D own GW% (0-2 plus 2-0 bye)");
  near(D.omwp, 1, "D OMW% = C only");
  // C faced D (MW without bye 0 → floor) and B (floor).
  near(C.omwp, 0.33, "C OMW% uses D's MW% with the bye removed");
  const order = st.map((r) => r.playerId).join(",");
  // C = A on OMW% (0.33); C has GW% 1 > 0.8. E = D on OMW% (1); E GW% 0.6 > 0.5.
  assert(order === "C,A,E,D,B", `bye-exclusion order ${order}`);
  console.log(`ok   byes count as 2-0 wins for the player, never as opponents; order ${order}`);
}

// ---------------------------------------------------------------------------
// 2d. Random tiebreak is seeded.
// ---------------------------------------------------------------------------
console.log("\n--- Random tiebreak ---");
{
  const players: SwissPlayer[] = ["A", "B", "C", "D", "E", "F"].map((id) => ({ id }));
  const orderFor = (seed: string) =>
    computeStandings(players, [], {}, createRng(seed))
      .map((r) => r.playerId)
      .join("");
  assert(orderFor("x") === orderFor("x"), "same seed, same order");
  const distinct = new Set(Array.from({ length: 30 }, (_, i) => orderFor(`seed-${i}`)));
  assert(distinct.size > 5, `different seeds should vary the order (got ${distinct.size} distinct)`);
  console.log(`ok   identical seeds reproduce the order; 30 seeds gave ${distinct.size} distinct orders`);
}

// ---------------------------------------------------------------------------
// 2e. Final-round power pairing order.
// ---------------------------------------------------------------------------
console.log("\n--- Final-round power pairing ---");
{
  function mkStandings(ids: string[]): SwissStanding[] {
    // Descending points so no two players are level; rank = list order.
    return ids.map((id, i) => ({
      playerId: id,
      rank: i + 1,
      matchPoints: (ids.length - i) * 3,
      wins: 0,
      losses: 0,
      draws: 0,
      record: "0-0-0",
      byes: 0,
      matchesPlayed: 0,
      gamesWon: 0,
      gamesLost: 0,
      gamesDrawn: 0,
      mwp: 0,
      omwp: 0,
      gwp: 0,
      ogwp: 0,
      dropped: false,
    }));
  }
  function finalPairs(ids: string[], history: [string, string | null][]): string {
    const out = pairRound({
      players: ids.map((id) => ({ id })),
      matchHistory: history.map(([playerA, playerB]) => ({ playerA, playerB })),
      standings: mkStandings(ids),
      roundNumber: 4,
      isFinalRound: true,
      powerPairFinal: true,
      seed: "power",
    });
    return out.pairings.map(([a, b]) => `${a}-${b ?? "BYE"}`).join(" ");
  }
  const eight = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"];

  let got = finalPairs(eight, []);
  assert(got === "P1-P2 P3-P4 P5-P6 P7-P8", `no history: ${got}`);
  got = finalPairs(eight, [["P1", "P2"]]);
  assert(got === "P1-P3 P2-P4 P5-P6 P7-P8", `P1 already played P2: ${got}`);
  got = finalPairs(eight, [["P1", "P2"], ["P1", "P3"], ["P5", "P6"]]);
  assert(got === "P1-P4 P2-P3 P5-P7 P6-P8", `skip two for P1, skip one for P5: ${got}`);
  // Greedy would take P1-P3 and leave P2-P4, a rematch. Lookahead finds P1-P4, P2-P3.
  got = finalPairs(["P1", "P2", "P3", "P4"], [["P1", "P2"], ["P4", "P2"], ["P4", "P3"]]);
  assert(got === "P1-P4 P2-P3", `lookahead avoids a forced rematch: ${got}`);
  // Here the weighted fallback would give P1-P5 P2-P3 P4-P6, so this only
  // passes if the power pairer itself looks ahead: P2-P3 would strand P5-P6.
  got = finalPairs(
    ["P1", "P2", "P3", "P4", "P5", "P6"],
    [["P1", "P2"], ["P1", "P3"], ["P1", "P6"], ["P2", "P4"], ["P3", "P4"], ["P5", "P6"]],
  );
  assert(got === "P1-P4 P2-P5 P3-P6", `lookahead keeps rank order below a dead end: ${got}`);
  // Odd field: P7 (last) already had a bye, so P6 gets it.
  got = finalPairs(["P1", "P2", "P3", "P4", "P5", "P6", "P7"], [["P7", null]]);
  assert(got === "P1-P2 P3-P4 P5-P7 P6-BYE", `bye to lowest-ranked without one: ${got}`);
  console.log("ok   1v2/3v4 order, rematch skipping, lookahead, bye recipient");
}

// ---------------------------------------------------------------------------
// 2f. Manual pairing warnings, round count, top cut.
// ---------------------------------------------------------------------------
console.log("\n--- Manual pairings, round count, top cut ---");
{
  const players: SwissPlayer[] = ["A", "B", "C", "D", "E"].map((id) => ({ id }));
  const history = [res(1, "A", "B"), res(1, "C", "D"), res(1, "E", null)];
  const st = computeStandings(players, history, {}, createRng("manual"));
  const manual: Pairing[] = [
    ["A", "B"], // rematch, 3 vs 0
    ["C", "E"], // 3 vs 3: clean
    ["D", "A"], // duplicate A, 0 vs 3
  ];
  const warnings = validateManualPairings(manual, history, st);
  const codes = warnings.map((w) => `${w.code}:${[...w.playerIds].sort().join("")}`).sort();
  const expected = ["duplicate_player:A", "point_mismatch:AB", "point_mismatch:AD", "rematch:AB"].sort();
  assert(JSON.stringify(codes) === JSON.stringify(expected), `manual warnings ${JSON.stringify(codes)}`);
  assert(validateManualPairings([["A", "C"], ["B", "D"], ["E", null]], history, st).length === 0, "clean pairing has no warnings");

  const rounds: [number, number][] = [[4, 3], [8, 3], [9, 4], [16, 4], [17, 5], [32, 5], [33, 6], [64, 6], [3, 2]];
  for (const [n, r] of rounds) assert(resolveRoundCount(n, {}) === r, `auto rounds for ${n} = ${resolveRoundCount(n, {})}, expected ${r}`);
  assert(resolveRoundCount(20, { swissRounds: 7 }) === 7, "explicit round count wins");

  const cuts: [number, number][] = [[4, 0], [6, 0], [7, 4], [16, 4], [17, 8], [64, 8]];
  for (const [n, c] of cuts) assert(resolveTopCutSize(n, {}) === c, `auto cut for ${n} = ${resolveTopCutSize(n, {})}, expected ${c}`);
  assert(resolveTopCutSize(6, { topCut: 8 }) === 4, "explicit 8 shrinks to 4 for 6 players");
  assert(resolveTopCutSize(30, { topCut: 0 }) === 0, "explicit none");
  assert(resolveTopCutSize(10, { topCut: 4 }) === 4, "explicit 4");

  const dropped = computeStandings(
    players.map((p) => ({ ...p, dropped: p.id === "C" })),
    history,
    {},
    createRng("manual"),
  );
  const seeds = topCutSeeds(dropped, 4);
  assert(seeds.length === 4 && !seeds.includes("C"), `top cut skips dropped C: ${seeds.join(",")}`);
  assert(
    JSON.stringify(seeds) ===
      JSON.stringify(dropped.filter((s) => !s.dropped).map((s) => s.playerId).slice(0, 4)),
    "top cut seeds follow rank order",
  );
  console.log("ok   duplicate/rematch/point-mismatch warnings; auto rounds and cut sizes; cut seeds");
}

// ---------------------------------------------------------------------------
// 3. Property tests over random events.
// ---------------------------------------------------------------------------
console.log("\n--- Property tests: 500 random events ---");

/** Every perfect pairing of `ids` (+ one bye when odd), for small fields. */
function allPairings(ids: string[]): { pairs: [string, string][]; bye: string | null }[] {
  const out: { pairs: [string, string][]; bye: string | null }[] = [];
  const rec = (rest: string[], pairs: [string, string][], bye: string | null) => {
    if (rest.length === 0) {
      out.push({ pairs: [...pairs], bye });
      return;
    }
    const [first, ...others] = rest;
    if (rest.length % 2 === 1 && bye === null) rec(others, pairs, first); // first takes the bye
    for (let i = 0; i < others.length; i++) {
      pairs.push([first, others[i]]);
      rec([...others.slice(0, i), ...others.slice(i + 1)], pairs, bye);
      pairs.pop();
    }
  };
  rec(ids, [], null);
  return out.filter((p) => (ids.length % 2 === 1) === (p.bye !== null));
}

/**
 * Depth-first search for a rematch-free pairing (independent of the engine),
 * with a step budget. `byeFilter` restricts who may take the bye.
 * Returns true (found), false (proved none), or null (budget exhausted).
 */
function findRematchFree(ids: string[], played: Set<string>, byeFilter: (id: string) => boolean): boolean | null {
  let steps = 0;
  const BUDGET = 2_000_000;
  const rec = (rest: string[], byeUsed: boolean): boolean | null => {
    if (++steps > BUDGET) return null;
    if (rest.length === 0) return true;
    const [first, ...others] = rest;
    let exhausted = false;
    if (!byeUsed && rest.length % 2 === 1 && byeFilter(first)) {
      const r = rec(others, true);
      if (r) return true;
      if (r === null) exhausted = true;
    }
    for (let i = 0; i < others.length; i++) {
      if (played.has(pk(first, others[i]))) continue;
      const r = rec([...others.slice(0, i), ...others.slice(i + 1)], byeUsed);
      if (r) return true;
      if (r === null) exhausted = true;
    }
    return exhausted ? null : false;
  };
  return rec(ids, ids.length % 2 === 0);
}

interface Outcome {
  a: number;
  b: number;
  d: number;
  time: boolean;
}
const OUTCOMES: Outcome[] = [
  { a: 2, b: 0, d: 0, time: false },
  { a: 2, b: 1, d: 0, time: false },
  { a: 0, b: 2, d: 0, time: false },
  { a: 1, b: 2, d: 0, time: false },
  { a: 2, b: 0, d: 1, time: false }, // a drawn game that doesn't count toward 2 wins
  { a: 1, b: 1, d: 0, time: true }, // time-out on equal games: match draw
  { a: 1, b: 1, d: 1, time: true }, // drawn game, then time-out level
  { a: 1, b: 0, d: 0, time: true }, // time-out with A ahead: A wins
  { a: 0, b: 1, d: 1, time: true }, // time-out with B ahead after a drawn game
  { a: 0, b: 0, d: 0, time: false }, // intentional draw
];

interface EventStats {
  rounds: number;
  pairings: number;
  bruteChecked: number;
  forcedRematches: number;
  forcedSecondByes: number;
  inconclusive: number;
  drops: number;
}

function runEvent(e: number, stats: EventStats | null): string {
  const label = `event ${e}`;
  const gen = createRng(`event-${e}`);
  const n = 4 + Math.floor(gen() * 61); // 4..64
  const totalRounds = 3 + Math.floor(gen() * 5); // 3..7
  const powerPairFinal = gen() < 0.5;
  const players: SwissPlayer[] = Array.from({ length: n }, (_, i) => ({ id: `p${String(i + 1).padStart(2, "0")}` }));
  const history: SwissMatchResult[] = [];
  const log: string[] = [];

  for (let round = 1; round <= totalRounds; round++) {
    const active = players.filter((p) => !p.dropped);
    if (active.length < 2) break;
    const standings = computeStandings(players, history, {}, createRng(`event-${e}:standings:${round}`));
    const input: PairRoundInput = {
      players,
      matchHistory: history,
      standings,
      roundNumber: round,
      isFinalRound: round === totalRounds,
      powerPairFinal,
      seed: `event-${e}:pairing`,
    };
    const out = pairRound(input);
    log.push(JSON.stringify(out), JSON.stringify(standings));

    if (stats) {
      stats.rounds++;
      const rl = `${label} r${round} (${active.length} active)`;

      // Standings invariants.
      assert(standings.length === players.length, `${rl}: standings length`);
      for (let i = 0; i < standings.length; i++) {
        const s = standings[i];
        assert(s.rank === i + 1, `${rl}: rank ${s.rank} at index ${i}`);
        assert(s.matchPoints === 3 * s.wins + s.draws, `${rl}: ${s.playerId} points`);
        if (i > 0) assert(standings[i - 1].matchPoints >= s.matchPoints, `${rl}: standings not sorted by points`);
      }

      // Determinism: identical inputs (fresh copies) give identical output.
      const again = pairRound(JSON.parse(JSON.stringify(input)) as PairRoundInput);
      assert(JSON.stringify(again) === JSON.stringify(out), `${rl}: pairRound not deterministic`);

      // Every active player exactly once; dropped players never.
      const activeIds = new Set(active.map((p) => p.id));
      const seen = new Map<string, number>();
      for (const [a, b] of out.pairings) {
        for (const id of b === null ? [a] : [a, b]) seen.set(id, (seen.get(id) ?? 0) + 1);
        if (b === null) assert(a === out.byeId, `${rl}: bye entry ${a} != byeId ${out.byeId}`);
      }
      for (const id of activeIds) assert(seen.get(id) === 1, `${rl}: ${id} paired ${seen.get(id) ?? 0} times`);
      for (const id of seen.keys()) assert(activeIds.has(id), `${rl}: dropped/unknown player ${id} paired`);
      assert((out.byeId !== null) === (active.length % 2 === 1), `${rl}: bye presence`);
      assert(out.pairings.filter(([, b]) => b === null).length === (out.byeId ? 1 : 0), `${rl}: one bye entry`);
      stats.pairings++;

      // Rematches and second byes.
      const played = new Set(history.filter((m) => m.playerB !== null).map((m) => pk(m.playerA, m.playerB as string)));
      const hadBye = new Set(history.filter((m) => m.playerB === null).map((m) => m.playerA));
      const realPairs = out.pairings.filter(([, b]) => b !== null) as [string, string][];
      const rematches = realPairs.filter(([a, b]) => played.has(pk(a, b))).length;
      const secondBye = out.byeId !== null && hadBye.has(out.byeId) ? 1 : 0;
      assert(
        out.warnings.filter((w) => w.code === "rematch").length === rematches,
        `${rl}: rematch warnings don't match rematches`,
      );
      if (rematches) stats.forcedRematches++;
      if (secondBye) stats.forcedSecondByes++;

      const ids = [...activeIds].sort();
      if (ids.length <= 10) {
        // Brute force: minimum (rematches, second byes) over every pairing.
        stats.bruteChecked++;
        let best: [number, number] = [Infinity, Infinity];
        for (const p of allPairings(ids)) {
          const r = p.pairs.filter(([a, b]) => played.has(pk(a, b))).length;
          const sb = p.bye !== null && hadBye.has(p.bye) ? 1 : 0;
          if (r < best[0] || (r === best[0] && sb < best[1])) best = [r, sb];
        }
        if (best[0] === 0) assert(rematches === 0, `${rl}: rematch made although a rematch-free pairing exists`);
        assert(rematches === best[0], `${rl}: ${rematches} rematches, minimum is ${best[0]}`);
        if (rematches === best[0]) {
          assert(secondBye === best[1], `${rl}: second bye given although an alternative exists`);
        }
      } else {
        if (rematches > 0) {
          const found = findRematchFree(ids, played, () => true);
          if (found === null) stats.inconclusive++;
          assert(found !== true, `${rl}: rematch made although a rematch-free pairing exists`);
        } else if (secondBye) {
          const found = findRematchFree(ids, played, (id) => !hadBye.has(id));
          if (found === null) stats.inconclusive++;
          assert(found !== true, `${rl}: second bye given although an alternative exists`);
        }
      }
    }

    // Results.
    for (const [a, b] of out.pairings) {
      if (b === null) {
        history.push(res(round, a, null));
        continue;
      }
      const o = OUTCOMES[Math.floor(gen() * OUTCOMES.length)];
      history.push(res(round, a, b, o.a, o.b, o.d, o.time));
    }

    // Mid-event drops (about 5% of active players per round).
    for (const p of players) {
      if (!p.dropped && gen() < 0.05) {
        p.dropped = true;
        if (stats) stats.drops++;
      }
    }
  }
  return log.join("\n");
}

{
  const stats: EventStats = {
    rounds: 0,
    pairings: 0,
    bruteChecked: 0,
    forcedRematches: 0,
    forcedSecondByes: 0,
    inconclusive: 0,
    drops: 0,
  };
  const started = Date.now();
  for (let e = 0; e < 500; e++) {
    const first = runEvent(e, stats);
    if (e % 25 === 0) {
      // Whole-event determinism: replaying the same seed reproduces every round.
      assert(runEvent(e, null) === first, `event ${e}: replay differs`);
    }
  }
  console.log(
    `ok   ${stats.rounds} rounds paired across 500 events in ${((Date.now() - started) / 1000).toFixed(1)}s; ` +
      `${stats.drops} drops; ${stats.bruteChecked} rounds brute-forced (≤10 active)`,
  );
  console.log(
    `     forced rematches: ${stats.forcedRematches} rounds, forced second byes: ${stats.forcedSecondByes} rounds ` +
      `(each proven unavoidable); inconclusive searches: ${stats.inconclusive}`,
  );
  assert(stats.inconclusive === 0, "some large-field searches were inconclusive");
}

console.log(
  failures
    ? `\n${failures} FAILURE(S).`
    : "\nAll swiss-engine tests passed (matching, standings, floor, byes, tiebreak, power pairing, warnings, properties).",
);
process.exit(failures ? 1 : 0);
