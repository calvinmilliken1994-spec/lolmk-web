// Ad-hoc smoke tests for the shared bracket engine. Not wired into a test
// runner (none installed in this repo — see package.json) — run directly:
//   node --experimental-strip-types scripts/test-bracket-engine.ts
// Covers the cases called out as risk: exact power-of-two (8, 16), a
// non-power-of-two team count needing byes (9, 12), double vs single elim,
// and structural invariants (every match's advances/drops target exists,
// winner is always a participant, byes resolve to the real team).

import { buildKnockoutBracket, type BracketMatch } from "../src/lib/bracket-engine";

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

function checkInvariants(matches: BracketMatch[], label: string) {
  const byId = new Map(matches.map((m) => [m.id, m]));

  for (const m of matches) {
    // Every advances/drops target must exist in the match set.
    if (m.advances_to_match_id) {
      assert(byId.has(m.advances_to_match_id), `${label}: ${m.id} advances to missing match`);
    }
    if (m.drops_to_match_id) {
      assert(byId.has(m.drops_to_match_id), `${label}: ${m.id} drops to missing match`);
    }
    // Completed/bye matches must have a winner that is one of the two teams.
    if (m.status === "completed" || m.status === "bye") {
      assert(
        m.winner_id === m.team_a_id || m.winner_id === m.team_b_id,
        `${label}: ${m.id} winner ${m.winner_id} is not a participant (a=${m.team_a_id}, b=${m.team_b_id})`,
      );
    }
    // A match's downstream slot should be uniquely targeted (no two matches
    // both claiming to fill the same slot of the same target).
  }

  // No two different matches should advance into the same (target, slot).
  const claimed = new Set<string>();
  for (const m of matches) {
    if (m.advances_to_match_id && m.advances_to_slot) {
      const key = `${m.advances_to_match_id}:${m.advances_to_slot}`;
      assert(!claimed.has(key), `${label}: slot ${key} claimed by more than one advancing match`);
      claimed.add(key);
    }
  }

  // Exactly one grand_final match with no advances_to_match_id (the true final)
  // — reset match, if present, also has bracket grand_final but IS the last
  // one chronologically; just check at least one terminal grand_final exists.
  const terminalFinals = matches.filter(
    (m) => m.bracket === "grand_final" && m.advances_to_match_id === null,
  );
  assert(terminalFinals.length >= 1, `${label}: no terminal grand_final match`);
}

function run(n: number, doubleElimination: boolean, thirdPlaceMatch: boolean) {
  const label = `n=${n} de=${doubleElimination} 3p=${thirdPlaceMatch}`;
  const matches = buildKnockoutBracket(teamIds(n), {
    tournamentId: "test",
    knockoutBestOf: 1,
    doubleElimination,
    thirdPlaceMatch,
    grandFinalReset: doubleElimination,
  });

  assert(matches.length > 0, `${label}: produced no matches`);
  checkInvariants(matches, label);

  // Round-1 upper bracket matches should collectively reference every input
  // team exactly once (across team_a_id/team_b_id).
  const round1 = matches.filter((m) => m.bracket === "upper" && m.round_number === 1);
  const seen = new Set<string>();
  for (const m of round1) {
    if (m.team_a_id) seen.add(m.team_a_id);
    if (m.team_b_id) seen.add(m.team_b_id);
  }
  assert(seen.size === n, `${label}: round-1 references ${seen.size} teams, expected ${n}`);

  console.log(`ok   ${label} — ${matches.length} matches`);
}

for (const n of [8, 9, 12, 16]) {
  run(n, false, false); // single elim
  run(n, false, true); // single elim + third place
  run(n, true, false); // double elim
}

if (failures > 0) {
  console.error(`\n${failures} assertion failure(s).`);
  process.exit(1);
} else {
  console.log("\nAll bracket-engine smoke tests passed.");
}
