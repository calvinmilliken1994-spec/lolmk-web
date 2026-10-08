// Deterministic tests for the Riftbound desk's pure logic: the setup checklist
// (src/components/riftbound/rb-setup-model.ts) and the phase rail, status chip
// and primary action (rb-deck-model.ts), against docs/design/control-deck-v2/
// behaviour.md "Primary action". No database, no React. Run directly:
//   node --experimental-strip-types scripts/test-rb-setup.ts

import { registerHooks } from "node:module";
import type { RbMatch, RbPlayer, RbRound } from "../src/types/riftbound";
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

const setup = await import("../src/components/riftbound/rb-setup-model");
const deck = await import("../src/components/riftbound/rb-deck-model");
const { DEFAULT_RB_CONFIG } = await import("../src/types/riftbound");

let checks = 0;
let failures = 0;
function eq<T>(actual: T, expected: T, msg: string) {
  checks++;
  if (actual !== expected) {
    failures++;
    console.error(`FAIL: ${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  }
}

const T = "2026-12-12T01:00:00.000Z";

function player(i: number, status: RbPlayer["status"] = "registered", member = i % 4 !== 0): RbPlayer {
  return {
    id: `p${i}`,
    tournament_id: "t1",
    display_name: `Player ${i}`,
    member_discord_id: member ? `d${i}` : null,
    legend: null,
    status,
    dropped_after_round: null,
    created_at: T,
  };
}

function round(number: number, status: RbRound["status"], stage: RbRound["stage"] = "swiss"): RbRound {
  return {
    id: `r${number}`,
    tournament_id: "t1",
    number,
    stage,
    status,
    started_at: status === "live" || status === "closed" ? T : null,
    paused_at: null,
    paused_total_ms: 0,
    duration_ms: stage === "swiss" ? 3_600_000 : null,
    pairing_seed: null,
    created_at: T,
  };
}

function match(roundNumber: number, table: number, status: RbMatch["status"]): RbMatch {
  return {
    id: `m${roundNumber}-${table}`,
    tournament_id: "t1",
    round_id: `r${roundNumber}`,
    table_number: table,
    player_a_id: `p${table * 2}`,
    player_b_id: `p${table * 2 + 1}`,
    games_a: status === "pending" ? 0 : 2,
    games_b: 0,
    games_drawn: 0,
    decided_on_time: false,
    extension_ms: 0,
    status,
    reported_by_id: status === "completed" ? "9" : null,
    reported_by_name: status === "completed" ? "Ray" : null,
    reported_at: status === "completed" ? T : null,
    idempotency_key: null,
    flags: [],
  };
}

function state(over: {
  status?: RbDeskState["tournament"]["status"];
  config?: Partial<RbDeskState["tournament"]["config"]>;
  players?: RbPlayer[];
  rounds?: RbRound[];
  matches?: RbMatch[];
}): RbDeskState {
  return {
    tournament: {
      id: "t1",
      slug: "poro-cup-rb",
      name: "Poro Cup",
      status: over.status ?? "draft",
      config: { ...DEFAULT_RB_CONFIG, date: "2026-12-12", venue: "Hongdae", ...over.config },
      scene: "idle",
      auto_follow: true,
      auto_follow_paused: false,
      champion_player_id: null,
      created_at: T,
      updated_at: T,
    },
    players: over.players ?? [],
    rounds: over.rounds ?? [],
    matches: over.matches ?? [],
    standings: [],
    audit: [],
  };
}

const field = (n: number, status: RbPlayer["status"] = "registered") => Array.from({ length: n }, (_, i) => player(i + 1, status));
const spec = (s: RbDeskState) => deck.rbPrimarySpec(s);

// ---- Primary action: every row of behaviour.md ----------------------------

{
  const noBasics = state({ config: { date: null, venue: null } });
  const a = spec(noBasics)!;
  eq(a.label, "Open check-in", "setup label");
  eq(a.enabled, false, "setup blocked without basics");
  eq(a.reason, "Needs: date, venue", "setup blocked reason lists the missing fields");
  eq(spec(state({ config: { venue: null } }))!.reason, "Needs: venue", "reason lists only what is missing");
  const ok = spec(state({}))!;
  eq(ok.enabled, true, "setup enabled with basics + format");
  eq(ok.reason, undefined, "no reason when enabled");
  eq(ok.hint, "Players can still register after", "reference hint under Open check-in");
}

{
  const one = spec(state({ status: "registration", players: [player(1, "checked_in"), player(2), player(3)] }))!;
  eq(one.label, "Close check-in & pair Round 1", "check-in label");
  eq(one.enabled, false, "check-in blocked below 2 checked in");
  eq(one.reason, "Need at least 2 players", "check-in reason");
  const two = spec(state({ status: "registration", players: [player(1, "checked_in"), player(2, "checked_in")] }))!;
  eq(two.enabled, true, "check-in enabled at 2 checked in");
}

const active = field(28, "active");
const inProgress = (rounds: RbRound[], matches: RbMatch[] = [], config: Partial<RbDeskState["tournament"]["config"]> = {}) =>
  state({ status: "in_progress", config: { swissRounds: 5, tiebreakSeed: "s", ...config }, players: active, rounds, matches });

{
  const draft = spec(inProgress([round(1, "draft")]))!;
  eq(draft.label, "Publish Round 1", "draft round label");
  eq(draft.enabled, true, "publish always enabled");
  const pub = spec(inProgress([round(1, "closed"), round(2, "published")]))!;
  eq(pub.label, "Start Round 2 clock", "published round label");
  eq(pub.enabled, true, "start clock always enabled");

  const live = spec(inProgress([round(1, "live")], [match(1, 1, "pending"), match(1, 2, "pending"), match(1, 3, "completed")]))!;
  eq(live.label, "Close Round 1", "live round label");
  eq(live.enabled, false, "close blocked with outstanding tables");
  eq(live.reason, "2 tables outstanding", "outstanding reason");
  eq(spec(inProgress([round(1, "live")], [match(1, 1, "pending")]))!.reason, "1 table outstanding", "singular outstanding reason");
  const all = spec(inProgress([round(1, "live")], [match(1, 1, "completed"), match(1, 2, "bye")]))!;
  eq(all.enabled, true, "close enabled when every table is reported (byes count)");
  eq(all.reason, undefined, "no reason when every table is reported");

  const closed = spec(inProgress([round(1, "closed")]))!;
  eq(closed.label, "Pair Round 2", "closed, not last");
  eq(closed.enabled, true, "pair next enabled");
}

{
  const swiss = (n: number) => Array.from({ length: n }, (_, i) => round(i + 1, "closed"));
  const cut = spec(inProgress(swiss(5)))!;
  eq(cut.label, "Cut to Top 8", "last Swiss round closed with Auto cut at 28 players");
  eq(cut.enabled, true, "cut enabled");
  ok(Boolean(cut.confirm), "cut asks for confirmation");
  eq(spec(inProgress(swiss(5), [], { topCut: 4 }))!.label, "Cut to Top 4", "cut size follows the config");
  const none = spec(inProgress(swiss(5), [], { topCut: 0 }))!;
  eq(none.label, "Complete event", "last Swiss round closed with no cut completes the event");
  ok(Boolean(none.confirm), "complete asks for confirmation");
  const small = state({ status: "in_progress", config: { swissRounds: 3, tiebreakSeed: "s" }, players: field(5, "active"), rounds: swiss(3) });
  eq(spec(small)!.label, "Complete event", "Auto cut at 5 players is none");
}

{
  const cutState = (rounds: RbRound[], matches: RbMatch[]) =>
    state({ status: "in_progress", config: { swissRounds: 5, tiebreakSeed: "s", topCutSeedIds: ["p1", "p2", "p3", "p4"] }, players: active, rounds, matches });
  const swiss = Array.from({ length: 5 }, (_, i) => round(i + 1, "closed"));
  eq(spec(cutState([...swiss, round(6, "draft", "top_cut")], [match(6, 1, "pending"), match(6, 2, "pending")]))!.label, "Publish Round 6", "top-cut draft publishes");
  eq(spec(cutState([...swiss, round(6, "published", "top_cut")], [match(6, 1, "pending"), match(6, 2, "pending")])), null, "no primary action while top-cut tables are pending");
  eq(spec(cutState([...swiss, round(6, "live", "top_cut")], [match(6, 1, "completed"), match(6, 2, "pending")])), null, "still none with one table outstanding");
  eq(spec(cutState([...swiss, round(6, "published", "top_cut")], [match(6, 1, "completed"), match(6, 2, "completed")]))!.label, "Close Round 6", "semis reported");
  eq(spec(cutState([...swiss, round(6, "closed", "top_cut")], [match(6, 1, "completed"), match(6, 2, "completed")]))!.label, "Pair Round 7", "semis closed");
  const final = spec(cutState([...swiss, round(6, "closed", "top_cut"), round(7, "published", "top_cut")], [match(6, 1, "completed"), match(6, 2, "completed"), match(7, 1, "completed")]))!;
  eq(final.label, "Complete event", "final reported");
  ok(Boolean(final.confirm), "complete asks for confirmation");
  eq(spec(state({ status: "completed" })), null, "no primary action once complete");
}

function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}

// ---- Phases and chip --------------------------------------------------------

{
  const ph = (s: RbDeskState) => Object.fromEntries(deck.rbPhases(s).map((p) => [p.id, p.status]));
  eq(JSON.stringify(ph(state({ players: field(28) }))), JSON.stringify({ setup: "live", checkin: "next", swiss: "next", top_cut: "next", complete: "next" }), "phases in setup");
  eq(ph(state({ players: field(5) })).top_cut, "off", "no cut at 5 players is struck through");
  eq(ph(state({ status: "registration", players: field(28) })).setup, "done", "setup done in check-in");
  eq(ph(inProgress([round(1, "live")])).swiss, "live", "swiss live");
  eq(ph(inProgress([round(1, "live")], [], { topCutSeedIds: ["p1", "p2"] })).top_cut, "live", "top cut live once the cut is made");
  eq(deck.rbStatusChip(state({})), "SETUP", "chip setup");
  eq(deck.rbStatusChip(state({ status: "registration" })), "CHECK-IN", "chip check-in");
  eq(deck.rbStatusChip(inProgress([round(1, "closed"), round(2, "closed"), round(3, "live")])), "ROUND 3 / 5 · LIVE", "chip live round");
  eq(deck.rbStatusChip(state({ status: "completed" })), "COMPLETE", "chip complete");
}

// ---- Setup model ------------------------------------------------------------

{
  const s = state({ players: field(28) });
  eq(setup.rbRoundsHint(s), "Auto · 5 rounds at 28 registered. Fixed when Round 1 is paired.", "rounds hint matches the reference");
  eq(setup.rbCutHint(s), "Auto · Top 8 at 17+ players. Top cut is untimed.", "cut hint matches the reference");
  eq(JSON.stringify(setup.rbRoundOptions(s)), "[4,5,6]", "round options around Auto");
  eq(setup.rbCutHint(state({ players: field(10) })), "Auto · Top 4 at 7–16 players. Top cut is untimed.", "Top 4 hint");
  eq(setup.rbCutHint(state({ players: field(5) })), "Auto · No cut at 6 or fewer players. Swiss rank 1 is champion.", "no cut hint");
  eq(setup.rbCutHint(state({ players: field(6), config: { topCut: 8 } })), "Only 6 players: the cut shrinks to Top 4. Top cut is untimed.", "oversized cut shrinks");
  eq(setup.rbFormatSummary(s), "Bo3 · 60 min · Auto rounds · Auto cut", "format summary matches the reference");
  eq(setup.rbAdvancedSummary(s), "Advanced · bye 2–0 · MW% floor 33% · tiebreakers", "advanced summary matches the reference");

  const fixed = inProgress([round(1, "live")]);
  eq(setup.rbRoundsHint(fixed), "5 rounds, fixed when Round 1 was paired. Editable until the final round is paired.", "rounds hint after Round 1");
}

{
  const none = setup.rbLocks(state({}));
  eq(none.format, null, "nothing locked in setup");
  eq(none.players, null, "players open in setup");
  const r1 = setup.rbLocks(state({ status: "in_progress", config: { swissRounds: 5 }, rounds: [round(1, "live")] }));
  eq(r1.format, "Round 1 is paired.", "format locks when Round 1 is paired");
  eq(r1.swissRounds, null, "round count stays editable until the final round");
  eq(r1.topCut, null, "cut size stays editable until the cut");
  ok(Boolean(r1.players), "registration closes when Round 1 is paired");
  const finalPaired = setup.rbLocks(state({ status: "in_progress", config: { swissRounds: 2 }, rounds: [round(1, "closed"), round(2, "live")] }));
  eq(finalPaired.swissRounds, "The final Swiss round is paired.", "round count locks at the final round");
  eq(finalPaired.powerPair, "The final Swiss round is paired.", "power pairing locks at the final round");
  eq(setup.rbLocks(state({ status: "in_progress", config: { topCutSeedIds: ["a", "b"] } })).topCut, "The cut has been made.", "cut size locks after the cut");
  eq(setup.rbLocks(state({ status: "completed" })).event, "The event is finished.", "everything locks when finished");
}

{
  const steps = setup.rbSetupSteps(
    state({
      status: "draft",
      players: field(28),
      config: {
        judges: [
          { id: "a", name: "Ray", from: 1, to: 6 },
          { id: "b", name: "Joe", from: 7, to: 11 },
          { id: "c", name: "Jin", from: 12, to: null },
        ],
      },
    }),
  );
  const by = Object.fromEntries(steps.map((x) => [x.id, x]));
  eq(steps.length, 6, "six checklist steps");
  eq(steps.map((x) => x.label).join(","), "Event basics,Format,Players,Check-in,Judges,Venue screen", "step order and names");
  eq(by.players.detail, "28 registered · 21 members, 7 guests", "players detail");
  eq(by.judges.detail, "Ray, Joe, Jin · tables split 1–6 / 7–11 / 12+", "judges detail matches the reference");
  eq(by.checkin.detail, "Opens on event day", "check-in detail");
  eq(by.venue.detail, "Not tested yet · open /rblive/poro-cup-rb", "venue detail matches the reference");
  eq(by.venue.status, "warn", "venue is warn until tested");
  eq(by.basics.status, "done", "basics done");
  eq(by.checkin.status, "todo", "check-in todo before it opens");
  const tested = setup.rbSetupSteps(state({ players: field(3), config: { venueTestedAt: T } }));
  eq(tested.find((x) => x.id === "venue")!.status, "done", "venue done after Mark tested");
  eq(tested.find((x) => x.id === "judges")!.detail, "Optional · no judges added", "judges optional");
  eq(setup.rbJudgeOverlaps([{ id: "a", name: "Ray", from: 1, to: 6 }, { id: "b", name: "Joe", from: 6, to: 9 }]).join(), "Ray and Joe", "overlap detected");
  eq(setup.rbJudgeOverlaps([{ id: "a", name: "Ray", from: 1, to: 6 }, { id: "b", name: "Joe", from: 7, to: null }]).length, 0, "adjacent ranges don't overlap");
}

if (failures > 0) {
  console.error(`\n${failures} of ${checks} checks failed.`);
  process.exit(1);
}
console.log(`ok: ${checks} checks passed.`);
