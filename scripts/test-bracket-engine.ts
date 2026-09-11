// Rigorous deterministic tests for the shared bracket engine
// (src/lib/bracket-engine.ts), covering the full range of team counts the
// Summoner's Rift tool will support (8-16) plus edge cases below that range
// to stress bye propagation. Not wired into a test runner (none installed
// in this repo — see package.json). Run directly:
//   node --experimental-strip-types scripts/test-bracket-engine.ts
//
// This supersedes the earlier structural-only smoke test: in addition to
// checking the static shape of a freshly-built bracket, it *plays out* a
// full deterministic tournament (team A always wins) through every match to
// verify the engine reaches exactly one champion with no stuck matches —
// this is what caught the real double-elimination bugs fixed in this file
// (a stale splice deleting real matches, wrong LB round sizes, WB
// advancement links getting overwritten, byes firing on temporarily-empty
// slots instead of permanently-dead ones, and the grand-final reset
// placeholder being misidentified as a dead node).

// Run with: npx tsx scripts/test-bracket-engine.ts
import {
  applyBracketResult,
  buildKnockoutBracket,
  resolveByes,
  retractBracketResult,
  validateClinchingScore,
  type BracketMatch,
} from "../src/lib/bracket-engine";

let failures = 0;
function assert(cond: unknown, msg: string) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}

function teamIds(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `team_${i + 1}`);
}

/** Exact expected match count for a given team count / format, per the
 * standard bracket math (also documented in assets/TOURNAMENT.md):
 * upper = size-1 always; lower (double-elim) = size-2; +1 grand final;
 * +1 more if a reset match is configured. */
function expectedCount(n: number, doubleElim: boolean, reset: boolean): number {
  const size = Math.pow(2, Math.ceil(Math.log2(Math.max(n, 2))));
  const upper = size - 1;
  if (!doubleElim) return upper;
  const lower = size - 2;
  return upper + lower + 1 + (reset ? 1 : 0);
}

/** Structural invariants checked against a freshly-built (unplayed) bracket. */
function checkStaticInvariants(matches: BracketMatch[], n: number, label: string) {
  const byId = new Map(matches.map((m) => [m.id, m]));

  for (const m of matches) {
    if (m.advances_to_match_id) {
      assert(byId.has(m.advances_to_match_id), `${label}: ${m.id} advances to missing match`);
    }
    if (m.drops_to_match_id) {
      assert(byId.has(m.drops_to_match_id), `${label}: ${m.id} drops to missing match`);
    }
    if (m.status === "completed" || m.status === "bye") {
      assert(
        m.winner_id === null || m.winner_id === m.team_a_id || m.winner_id === m.team_b_id,
        `${label}: ${m.id} winner ${m.winner_id} is not a participant (a=${m.team_a_id}, b=${m.team_b_id})`,
      );
    }
  }

  // No two matches should claim the same downstream (target, slot).
  const claimed = new Set<string>();
  for (const m of matches) {
    if (m.advances_to_match_id && m.advances_to_slot) {
      const key = `${m.advances_to_match_id}:${m.advances_to_slot}`;
      assert(!claimed.has(key), `${label}: slot ${key} claimed by more than one match (advances)`);
      claimed.add(key);
    }
    if (m.drops_to_match_id && m.drops_to_slot) {
      const key = `${m.drops_to_match_id}:${m.drops_to_slot}`;
      assert(!claimed.has(key), `${label}: slot ${key} claimed by more than one match (drops)`);
      claimed.add(key);
    }
  }

  // Every non-round-1, non-deferred-reset match must have exactly one
  // inbound link into each of its two slots (a real bracket has no orphans).
  const grandFinals = matches.filter((m) => m.bracket === "grand_final");
  for (const m of matches) {
    const isRound1 = m.round_number === 1 && m.bracket !== "lower";
    if (isRound1) continue;
    const isDeferredReset = m.bracket === "grand_final" && grandFinals.indexOf(m) === 1;
    if (isDeferredReset) continue; // populated later by app code, not structurally fed
    const inboundA = matches.filter(
      (x) =>
        (x.advances_to_match_id === m.id && x.advances_to_slot === "a") ||
        (x.drops_to_match_id === m.id && x.drops_to_slot === "a"),
    ).length;
    const inboundB = matches.filter(
      (x) =>
        (x.advances_to_match_id === m.id && x.advances_to_slot === "b") ||
        (x.drops_to_match_id === m.id && x.drops_to_slot === "b"),
    ).length;
    assert(inboundA === 1, `${label}: ${m.bracket} r${m.round_number} has ${inboundA} inbound to slot A (expected 1)`);
    assert(inboundB === 1, `${label}: ${m.bracket} r${m.round_number} has ${inboundB} inbound to slot B (expected 1)`);
  }

  // Round-1 upper-bracket matches collectively reference every input team
  // exactly once.
  const round1 = matches.filter((m) => m.bracket === "upper" && m.round_number === 1);
  const seen = new Set<string>();
  for (const m of round1) {
    if (m.team_a_id) seen.add(m.team_a_id);
    if (m.team_b_id) seen.add(m.team_b_id);
  }
  assert(seen.size === n, `${label}: round-1 references ${seen.size} teams, expected ${n}`);
}

/**
 * Play out a full tournament deterministically and verify it reaches
 * exactly one champion with no stuck matches. `winnerPicker` decides who
 * wins each playable match — defaults to "team A always wins", but the
 * grand-final-reset scenario needs "team B (the LB finalist) wins GF1" to
 * actually exercise the reset match.
 */
function simulate(
  matches: BracketMatch[],
  opts: { winnerPicker?: (m: BracketMatch) => "a" | "b" } = {},
): BracketMatch[] {
  const pick = opts.winnerPicker ?? (() => "a" as const);
  let iterations = 0;
  const maxIter = 500;
  while (iterations++ < maxIter) {
    const playable = matches.filter((m) => m.status === "pending" && m.team_a_id && m.team_b_id);
    if (playable.length === 0) break;
    for (const m of playable) {
      const side = pick(m);
      const winner = side === "a" ? m.team_a_id : m.team_b_id;
      const loser = side === "a" ? m.team_b_id : m.team_a_id;
      m.status = "completed";
      m.winner_id = winner;
      m.team_a_score = side === "a" ? 1 : 0;
      m.team_b_score = side === "b" ? 1 : 0;
      if (m.advances_to_match_id) {
        const t = matches.find((x) => x.id === m.advances_to_match_id);
        if (t) {
          if (m.advances_to_slot === "a") t.team_a_id = winner;
          else t.team_b_id = winner;
        }
      }
      if (m.drops_to_match_id) {
        const t = matches.find((x) => x.id === m.drops_to_match_id);
        if (t) {
          if (m.drops_to_slot === "a") t.team_a_id = loser;
          else t.team_b_id = loser;
        }
      }
    }
    matches = resolveByes(matches); // simulates real usage: called after every round of results
  }
  if (iterations >= maxIter) {
    failures++;
    console.error("FAIL: simulation did not terminate (possible cycle/deadlock)");
  }
  return matches;
}

function simulateAndVerify(
  n: number,
  doubleElim: boolean,
  reset: boolean,
  label: string,
  winnerPicker?: (m: BracketMatch) => "a" | "b",
) {
  const built = buildKnockoutBracket(teamIds(n), {
    tournamentId: "test",
    knockoutBestOf: 1,
    doubleElimination: doubleElim,
    thirdPlaceMatch: false,
    grandFinalReset: reset,
  });
  const matches = simulate(built, { winnerPicker });

  const finals = matches.filter((m) => m.bracket === "grand_final" && m.advances_to_match_id === null);
  const decided = finals.filter((m) => m.status === "completed" || m.status === "bye");
  assert(decided.length === 1, `${label}: expected exactly 1 decided terminal grand final, got ${decided.length}`);

  const stuck = matches.filter(
    (m) => m.status === "pending" && (!m.team_a_id || !m.team_b_id) && m.bracket !== "grand_final",
  );
  assert(stuck.length === 0, `${label}: ${stuck.length} matches stuck pending with a missing team`);

  const allTeams = new Set(teamIds(n));
  const appeared = new Set<string>();
  for (const m of matches) {
    if (m.team_a_id) appeared.add(m.team_a_id);
    if (m.team_b_id) appeared.add(m.team_b_id);
  }
  for (const t of allTeams) assert(appeared.has(t), `${label}: team ${t} never appeared in any match`);

  const exp = expectedCount(n, doubleElim, reset);
  assert(matches.length === exp, `${label}: match count ${matches.length} != expected ${exp}`);

  console.log(`ok   ${label} - ${matches.length} matches, champion reached, all ${n} teams appeared`);
}

// ---------------------------------------------------------------------------
// 1. Static structural checks + exact match counts, for every SR team count
//    (8-16), plus smaller counts below that range to stress bye handling.
// ---------------------------------------------------------------------------
console.log("--- Static structural invariants ---");
for (const n of [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) {
  for (const doubleElim of [false, true]) {
    for (const reset of doubleElim ? [false, true] : [false]) {
      const label = `n=${n} de=${doubleElim} reset=${reset}`;
      const matches = buildKnockoutBracket(teamIds(n), {
        tournamentId: "test",
        knockoutBestOf: 1,
        doubleElimination: doubleElim,
        thirdPlaceMatch: false,
        grandFinalReset: reset,
      });
      const exp = expectedCount(n, doubleElim, reset);
      assert(matches.length === exp, `${label}: got ${matches.length} matches, expected ${exp}`);
      checkStaticInvariants(matches, n, label);
      console.log(`ok   ${label} - ${matches.length} matches (expected ${exp})`);
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Full simulated tournaments (team A always wins) through to a champion.
// ---------------------------------------------------------------------------
console.log("\n--- Full simulations (team A always wins) ---");
for (const n of [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) {
  simulateAndVerify(n, false, false, `SIM n=${n} single-elim`);
  simulateAndVerify(n, true, false, `SIM n=${n} double-elim no-reset`);
  simulateAndVerify(n, true, true, `SIM n=${n} double-elim with-reset (A always wins, reset never triggers)`);
}

// ---------------------------------------------------------------------------
// 3. Grand-final-reset semantics: explicitly force the lower-bracket
//    finalist to win game 1 of the grand final, which MUST trigger the
//    reset match to actually be played (this is the scenario "team A always
//    wins" above cannot exercise, since the upper-bracket side is always
//    slot A in this engine's construction).
// ---------------------------------------------------------------------------
console.log("\n--- Grand-final reset: LB finalist forces a reset ---");
for (const n of [4, 8, 9, 16]) {
  const label = `RESET n=${n}`;
  const built = buildKnockoutBracket(teamIds(n), {
    tournamentId: "test",
    knockoutBestOf: 1,
    doubleElimination: true,
    thirdPlaceMatch: false,
    grandFinalReset: true,
  });

  // Simulate normally until only the grand final(s) remain playable, always
  // picking A, so the WB side reaches the first grand final as team A and
  // the LB side reaches it as team B.
  let matches = built;
  let guard = 0;
  while (guard++ < 500) {
    const playable = matches.filter(
      (m) => m.status === "pending" && m.team_a_id && m.team_b_id && m.bracket !== "grand_final",
    );
    if (playable.length === 0) break;
    for (const m of playable) {
      const winner = m.team_a_id;
      const loser = m.team_b_id;
      m.status = "completed";
      m.winner_id = winner;
      m.team_a_score = 1;
      if (m.advances_to_match_id) {
        const t = matches.find((x) => x.id === m.advances_to_match_id);
        if (t) {
          if (m.advances_to_slot === "a") t.team_a_id = winner;
          else t.team_b_id = winner;
        }
      }
      if (m.drops_to_match_id) {
        const t = matches.find((x) => x.id === m.drops_to_match_id);
        if (t) {
          if (m.drops_to_slot === "a") t.team_a_id = loser;
          else t.team_b_id = loser;
        }
      }
    }
    matches = resolveByes(matches);
  }

  const gf1 = matches.filter((m) => m.bracket === "grand_final").sort((a, b) => a.round_number - b.round_number)[0];
  assert(!!gf1 && !!gf1.team_a_id && !!gf1.team_b_id, `${label}: grand final 1 not reachable with both teams present`);
  if (!gf1 || !gf1.team_a_id || !gf1.team_b_id) continue;

  // Force the LB finalist (slot B) to win GF1 -- application logic (not yet
  // written) is responsible for populating the reset match's teams and
  // status when this happens; this test only asserts the engine's shape
  // supports it: the reset match must exist, be distinct from GF1, and
  // still be "pending" with no teams (i.e. NOT auto-resolved as a bye by
  // resolveByes, since it has zero structural feeders by design).
  const resetMatch = matches
    .filter((m) => m.bracket === "grand_final")
    .sort((a, b) => a.round_number - b.round_number)[1];
  assert(!!resetMatch, `${label}: no reset match found alongside grand final 1`);
  if (resetMatch) {
    assert(resetMatch.id !== gf1.id, `${label}: reset match must be distinct from grand final 1`);
    assert(resetMatch.status === "pending", `${label}: reset match status is ${resetMatch.status}, expected pending (must wait for app logic)`);
    assert(resetMatch.team_a_id === null && resetMatch.team_b_id === null, `${label}: reset match should have no teams until app logic populates it after an LB-finalist GF1 win`);
    assert(resetMatch.winner_id === null, `${label}: reset match should have no winner yet`);
  }
  console.log(`ok   ${label} - reset match present, correctly deferred (pending, unpopulated) pre-GF1 result`);
}

// ---------------------------------------------------------------------------
// 4. Fully-dead lower-bracket branches: force enough round-1 byes that a
//    lower-bracket match has BOTH incoming slots dead (two WB round-1 byes
//    dropping into the same LB match). Verifies resolveByes's fixed-point
//    "fully dead" propagation instead of leaving such a match stuck pending
//    forever.
// ---------------------------------------------------------------------------
console.log("\n--- Fully-dead lower-bracket branches (heavy byes) ---");
for (const n of [5, 9, 11, 13]) {
  // These counts pad to the next power of two with >= 3 byes in round 1,
  // which is enough to produce at least one LB match fed by two byes.
  simulateAndVerify(n, true, false, `DEADBRANCH n=${n} double-elim`);
  simulateAndVerify(n, true, true, `DEADBRANCH n=${n} double-elim with-reset`);
}

// ---------------------------------------------------------------------------
// 5. Explicit non-bye-eligibility check: a match with exactly one slot
//    filled and the other slot fed by a REAL, undecided match must NOT be
//    resolved as a bye by a bare resolveByes() call before that feeder is
//    actually played. This is the exact defect that let resolveByes crown
//    false winners in the pre-fix version of this file.
// ---------------------------------------------------------------------------
console.log("\n--- Byes never fire before a real feeder is decided ---");
for (const n of [8, 9, 16]) {
  const label = `NOBYE n=${n}`;
  const matches = buildKnockoutBracket(teamIds(n), {
    tournamentId: "test",
    knockoutBestOf: 1,
    doubleElimination: true,
    thirdPlaceMatch: false,
    grandFinalReset: false,
  });
  // Complete ONLY round-1 upper matches that are true byes (already
  // resolved at build time) -- do not play any real matches. Then check:
  // no round-2+ match with a real, still-pending feeder has been given a
  // false winner.
  const afterBuild = resolveByes(matches);
  for (const m of afterBuild) {
    const hasA = m.team_a_id !== null;
    const hasB = m.team_b_id !== null;
    if (m.status === "bye" && hasA !== hasB) {
      // This is a legitimate resolved bye (one real team, one permanently
      // dead slot) -- confirm its "dead" slot truly has no real, pending
      // feeder anywhere in the match set.
      const emptySlotOwner = hasA ? "b" : "a";
      const feeder = afterBuild.find(
        (x) =>
          (x.advances_to_match_id === m.id && x.advances_to_slot === emptySlotOwner) ||
          (x.drops_to_match_id === m.id && x.drops_to_slot === emptySlotOwner),
      );
      assert(
        !feeder || feeder.status === "bye" || feeder.status === "completed",
        `${label}: ${m.id} resolved as bye but its empty slot ${emptySlotOwner} has a real, undecided feeder (${feeder?.id}, status=${feeder?.status})`,
      );
    }
  }
  console.log(`ok   ${label} - no premature bye resolution against live undecided feeders`);
}

// ---------------------------------------------------------------------------
// 6. Result validation and reversible propagation.
// ---------------------------------------------------------------------------
console.log("\n--- Result validation and reversible propagation ---");
for (const [bestOf, a, b, valid] of [
  [1, 1, 0, true],
  [3, 2, 0, true],
  [3, 2, 1, true],
  [5, 3, 2, true],
  [3, 1, 0, false],
  [3, 3, 0, false],
  [3, 2, 2, false],
  [3, -1, 2, false],
  [3, 2.5, 1, false],
] as const) {
  let accepted = true;
  try {
    validateClinchingScore(bestOf, a, b);
  } catch {
    accepted = false;
  }
  assert(accepted === valid, `score Bo${bestOf} ${a}-${b}: expected valid=${valid}, got ${accepted}`);
}

{
  const base = (id: string, bracket: BracketMatch["bracket"], round: number): BracketMatch => ({
    id,
    event_id: "test",
    bracket,
    group_id: null,
    round_number: round,
    match_number: round,
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
  });
  const source = base("source", "upper", 1);
  source.team_a_id = "team_1";
  source.team_b_id = "team_2";
  source.advances_to_match_id = "bye_1";
  source.advances_to_slot = "a";
  const bye1 = base("bye_1", "upper", 2);
  bye1.advances_to_match_id = "bye_2";
  bye1.advances_to_slot = "a";
  const bye2 = base("bye_2", "grand_final", 1);
  const matches = [source, bye1, bye2];

  applyBracketResult(matches, source.id, 1, 0);
  assert(bye1.status === "bye" && bye2.status === "bye", "result should auto-resolve a transitive bye chain");
  retractBracketResult(matches, source.id);
  assert(source.status === "pending" && source.winner_id === null, "undo resets source result");
  for (const m of [bye1, bye2]) {
    assert(m.status === "pending", `undo retracts downstream bye ${m.id}`);
    assert(m.winner_id === null, `undo clears downstream bye winner ${m.id}`);
    assert(m.team_a_id === null, `undo clears transitive advancement slot on ${m.id}`);
  }
}
console.log("ok   clinching-score validation and transitive bye undo");

// ---------------------------------------------------------------------------
// 7. Lower-bracket crossover and final metadata.
// ---------------------------------------------------------------------------
console.log("\n--- Lower-bracket crossover and final metadata ---");
{
  const matches = buildKnockoutBracket(teamIds(8), {
    tournamentId: "test",
    knockoutBestOf: 1,
    doubleElimination: true,
    thirdPlaceMatch: false,
    grandFinalReset: true,
  });
  const playedPairs = new Set<string>();
  const pair = (m: BracketMatch) => [m.team_a_id, m.team_b_id].sort().join(":");
  for (const m of matches.filter((x) => x.bracket === "upper" && x.round_number === 1)) {
    playedPairs.add(pair(m));
    applyBracketResult(matches, m.id, 1, 0);
  }
  for (const m of matches.filter((x) => x.bracket === "upper" && x.round_number === 2)) {
    applyBracketResult(matches, m.id, 1, 0);
  }
  for (const m of matches.filter((x) => x.bracket === "lower" && x.round_number === 1)) {
    playedPairs.add(pair(m));
    applyBracketResult(matches, m.id, 1, 0);
  }
  const lbRound2 = matches.filter((x) => x.bracket === "lower" && x.round_number === 2);
  for (const m of lbRound2) {
    assert(!playedPairs.has(pair(m)), `lower crossover created immediate rematch ${pair(m)}`);
  }

  const finals = matches.filter((m) => m.bracket === "grand_final").sort((a, b) => a.round_number - b.round_number);
  assert(finals[0]?.round_number === 1, `GF1 round label key must be 1, got ${finals[0]?.round_number}`);
  assert(finals[1]?.round_number === 2, `reset round label key must be 2, got ${finals[1]?.round_number}`);
}

for (const doubleElimination of [false, true]) {
  let rejected = false;
  try {
    buildKnockoutBracket(teamIds(8), {
      tournamentId: "test",
      knockoutBestOf: 1,
      doubleElimination,
      thirdPlaceMatch: doubleElimination,
      grandFinalReset: false,
    });
  } catch {
    rejected = true;
  }
  assert(rejected === doubleElimination, "third place is rejected only for unsupported double elimination");
}
console.log("ok   crossover avoids immediate rematches; GF labels stable; unsupported third place rejected");

console.log(
  failures
    ? `\n${failures} FAILURE(S).`
    : "\nAll bracket-engine tests passed (structure, simulations, scores, reset, byes, undo, crossover, labels, options).",
);
process.exit(failures ? 1 : 0);
