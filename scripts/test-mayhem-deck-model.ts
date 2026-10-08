// Mayhem desk model tests: phases, the primary step, the re-roll lock,
// scene availability, the match queue and the activity text, over
// hand-built MayhemAdminState fixtures.
//   node --experimental-strip-types scripts/test-mayhem-deck-model.ts

import { registerHooks } from "node:module";
import type { MayhemAdminState, MayhemMatch, MayhemPlayer, MayhemTeam } from "../src/types/mayhem";

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

const m = await import("../src/components/mayhem/mayhem-deck-model");
const { isRevealStarted } = await import("../src/lib/mayhem-reveal");

let checks = 0;
function eq<T>(actual: T, expected: T, label: string) {
  checks++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
    process.exit(1);
  }
}

function player(i: number, member = false): MayhemPlayer {
  return {
    id: `p${i}`,
    event_id: "main",
    display_name: `Player ${i}`,
    entry_order: i,
    team_id: null,
    member_discord_id: member ? `d${i}` : null,
  };
}

function base(players = 30): MayhemAdminState {
  return {
    event: {
      id: "main",
      title: "Mayhem Night",
      stage: "collecting",
      scene: "idle",
      countdown_ends_at: null,
      reveal_index: 0,
      format: {
        groupStage: { enabled: false, groupCount: 2, seriesLength: 1, advancePerGroup: 2, seeding: "random" },
        knockout: { seriesLength: 1, doubleElimination: false, thirdPlaceMatch: false, grandFinalReset: true },
      },
      active_match_id: null,
      champion_team_id: null,
      updated_at: new Date(0).toISOString(),
      team_format: "randomized",
      registration_open: false,
      registration_generation: 0,
      auto_reveal: false,
      reveal_started_at: null,
      reveal_interval_ms: 8000,
      reveal_start_on_countdown: false,
    },
    players: Array.from({ length: players }, (_, i) => player(i + 1, i % 4 !== 3)),
    teams: [],
    groups: [],
    matches: [],
    applications: [],
    audit: [],
  } as unknown as MayhemAdminState;
}

function withTeams(s: MayhemAdminState, n = 6): MayhemAdminState {
  const teams: MayhemTeam[] = Array.from({ length: n }, (_, t) => ({
    id: `t${t + 1}`,
    event_id: "main",
    name: `Team ${t + 1}`,
    icon_url: "",
    seed: t + 1,
    reveal_order: t,
    group_id: null,
    players: s.players.slice(t * 5, t * 5 + 5),
    is_ready: true,
    captain_discord_id: null,
  }));
  return { ...s, event: { ...s.event, stage: "randomized", scene: "reveal" }, teams };
}

function match(n: number, patch: Partial<MayhemMatch>): MayhemMatch {
  return {
    id: `m${n}`,
    event_id: "main",
    bracket: "upper",
    group_id: null,
    round_number: 1,
    match_number: n,
    best_of: 1,
    team_a_id: null,
    team_b_id: null,
    team_a_score: 0,
    team_b_score: 0,
    winner_id: null,
    status: "pending",
    advances_to_match_id: null,
    advances_to_slot: null,
    drops_to_match_id: null,
    drops_to_slot: null,
    ...patch,
  };
}

const statuses = (s: MayhemAdminState) => m.mayhemPhases(s).map((p) => `${p.id}:${p.status}${p.meta ? `:${p.meta}` : ""}`);

// --- Entrants ------------------------------------------------------------
{
  const s = base(30);
  eq(m.mayhemCurrentPhase(s), "entrants", "collecting is Entrants");
  eq(statuses(s), ["entrants:live:30", "teams:next", "groups:off:OFF", "knockout:next", "complete:next"], "rail, groups off");
  const p = m.mayhemPrimarySpec(s)!;
  eq([p.kind, p.label, p.enabled], ["randomize", "Randomize teams", true], "30 players can randomize");
  eq(m.mayhemTeamFormatLock(s) !== null, true, "team format locked once players exist");
  eq(m.mayhemTeamFormatLock(base(0)), null, "team format open with no players");
  eq(m.mayhemStatusChip(s), "ENTRANTS · 30 PLAYERS", "status chip");

  const short = m.mayhemPrimarySpec(base(22))!;
  eq([short.enabled, short.reason], [false, "Need 3 more players (multiples of 5, min 20)."], "22 players blocked");
  eq(m.mayhemPrimarySpec(base(4))!.reason, "Need 16 more players (multiples of 5, min 20).", "under 20");
  eq(m.mayhemReadiness(base(25)), { canRandomize: true, playersNeeded: 0, teamCount: 5 }, "readiness 25");

  const premade = { ...base(0), event: { ...base(0).event, team_format: "premade" as const } };
  eq(m.mayhemPrimarySpec(premade)!.reason, "No premade teams yet.", "premade with no teams");
  const premadeTeams = withTeams(base(10), 2);
  premadeTeams.event = { ...premadeTeams.event, stage: "collecting", team_format: "premade" };
  premadeTeams.teams[1] = { ...premadeTeams.teams[1], is_ready: false };
  eq(m.mayhemPrimarySpec(premadeTeams)!.reason, "1 team not full yet.", "premade not full");
  premadeTeams.teams[1] = { ...premadeTeams.teams[1], is_ready: true };
  eq(m.mayhemPrimarySpec(premadeTeams)!.enabled, true, "premade all full");

  const on = base(30);
  on.event.format.groupStage.enabled = true;
  eq(statuses(on)[2], "groups:next", "groups on shows as next");
}

// --- Teams / reveal ------------------------------------------------------
{
  const s = withTeams(base(30));
  eq(m.mayhemCurrentPhase(s), "teams", "randomized is Teams");
  eq(statuses(s).slice(0, 2), ["entrants:done:30", "teams:live:NOW"], "rail teams live");
  eq(m.mayhemPrimarySpec(s)!.label, "Reveal team 1", "reveal team 1");
  eq(m.mayhemPrimarySpec(s)!.hint, "Then: seed knockout bracket", "hint without groups");
  eq(m.mayhemRerollLock(s), null, "re-roll open before the reveal");
  eq(m.mayhemOnAirLabel(s), "Reveal · 0 of 6", "on air before reveal");

  const three = { ...s, event: { ...s.event, reveal_index: 3 } };
  eq(m.mayhemPrimarySpec(three)!.label, "Reveal team 4", "reveal team 4 (reference)");
  eq(m.mayhemOnAirLabel(three), "Reveal · 3 of 6", "on air label (reference)");
  eq(m.mayhemRerollLock(three), "Locked: reveal started", "re-roll locked mid-reveal");
  eq(
    three.teams.map((t) => m.mayhemTeamOnScreen(three, t)),
    [true, true, true, false, false, false],
    "first three on screen",
  );

  const auto = { ...s, event: { ...s.event, auto_reveal: true, reveal_started_at: new Date().toISOString() } };
  eq(m.mayhemRevealStarted(auto), true, "auto-reveal armed counts as started");
  eq(m.mayhemPrimarySpec(auto)!.enabled, false, "reveal next blocked while auto runs");
  const waiting = { ...s, event: { ...s.event, auto_reveal: true, reveal_start_on_countdown: true } };
  eq(m.mayhemRevealStarted(waiting), true, "waiting for countdown counts as started");
  eq(m.mayhemPrimarySpec(waiting)!.reason, "Auto-reveal starts when the countdown ends.", "waiting reason");
  const paused = { ...s, event: { ...s.event, reveal_started_at: new Date().toISOString() } };
  eq(m.mayhemRevealStarted(paused), true, "paused at 0 after an auto start is still started");

  eq(isRevealStarted({ stage: "collecting", revealIndex: 3, autoReveal: true, revealStartedAt: "x" }), false, "never while collecting");
  eq(isRevealStarted({ stage: "randomized", revealIndex: 0, autoReveal: false, revealStartedAt: null }), false, "restart unlocks");

  const all = { ...s, event: { ...s.event, reveal_index: 6 } };
  eq(m.mayhemPrimarySpec(all)!.kind, "knockout_from_teams", "after reveal, seed knockout");
  const allGroups = { ...all, event: { ...all.event, format: { ...all.event.format, groupStage: { ...all.event.format.groupStage, enabled: true } } } };
  eq(m.mayhemPrimarySpec(allGroups)!.kind, "generate_groups", "after reveal with groups, generate groups");
  eq(m.mayhemPrimarySpec(s)!.hint, "Then: seed knockout bracket", "hint");

  const premade = { ...three, event: { ...three.event, team_format: "premade" as const } };
  eq(m.mayhemRerollLock(premade), "Premade teams can't be re-rolled.", "premade never re-rolls");
}

// --- Scenes --------------------------------------------------------------
{
  const s = base(30);
  eq(
    m.MAYHEM_SCENE_ORDER.map((id) => m.mayhemSceneUnavailableReason(id, s) === null),
    [true, true, false, false, false, false, false, false],
    "only idle and starting soon before teams",
  );
  const t = withTeams(s);
  eq(m.mayhemSceneUnavailableReason("reveal", t), null, "reveal available with teams");
  eq(m.mayhemSceneUnavailableReason("groups", t), "Enable group stage first", "groups off");
  eq(m.mayhemParseScene("champion"), "champion", "parse scene");
  eq(m.mayhemParseScene("nope"), null, "parse unknown scene");
  eq(m.mayhemParseScene(undefined), null, "parse missing scene");
}

// --- Knockout queue ------------------------------------------------------
{
  const t = withTeams(base(20), 4);
  const s: MayhemAdminState = {
    ...t,
    event: { ...t.event, stage: "knockout", scene: "match", reveal_index: 4, active_match_id: "m2" },
    matches: [
      match(1, { team_a_id: "t1", team_b_id: "t4", status: "completed", team_a_score: 1, winner_id: "t1" }),
      match(2, { team_a_id: "t2", team_b_id: "t3", best_of: 3 }),
      match(3, { round_number: 2, bracket: "grand_final", team_a_id: "t1" }),
      match(4, { team_a_id: "t2", team_b_id: "t1", best_of: 5 }),
    ],
  };
  const q = m.mayhemQueue(s);
  eq(q.onScreen?.match.id, "m2", "active match is on screen");
  eq(q.ready.map((r) => r.match.id), ["m4"], "ready");
  eq(q.waiting.map((r) => r.match.id), ["m3"], "waiting on a result");
  eq(q.done.map((r) => r.match.id), ["m1"], "done");
  eq(q.waiting[0].nameB, "TBD", "TBD name");
  eq(q.waiting[0].where, "Grand final · reset", "grand final reset label");
  eq(m.mayhemMatchWhere(s, s.matches[0]), "Upper · R1", "upper label");
  eq(s.matches.map(m.scorePadFormat), ["bo1", "bo3", "bo1", "bo5"], "score pad follows best_of");
  eq(m.mayhemPrimarySpec(s), null, "no primary step during the knockout");
  eq(m.mayhemStatusChip(s), "KNOCKOUT · 1/4 MATCHES", "knockout chip");
  eq(statuses(s)[3], "knockout:live:1/4", "knockout rail meta");

  const done = { ...s, event: { ...s.event, stage: "completed" as const, champion_team_id: "t1", scene: "champion" as const } };
  eq(statuses(done)[4], "complete:live:DONE", "complete live");
  eq(m.mayhemSceneUnavailableReason("champion", done), null, "champion available");
  eq(m.mayhemKnockoutSettingsLock(s) !== null, true, "knockout settings locked once seeded");

  const audit = [
    { id: "a1", event_id: "main", at: "2026-10-09T10:00:00Z", action: "match.report", detail: { matchNumber: 2, teamAScore: 1, teamBScore: 2, winnerId: "t3" }, actor_discord_id: "1", actor_name: "calvin" },
    { id: "a2", event_id: "main", at: "2026-10-09T10:01:00Z", action: "reveal.hide_last", detail: { shown: 2, of: 6 }, actor_discord_id: "1", actor_name: "calvin" },
    { id: "a3", event_id: "main", at: "2026-10-09T10:02:00Z", action: "teams.randomize", detail: { teams: 6, reroll: true }, actor_discord_id: "2", actor_name: "mj" },
    { id: "a4", event_id: "main", at: "2026-10-09T10:03:00Z", action: "match.set_active", detail: { matchId: "m4" }, actor_discord_id: "2", actor_name: "mj" },
  ];
  const withAudit = { ...s, audit };
  eq(
    m.mayhemActivity(withAudit).map((r) => `${r.actor}: ${r.text}`),
    [
      "calvin: M2: Team 3 won 2–1",
      "calvin: Hid the last team (2 of 6 on screen)",
      "mj: Re-rolled teams (6)",
      "mj: Put M4 on screen",
    ],
    "activity text",
  );
}

// --- Groups --------------------------------------------------------------
{
  const t = withTeams(base(20), 4);
  const s: MayhemAdminState = {
    ...t,
    event: {
      ...t.event,
      stage: "group_stage",
      format: { ...t.event.format, groupStage: { ...t.event.format.groupStage, enabled: true } },
    },
    groups: [{ id: "g1", event_id: "main", label: "Group A", advance_count: 2 }],
    matches: [
      match(1, { bracket: "group", group_id: "g1", team_a_id: "t1", team_b_id: "t2", status: "completed", winner_id: "t1", team_a_score: 1 }),
      match(2, { bracket: "group", group_id: "g1", team_a_id: "t3", team_b_id: "t4" }),
    ],
  };
  eq(statuses(s)[2], "groups:live:1/2", "groups live with progress");
  const p = m.mayhemPrimarySpec(s)!;
  eq([p.kind, p.hint], ["knockout_from_groups", "1 group match still open"], "seed from standings");
  eq(m.mayhemGroupRows(s, "g1").map((r) => r.status), ["done", "ready"], "group rows");
  eq(m.mayhemMatchWhere(s, s.matches[0]), "Group A", "group label");
}

console.log(`Mayhem deck model passed: ${checks} checks.`);
