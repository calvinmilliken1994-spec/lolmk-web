// SR desk model tests: phases, the primary step, the match queue over a real
// double-elimination bracket (built and advanced by bracket-engine, through
// the grand-final reset), labels, the UBR1 reveal progress, scenes, locks,
// the signups queue and the activity text.
//   node --experimental-strip-types scripts/test-sr-deck-model.ts

import { registerHooks } from "node:module";
import type { SrAdminState, SrAuditLogEntry, SrMatch, SrTeam, SrTeamApplicationView } from "../src/types/sr-tournament";

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

const m = await import("../src/components/sr/sr-deck-model");
const engine = await import("../src/lib/bracket-engine");
const { REVEAL_ROW_INTERVAL_MS } = await import("../src/lib/sr-reveal");

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

const NAMES = ["Hanbit Five", "Mid Diff", "Flash on D", "Baron Steal", "Gank Squad", "Poro Patrol", "Nexus Ten", "Ward Bros"];

function team(i: number, status: SrTeam["status"] = "approved", seed: number | null = null): SrTeam {
  return {
    id: `t${i}`,
    tournament_id: "sr1",
    name: NAMES[i - 1] ?? `Team ${i}`,
    logo_url: null,
    seed,
    captain_discord_id: `cap${i}`,
    status,
    created_at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
  };
}

function base(): SrAdminState {
  return {
    tournament: {
      id: "sr1",
      slug: "sr-cup",
      name: "SR Cup",
      status: "draft",
      format: "double_elim",
      best_of: 3,
      third_place_match: false,
      grand_final_reset: true,
      grand_final_best_of: 5,
      min_teams: 8,
      max_teams: 16,
      start_at: null,
      end_at: null,
      seed_locked: false,
      champion_team_id: null,
      signups_open: false,
      scene: "idle",
      countdown_ends_at: null,
      active_match_id: null,
      ubr1_revealed_count: 0,
      ubr1_reveal_generation: 0,
      ubr1_reveal_started_at: null,
      ubr1_reveal_run_id: null,
      created_at: "2026-10-01T00:00:00.000Z",
      updated_at: "2026-10-01T00:00:00.000Z",
    },
    teams: [],
    matches: [],
    players: [],
    audit: [],
    applications: [],
  };
}

const phaseRow = (s: SrAdminState) => m.srPhases(s).map((p) => `${p.id}:${p.status}${p.meta ? `:${p.meta}` : ""}`);
const primary = (s: SrAdminState, now?: number) => {
  const p = m.srPrimarySpec(s, now);
  return p ? [p.kind, p.label, p.enabled, p.reason ?? null, p.hint ?? null] : null;
};

// --- Setup / Signups --------------------------------------------------------
{
  const s = base();
  eq(m.srCurrentPhase(s), "setup", "fresh draft is Setup");
  eq(phaseRow(s), ["setup:live", "signups:next", "seeding:next", "bracket:next", "live:next", "complete:next"], "rail at setup");
  eq(primary(s), ["open_signups", "Open signups", true, null, "Captains can apply with a five-player roster"], "open signups");
  eq(m.srStatusChip(s), "SETUP · DRAFT", "setup chip");
  eq(m.srTitle(s), "SR Cup · Double elim", "title (reference)");

  const open = { ...s, tournament: { ...s.tournament, signups_open: true } };
  eq(m.srCurrentPhase(open), "signups", "signups open is Signups");
  eq(phaseRow(open).slice(0, 2), ["setup:done", "signups:live:0 teams"], "rail at signups");
  eq(primary(open)!.slice(2, 4), [false, "Need 8 more approved teams (min 8)."], "roll seeds blocked");

  // Closed signups but teams exist (signups closed early): still Signups.
  const closed = { ...s, teams: [team(1, "pending")] };
  eq(m.srCurrentPhase(closed), "signups", "teams exist means Signups");

  const app: SrTeamApplicationView = {
    application: {
      id: "a1",
      tournament_id: "sr1",
      team_name: "Late Squad",
      captain_discord_id: "capX",
      roster_version: 1,
      send_in_progress: false,
      created_at: "2026-10-02T00:00:00.000Z",
    },
    slots: [
      { status: "confirmed", is_captain: true },
      { status: "confirmed", is_captain: false },
      { status: "pending", is_captain: false },
      { status: "declined", is_captain: false },
      { status: "draft", is_captain: false },
    ].map((x, i) => ({
      id: `sl${i}`,
      application_id: "a1",
      member_discord_id: `m${i}`,
      display_name: `M${i}`,
      avatar_url: null,
      status: x.status as "confirmed" | "pending" | "declined" | "draft",
      is_captain: x.is_captain,
      confirm_token_expires_at: null,
      delivery_status: "sent" as const,
      delivery_error: null,
      token_roster_version: 1,
      updated_at: "2026-10-02T00:00:00.000Z",
      created_at: "2026-10-02T00:00:00.000Z",
    })),
  };
  const mixed: SrAdminState = {
    ...open,
    teams: [team(1), team(2, "rejected"), team(3, "pending"), team(4), team(5, "pending")],
    applications: [app],
  };
  const q = m.srSignupQueue(mixed);
  eq(q.pending.map((t) => t.id), ["t3", "t5"], "pending teams first, oldest first");
  eq(q.inProgress.map((r) => [r.view.application.team_name, r.confirmed, r.selected]), [["Late Squad", 2, 5]], "application progress");
  eq(q.approved.map((t) => t.id), ["t1", "t4"], "approved");
  eq(q.rejected.map((t) => t.id), ["t2"], "rejected");
  eq(m.srStatusChip(mixed), "SIGNUPS · 2 APPROVED · 3 PENDING", "signups chip counts teams + applications");
  eq(primary(mixed)!.slice(2), [false, "Need 6 more approved teams (min 8).", "2 teams still waiting for review"], "roll seeds blocked, pending hint");
  eq(m.srRosterLock(mixed), null, "roster open in draft");

  const eight = { ...open, teams: Array.from({ length: 8 }, (_, i) => team(i + 1)) };
  eq(primary(eight), ["roll_seeds", "Roll seeds", true, null, "Closes signups and locks the roster"], "roll seeds ready");
  eq(m.srSceneUnavailableReason("teams", eight), null, "teams scene once approved");
  eq(m.srSceneUnavailableReason("bracket", eight), "Generate the bracket first", "no bracket scene yet");
}

// --- Seeding ------------------------------------------------------------------
const seeded = (): SrAdminState => {
  const s = base();
  return {
    ...s,
    tournament: { ...s.tournament, status: "seeding", seed_locked: true },
    teams: Array.from({ length: 8 }, (_, i) => team(i + 1, "approved", i + 1)),
  };
};
{
  const s = seeded();
  eq(m.srCurrentPhase(s), "seeding", "seeding");
  eq(primary(s), ["generate_bracket", "Generate bracket", true, null, "Publishes the bracket"], "generate");
  eq(m.srRosterLock(s) !== null, true, "roster locked after seeding");
  eq(m.srDatesLock(s) !== null, true, "dates locked after draft");
  eq(m.srStatusChip(s), "SEEDING · 8 TEAMS", "seeding chip");
}

// --- A real 8-team double-elimination bracket ---------------------------------
let nextId = 0;
function bracket(s: SrAdminState): SrMatch[] {
  const built = engine.resolveByes(
    engine.buildKnockoutBracket(
      s.teams.map((t) => t.id),
      {
        tournamentId: "sr1",
        knockoutBestOf: s.tournament.best_of,
        doubleElimination: true,
        thirdPlaceMatch: false,
        grandFinalReset: true,
        grandFinalBestOf: s.tournament.grand_final_best_of,
        idFactory: () => `m${++nextId}`,
      },
    ),
  );
  return built.map((b) => ({ ...b, tournament_id: "sr1" }) as unknown as SrMatch);
}

function report(s: SrAdminState, id: string, a: number, b: number): SrAdminState {
  const graph = s.matches.map((x) => ({ ...x, event_id: "sr1", group_id: null }));
  const r = engine.applyBracketResult(graph as never, id, a, b);
  const matches = (r.matches ?? graph).map((x) => ({ ...(x as object), tournament_id: "sr1" }) as unknown as SrMatch);
  const t = s.tournament;
  return {
    ...s,
    matches,
    tournament: {
      ...t,
      status: r.championId ? "completed" : "in_progress",
      champion_team_id: r.championId,
      active_match_id: t.active_match_id === id ? null : t.active_match_id,
      scene: r.championId ? "champion" : t.active_match_id === id && t.scene === "match" ? "bracket" : t.scene,
    },
  };
}

const win = (x: SrMatch, aWins = true) => {
  const w = Math.floor(x.best_of / 2) + 1;
  return aWins ? [w, 0] : [0, w];
};

{
  const s0 = seeded();
  let s: SrAdminState = { ...s0, tournament: { ...s0.tournament, status: "bracket_published" } };
  s = { ...s, matches: bracket(s) };
  const counts = m.srMatchCounts(s);
  eq(counts, { done: 0, total: 14 }, "8-team DE: 14 matches before the reset is decided (reference)");
  eq(m.srCurrentPhase(s), "bracket", "bracket published");
  eq(phaseRow(s).slice(3), ["bracket:live:0/14", "live:next", "complete:next"], "rail at bracket");
  eq(m.srStatusChip(s), "BRACKET · 0 / 14 MATCHES", "bracket chip");

  // UBR1 reveal
  const T0 = Date.UTC(2026, 9, 9, 10, 0, 0);
  eq(primary(s, T0)!.slice(0, 2), ["start_reveal", "Start UBR1 reveal"], "reveal is the first step");
  eq(m.srUbr1Reveal(s, T0), { total: 4, shown: 0, started: false, running: false }, "reveal not started");
  const rv = { ...s, tournament: { ...s.tournament, ubr1_reveal_started_at: new Date(T0).toISOString() } };
  eq(m.srUbr1Reveal(rv, T0 + 100), { total: 4, shown: 1, started: true, running: true }, "first matchup at once");
  eq(m.srUbr1Reveal(rv, T0 + 2 * REVEAL_ROW_INTERVAL_MS + 10).shown, 3, "third at 2 intervals");
  eq(m.srUbr1Reveal(rv, T0 + 60_000), { total: 4, shown: 4, started: true, running: false }, "done after the hold");

  // After the reveal, start matches in bracket order.
  s = rv;
  const q0 = m.srQueue(s);
  eq(q0.nowPlaying, null, "nothing featured yet");
  eq(q0.upNext.map((r) => r.label), ["UB Quarter 1", "UB Quarter 2", "UB Quarter 3", "UB Quarter 4"], "UB R1 ready");
  eq(q0.upNext.map((r) => [r.seedA, r.seedB]), [[1, 8], [4, 5], [2, 7], [3, 6]], "seeded pairings");
  eq(q0.waiting.length, 10, "ten waiting");
  eq(
    q0.waiting.map((r) => `${r.label}: ${r.nameA} vs ${r.nameB}`),
    [
      "UB Semi 1: Winner UB Quarter 1 vs Winner UB Quarter 2",
      "UB Semi 2: Winner UB Quarter 3 vs Winner UB Quarter 4",
      "LB Round 1: Loser UB Quarter 1 vs Loser UB Quarter 2",
      "LB Round 1: Loser UB Quarter 3 vs Loser UB Quarter 4",
      "UB Final: Winner UB Semi 1 vs Winner UB Semi 2",
      "LB Round 2: Winner LB Round 1 · 1 vs Loser UB Semi 2",
      "LB Round 2: Winner LB Round 1 · 2 vs Loser UB Semi 1",
      "LB Round 3: Winner LB Round 2 · 1 vs Winner LB Round 2 · 2",
      "LB Final: Winner LB Round 3 vs Loser UB Final",
      "Grand final: Winner UB Final vs Winner LB Final",
    ],
    "waiting rows name their sources, in bracket order",
  );
  const first = q0.upNext[0];
  eq(primary(s, T0 + 60_000), ["start_match", "Start UB Quarter 1", true, null, `${first.nameA} vs ${first.nameB} · both teams ready`], "start next");

  // Feature it: the ScorePad is the step, others show who's busy.
  s = { ...s, tournament: { ...s.tournament, active_match_id: first.match.id, scene: "match" } };
  eq(m.srPrimarySpec(s, T0 + 60_000), null, "no primary while a match is featured");
  eq(m.srQueue(s).nowPlaying?.match.id, first.match.id, "now playing");
  eq(m.srOnAirLabel(s), "Match · UB Quarter 1", "on air");
  eq(m.srScorePadFormat(first.match), "bo3", "Bo3 pad from best_of");

  // Play UB R1 (upper seeds win) and LB R1.
  for (const r of m.srQueue(s).upNext.concat(m.srQueue(s).nowPlaying ?? [])) {
    const [a, b] = win(r.match);
    s = report(s, r.match.id, a, b);
  }
  eq(s.tournament.status, "in_progress", "first result moves to Live");
  eq(m.srCurrentPhase(s), "live", "live");
  eq(s.tournament.active_match_id, null, "reporting the featured match clears it");
  const labels = (rows: { label: string }[]) => rows.map((r) => r.label);
  eq(labels(m.srQueue(s).upNext), ["UB Semi 1", "UB Semi 2", "LB Round 1", "LB Round 1"], "after UB R1");

  // Readiness: feature UB Semi 1, LB Round 1 teams are free.
  const semi1 = m.srQueue(s).upNext[0];
  s = { ...s, tournament: { ...s.tournament, active_match_id: semi1.match.id, scene: "match" } };
  eq(m.srMatchLabel(s, semi1.match, true), "UB Semifinal 1", "long label (reference kicker)");
  eq(m.srQueue(s).upNext.every((r) => r.ready), true, "nobody else is busy");
  eq(m.srStatusChip(s), "LIVE · 4 / 14 MATCHES", "live chip");

  // Play everything in bracket order until the grand final.
  const playUntil = (stop: (st: SrAdminState) => boolean) => {
    for (let guard = 0; guard < 40 && !stop(s); guard++) {
      const q = m.srQueue(s);
      const r = q.nowPlaying ?? q.upNext[0];
      if (!r) break;
      const [a, b] = win(r.match);
      s = report(s, r.match.id, a, b);
    }
  };
  playUntil((st) => m.srQueue(st).upNext.some((r) => r.match.bracket === "grand_final"));
  const gf = m.srQueue(s).upNext.find((r) => r.match.bracket === "grand_final")!;
  eq(gf.label, "Grand final", "grand final label");
  eq(m.srScorePadFormat(gf.match), "bo5", "grand-final override drives the pad");
  eq(m.srMatchCounts(s), { done: 13, total: 14 }, "13 of 14 before the final");

  // LB champion wins GF1: the reset becomes real (15 matches).
  const [ga, gb] = win(gf.match, false);
  s = report(s, gf.match.id, ga, gb);
  eq(s.tournament.status, "in_progress", "no champion after GF1 upset");
  const reset = m.srQueue(s).upNext[0];
  eq([reset.label, m.srScorePadFormat(reset.match)], ["Grand final · reset", "bo5"], "reset is up next, Bo5");
  eq(m.srMatchCounts(s), { done: 14, total: 15 }, "reset counts once it's real");
  eq(m.srQueue(s).done[0].label, "Grand final", "done list, newest first");

  // Undo GF1 (engine): the reset goes back to undecided.
  const undone = engine.retractBracketResult(
    s.matches.map((x) => ({ ...x, event_id: "sr1", group_id: null })) as never,
    gf.match.id,
  ) as unknown as SrMatch[];
  const su = { ...s, matches: undone.map((x) => ({ ...x, tournament_id: "sr1" })) };
  eq(m.srMatchCounts(su), { done: 13, total: 14 }, "undo GF1 hides the reset again");

  // Win the reset: champion, Complete.
  const [ra, rb] = win(reset.match);
  s = report(s, reset.match.id, ra, rb);
  eq(s.tournament.status, "completed", "reset decides the champion");
  eq(m.srCurrentPhase(s), "complete", "complete");
  eq(phaseRow(s).slice(4), ["live:done", "complete:live:DONE"], "rail complete");
  eq(m.srPrimarySpec(s), null, "nothing left");
  eq(m.srSceneUnavailableReason("champion", s), null, "champion scene available");
  eq(m.srStatusChip(s), "COMPLETE", "complete chip");
  eq(m.srBracketSettingsLock(s) !== null, true, "bracket settings locked");
  const arch = { ...s, tournament: { ...s.tournament, status: "archived" as const } };
  eq([m.srStatusChip(arch), phaseRow(arch)[5]], ["ARCHIVED", "complete:live:ARCHIVED"], "archived");
}

// --- Single elimination labels --------------------------------------------------
{
  const s0 = seeded();
  const s: SrAdminState = { ...s0, tournament: { ...s0.tournament, format: "single_elim", status: "bracket_published" } };
  const built = engine.resolveByes(
    engine.buildKnockoutBracket(
      s.teams.map((t) => t.id),
      {
        tournamentId: "sr1",
        knockoutBestOf: 1,
        doubleElimination: false,
        thirdPlaceMatch: true,
        grandFinalReset: false,
        idFactory: () => `se${++nextId}`,
      },
    ),
  ).map((b) => ({ ...b, tournament_id: "sr1" }) as unknown as SrMatch);
  const se = { ...s, matches: built };
  const labels = [...new Set(se.matches.map((x) => m.srMatchLabel(se, x)))];
  eq(labels.sort(), ["Final", "Quarter 1", "Quarter 2", "Quarter 3", "Quarter 4", "Semi 1", "Semi 2", "Third place"].sort(), "SE labels");
  eq(m.srMatchCounts(se).total, 8, "SE 8 teams + third place = 8 matches");
}

// --- Byes (6 teams) ---------------------------------------------------------------
{
  const s0 = seeded();
  const six: SrAdminState = {
    ...s0,
    tournament: { ...s0.tournament, status: "bracket_published", min_teams: 4 },
    teams: s0.teams.slice(0, 6),
  };
  const withBracket = { ...six, matches: bracket(six) };
  const q = m.srQueue(withBracket);
  eq(q.done.length, 0, "byes are never shown as reported");
  eq(q.upNext.every((r) => r.nameA !== "TBD" && r.nameB !== "TBD"), true, "up next has two real teams");
}

// --- Activity ---------------------------------------------------------------------
{
  const s: SrAdminState = { ...base(), teams: [team(1), team(2, "pending")] };
  const e = (id: number, action: SrAuditLogEntry["action"], detail: Record<string, unknown>, actor: [string, string, "admin" | "member"] | null): SrAuditLogEntry => ({
    id,
    tournament_id: "sr1",
    action,
    detail,
    actor_discord_id: actor?.[0] ?? null,
    actor_name: actor?.[1] ?? null,
    actor_kind: actor?.[2] ?? null,
    created_at: "2026-10-09T10:00:00.000Z",
  });
  s.audit = [
    e(5, "team.status", { teamId: "t2", name: "Mid Diff", status: "approved" }, ["1", "Calvin", "admin"]),
    e(4, "team.signup", { teamId: "t2", name: "Mid Diff" }, ["m3", "Jun", "member"]),
    e(3, "roster.slot_confirm", { slotId: "x" }, ["m3", "Jun", "member"]),
    e(2, "team.application_create", { name: "Mid Diff" }, ["cap2", "Mina", "member"]),
    e(1, "signups.toggle", { open: true }, null),
  ];
  eq(
    m.srActivity(s).map((r) => `${r.actor}: ${r.text}`),
    [
      "Calvin (admin): Approved Mid Diff",
      "Jun (member): Mid Diff is fully confirmed and waiting for review",
      "Jun (member): Confirmed their roster spot",
      "Mina (captain): Applied as Mid Diff",
      "—: Opened signups",
    ],
    "activity shows the actor kind; captains read as captain; old rows have no actor",
  );
}

eq(m.srParseScene("champion"), "champion", "parse scene");
eq(m.srParseScene("reveal"), null, "no reveal scene in SR");

console.log(`SR deck model passed: ${checks} checks.`);
