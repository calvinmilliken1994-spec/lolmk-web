// Top-cut tests: a 4-player and an 8-player cut played to a champion through
// the real rb-service operations over the in-memory store, with the pure
// bracket view, the desk queue and the champion summary checked at each step.
//   node --experimental-strip-types scripts/test-rb-cut.ts

import { registerHooks } from "node:module";
import type { RbActor, RbMatch, RbTournament } from "../src/types/riftbound";
import type { RbContext } from "../src/lib/rb-service";
import type { MemoryStore as MemoryStoreClass } from "./rb-memory-store";

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

const { MemoryStore } = await import("./rb-memory-store");
type MemoryStore = MemoryStoreClass;
const svc = await import("../src/lib/rb-service");
const cut = await import("../src/lib/rb-cut");
const model = await import("../src/components/riftbound/rb-cut-model");
const venue = await import("../src/components/riftbound/rb-venue-model");

let failures = 0;
let checks = 0;
function ok(cond: unknown, msg: string) {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`);

const DESK: RbActor = { discordId: "100000000000000003", name: "Desk Dee" };
const JUDGE: RbActor = { discordId: "100000000000000001", name: "Judge Ana" };

let keyN = 0;
const key = () => `cut-k-${++keyN}`;

async function play(players: number, cutSize: 4 | 8, swissRounds: number) {
  const store = new MemoryStore();
  let idN = 0;
  let seedN = 0;
  let nowMs = Date.parse("2026-10-10T10:00:00+09:00");
  const act = async <T>(actor: RbActor, label: string, op: (c: RbContext) => Promise<T>): Promise<T> => {
    store.begin();
    const ctx: RbContext = {
      store,
      actor,
      now: () => (nowMs += 1000),
      newId: (p) => `${p}_${String(++idN).padStart(5, "0")}`,
      newSeed: () => `seed-${++seedN}`,
      slug: null,
    };
    try {
      return await op(ctx);
    } catch (e) {
      store.rollback();
      throw new Error(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const fails = async (actor: RbActor, label: string, op: (c: RbContext) => Promise<unknown>, expect: RegExp) => {
    try {
      await act(actor, label, op);
      ok(false, `${label}: expected failure`);
    } catch (e) {
      ok(expect.test(e instanceof Error ? e.message : String(e)), `${label}: wrong error ${e instanceof Error ? e.message : e}`);
    }
  };

  const tag = `${cutSize}-cut`;
  const created = await act(DESK, "create", (c) => svc.createTournament(c, { name: `Cut Test ${cutSize}` }));
  const tid = created.id;
  await act(DESK, "config", (c) => svc.updateConfig(c, { tournamentId: tid, config: { swissRounds, topCut: cutSize } }));
  const names = Array.from({ length: players }, (_, i) => `Player ${String(i + 1).padStart(2, "0")}`);
  const added = await act(DESK, "players", (c) => svc.bulkAddPlayers(c, { tournamentId: tid, names }));
  await act(DESK, "legend", (c) => svc.updatePlayer(c, { playerId: added.added[0].id, legend: "Ahri" }));
  await act(DESK, "open", (c) => svc.openCheckIn(c, { tournamentId: tid }));
  for (const p of added.added) await act(DESK, "check in", (c) => svc.checkIn(c, { playerId: p.id }));
  await act(DESK, "r1", (c) => svc.closeCheckInAndPairRound1(c, { tournamentId: tid }));

  // Swiss: the lower table's A seat always wins 2-0, so the standings are deterministic enough.
  for (let n = 1; n <= swissRounds; n++) {
    if (n > 1) await act(DESK, `pair ${n}`, (c) => svc.pairNextRound(c, { tournamentId: tid }));
    const round = [...store.rounds.values()].find((r) => r.number === n)!;
    await act(DESK, `publish ${n}`, (c) => svc.publishRound(c, { roundId: round.id }));
    await act(DESK, `start ${n}`, (c) => svc.startClock(c, { roundId: round.id }));
    for (const m of [...store.matches.values()].filter((x) => x.round_id === round.id && x.status === "pending")) {
      await act(JUDGE, "report", (c) =>
        svc.reportResult(c, { matchId: m.id, gamesA: 2, gamesB: m.table_number % 3 === 0 ? 1 : 0, gamesDrawn: 0, decidedOnTime: false, idempotencyKey: key() }),
      );
    }
    await act(DESK, `close ${n}`, (c) => svc.closeRound(c, { roundId: round.id }));
  }

  // ---- Cut ----
  const made = await act(DESK, "cutToTop", (c) => svc.cutToTop(c, { tournamentId: tid }));
  const seeds = made.seeds;
  eq(seeds.length, cutSize, `${tag}: cut size`);
  const stateOf = () => {
    const full = store.full(tid);
    return {
      ...full,
      standings: svc.computeRbStandings(full),
      topCutSeeds: seeds,
    };
  };
  const deskState = () => stateOf() as unknown as Parameters<typeof model.rbCutDesk>[0];

  let level = 0;
  let champion: string | null = null;
  const depth = Math.log2(cutSize);
  const sizes: number[] = [];
  while (!champion) {
    const round = level === 0 ? made.round : (await act(DESK, `pair cut ${level}`, (c) => svc.pairNextRound(c, { tournamentId: tid }))).round;
    const tables = () => [...store.matches.values()].filter((m) => m.round_id === round.id).sort((a, b) => a.table_number - b.table_number);
    sizes.push(tables().length);

    // Draft: nothing can be reported or started yet.
    let d = model.rbCutDesk(deskState());
    ok(d.round?.id === round.id && d.round.status === "draft" && !d.reportable, `${tag} L${level}: draft round is not reportable`);
    await fails(JUDGE, "report draft", (c) => svc.reportTopCutResult(c, { matchId: tables()[0].id, gamesA: 2, gamesB: 0, gamesDrawn: 0, idempotencyKey: key() }), /isn't running|hasn't been published/);
    await fails(DESK, "start draft", (c) => svc.setMatchStarted(c, { matchId: tables()[0].id, started: true }), /isn't running/);

    await act(DESK, "publish", (c) => svc.publishRound(c, { roundId: round.id }));
    ok(store.tournaments.get(tid)?.scene === "top_cut", `${tag} L${level}: publishing a cut round follows to the bracket`);
    d = model.rbCutDesk(deskState());
    ok(d.reportable && d.queue.length === tables().length && d.finished.length === 0 && d.undo === null, `${tag} L${level}: queue is every table, nothing to undo`);
    ok(d.isFinal === (level === depth - 1), `${tag} L${level}: isFinal`);
    eq(d.roundName, cut.cutLevelName(depth, level).text, `${tag} L${level}: round name`);
    ok(d.queue.every((r) => r.a.seed < r.b!.seed), `${tag} L${level}: higher seed listed first in the queue`);

    // LIVE tag.
    const first = tables()[0];
    await act(DESK, "start", (c) => svc.setMatchStarted(c, { matchId: first.id, started: true }));
    ok(store.matches.get(first.id)?.started_at, `${tag} L${level}: started_at set`);
    let view = venue.rbVenueCut(publicData(stateOf()))!;
    ok(view.cards.filter((c) => c.live).length === 1 && view.cards.find((c) => c.matchId === first.id)?.live, `${tag} L${level}: exactly the started card is LIVE`);
    eq(model.rbCutDesk(deskState()).queue[0].status, "live", `${tag} L${level}: desk row is live`);
    await act(DESK, "unstart", (c) => svc.setMatchStarted(c, { matchId: first.id, started: false }));
    ok(venue.rbVenueCut(publicData(stateOf()))!.cards.every((c) => !c.live), `${tag} L${level}: live mark removed`);
    await act(DESK, "restart", (c) => svc.setMatchStarted(c, { matchId: first.id, started: true }));

    // Report every table; the lower-numbered seed wins unless it's table 2 of a 4-table round (an upset).
    for (const m of tables()) {
      const aIsHigher = seeds.indexOf(m.player_a_id) < seeds.indexOf(m.player_b_id as string);
      const upset = level === 0 && m.table_number === 2;
      const aWins = upset ? !aIsHigher : aIsHigher;
      await act(JUDGE, "report", (c) =>
        svc.reportTopCutResult(c, { matchId: m.id, gamesA: aWins ? 2 : level === depth - 1 ? 1 : 0, gamesB: aWins ? (level === depth - 1 ? 1 : 0) : 2, gamesDrawn: 0, idempotencyKey: key() }),
      );
    }
    d = model.rbCutDesk(deskState());
    ok(d.queue.length === 0 && d.finished.length === tables().length, `${tag} L${level}: all reported`);
    ok(d.undo?.matchId === tables().at(-1)!.id, `${tag} L${level}: undo points at the newest result`);

    // Undo the latest and report it the other way round, then again as first.
    const last = tables().at(-1)!;
    await act(DESK, "undo", (c) => svc.undoTopCutResult(c, { matchId: last.id }));
    d = model.rbCutDesk(deskState());
    ok(d.queue.some((r) => r.matchId === last.id) && d.undo?.matchId !== last.id, `${tag} L${level}: undo puts the table back in the queue`);
    ok(venue.rbVenueCut(publicData(stateOf()))!.cards.find((c) => c.matchId === last.id)!.done === false, `${tag} L${level}: card is open again`);
    const aIsHigher = seeds.indexOf(last.player_a_id) < seeds.indexOf(last.player_b_id as string);
    const upset = level === 0 && last.table_number === 2;
    const aWins = upset ? !aIsHigher : aIsHigher;
    await act(JUDGE, "re-report", (c) =>
      svc.reportTopCutResult(c, { matchId: last.id, gamesA: aWins ? 2 : level === depth - 1 ? 1 : 0, gamesB: aWins ? (level === depth - 1 ? 1 : 0) : 2, gamesDrawn: 0, idempotencyKey: key() }),
    );

    // Bracket view after the round.
    view = venue.rbVenueCut(publicData(stateOf()))!;
    const doneCards = view.cards.filter((c) => c.level === level);
    ok(doneCards.every((c) => c.done && c.slots.some((s) => s.state === "winner") && c.slots.some((s) => s.state === "loser")), `${tag} L${level}: winners and losers marked`);
    ok(doneCards.every((c) => c.slots[0].seed! < c.slots[1].seed!), `${tag} L${level}: higher seed first on every card`);
    ok(doneCards.every((c) => !c.live), `${tag} L${level}: no LIVE tag once reported`);

    if (level === depth - 1) {
      await fails(DESK, "pair after final", (c) => svc.pairNextRound(c, { tournamentId: tid }), /isn't closed|finished/);
      d = model.rbCutDesk(deskState());
      ok(d.finalReported && d.isFinal, `${tag}: the desk sees the final reported`);
      const done = await act(DESK, "completeEvent", (c) => svc.completeEvent(c, { tournamentId: tid }));
      champion = done.championId;
    } else {
      await act(DESK, "close", (c) => svc.closeRound(c, { roundId: round.id }));
      ok(store.tournaments.get(tid)?.scene === "top_cut", `${tag} L${level}: closing a cut round keeps the bracket up`);
    }
    level++;
  }
  eq(sizes, depth === 2 ? [2, 1] : [4, 2, 1], `${tag}: tables per round`);

  // ---- Champion ----
  const t = store.tournaments.get(tid) as RbTournament;
  ok(t.status === "completed" && t.champion_player_id === champion && t.scene === "champion", `${tag}: completed with the champion scene`);
  const full = store.full(tid);
  const standings = svc.computeRbStandings(full);
  const summary = cut.rbChampionSummary(full, standings)!;
  ok(summary && summary.playerId === champion, `${tag}: champion summary`);
  const finalRound = full.rounds.filter((r) => r.stage === "top_cut").at(-1)!;
  const fm = full.matches.find((m) => m.round_id === finalRound.id) as RbMatch;
  const champIsA = fm.player_a_id === champion;
  eq([summary.finalFor, summary.finalAgainst], champIsA ? [fm.games_a, fm.games_b] : [fm.games_b, fm.games_a], `${tag}: final score from the champion's side`);
  eq(summary.playoffRecord, `${depth}-0`, `${tag}: playoff record`);
  eq(summary.swissRecord, standings.find((s) => s.playerId === champion)!.record, `${tag}: Swiss record`);
  eq(summary.seed, seeds.indexOf(champion!) + 1, `${tag}: seed`);
  eq(summary.cutSize, cutSize, `${tag}: cut size in summary`);
  eq(summary.swissRounds, swissRounds, `${tag}: Swiss rounds in summary`);
  ok(summary.finalOpponent && summary.finalOpponent !== summary.name, `${tag}: finalist named`);
  if (champion === added.added[0].id) eq(summary.legend, "Ahri", `${tag}: legend`);

  // Not published before completion.
  const open = store.full(tid);
  open.tournament = { ...open.tournament, status: "in_progress", champion_player_id: null };
  ok(cut.rbChampionSummary(open, standings) === null, `${tag}: no champion summary before completion`);

  // Hall of Champions row.
  // (champions.ts itself uses "@/" imports, so the Hall's mapping lives in rb-cut.ts and is tested here.)
  const row = cut.rbChampionRecord(full, standings)!;
  eq([row.game, row.champion.name, row.runnerUp?.name, row.teams, row.source], ["Riftbound", summary.name, summary.finalOpponent, players, "live"], `${tag}: Hall row`);
  ok(row.id === `rb-${t.slug}` && row.tournament === t.name && row.date === t.updated_at, `${tag}: Hall row id, name, date`);
  ok(cut.rbChampionRecord(open, standings) === null, `${tag}: no Hall row before completion`);

  // Venue champion data is only there once complete.
  const data = publicData(full, summary);
  ok(data.champion?.name === summary.name, `${tag}: venue data carries the champion`);
  ok(publicData(open).champion === null, `${tag}: no champion in venue data before completion`);
  console.log(`ok   ${tag}: ${players} players, ${swissRounds} Swiss rounds, cut ${sizes.join("-")} -> ${summary.name} (seed ${summary.seed}) ${summary.finalFor}-${summary.finalAgainst} over ${summary.finalOpponent}`);
  return { store, tid, seeds, full, summary };
}

function publicData(full: ReturnType<MemoryStore["full"]>, champion: ReturnType<typeof cut.rbChampionSummary> = null) {
  const standings = svc.computeRbStandings(full);
  return {
    tournament: { ...full.tournament, config: { ...full.tournament.config }, },
    players: full.players,
    rounds: full.rounds,
    matches: full.matches,
    standings,
    champion: champion ?? cut.rbChampionSummary(full, standings),
  } as unknown as Parameters<typeof venue.rbVenueCut>[0];
}

// ---- Pure layout ----
{
  const mk = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);
  const names = new Map(mk(8).map((id, i) => [id, `Name ${i + 1}`]));
  const v8 = cut.rbCutView(mk(8), 3, [], [], names, new Map());
  eq([v8.size, v8.depth, v8.cards.length], [8, 3, 7], "8-cut view: 7 cards");
  eq(v8.cards.filter((c) => c.level === 0).map((c) => c.top), [0, 200, 400, 600], "8-cut: QF tops");
  eq(v8.cards.filter((c) => c.level === 1).map((c) => [c.left, c.top]), [[600, 100], [600, 500]], "8-cut: SF positions");
  eq(v8.cards.filter((c) => c.level === 2).map((c) => [c.left, c.top]), [[1200, 300]], "8-cut: final position");
  eq(v8.connectors.length, 6, "8-cut: 3 joins and 3 stubs per... 6 lines");
  eq(v8.cards.filter((c) => c.level === 0).map((c) => c.slots.map((s) => s.seed)), [[1, 8], [4, 5], [2, 7], [3, 6]], "8-cut: seeding 1v8 4v5 2v7 3v6");
  eq(v8.cards.find((c) => c.level === 1)!.slots.map((s) => s.name), ["Winner QF1", "Winner QF2"], "8-cut: SF placeholders");
  const v4 = cut.rbCutView(mk(4), 3, [], [], names, new Map());
  eq([v4.size, v4.cards.length], [4, 3], "4-cut view: 3 cards");
  eq(v4.cards.filter((c) => c.level === 0).map((c) => c.slots.map((s) => s.seed)), [[1, 4], [2, 3]], "4-cut: seeding 1v4 2v3");
  eq(v4.labels.map((l) => l.text), ["SEMIFINALS", "FINAL"], "4-cut: labels");
  ok(v4.cards.every((c) => c.left + 460 <= 1920 - 144), "4-cut fits the stage");
  ok(v8.cards.every((c) => c.left + 460 <= 1920 - 144), "8-cut fits the stage");
}

const a = await play(8, 4, 3);
const b = await play(16, 8, 4);
void a;
void b;

if (failures > 0) {
  console.error(`\n${failures} of ${checks} checks failed.`);
  process.exit(1);
}
console.log(`ok: ${checks} checks passed.`);
