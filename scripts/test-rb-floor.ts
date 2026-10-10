// Deterministic tests for the judges' floor logic
// (src/components/riftbound/rb-floor-model.ts): the round on the floor, the
// judge's range, the table list (order, filters, search), going-in records, the
// review card, "decided on time", and the submission queue (classification,
// double-tap guard, survival across a refresh). No database, no React. Run:
//   node --experimental-strip-types scripts/test-rb-floor.ts

import { registerHooks } from "node:module";
import type { RbMatch, RbPlayer, RbRound, RbJudge } from "../src/types/riftbound";
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

const m = await import("../src/components/riftbound/rb-floor-model");
const round = await import("../src/components/riftbound/rb-round-model");
const { DEFAULT_RB_CONFIG, RB_DESK_FLAG_KINDS } = await import("../src/types/riftbound");

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
const iso = (ms: number) => new Date(ms).toISOString();

const NAMES = ["Aria", "Bok", "Calder", "Dami", "Eun", "Finn", "Gyu", "Hana", "Iris", "Jun", "Kai", "Lumi", "Mina", "Jae"];
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

const rnd = (number: number, status: RbRound["status"], over: Partial<RbRound> = {}): RbRound => ({
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
});

const tbl = (r: number, table: number, a: number, b: number | null, over: Partial<RbMatch> = {}): RbMatch => ({
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
  status: b === null ? "bye" : "pending",
  reported_by_id: null,
  reported_by_name: null,
  reported_at: null,
  idempotency_key: null,
  flags: [],
  ...over,
});

const done = (r: number, table: number, a: number, b: number, ga: number, gb: number, by: string, over: Partial<RbMatch> = {}) =>
  tbl(r, table, a, b, { status: "completed", games_a: ga, games_b: gb, reported_by_id: "9", reported_by_name: by, reported_at: iso(START + 5 * MIN), ...over });

const flag = (kind: "judge_call" | "no_show" = "judge_call") => ({
  kind,
  id: `f-${kind}`,
  note: "",
  raised_by_name: "Joe",
  raised_at: iso(START),
  acknowledged_by_name: null,
  acknowledged_at: null,
});

const stand = (i: number, w: number, l: number, d = 0) => ({
  playerId: `p${i}`, rank: i + 1, matchPoints: w * 3 + d, wins: w, losses: l, draws: d, record: `${w}-${l}-${d}`, byes: 0, matchesPlayed: w + l + d,
  gamesWon: 0, gamesLost: 0, gamesDrawn: 0, mwp: 0, omwp: 0, gwp: 0, ogwp: 0, dropped: false,
});

const JUDGES: RbJudge[] = [
  { id: "j1", name: "Ray", from: 1, to: 6 },
  { id: "j2", name: "Joe", from: 7, to: null },
  { id: "j3", name: "Jin", from: null, to: null },
  { id: "j4", name: "Min", from: null, to: 4 },
];

function state(over: { rounds?: RbRound[]; matches?: RbMatch[]; standings?: RbDeskState["standings"]; judges?: RbJudge[]; players?: RbPlayer[] }): RbDeskState {
  return {
    tournament: {
      id: "t1",
      slug: "poro",
      name: "Poro Cup",
      status: "in_progress",
      config: { ...DEFAULT_RB_CONFIG, swissRounds: 5, tiebreakSeed: "s", judges: over.judges ?? JUDGES },
      scene: "idle",
      auto_follow: true,
      auto_follow_paused: false,
      champion_player_id: null,
      created_at: iso(START),
      updated_at: iso(START),
    },
    players: over.players ?? players,
    rounds: over.rounds ?? [],
    matches: over.matches ?? [],
    standings: over.standings ?? [],
    audit: [],
  };
}

// ---- The round on the floor -------------------------------------------------

eq(m.rbFloorRound(state({ rounds: [rnd(1, "closed"), rnd(2, "live")] }))?.number, 2, "live round is on the floor");
eq(m.rbFloorRound(state({ rounds: [rnd(1, "closed"), rnd(2, "published")] }))?.number, 2, "published round is on the floor");
eq(m.rbFloorRound(state({ rounds: [rnd(1, "closed"), rnd(2, "draft")] }))?.number, 1, "a draft is never shown; the closed round stays on screen");
eq(m.rbFloorRound(state({ rounds: [rnd(1, "draft")] })), null, "only a draft: nothing to show");
eq(m.rbFloorRound(state({ rounds: [] })), null, "no rounds: nothing to show");
eq(m.rbFloorRound(state({ rounds: [rnd(1, "closed"), rnd(2, "live", { stage: "top_cut" })] }))?.number, 1, "top-cut rounds belong to the desk, not the Swiss floor");

// ---- Judge and range --------------------------------------------------------

eq(m.rbJudgeFor(JUDGES, "ray")?.id, "j1", "matched by name, case-insensitive");
eq(m.rbJudgeFor(JUDGES, " Ray ")?.id, "j1", "…and trimmed");
eq(m.rbJudgeFor(JUDGES, "Nobody"), null, "unknown admin: no judge");
eq(m.rbJudgeFor(JUDGES, "Nobody", "j2")?.id, "j2", "a remembered pick wins for an unknown admin");
eq(m.rbJudgeFor(JUDGES, "Ray", "j2")?.id, "j2", "a pick overrides the name match");
eq(m.rbJudgeFor(JUDGES, "Ray", "gone")?.id, "j1", "a stale pick falls back to the name");
eq([1, 6, 7].map((t) => m.rbInRange(JUDGES[0], t)).join(), "true,true,false", "range 1–6");
eq([6, 7, 40].map((t) => m.rbInRange(JUDGES[1], t)).join(), "false,true,true", "range 7+");
eq([1, 4, 5].map((t) => m.rbInRange(JUDGES[3], t)).join(), "true,true,false", "range up to 4");
eq(m.rbInRange(JUDGES[2], 99), true, "no range = every table");
eq(m.rbInRange(null, 3), true, "no judge = every table");
eq([0, 1, 2, 3].map((i) => m.rbRangeLabel(JUDGES[i])).join(" | "), "tables 1–6 | tables 7+ | all tables | tables 1–4", "range labels");
eq(m.rbRangeLabel({ id: "x", name: "x", from: 5, to: 5 }), "table 5", "single table label");

// ---- Table list -------------------------------------------------------------

{
  const live = rnd(3, "live");
  const ms = [
    done(3, 1, 0, 1, 2, 0, "Ray"),
    tbl(3, 2, 2, 3),
    tbl(3, 3, 4, 5),
    done(3, 4, 6, 7, 1, 1, "Ray"),
    done(3, 5, 8, 9, 2, 0, "Jin"),
    tbl(3, 6, 10, 11, { flags: [flag()], extension_ms: 3 * MIN }),
    tbl(3, 7, 12, 13),
    tbl(3, 8, 0, null, { status: "bye" }),
  ];
  const s = state({ rounds: [live], matches: ms });
  const at = START + 10 * MIN;
  const ray = JUDGES[0];
  const list = (opts: Partial<Parameters<typeof m.rbFloorList>[3]> = {}, now: number | null = at) =>
    m.rbFloorList(s, live, now, { query: "", filter: "all", judge: ray, adminName: "Ray", ...opts });

  const all = list();
  eq(all.outstanding.map((r) => r.table).join(), "6,2,3,7", "outstanding: judge call first, then by table");
  eq(all.reported.map((r) => r.table).join(), "1,4,5", "reported below, by table");
  eq(all.total, 7, "byes aren't listed or counted");
  eq(all.outstandingTotal, 4, "header counts every outstanding table");
  eq(all.outstanding[0].line, "Judge call open · +3:00", "flagged line (reference)");
  eq(all.outstanding[1].line, "Playing · 50:00 left", "playing line");
  eq(all.outstanding[3].line, "Playing · 50:00 left · not your table", "outside the judge's range");
  eq(all.outstanding[3].mine, false, "mine flag");
  eq(all.reported.map((r) => r.line).join(" | "), "Aria 2–0 Bok | Gyu 1–1 Hana · draw | Iris 2–0 Jun · Jin", "reported lines: mine unsigned, others signed, draws marked (reference)");
  eq(all.reported[0].reportedByMe, true, "reported by me");
  eq(all.reported[2].reportedByMe, false, "reported by someone else");
  eq(list({ filter: "mine" }).outstanding.map((r) => r.table).join(), "6,2,3", "Mine = my range");
  eq(list({ filter: "mine", judge: JUDGES[2] }).outstanding.length, 4, "Mine with no range = every table");
  eq(list({ filter: "mine", judge: null }).outstanding.length, 4, "Mine with no judge = every table");
  eq(list({ filter: "flagged" }).outstanding.map((r) => r.table).join(), "6", "Flagged");
  eq(list({ filter: "flagged" }).reported.length, 0, "Flagged hides reported tables");
  eq(list({ query: "7", filter: "mine" }).outstanding.map((r) => r.table).join(), "7", "a search looks beyond Mine");
  eq(list({ query: "mina" }).outstanding.map((r) => r.table).join(), "7", "search by player name, case-insensitive");
  eq(list({ query: "KAI" }).outstanding.map((r) => r.table).join(), "6", "search matches either player");
  eq(list({ query: "1" }).outstanding.length + list({ query: "1" }).reported.length, 1, "table-number search is a prefix match on table numbers (not names)");
  eq(list({ query: "zzz" }).outstanding.length, 0, "no match");
  eq(list({ query: "  " }).outstanding.length, 4, "blank search = no search");
  eq(list({}, null).outstanding.find((r) => r.table === 2)?.kind, "waiting", "before the first tick nothing is over time");

  const over = list({}, START + 61 * MIN);
  eq(over.outstanding.map((r) => `${r.table}:${r.kind}`).join(), "6:flagged,2:over_time,3:over_time,7:over_time", "past the end: over time, flagged stays on top");
  eq(over.outstanding[1].line, "Time called", "over time line");
  const ext = m.rbFloorList(
    { ...s, matches: ms.map((x) => (x.id === "m3-2" ? { ...x, extension_ms: 5 * MIN } : x)) },
    live,
    START + 62 * MIN,
    { query: "", filter: "all", judge: ray, adminName: "Ray" },
  );
  eq(ext.outstanding.find((r) => r.table === 2)?.kind, "playing", "an extension keeps its table in time");
  eq(ext.outstanding.find((r) => r.table === 2)?.line, "Playing · 03:00 left · +5:00", "…with the extra time on the line");

  const published = m.rbFloorList(s, rnd(3, "published"), at, { query: "", filter: "all", judge: ray, adminName: "Ray" });
  eq(published.outstanding.find((r) => r.table === 3)?.line, "Clock not started", "published: clock not started");
  const paused = m.rbFloorList(s, rnd(3, "live", { paused_at: iso(START + 20 * MIN) }), at, { query: "", filter: "all", judge: ray, adminName: "Ray" });
  eq(paused.outstanding.find((r) => r.table === 3)?.line, "Paused · 40:00 left", "paused");
  const two = m.rbFloorList(
    { ...s, matches: ms.map((x) => (x.id === "m3-3" ? { ...x, flags: [flag("no_show")] } : x)) },
    live,
    at,
    { query: "", filter: "all", judge: ray, adminName: "Ray" },
  );
  eq(two.outstanding.map((r) => r.table).join(), "3,6,2,7", "two flagged tables sort by table number, ahead of the rest");
  eq(two.outstanding[0].line, "No-show open", "flag kind in the line");
  const acked = { ...ms[5], flags: [{ ...flag(), acknowledged_at: iso(START), acknowledged_by_name: "Ray" }] };
  eq(
    m.rbFloorList({ ...s, matches: ms.map((x) => (x.id === acked.id ? acked : x)) }, live, at, { query: "", filter: "flagged", judge: ray, adminName: "Ray" }).outstanding.length,
    0,
    "an acknowledged flag leaves the Flagged filter",
  );
  eq(m.rbReportedLine(s, done(3, 9, 0, 1, 1, 0, "Ray", { decided_on_time: true }), "ray"), "Aria 1–0 Bok (time)", "time-out win marked; own name compared case-insensitively");
}

// ---- Going in, review card, decided on time -----------------------------------

{
  const s = state({ standings: [stand(12, 2, 0), stand(13, 1, 1, 1)] });
  eq(m.rbGoingIn(s, players[12]), "2-0 going in", "record going in (reference)");
  eq(m.rbGoingIn(s, players[13]), "1-1-1 going in", "draws shown only when there are any");
  eq(m.rbGoingIn(s, players[0]), "0-0 going in", "no results yet");
  eq(m.rbGoingIn(s, undefined), "0-0 going in", "unknown player");

  const r = m.rbReview("Mina", "Jae", { gamesA: 2, gamesB: 1 }, false, false, false);
  eq([r.headline, r.timeLine, r.dropLine, r.winner].join(" | "), "Mina wins | Not decided on time | No drops | a", "review: A wins (reference)");
  eq(m.rbReview("Mina", "Jae", { gamesA: 0, gamesB: 2 }, true, true, false).headline, "Jae wins", "review: B wins");
  eq(m.rbReview("Mina", "Jae", { gamesA: 0, gamesB: 2 }, true, true, false).dropLine, "Mina drops after this round", "review: one drop");
  eq(m.rbReview("Mina", "Jae", { gamesA: 1, gamesB: 1 }, true, true, true).dropLine, "Mina and Jae drop after this round", "review: two drops");
  eq(m.rbReview("Mina", "Jae", { gamesA: 1, gamesB: 1 }, true, false, false).headline, "Draw", "review: draw");
  eq(m.rbReview("Mina", "Jae", { gamesA: 1, gamesB: 1 }, true, false, false).timeLine, "Decided on time", "review: on time");

  eq(m.rbDecidedOnTime(3, 2, 0, false), false, "a full win isn't on time");
  eq(m.rbDecidedOnTime(3, 1, 0, false), true, "a time-out lead always is, whatever the toggle");
  eq(m.rbDecidedOnTime(3, 1, 1, false), false, "a draw isn't unless the toggle says so");
  eq(m.rbDecidedOnTime(3, 1, 1, true), true, "toggle on");
  eq(m.rbDecidedOnTime(1, 1, 0, false), false, "Bo1 win");
  eq(m.rbShortId("floor-7f3a9c2e-1111-4222-8333-444455556666"), "7f3a", "short id");
  eq(m.rbShortId("desk-aabbccdd"), "aabb", "short id of a desk key");
  eq(m.rbClockOffset(10_000, 4_000), 6_000, "clock offset: server ahead");
  eq(m.rbClockOffset(undefined, 4_000), 0, "clock offset: no server time");
  eq(RB_DESK_FLAG_KINDS.slice(0, 4).join(), "no_show,judge_call,deck_check,head_judge", "the four floor flag kinds");
  eq(["no_show", "judge_call", "deck_check", "head_judge"].map((k) => round.FLAG_LABEL[k as keyof typeof round.FLAG_LABEL]).join(), "No-show,Judge call,Deck check,Need head judge", "flag labels");
  const keys = new Set(Array.from({ length: 100 }, () => round.newDeskKey("floor")));
  eq(keys.size, 100, "floor keys are unique");
  eq([...keys].every((k) => /^floor-[0-9a-f-]{32,36}$/.test(k) && k.length <= 100), true, "floor key shape fits the server's 1–100 limit");
}

// ---- Submission queue --------------------------------------------------------

const payload = { gamesA: 2, gamesB: 1, gamesDrawn: 0, decidedOnTime: false, dropA: false, dropB: false };
const sub = (key: string, matchId = "m3-7", status: "sending" | "failed" | "rejected" | "conflict" | "sent" = "sending"): import("../src/components/riftbound/rb-floor-model").RbSubmission => ({
  key,
  matchId,
  table: 7,
  label: "Mina wins 2–1",
  payload,
  status,
  error: null,
  attempts: 0,
  createdAt: START,
});

{
  eq(m.rbClassify({ ok: true, data: {} }).kind, "sent", "ok → sent");
  eq(m.rbClassify({ ok: false, error: "Reported by Jin at 14:02:11 KST." }).kind, "conflict", "'Reported by …' → conflict");
  eq((m.rbClassify({ ok: false, error: "Reported by Jin at 14:02:11 KST." }) as { message: string }).message, "Reported by Jin at 14:02:11 KST.", "conflict keeps the server's words");
  eq(m.rbClassify({ ok: false, error: "This round is closed." }).kind, "rejected", "other { ok: false } → rejected, not retried");
  eq(m.rbClassify({ ok: false }).kind, "rejected", "{ ok: false } without a message");
  eq(m.rbClassify(null, new TypeError("Failed to fetch")).kind, "failed", "thrown error → failed (retried)");
  eq((m.rbClassify(null, new TypeError("Failed to fetch")) as { message: string }).message, "Failed to fetch", "…with its message");
  eq(m.rbClassify(null, "weird").kind, "failed", "a thrown non-Error → failed");

  // Double tap: a second submission for the same table (even with a new key) changes nothing.
  const first = m.rbEnqueue([], sub("k1"));
  eq([first.added, first.list.length], [true, 1], "first submission is queued");
  const second = m.rbEnqueue(first.list, sub("k2"));
  eq([second.added, second.list.length, second.sub.key], [false, 1, "k1"], "a second tap for the same table adds nothing and returns the first");
  const same = m.rbEnqueue(first.list, sub("k1", "m3-8"));
  eq(same.added, false, "the same key can't be queued twice, even for another table");
  const other = m.rbEnqueue(first.list, sub("k3", "m3-8"));
  eq([other.added, other.list.length], [true, 2], "another table queues normally");
  const afterSent = m.rbEnqueue(m.rbApplyOutcome(first.list, "k1", { kind: "sent" }), sub("k4"));
  eq(afterSent.added, true, "once sent, the table is no longer active");
  eq(m.rbActiveFor(first.list, "m3-7")?.key, "k1", "active submission lookup");
  eq(m.rbActiveFor(m.rbApplyOutcome(first.list, "k1", { kind: "conflict", message: "x" }), "m3-7"), undefined, "a conflict isn't active");

  // Outcomes.
  const sending = m.rbMarkSending([sub("k1", "m3-7", "failed")], "k1");
  eq([sending[0].status, sending[0].attempts], ["sending", 1], "marking sending counts the attempt");
  const failed = m.rbApplyOutcome(sending, "k1", { kind: "failed", message: "Failed to fetch" });
  eq([failed[0].status, failed[0].error, failed[0].key], ["failed", "Failed to fetch", "k1"], "failed keeps the key");
  eq(m.rbApplyOutcome(failed, "k1", { kind: "sent" })[0].error, null, "sent clears the error");
  eq(m.rbIsActive(sub("k", "m", "sent")), false, "sent isn't active");
  eq(m.rbIsActive(sub("k", "m", "rejected")), true, "rejected is active (waits for the judge)");

  // sessionStorage round trip.
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  m.rbSaveQueue(storage, "poro", [sub("k1"), sub("k2", "m3-8", "failed"), sub("k3", "m3-9", "sent"), sub("k4", "m3-10", "conflict"), sub("k5", "m3-11", "rejected")]);
  eq(JSON.parse(store.get("rb-floor-pending:poro") as string).map((s: { key: string }) => s.key).join(), "k1,k2,k5", "only unfinished submissions are persisted");
  const back = m.rbLoadQueue(storage, "poro");
  eq(back.map((s) => `${s.key}:${s.status}`).join(), "k1:failed,k2:failed,k5:rejected", "after a refresh, 'sending' comes back as failed (to be sent again with the same key)");
  eq(JSON.stringify(back[0].payload), JSON.stringify(payload), "payload survives");
  eq(m.rbLoadQueue(storage, "other").length, 0, "queues are per tournament");
  m.rbSaveQueue(storage, "poro", [sub("k3", "m3-9", "sent")]);
  eq(store.has("rb-floor-pending:poro"), false, "an empty queue removes the entry");
  store.set("rb-floor-pending:poro", "{not json");
  eq(m.rbLoadQueue(storage, "poro").length, 0, "garbage in storage is ignored");
  store.set("rb-floor-pending:poro", JSON.stringify([{ key: "", matchId: "m", table: 1, status: "failed", payload }, { nope: true }, 7]));
  eq(m.rbLoadQueue(storage, "poro").length, 0, "malformed entries are dropped");
  const full = { setItem: () => { throw new Error("quota"); }, removeItem: () => { throw new Error("quota"); } };
  m.rbSaveQueue(full, "poro", [sub("k1")]);
  checks++; // reaching here means a full storage didn't throw
}

if (failures > 0) {
  console.error(`\n${failures} of ${checks} checks failed.`);
  process.exit(1);
}
console.log(`ok: ${checks} checks passed.`);
