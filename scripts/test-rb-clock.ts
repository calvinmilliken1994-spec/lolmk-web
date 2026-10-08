// Deterministic tests for the Riftbound clock maths and the pure parts of
// src/lib/rb-db.ts (public projection, export, audit actor guard). No database
// is touched. Not wired into a test runner (none installed — see package.json).
// Run directly:
//   node --experimental-strip-types scripts/test-rb-clock.ts
//
// Node's ESM loader does not resolve extensionless relative imports, and the
// app imports its siblings without extensions. The hook below retries such
// specifiers with ".ts", and rb-db is loaded with a dynamic import afterwards.

import { registerHooks } from "node:module";
import type { RbMatch, RbPlayer, RbRound, RbTournament, RbTournamentFull } from "../src/types/riftbound";

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
  clockAdjustPatch,
  clockEndsAtMs,
  clockPausePatch,
  clockRemainingMs,
  clockResumePatch,
  clockStartPatch,
  formatGameExport,
  formatMatchExport,
  isTimeCalled,
  toPublicMatch,
  toPublicPlayer,
  toPublicRound,
  toPublicTournament,
  writeAudit,
} = await import("../src/lib/rb-db");
const { DEFAULT_RB_CONFIG } = await import("../src/types/riftbound");

let failures = 0;
let checks = 0;
function eq<T>(actual: T, expected: T, msg: string) {
  checks++;
  if (actual !== expected) {
    failures++;
    console.error(`FAIL: ${msg} (expected ${String(expected)}, got ${String(actual)})`);
  }
}
function ok(cond: unknown, msg: string) {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}
function throws(fn: () => unknown, msg: string) {
  checks++;
  try {
    fn();
    failures++;
    console.error(`FAIL: ${msg} (did not throw)`);
  } catch {
    // expected
  }
}

const MIN = 60_000;
const T0 = Date.parse("2026-10-08T10:00:00.000Z");
const at = (minutes: number) => T0 + minutes * MIN;
const iso = (ms: number) => new Date(ms).toISOString();

type Clock = Pick<RbRound, "started_at" | "paused_at" | "paused_total_ms" | "duration_ms">;
const fresh = (): Clock => ({
  started_at: null,
  paused_at: null,
  paused_total_ms: 0,
  duration_ms: 60 * MIN,
});
const apply = (c: Clock, patch: Partial<Clock>): Clock => ({ ...c, ...patch });

// 1. Not started: full duration, plus the table's extension.
{
  const c = fresh();
  eq(clockRemainingMs(c, null, at(5)), 60 * MIN, "not started shows the full duration");
  eq(clockRemainingMs(c, { extension_ms: 5 * MIN }, at(5)), 65 * MIN, "not started + extension");
  eq(isTimeCalled(c, null, at(500)), false, "an unstarted clock is never called");
  eq(clockEndsAtMs(c), null, "no end instant before start");
}

// 2. Running.
{
  const c = apply(fresh(), clockStartPatch(fresh(), at(0)));
  eq(c.started_at, iso(at(0)), "start stamps started_at");
  eq(clockRemainingMs(c, null, at(0)), 60 * MIN, "remaining at start");
  eq(clockRemainingMs(c, null, at(15)), 45 * MIN, "remaining after 15 min");
  eq(clockRemainingMs(c, null, at(60)), 0, "remaining at the end");
  eq(clockRemainingMs(c, null, at(75)), 0, "overrun clamps to 0");
  eq(isTimeCalled(c, null, at(59.99)), false, "in time just before the end");
  eq(isTimeCalled(c, null, at(60)), true, "time called at the end");
  eq(clockEndsAtMs(c), at(60), "end instant");
  eq(clockRemainingMs(c, null, at(-3)), 60 * MIN, "a clock-skewed 'now' before start never exceeds the duration");
  throws(() => clockStartPatch(c, at(1)), "starting twice throws");
}

// 3. Pause freezes, resume continues from where it stopped.
{
  let c = apply(fresh(), clockStartPatch(fresh(), at(0)));
  c = apply(c, clockPausePatch(c, at(10))); // 50 min left, frozen
  eq(clockRemainingMs(c, null, at(10)), 50 * MIN, "remaining at the moment of pause");
  eq(clockRemainingMs(c, null, at(40)), 50 * MIN, "paused clock does not move");
  eq(clockEndsAtMs(c), null, "no fixed end while paused");
  eq(isTimeCalled(c, null, at(500)), false, "a paused clock with time left is never called");
  throws(() => clockPausePatch(c, at(41)), "pausing twice throws");

  c = apply(c, clockResumePatch(c, at(25))); // paused for 15 min
  eq(c.paused_at, null, "resume clears paused_at");
  eq(c.paused_total_ms, 15 * MIN, "resume accumulates the pause");
  eq(clockRemainingMs(c, null, at(25)), 50 * MIN, "resume continues from the frozen value");
  eq(clockRemainingMs(c, null, at(35)), 40 * MIN, "10 min after resume");
  eq(clockEndsAtMs(c), at(75), "end instant moves out by the pause");
  eq(isTimeCalled(c, null, at(74)), false, "not called before the shifted end");
  eq(isTimeCalled(c, null, at(75)), true, "called at the shifted end");
  throws(() => clockResumePatch(c, at(80)), "resuming a running clock throws");

  // Second pause accumulates on top of the first.
  c = apply(c, clockPausePatch(c, at(45))); // 20 min since resume; 30 left
  c = apply(c, clockResumePatch(c, at(50))); // 5 more paused
  eq(c.paused_total_ms, 20 * MIN, "two pauses accumulate");
  eq(clockRemainingMs(c, null, at(50)), 30 * MIN, "remaining after the second resume");
}

// 4. Pause while the clock has already run out (0 remaining stays 0 and is called).
{
  let c = apply(fresh(), clockStartPatch(fresh(), at(0)));
  c = apply(c, clockPausePatch(c, at(70)));
  eq(clockRemainingMs(c, null, at(71)), 0, "paused after expiry stays at 0");
  eq(isTimeCalled(c, null, at(71)), true, "paused after expiry is still called");
}

// 5. Adjust.
{
  let c = apply(fresh(), clockStartPatch(fresh(), at(0)));
  c = apply(c, clockAdjustPatch(c, 5 * MIN));
  eq(c.duration_ms, 65 * MIN, "add 5 minutes");
  eq(clockRemainingMs(c, null, at(20)), 45 * MIN, "remaining after +5 at 20 min");
  c = apply(c, clockAdjustPatch(c, -10 * MIN));
  eq(c.duration_ms, 55 * MIN, "remove 10 minutes");
  eq(clockRemainingMs(c, null, at(20)), 35 * MIN, "remaining after -10 at 20 min");
  c = apply(c, clockAdjustPatch(c, -999 * MIN));
  eq(c.duration_ms, 0, "duration never goes negative");
  eq(clockRemainingMs(c, null, at(20)), 0, "zero duration means time is up");
  throws(() => clockAdjustPatch(c, Number.NaN), "NaN adjustment throws");
  throws(
    () => clockAdjustPatch({ ...fresh(), duration_ms: null }, MIN),
    "adjusting an unlimited round throws",
  );

  // Adjusting while paused takes effect on resume without disturbing the freeze.
  let p = apply(fresh(), clockStartPatch(fresh(), at(0)));
  p = apply(p, clockPausePatch(p, at(10)));
  p = apply(p, clockAdjustPatch(p, 10 * MIN));
  eq(clockRemainingMs(p, null, at(30)), 60 * MIN, "adjust while paused: 50 left + 10");
}

// 6. Table extensions.
{
  const c = apply(fresh(), clockStartPatch(fresh(), at(0)));
  const ext = { extension_ms: 5 * MIN };
  eq(clockRemainingMs(c, ext, at(60)), 5 * MIN, "extended table has 5 min when the round ends");
  eq(clockRemainingMs(c, null, at(60)), 0, "unextended table is out at the same moment");
  eq(isTimeCalled(c, ext, at(60)), false, "extended table is still in time");
  eq(isTimeCalled(c, ext, at(65)), true, "extended table is called 5 min later");
  eq(clockEndsAtMs(c, ext), at(65), "extended end instant");
  eq(clockEndsAtMs(c, null), at(60), "round end instant is unaffected by a table extension");

  // Extension + pause + adjust compose.
  let d = apply(fresh(), clockStartPatch(fresh(), at(0)));
  d = apply(d, clockPausePatch(d, at(30)));
  d = apply(d, clockResumePatch(d, at(40)));
  d = apply(d, clockAdjustPatch(d, 5 * MIN));
  // total = 65 + 3 ext = 68 min; elapsed at 50 = 50 - 10 = 40 -> 28 left
  eq(clockRemainingMs(d, { extension_ms: 3 * MIN }, at(50)), 28 * MIN, "pause + adjust + extension compose");
  eq(clockEndsAtMs(d, { extension_ms: 3 * MIN }), at(78), "composed end instant");
}

// 7. No time limit (top cut).
{
  const c: Clock = { started_at: iso(at(0)), paused_at: null, paused_total_ms: 0, duration_ms: null };
  eq(clockRemainingMs(c, { extension_ms: 5 * MIN }, at(500)), null, "no limit means null");
  eq(isTimeCalled(c, null, at(500)), false, "no limit is never called");
  eq(clockEndsAtMs(c), null, "no limit has no end instant");
}

// 8. now may be a Date.
{
  const c = apply(fresh(), clockStartPatch(fresh(), at(0)));
  eq(clockRemainingMs(c, null, new Date(at(30))), 30 * MIN, "accepts a Date for now");
}

// 9. Public projection and export (pure).
const tournament: RbTournament = {
  id: "rbt_1",
  slug: "poro-cup",
  name: "Poro Cup",
  status: "in_progress",
  config: { ...DEFAULT_RB_CONFIG, tiebreakSeed: "secret-seed" },
  scene: "pairings",
  auto_follow: true,
  auto_follow_paused: false,
  champion_player_id: null,
  created_at: iso(at(0)),
  updated_at: iso(at(0)),
};
const mkPlayer = (id: string, name: string, status: RbPlayer["status"], discord: string | null): RbPlayer => ({
  id,
  tournament_id: "rbt_1",
  display_name: name,
  member_discord_id: discord,
  legend: "Jinx",
  status,
  dropped_after_round: status === "dq" ? 1 : null,
  created_at: iso(at(0)),
});
const players: RbPlayer[] = [
  mkPlayer("p1", "=SUM(1+1)", "active", "111"),
  mkPlayer("p2", 'Bob "The Bold"', "dq", "222"),
  mkPlayer("p3", "Cara", "active", null),
];
const rounds: RbRound[] = [
  { id: "r1", tournament_id: "rbt_1", number: 1, stage: "swiss", status: "closed", started_at: iso(at(0)), paused_at: null, paused_total_ms: 0, duration_ms: 60 * MIN, pairing_seed: "seed1", created_at: iso(at(0)) },
  { id: "r2", tournament_id: "rbt_1", number: 2, stage: "swiss", status: "draft", started_at: null, paused_at: null, paused_total_ms: 0, duration_ms: 60 * MIN, pairing_seed: "seed2", created_at: iso(at(0)) },
];
const mkMatch = (over: Partial<RbMatch>): RbMatch => ({
  id: "m1",
  tournament_id: "rbt_1",
  round_id: "r1",
  table_number: 1,
  player_a_id: "p1",
  player_b_id: "p2",
  games_a: 2,
  games_b: 1,
  games_drawn: 0,
  decided_on_time: false,
  extension_ms: 5 * MIN,
  started_at: null,
  status: "completed",
  reported_by_id: "999",
  reported_by_name: "Judge Judy",
  reported_at: iso(at(50)),
  idempotency_key: "key-1",
  flags: [{ kind: "note", text: "slow play warning" }],
  ...over,
});
const matches: RbMatch[] = [
  mkMatch({}),
  mkMatch({ id: "m2", table_number: 2, player_a_id: "p3", player_b_id: null, games_a: 2, games_b: 0, status: "bye", flags: [], idempotency_key: null, reported_by_id: null, reported_by_name: null, reported_at: null }),
  mkMatch({ id: "m3", round_id: "r2", table_number: 1, player_a_id: "p1", player_b_id: "p3", games_a: 0, games_b: 0, status: "pending", reported_by_id: null, reported_by_name: null, reported_at: null, idempotency_key: null, flags: [] }),
];
const full: RbTournamentFull = { tournament, players, rounds, matches };

{
  const pub = toPublicTournament(tournament);
  ok(!("tiebreakSeed" in pub.config), "public config has no tiebreak seed");
  ok(!("id" in pub) && !("auto_follow" in pub) && !("created_at" in pub), "public tournament drops internals");

  const pp = toPublicPlayer(players[1]);
  eq(pp.status, "dropped", "dq is shown publicly as dropped");
  const ppJson = JSON.stringify(players.map(toPublicPlayer));
  ok(!/111|222|Jinx|member_discord_id|legend/.test(ppJson), "public players leak no discord id or legend");

  eq(toPublicRound(rounds[1]), null, "a draft round is not public");
  ok(!("pairing_seed" in (toPublicRound(rounds[0]) ?? {})), "public round has no pairing seed");

  const pm = JSON.stringify(toPublicMatch(matches[0]));
  ok(!/999|Judge Judy|key-1|slow play|flags|reported_|idempotency/.test(pm), "public match leaks no reporter, key or flags");
  eq(toPublicMatch(matches[0]).extension_ms, 5 * MIN, "public match keeps the extension for the clock");
}

{
  const csv = formatMatchExport(full, "csv").split("\r\n");
  ok(csv[0].startsWith("round,stage,table,player_a,player_b"), "match csv header");
  ok(csv[1].includes(`"'=SUM(1+1)"`) || csv[1].includes(`'=SUM(1+1)`), "csv neutralises a leading '=' (formula injection)");
  ok(csv[1].includes(`"Bob ""The Bold"""`), "csv escapes embedded quotes");
  ok(csv[1].includes("5,completed,999,Judge Judy"), "csv carries the extension and reporter");
  eq(csv.filter(Boolean).length, 4, "match csv has a header and three rows");

  const json = JSON.parse(formatMatchExport(full, "json")) as Array<{ round: number; player_b: string }>;
  eq(json.length, 3, "match json row count");
  eq(json[1].player_b, "", "a bye has an empty opponent");

  const games = JSON.parse(formatGameExport(full, "json")) as Array<{ player: string; match_result: string; games_won: number }>;
  eq(games.length, 5, "two rows per match plus one per bye");
  eq(games[0].match_result, "win", "p1 won table 1");
  eq(games[1].match_result, "loss", "p2 lost table 1");
  eq(games[2].match_result, "bye", "bye row");
  eq(games[3].match_result, "pending", "pending match");
  const gcsv = formatGameExport(full, "csv").split("\r\n");
  ok(gcsv[0].startsWith("round,stage,table,player,opponent,games_won"), "game csv header");
}

// 10. writeAudit refuses a missing actor before touching the database.
{
  let rejected = 0;
  for (const bad of [undefined, { discordId: "", name: "x" }, { discordId: "1", name: "  " }]) {
    try {
      await writeAudit("rbt_1", "scene.set", null, bad as never);
    } catch (e) {
      if (/requires an actor/.test(String((e as Error).message))) rejected++;
    }
  }
  eq(rejected, 3, "writeAudit rejects a missing or blank actor");
}

if (failures > 0) {
  console.error(`\n${failures} of ${checks} checks failed.`);
  process.exit(1);
}
console.log(`ok: ${checks} checks passed.`);
