// End-to-end scenario for the Riftbound tournament tool, run against an
// in-memory store (no database). Run directly:
//   node --experimental-strip-types scripts/test-rb-scenario.ts
//
// What it exercises: the real operations in src/lib/rb-service.ts — the same
// code the server actions in src/app/tools/riftbound/actions.ts call —
// with the Swiss engine, the bracket engine and the rb-db clock/export
// helpers. A 31-player, 5-round Swiss event with a no-show, a bye, game and
// match draws, a time-out, drops (via a report, between rounds with an undo,
// a DQ mid-round, and one after the cut), a duplicate submission and a
// conflicting report, then a top 8 cut played to a champion.
//
// The memory store is deliberately strict, so the scenario also checks the
// operations' contract:
//   - every write needs a FOR UPDATE-equivalent lock taken earlier in the
//     same call on that row (or its tournament, for inserts)
//   - locks follow the documented order tournament -> rounds -> matches -> players
//   - every successful mutation writes at least one audit row, with the actor
//   - a failed call rolls back completely (snapshot restore, like a transaction)
//   - the DB constraints that matter (unique idempotency key, unique table per
//     round, unique round number, bye iff no opponent, RESTRICT deletes)
//
// Not covered here: the SQL in rb-pg-store.ts / rb-db.ts and real row-lock
// contention. That needs a Postgres database (see the note at the bottom).

import { registerHooks } from "node:module";
import type { RbActor, RbAuditAction, RbMatch, RbPlayer, RbRound, RbTournament, RbTournamentFull } from "../src/types/riftbound";
import type {
  RbContext,
  RbMatchPatch,
  RbPlayerPatch,
  RbRoundPatch,
  RbStore,
  RbTournamentPatch,
  SwissReportInput,
} from "../src/lib/rb-service";

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

const svc = await import("../src/lib/rb-service");
const { createRng, topCutSeeds } = await import("../src/lib/swiss-engine");
const { clockRemainingMs, toPublicMatch, toPublicTournament } = await import("../src/lib/rb-db");

let failures = 0;
let checks = 0;
function ok(cond: unknown, msg: string) {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

const LEVEL = { tournament: 0, round: 1, match: 2, player: 3 } as const;
type Kind = keyof typeof LEVEL;

interface AuditRow {
  tournamentId: string;
  action: RbAuditAction;
  detail: Record<string, unknown> | null;
  actor: RbActor;
  call: number;
}

class MemoryStore implements RbStore {
  tournaments = new Map<string, RbTournament>();
  players = new Map<string, RbPlayer>();
  rounds = new Map<string, RbRound>();
  matches = new Map<string, RbMatch>();
  audits: AuditRow[] = [];

  // Per-call transaction state.
  call = 0;
  private snapshot: string | null = null;
  private locked = new Set<string>(); // "kind:id"
  private maxLevel = -1;
  writes = 0;

  begin() {
    this.call++;
    this.snapshot = JSON.stringify({
      t: [...this.tournaments],
      p: [...this.players],
      r: [...this.rounds],
      m: [...this.matches],
      a: this.audits,
    });
    this.locked.clear();
    this.maxLevel = -1;
    this.writes = 0;
  }
  rollback() {
    const s = JSON.parse(this.snapshot as string);
    this.tournaments = new Map(s.t);
    this.players = new Map(s.p);
    this.rounds = new Map(s.r);
    this.matches = new Map(s.m);
    this.audits = s.a;
  }

  private lock(kind: Kind, ids: string[]) {
    if (LEVEL[kind] < this.maxLevel) {
      throw new Error(`lock order violation: ${kind} after level ${this.maxLevel}`);
    }
    this.maxLevel = LEVEL[kind];
    for (const id of ids) this.locked.add(`${kind}:${id}`);
  }
  private requireLock(kind: Kind, id: string) {
    if (!this.locked.has(`${kind}:${id}`)) throw new Error(`write to ${kind} ${id} without a row lock`);
    this.writes++;
  }
  private clone<T>(v: T): T {
    return structuredClone(v);
  }
  private checkMatch(m: RbMatch) {
    if ((m.player_b_id === null) !== (m.status === "bye")) throw new Error(`constraint: bye iff no opponent (${m.id})`);
    if (m.player_b_id !== null && m.player_a_id === m.player_b_id) throw new Error("constraint: distinct players");
    for (const o of this.matches.values()) {
      if (o.id === m.id) continue;
      if (o.round_id === m.round_id && o.table_number === m.table_number) throw new Error("constraint: table unique");
      if (m.idempotency_key && o.idempotency_key === m.idempotency_key) throw new Error("constraint: idempotency key unique");
    }
    if (m.status === "completed" && !(m.reported_by_id && m.reported_by_name && m.reported_at)) {
      throw new Error("constraint: completed has reporter");
    }
  }

  async findMatchRef(matchId: string) {
    const m = this.matches.get(matchId);
    return m ? { tournamentId: m.tournament_id, roundId: m.round_id } : null;
  }
  async findRoundTournamentId(roundId: string) {
    return this.rounds.get(roundId)?.tournament_id ?? null;
  }
  async findPlayerTournamentId(playerId: string) {
    return this.players.get(playerId)?.tournament_id ?? null;
  }
  async slugTaken(slug: string) {
    return [...this.tournaments.values()].some((t) => t.slug.toLowerCase() === slug.toLowerCase());
  }

  async lockTournament(id: string) {
    this.lock("tournament", [id]);
    const t = this.tournaments.get(id);
    return t ? this.clone(t) : null;
  }
  async lockRounds(tid: string) {
    const rs = [...this.rounds.values()].filter((r) => r.tournament_id === tid).sort((a, b) => a.number - b.number);
    this.lock("round", rs.map((r) => r.id));
    return this.clone(rs);
  }
  async lockRound(tid: string, rid: string) {
    const r = this.rounds.get(rid);
    this.lock("round", [rid]);
    return r && r.tournament_id === tid ? this.clone(r) : null;
  }
  async lockTournamentMatches(tid: string) {
    const num = (m: RbMatch) => this.rounds.get(m.round_id)?.number ?? 0;
    const ms = [...this.matches.values()]
      .filter((m) => m.tournament_id === tid)
      .sort((a, b) => num(a) - num(b) || a.table_number - b.table_number);
    this.lock("match", ms.map((m) => m.id));
    return this.clone(ms);
  }
  async lockMatch(tid: string, mid: string) {
    const m = this.matches.get(mid);
    this.lock("match", [mid]);
    return m && m.tournament_id === tid ? this.clone(m) : null;
  }
  async lockPlayers(tid: string) {
    const ps = [...this.players.values()].filter((p) => p.tournament_id === tid).sort((a, b) => (a.id < b.id ? -1 : 1));
    this.lock("player", ps.map((p) => p.id));
    return this.clone(ps);
  }
  async findMatchByIdempotencyKey(key: string) {
    const m = [...this.matches.values()].find((x) => x.idempotency_key === key);
    return m ? this.clone(m) : null;
  }

  async insertTournament(t: RbTournament) {
    if (await this.slugTaken(t.slug)) throw new Error("constraint: slug unique");
    this.writes++;
    this.tournaments.set(t.id, this.clone(t));
    this.locked.add(`tournament:${t.id}`);
  }
  async updateTournament(id: string, patch: RbTournamentPatch) {
    this.requireLock("tournament", id);
    const t = this.tournaments.get(id) as RbTournament;
    Object.assign(t, this.clone(patch));
    if (t.status === "completed" && !t.champion_player_id) throw new Error("constraint: completed has champion");
  }
  async insertPlayer(p: RbPlayer) {
    this.requireLock("tournament", p.tournament_id);
    this.players.set(p.id, this.clone(p));
    this.locked.add(`player:${p.id}`);
  }
  async updatePlayer(tid: string, id: string, patch: RbPlayerPatch) {
    this.requireLock("player", id);
    Object.assign(this.players.get(id) as RbPlayer, this.clone(patch));
  }
  async deletePlayer(tid: string, id: string) {
    this.requireLock("player", id);
    if ([...this.matches.values()].some((m) => m.player_a_id === id || m.player_b_id === id)) {
      throw new Error("constraint: player referenced by a match (RESTRICT)");
    }
    this.players.delete(id);
  }
  async insertRound(r: RbRound) {
    this.requireLock("tournament", r.tournament_id);
    if ([...this.rounds.values()].some((x) => x.tournament_id === r.tournament_id && x.number === r.number)) {
      throw new Error("constraint: round number unique");
    }
    this.rounds.set(r.id, this.clone(r));
    this.locked.add(`round:${r.id}`);
  }
  async updateRound(tid: string, id: string, patch: RbRoundPatch) {
    this.requireLock("round", id);
    Object.assign(this.rounds.get(id) as RbRound, this.clone(patch));
  }
  async deleteRound(tid: string, id: string) {
    this.requireLock("round", id);
    if ([...this.matches.values()].some((m) => m.round_id === id)) throw new Error("constraint: round has matches (RESTRICT)");
    this.rounds.delete(id);
  }
  async insertMatch(m: RbMatch) {
    this.requireLock("round", m.round_id);
    this.checkMatch(m);
    this.matches.set(m.id, this.clone(m));
    this.locked.add(`match:${m.id}`);
  }
  async updateMatch(tid: string, id: string, patch: RbMatchPatch) {
    this.requireLock("match", id);
    const next = { ...(this.matches.get(id) as RbMatch), ...this.clone(patch) };
    this.checkMatch(next);
    this.matches.set(id, next);
  }
  async deleteRoundMatches(tid: string, roundId: string) {
    for (const m of [...this.matches.values()].filter((x) => x.round_id === roundId)) {
      this.requireLock("match", m.id);
      this.matches.delete(m.id);
    }
  }
  async writeAudit(tournamentId: string, action: RbAuditAction, detail: Record<string, unknown> | null, actor: RbActor) {
    if (!actor?.discordId?.trim() || !actor?.name?.trim()) throw new Error("audit without actor");
    this.audits.push({ tournamentId, action, detail: this.clone(detail), actor: { ...actor }, call: this.call });
  }

  full(tid: string): RbTournamentFull {
    const num = (m: RbMatch) => this.rounds.get(m.round_id)?.number ?? 0;
    return this.clone({
      tournament: this.tournaments.get(tid) as RbTournament,
      players: [...this.players.values()].filter((p) => p.tournament_id === tid),
      rounds: [...this.rounds.values()].filter((r) => r.tournament_id === tid).sort((a, b) => a.number - b.number),
      matches: [...this.matches.values()]
        .filter((m) => m.tournament_id === tid)
        .sort((a, b) => num(a) - num(b) || a.table_number - b.table_number),
    });
  }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const ANA: RbActor = { discordId: "100000000000000001", name: "Judge Ana" };
const BO: RbActor = { discordId: "100000000000000002", name: "Judge Bo" };
const DESK: RbActor = { discordId: "100000000000000003", name: "Desk Dee" };

function runScenario(verbose: boolean) {
  const store = new MemoryStore();
  let nowMs = Date.parse("2026-10-10T10:00:00+09:00");
  let idN = 0;
  let seedN = 0;
  let calls = 0;
  let failedAsExpected = 0;
  const log = (s: string) => verbose && console.log(s);

  async function act<T>(actor: RbActor, label: string, op: (ctx: RbContext) => Promise<T>): Promise<T> {
    store.begin();
    const ctx: RbContext = {
      store,
      actor,
      now: () => nowMs,
      newId: (p) => `${p}_${String(++idN).padStart(5, "0")}`,
      newSeed: () => `seed-${++seedN}`,
      slug: null,
    };
    try {
      const out = await op(ctx);
      calls++;
      const audits = store.audits.filter((a) => a.call === store.call);
      if (store.writes > 0) {
        ok(audits.length > 0, `${label}: wrote without an audit row`);
        ok(audits.every((a) => a.actor.discordId === actor.discordId && a.actor.name === actor.name), `${label}: audit actor`);
      }
      return out;
    } catch (e) {
      store.rollback();
      throw new Error(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function actFails(actor: RbActor, label: string, op: (ctx: RbContext) => Promise<unknown>, expect: RegExp) {
    const before = JSON.stringify([...store.matches, ...store.players, ...store.rounds, ...store.tournaments]);
    const auditsBefore = store.audits.length;
    try {
      await act(actor, label, op);
      ok(false, `${label}: expected failure ${expect}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      ok(expect.test(msg), `${label}: wrong error "${msg}" (expected ${expect})`);
      ok(!/constraint|without a row lock|lock order|audit without/.test(msg), `${label}: contract violation "${msg}"`);
      failedAsExpected++;
    }
    const after = JSON.stringify([...store.matches, ...store.players, ...store.rounds, ...store.tournaments]);
    ok(before === after && auditsBefore === store.audits.length, `${label}: failed call left changes behind`);
  }

  return { store, act, actFails, log, advance: (ms: number) => (nowMs += ms), stats: () => ({ calls, failedAsExpected }) };
}

type Harness = ReturnType<typeof runScenario>;

const OUTCOMES: [number, number, number, boolean][] = [
  [2, 0, 0, false],
  [2, 1, 0, false],
  [0, 2, 0, false],
  [1, 2, 0, false],
  [2, 1, 1, false], // a drawn game on the way to 2 wins
  [1, 0, 0, true], // time-out, A ahead: A wins
  [0, 1, 0, true], // time-out, B ahead
  [1, 1, 0, true], // time-out, level: match draw
  [1, 1, 1, true], // drawn game, then time-out level
  [0, 0, 0, false], // intentional draw
];

let keyN = 0;
const key = () => `k-${++keyN}`;

async function scenario(h: Harness) {
  const { store, act, actFails, log } = h;
  const gen = createRng("scenario");
  const tidOf = async () => [...store.tournaments.keys()][0];

  // ---- Setup ---------------------------------------------------------------
  const created = await act(DESK, "createTournament", (c) => svc.createTournament(c, { name: "Riftbound Test Cup" }));
  const tid = created.id;
  ok(created.slug === "riftbound-test-cup", `slug ${created.slug}`);
  await act(DESK, "updateConfig before R1", (c) => svc.updateConfig(c, { tournamentId: tid, config: { roundMinutes: 50 } }));

  const names = Array.from({ length: 32 }, (_, i) => `Player ${String(i + 1).padStart(2, "0")}`);
  const bulk = await act(DESK, "bulkAddPlayers", (c) =>
    svc.bulkAddPlayers(c, { tournamentId: tid, names: [...names, "player 05", "  "] }),
  );
  ok(bulk.added.length === 32 && bulk.skipped.length === 1, `bulk add ${bulk.added.length} added, ${bulk.skipped.length} skipped`);
  const larry = await act(DESK, "addPlayer", (c) =>
    svc.addPlayer(c, { tournamentId: tid, displayName: "Late Larry", memberDiscordId: "200000000000000009", legend: "Jinx" }),
  );
  await actFails(DESK, "addPlayer duplicate", (c) => svc.addPlayer(c, { tournamentId: tid, displayName: "late larry" }), /already registered/);
  await act(DESK, "updatePlayer", (c) => svc.updatePlayer(c, { playerId: bulk.added[0].id, legend: "Ahri" }));
  await act(DESK, "removePlayer", (c) => svc.removePlayer(c, { playerId: larry.id }));

  // ---- Check-in ------------------------------------------------------------
  await actFails(DESK, "checkIn before open", (c) => svc.checkIn(c, { playerId: bulk.added[0].id }), /Check-in isn't open/);
  await act(DESK, "openCheckIn", (c) => svc.openCheckIn(c, { tournamentId: tid }));
  const noShow = bulk.added[31];
  for (const p of bulk.added.slice(0, 31)) await act(DESK, "checkIn", (c) => svc.checkIn(c, { playerId: p.id }));
  await act(DESK, "undoCheckIn", (c) => svc.undoCheckIn(c, { playerId: bulk.added[3].id }));
  await act(DESK, "checkIn again", (c) => svc.checkIn(c, { playerId: bulk.added[3].id }));
  await actFails(DESK, "checkIn twice", (c) => svc.checkIn(c, { playerId: bulk.added[3].id }), /already checked in/);

  const r1 = await act(DESK, "closeCheckInAndPairRound1", (c) => svc.closeCheckInAndPairRound1(c, { tournamentId: tid }));
  let full = store.full(tid);
  ok(full.tournament.config.swissRounds === 5, `31 players -> 5 rounds (got ${full.tournament.config.swissRounds})`);
  ok(Boolean(full.tournament.config.tiebreakSeed), "tiebreak seed generated");
  ok(full.players.filter((p) => p.status === "active").length === 31, "31 active players");
  ok(full.players.find((p) => p.id === noShow.id)?.status === "registered", "no-show stays registered");
  let r1Matches = full.matches.filter((m) => m.round_id === r1.round.id);
  ok(r1Matches.length === 16 && r1Matches.filter((m) => m.status === "bye").length === 1, "R1: 15 tables + 1 bye");
  ok(!r1Matches.some((m) => m.player_a_id === noShow.id || m.player_b_id === noShow.id), "no-show not paired");
  ok(r1Matches.every((m) => m.status !== "bye" || (m.games_a === 2 && m.games_b === 0)), "bye recorded 2-0");
  log(`ok   setup: 32 registered, 31 checked in, 5 rounds, R1 has 15 tables + bye`);

  // ---- Lock rules ----------------------------------------------------------
  await actFails(DESK, "roundMinutes after R1", (c) => svc.updateConfig(c, { tournamentId: tid, config: { roundMinutes: 40 } }), /locked once Round 1/);
  await actFails(DESK, "bestOf after R1", (c) => svc.updateConfig(c, { tournamentId: tid, config: { bestOf: 1 } }), /locked once Round 1/);
  await actFails(DESK, "scoring after R1", (c) => svc.updateConfig(c, { tournamentId: tid, config: { scoring: { winPercentFloor: 0.4 } } }), /locked once Round 1/);
  await act(DESK, "swissRounds 6", (c) => svc.updateConfig(c, { tournamentId: tid, config: { swissRounds: 6 } }));
  await act(DESK, "swissRounds back to 5", (c) => svc.updateConfig(c, { tournamentId: tid, config: { swissRounds: 5 } }));
  await actFails(DESK, "swissRounds auto after R1", (c) => svc.updateConfig(c, { tournamentId: tid, config: { swissRounds: "auto" } }), /fixed/);
  await actFails(DESK, "addPlayer after R1", (c) => svc.addPlayer(c, { tournamentId: tid, displayName: "Too Late" }), /before Round 1/);

  // ---- Draft override ------------------------------------------------------
  const byeMatch = r1Matches.find((m) => m.status === "bye") as RbMatch;
  const byePlayer = byeMatch.player_a_id;
  const table1Player = r1Matches[0].player_a_id;
  const swap = await act(DESK, "swapDraftPairing", (c) =>
    svc.swapDraftPairing(c, { roundId: r1.round.id, playerA: byePlayer, playerB: table1Player }),
  );
  ok(swap.warnings.length === 0, `R1 swap has no warnings (${JSON.stringify(swap.warnings)})`);
  full = store.full(tid);
  r1Matches = full.matches.filter((m) => m.round_id === r1.round.id);
  ok(
    r1Matches.find((m) => m.status === "bye")?.player_a_id === table1Player && r1Matches[0].player_a_id === byePlayer,
    "swap moved the bye to the table-1 player and seated the old bye player",
  );
  ok(store.audits.some((a) => a.action === "round.override"), "override audited");

  // ---- Round 1 play --------------------------------------------------------
  const t1 = r1Matches.find((m) => m.status === "pending") as RbMatch;
  await actFails(ANA, "report on draft", (c) => svc.reportResult(c, rep(t1, [2, 0, 0, false])), /hasn't been published/);
  await act(DESK, "publishRound", (c) => svc.publishRound(c, { roundId: r1.round.id }));
  ok(store.tournaments.get(tid)?.scene === "pairings", "auto-follow: published -> pairings");
  await act(DESK, "setScene manual", (c) => svc.setScene(c, { tournamentId: tid, scene: "standings" }));
  ok(store.tournaments.get(tid)?.auto_follow_paused === true, "manual scene pauses auto-follow");
  await act(DESK, "startClock", (c) => svc.startClock(c, { roundId: r1.round.id }));
  ok(store.tournaments.get(tid)?.scene === "pairings_clock" && store.tournaments.get(tid)?.auto_follow_paused === false, "phase change resumes auto-follow: clock -> pairings_clock");
  await actFails(DESK, "startClock twice", (c) => svc.startClock(c, { roundId: r1.round.id }), /Publish the round/);
  h.advance(10 * 60_000);
  await act(DESK, "pauseClock", (c) => svc.pauseClock(c, { roundId: r1.round.id }));
  h.advance(2 * 60_000);
  await act(DESK, "resumeClock", (c) => svc.resumeClock(c, { roundId: r1.round.id }));
  await act(DESK, "adjustClock", (c) => svc.adjustClock(c, { roundId: r1.round.id, deltaMs: 5 * 60_000 }));
  const round1 = store.rounds.get(r1.round.id) as RbRound;
  ok(clockRemainingMs(round1, null, h.advance(0)) === (50 + 5 - 10) * 60_000, `clock: 55 min - 10 min played (got ${clockRemainingMs(round1, null, h.advance(0))})`);

  const pend = () => [...store.matches.values()].filter((m) => m.round_id === r1.round.id && m.status === "pending").sort((a, b) => a.table_number - b.table_number);
  const [ta, tb, tc, td, te] = pend();

  // Forced cases first: draw on time, a time-out win, an intentional draw, a drawn game.
  await act(ANA, "report time-out draw", (c) => svc.reportResult(c, rep(ta, [1, 1, 0, true], "dup-key")));
  // Duplicate submission (same key, same table): original returned, nothing written.
  const auditsBefore = store.audits.length;
  const dup = await act(ANA, "duplicate submission", (c) => svc.reportResult(c, rep(ta, [1, 1, 0, true], "dup-key")));
  ok(dup.duplicate && dup.match.games_a === 1 && dup.match.decided_on_time, "duplicate returns the original result");
  ok(store.audits.length === auditsBefore, "duplicate writes nothing");
  // Conflicting report: another judge, new key, same table.
  await actFails(BO, "conflicting report", (c) => svc.reportResult(c, rep(ta, [2, 0, 0, false])), /^conflicting report: Reported by Judge Ana at \d\d:\d\d:\d\d KST\.$/);
  await actFails(BO, "key reused on another table", (c) => svc.reportResult(c, rep(tb, [2, 0, 0, false], "dup-key")), /already recorded for another table/);
  await actFails(BO, "illegal score: unfinished", (c) => svc.reportResult(c, rep(tb, [1, 0, 0, false])), /Nobody has 2 win/);
  await actFails(BO, "illegal score: 3 wins", (c) => svc.reportResult(c, rep(tb, [3, 1, 0, false])), /nobody can win more than 2/);
  await actFails(BO, "illegal score: both 2", (c) => svc.reportResult(c, rep(tb, [2, 2, 0, false])), /Only one player/);
  await act(BO, "report time-out win", (c) => svc.reportResult(c, rep(tb, [1, 0, 0, true])));
  await act(BO, "report intentional draw", (c) => svc.reportResult(c, rep(tc, [0, 0, 0, false])));
  await act(ANA, "report with drawn game", (c) => svc.reportResult(c, rep(td, [2, 1, 1, false])));

  // Extension, flag, acknowledge on an open table.
  await act(ANA, "addExtension", (c) => svc.addExtension(c, { matchId: te.id, ms: 3 * 60_000, reason: "judge call" }));
  const flag = await act(ANA, "flagTable", (c) => svc.flagTable(c, { matchId: te.id, kind: "judge_call", note: "rules question" }));
  await act(DESK, "acknowledgeFlag", (c) => svc.acknowledgeFlag(c, { matchId: te.id, flagId: flag.id }));
  await actFails(DESK, "acknowledge twice", (c) => svc.acknowledgeFlag(c, { matchId: te.id, flagId: flag.id }), /Already acknowledged by Desk Dee/);
  const teNow = store.matches.get(te.id) as RbMatch;
  ok(teNow.extension_ms === 180_000 && clockRemainingMs(round1, teNow, h.advance(0)) === (45 + 3) * 60_000, "table extension adds to that table's clock only");
  ok(!JSON.stringify(toPublicMatch(teNow)).includes("judge_call"), "flags stay out of the public projection");

  // Undo then re-report.
  await act(DESK, "undoResult", (c) => svc.undoResult(c, { matchId: tc.id }));
  ok(store.matches.get(tc.id)?.status === "pending" && store.matches.get(tc.id)?.idempotency_key === null, "undo clears result and key");
  await act(BO, "re-report", (c) => svc.reportResult(c, rep(tc, [0, 2, 0, false])));

  await actFails(DESK, "close with open tables", (c) => svc.closeRound(c, { roundId: r1.round.id }), /still have no result/);
  await actFails(DESK, "pair next before close", (c) => svc.pairNextRound(c, { tournamentId: tid }), /isn't closed/);
  await reportAll(h, r1.round.id, gen);
  await act(DESK, "closeRound 1", (c) => svc.closeRound(c, { roundId: r1.round.id }));
  ok(store.tournaments.get(tid)?.scene === "standings", "auto-follow: closed -> standings");
  await actFails(DESK, "undo after close", (c) => svc.undoResult(c, { matchId: ta.id }), /closed/);
  log(`ok   round 1: draws, time-out, intentional draw, duplicate, conflict, extension, flag, undo`);

  // ---- Rounds 2-5 ----------------------------------------------------------
  let droppedViaReport = "";
  let dropUndoPlayer = "";
  let dqPlayer = "";
  for (let n = 2; n <= 5; n++) {
    const { round, warnings } = await act(DESK, `pairNextRound ${n}`, (c) => svc.pairNextRound(c, { tournamentId: tid }));
    ok(round.number === n, `round ${n} paired`);
    ok(warnings.length === 0, `round ${n}: pairing warnings ${JSON.stringify(warnings)}`);

    if (n === 3) {
      // Drop a player who is in the draft round: the draft is re-paired without them.
      const ms = [...store.matches.values()].filter((m) => m.round_id === round.id && m.status === "pending");
      dropUndoPlayer = ms[0].player_a_id;
      await act(DESK, "setDrop in draft", (c) => svc.setDrop(c, { playerId: dropUndoPlayer }));
      ok(!inRound(store, n, dropUndoPlayer), "dropped player removed from the re-paired draft");
      await act(DESK, "undoDrop", (c) => svc.undoDrop(c, { playerId: dropUndoPlayer }));
      ok(inRound(store, n, dropUndoPlayer), "undone drop: player back in the re-paired draft");
      await act(DESK, "setDrop again", (c) => svc.setDrop(c, { playerId: dropUndoPlayer }));
      ok(store.players.get(dropUndoPlayer)?.dropped_after_round === 2, "drop between rounds 2 and 3 recorded after round 2");
    }

    const roundId = roundIdOf(store, n);
    if (n === 5) {
      ok(store.audits.some((a) => a.action === "round.pair" && a.detail?.round === 5 && a.detail?.final === true), "round 5 paired as the final round");
      await actFails(DESK, "swissRounds after final paired", (c) => svc.updateConfig(c, { tournamentId: tid, config: { swissRounds: 6 } }), /locked once the final round/);
    }
    await act(DESK, `publish ${n}`, (c) => svc.publishRound(c, { roundId }));
    await act(DESK, `start ${n}`, (c) => svc.startClock(c, { roundId }));

    if (n === 2) {
      const m = firstPending(store, roundId);
      droppedViaReport = m.player_b_id as string;
      await act(ANA, "report with dropB", (c) => svc.reportResult(c, { ...rep(m, [2, 0, 0, false]), dropB: true }));
      ok(store.players.get(droppedViaReport)?.status === "dropped" && store.players.get(droppedViaReport)?.dropped_after_round === 2, "drop flagged on a result");
    }
    if (n === 4) {
      const m = firstPending(store, roundId);
      dqPlayer = m.player_a_id;
      await act(DESK, "DQ mid-round", (c) => svc.setDrop(c, { playerId: dqPlayer, dq: true }));
      ok(store.players.get(dqPlayer)?.status === "dq" && store.matches.get(m.id)?.status === "pending", "DQ mid-round keeps the table open");
      await act(BO, "report DQ'd table", (c) => svc.reportResult(c, rep(m, [0, 2, 0, false])));
    }
    await reportAll(h, roundId, gen);
    await act(DESK, `close ${n}`, (c) => svc.closeRound(c, { roundId }));
  }
  await actFails(DESK, "pair round 6", (c) => svc.pairNextRound(c, { tournamentId: tid }), /All 5 Swiss rounds are played/);
  await actFails(DESK, "complete without cut", (c) => svc.completeEvent(c, { tournamentId: tid }), /top 8 cut/);

  // ---- Swiss invariants ----------------------------------------------------
  full = store.full(tid);
  for (const r of full.rounds) {
    const seen = new Map<string, number>();
    for (const m of full.matches.filter((x) => x.round_id === r.id)) {
      for (const id of [m.player_a_id, m.player_b_id]) if (id) seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    ok([...seen.values()].every((c) => c === 1), `round ${r.number}: a player is seated twice`);
    for (const p of full.players) {
      if (p.dropped_after_round !== null && r.number > p.dropped_after_round) {
        ok(!seen.has(p.id), `round ${r.number}: ${p.id} paired after dropping after round ${p.dropped_after_round}`);
      }
    }
    ok(r.status === "closed", `round ${r.number} closed`);
  }
  const pairs = new Set<string>();
  let rematches = 0;
  for (const m of full.matches.filter((x) => x.player_b_id)) {
    const k = [m.player_a_id, m.player_b_id].sort().join("|");
    if (pairs.has(k)) rematches++;
    pairs.add(k);
  }
  ok(rematches === 0, `${rematches} rematches in Swiss`);
  const byes = full.matches.filter((m) => m.status === "bye");
  ok(new Set(byes.map((m) => m.player_a_id)).size === byes.length, "no player had two byes");
  const draws = full.matches.filter((m) => m.status === "completed" && m.games_a === m.games_b).length;
  const timeouts = full.matches.filter((m) => m.decided_on_time).length;
  ok(draws >= 2 && timeouts >= 2 && byes.length >= 3, `variety: ${draws} draws, ${timeouts} time-outs, ${byes.length} byes`);
  const standings = svc.computeRbStandings(full);
  ok(standings.length === 31, "standings cover the 31 players");
  ok(JSON.stringify(standings) === JSON.stringify(svc.computeRbStandings(store.full(tid))), "standings reproduce from the stored seed");
  log(`ok   Swiss: 5 rounds, ${draws} match draws, ${timeouts} time-outs, ${byes.length} byes, 3 drops (1 via report, 1 undone+redone, 1 DQ), no rematches`);

  // ---- Top cut -------------------------------------------------------------
  const cut = await act(DESK, "cutToTop", (c) => svc.cutToTop(c, { tournamentId: tid }));
  const expectedSeeds = topCutSeeds(standings, 8);
  ok(JSON.stringify(cut.seeds) === JSON.stringify(expectedSeeds), "cut seeds = top 8 non-dropped standings");
  ok(!cut.seeds.includes(droppedViaReport) && !cut.seeds.includes(dqPlayer) && !cut.seeds.includes(dropUndoPlayer), "dropped players not in the cut");
  ok(store.tournaments.get(tid)?.scene === "top_cut", "auto-follow: cut -> top_cut");
  await actFails(DESK, "cut twice", (c) => svc.cutToTop(c, { tournamentId: tid }), /already been made/);
  await actFails(DESK, "topCut change after cut", (c) => svc.updateConfig(c, { tournamentId: tid, config: { topCut: 4 } }), /already been made/);

  const qf = cut.round;
  const qfMatches = () => [...store.matches.values()].filter((m) => m.round_id === qf.id).sort((a, b) => a.table_number - b.table_number);
  const seedPairs = qfMatches().map((m) => [cut.seeds.indexOf(m.player_a_id) + 1, cut.seeds.indexOf(m.player_b_id as string) + 1].join("v"));
  ok(seedPairs.join(" ") === "1v8 4v5 2v7 3v6", `QF seeding ${seedPairs.join(" ")}`);
  ok(qf.duration_ms === null, "top cut has no time limit");
  await act(DESK, "publish QF", (c) => svc.publishRound(c, { roundId: qf.id }));
  await act(DESK, "start QF", (c) => svc.startClock(c, { roundId: qf.id }));
  const q = qfMatches();
  await actFails(ANA, "top-cut draw", (c) => svc.reportTopCutResult(c, { matchId: q[0].id, gamesA: 1, gamesB: 1, gamesDrawn: 0, idempotencyKey: key() }), /needs a winner/);
  await actFails(ANA, "swiss report on top cut", (c) => svc.reportResult(c, rep(q[0], [2, 0, 0, false])), /top-cut table/);
  for (const m of q) {
    await act(ANA, "report QF", (c) => svc.reportTopCutResult(c, { matchId: m.id, gamesA: 2, gamesB: m.table_number % 2, gamesDrawn: 0, idempotencyKey: key() }));
  }
  await act(DESK, "undoTopCutResult", (c) => svc.undoTopCutResult(c, { matchId: q[3].id }));
  await act(BO, "re-report QF", (c) => svc.reportTopCutResult(c, { matchId: q[3].id, gamesA: 0, gamesB: 2, gamesDrawn: 1, idempotencyKey: key() }));
  await act(DESK, "close QF", (c) => svc.closeRound(c, { roundId: qf.id }));

  // A QF winner drops after the cut: nobody replaces them, their SF opponent advances.
  const qfWinners = qfMatches().map((m) => (m.games_a > m.games_b ? m.player_a_id : (m.player_b_id as string)));
  const leaver = qfWinners[1];
  await act(DESK, "drop after cut", (c) => svc.setDrop(c, { playerId: leaver }));
  await actFails(DESK, "undoDrop after cut", (c) => svc.undoDrop(c, { playerId: leaver }), /after the cut/);
  const sf = await act(DESK, "pair SF", (c) => svc.pairNextRound(c, { tournamentId: tid }));
  const sfMatches = [...store.matches.values()].filter((m) => m.round_id === sf.round.id).sort((a, b) => a.table_number - b.table_number);
  ok(sfMatches.length === 2 && sfMatches[0].status === "bye" && sfMatches[0].player_a_id === qfWinners[0], "SF: opponent of the leaver advances on a bye");
  ok(sfMatches[1].player_a_id !== leaver && sfMatches[1].player_b_id !== leaver, "leaver not seated");
  ok(cut.seeds.indexOf(sfMatches[1].player_a_id) < cut.seeds.indexOf(sfMatches[1].player_b_id as string), "higher seed listed first");
  await act(DESK, "publish SF", (c) => svc.publishRound(c, { roundId: sf.round.id }));
  await act(ANA, "report SF", (c) => svc.reportTopCutResult(c, { matchId: sfMatches[1].id, gamesA: 1, gamesB: 2, gamesDrawn: 0, idempotencyKey: key() }));
  await act(DESK, "close SF", (c) => svc.closeRound(c, { roundId: sf.round.id }));

  const fin = await act(DESK, "pair final", (c) => svc.pairNextRound(c, { tournamentId: tid }));
  const finalMatch = [...store.matches.values()].find((m) => m.round_id === fin.round.id) as RbMatch;
  const sfWinner = sfMatches[1].player_b_id as string;
  ok(new Set([finalMatch.player_a_id, finalMatch.player_b_id]).size === 2 && [finalMatch.player_a_id, finalMatch.player_b_id].includes(qfWinners[0]) && [finalMatch.player_a_id, finalMatch.player_b_id].includes(sfWinner), "final: the two SF winners");
  await act(DESK, "publish final", (c) => svc.publishRound(c, { roundId: fin.round.id }));
  await actFails(DESK, "complete before final", (c) => svc.completeEvent(c, { tournamentId: tid }), /final has no result/);
  await act(BO, "report final", (c) => svc.reportTopCutResult(c, { matchId: finalMatch.id, gamesA: 2, gamesB: 1, gamesDrawn: 0, idempotencyKey: key() }));
  await actFails(DESK, "pair after final", (c) => svc.pairNextRound(c, { tournamentId: tid }), /isn't closed|finished/);

  const done = await act(DESK, "completeEvent", (c) => svc.completeEvent(c, { tournamentId: tid }));
  ok(done.championId === finalMatch.player_a_id, "champion = final winner");
  const tFinal = store.tournaments.get(tid) as RbTournament;
  ok(tFinal.status === "completed" && tFinal.champion_player_id === done.championId && tFinal.scene === "champion", "completed, champion scene");
  ok(store.rounds.get(fin.round.id)?.status === "closed", "final round closed by completeEvent");
  ok(!("tiebreakSeed" in toPublicTournament(tFinal).config), "public projection hides the tiebreak seed");
  await actFails(DESK, "report after completion", (c) => svc.reportTopCutResult(c, { matchId: finalMatch.id, gamesA: 2, gamesB: 0, gamesDrawn: 0, idempotencyKey: key() }), /isn't running/);
  log(`ok   top 8: seeded 1v8 4v5 2v7 3v6, a post-cut drop gave a bye, champion ${store.players.get(done.championId)?.display_name}`);

  // ---- Export, archive ----------------------------------------------------
  const csv = await act(DESK, "exportRecords", (c) => svc.exportRecords(c, { tournamentId: tid, kind: "matches", format: "csv" }));
  const lines = csv.content.trim().split("\r\n");
  ok(lines[0].startsWith("round,stage,table") && lines.length === store.full(tid).matches.length + 1, `export: ${lines.length - 1} match rows`);
  ok(store.audits.at(-1)?.action === "export.download", "export audited");
  await act(DESK, "archiveEvent", (c) => svc.archiveEvent(c, { tournamentId: tid }));
  ok(store.tournaments.get(tid)?.status === "archived", "archived");

  // ---- Audit trail ----------------------------------------------------------
  const actors = new Set([ANA, BO, DESK].map((a) => `${a.discordId}:${a.name}`));
  ok(store.audits.every((a) => actors.has(`${a.actor.discordId}:${a.actor.name}`)), "every audit row names a real actor");
  const reports = store.audits.filter((a) => a.action === "match.report").length;
  log(`ok   audit: ${store.audits.length} rows (${reports} reports), every one with an actor`);
  await tidOf();
  return { store, tid };
}

function rep(m: RbMatch, [a, b, d, time]: [number, number, number, boolean], k = key()): SwissReportInput {
  return { matchId: m.id, gamesA: a, gamesB: b, gamesDrawn: d, decidedOnTime: time, idempotencyKey: k };
}

function roundIdOf(store: MemoryStore, n: number): string {
  return ([...store.rounds.values()].find((r) => r.number === n) as RbRound).id;
}
function firstPending(store: MemoryStore, roundId: string): RbMatch {
  return [...store.matches.values()]
    .filter((m) => m.round_id === roundId && m.status === "pending")
    .sort((a, b) => a.table_number - b.table_number)[0];
}
function inRound(store: MemoryStore, n: number, playerId: string): boolean {
  const rid = roundIdOf(store, n);
  return [...store.matches.values()].some((m) => m.round_id === rid && (m.player_a_id === playerId || m.player_b_id === playerId));
}

async function reportAll(h: Harness, roundId: string, gen: () => number) {
  const judges = [ANA, BO];
  for (const m of [...h.store.matches.values()].filter((x) => x.round_id === roundId && x.status === "pending")) {
    const o = OUTCOMES[Math.floor(gen() * OUTCOMES.length)];
    await h.act(judges[m.table_number % 2], `report table ${m.table_number}`, (c) => svc.reportResult(c, rep(m, o)));
  }
}

// ---------------------------------------------------------------------------
// Run (twice: the second run must reproduce the first exactly)
// ---------------------------------------------------------------------------

console.log("--- Riftbound scenario: 31 players, 5 Swiss rounds, top 8 ---");
const h1 = runScenario(true);
keyN = 0;
const first = await scenario(h1);
const h2 = runScenario(false);
keyN = 0;
const second = await scenario(h2);
const snap = (s: MemoryStore, tid: string) =>
  JSON.stringify({ full: s.full(tid), audits: s.audits.map((a) => [a.action, a.detail, a.actor.name]) });
ok(snap(first.store, first.tid) === snap(second.store, second.tid), "a second run with the same seeds reproduces the event exactly");
const { calls, failedAsExpected } = h1.stats();
console.log(`ok   ${calls} successful operations, ${failedAsExpected} rejected as expected (each rolled back), replay identical`);

console.log(failures ? `\n${failures} FAILURE(S) in ${checks} checks.` : `\nScenario passed: ${checks} checks.`);
process.exit(failures ? 1 : 0);

// Database note: this scenario runs the operations against MemoryStore. To
// exercise rb-pg-store.ts, the SQL in rb-db.ts and real FOR UPDATE
// contention, run the same scenario with createPgStore(client) inside
// withTransaction() against a disposable Postgres (a Neon branch, or local
// Postgres via POSTGRES_URL). That needs a database URL; none is used here.
