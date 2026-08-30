// Generic bracket engine for ARAM Mayhem.
//
// Deliberately format-agnostic: instead of hand-placing matches per team
// count (like src/components/sections/bracket-flow.tsx does for the fixed
// League tournament sizes), this generates a normalized match graph for any
// team count by padding to the next power of two with byes, using the
// standard seeding algorithm, and auto-resolving byes transitively.

import type { MayhemMatch, MayhemMatchBracket, SeriesLength } from "@/types/mayhem";

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Standard tournament seeding order for a bracket of `size` (power of two).
 * E.g. size=8 -> [1,8,4,5,2,7,3,6], read in pairs: (1,8) (4,5) (2,7) (3,6).
 * Seed numbers beyond the real team count are byes.
 */
function standardSeedOrder(size: number): number[] {
  let seeds = [1, 2];
  while (seeds.length < size) {
    const sum = seeds.length * 2 + 1;
    const next: number[] = [];
    for (const s of seeds) {
      next.push(s, sum - s);
    }
    seeds = next;
  }
  return seeds;
}

interface BuildOptions {
  knockoutBestOf: SeriesLength;
  doubleElimination: boolean;
  thirdPlaceMatch: boolean;
  grandFinalReset: boolean;
  groupId?: string | null;
  /** Starting match_number so group + knockout numbers don't collide. */
  startMatchNumber?: number;
  idFactory?: () => string;
}

let counter = 0;
function defaultId(): string {
  counter += 1;
  return `m_${Date.now().toString(36)}_${counter}`;
}

/**
 * Build a full single- or double-elimination bracket for the given seeded
 * team IDs (index 0 = seed 1, best team). Byes are auto-created and
 * immediately resolved (marked completed, winner auto-advanced) so the
 * live match queue only ever surfaces real matches.
 */
export function buildKnockoutBracket(
  teamIdsBySeed: string[],
  opts: BuildOptions,
): MayhemMatch[] {
  const id = opts.idFactory ?? defaultId;
  const n = teamIdsBySeed.length;
  const size = nextPowerOfTwo(Math.max(n, 2));
  const rounds = Math.log2(size);
  const seedOrder = standardSeedOrder(size);
  const seedTeam = (seed: number): string | null => teamIdsBySeed[seed - 1] ?? null;

  let matchNumber = opts.startMatchNumber ?? 1;
  const matches: MayhemMatch[] = [];

  // ---- Upper (or single-elim only) bracket ----
  const wbRounds: MayhemMatch[][] = [];
  for (let r = 0; r < rounds; r++) {
    const matchesInRound = size / 2 ** (r + 1);
    const round: MayhemMatch[] = [];
    for (let i = 0; i < matchesInRound; i++) {
      let teamA: string | null = null;
      let teamB: string | null = null;
      if (r === 0) {
        teamA = seedTeam(seedOrder[i * 2]);
        teamB = seedTeam(seedOrder[i * 2 + 1]);
      }
      round.push({
        id: id(),
        event_id: "main",
        bracket: (opts.doubleElimination ? "upper" : "upper") as MayhemMatchBracket,
        group_id: opts.groupId ?? null,
        round_number: r + 1,
        match_number: matchNumber++,
        best_of: opts.knockoutBestOf,
        team_a_id: teamA,
        team_b_id: teamB,
        team_a_score: 0,
        team_b_score: 0,
        winner_id: null,
        status: "pending",
        advances_to_match_id: null,
        advances_to_slot: null,
        drops_to_match_id: null,
        drops_to_slot: null,
      });
    }
    wbRounds.push(round);
    matches.push(...round);
  }
  // Link WB round r -> r+1
  for (let r = 0; r < wbRounds.length - 1; r++) {
    wbRounds[r].forEach((m, i) => {
      const target = wbRounds[r + 1][Math.floor(i / 2)];
      m.advances_to_match_id = target.id;
      m.advances_to_slot = i % 2 === 0 ? "a" : "b";
    });
  }

  const wbFinal = wbRounds[wbRounds.length - 1][0];

  if (!opts.doubleElimination) {
    // Single elimination: optional third-place match from semifinal losers.
    if (opts.thirdPlaceMatch && wbRounds.length >= 2) {
      const semis = wbRounds[wbRounds.length - 2];
      if (semis.length === 2) {
        const thirdPlace: MayhemMatch = {
          id: id(),
          event_id: "main",
          bracket: "third_place",
          group_id: opts.groupId ?? null,
          round_number: wbRounds.length,
          match_number: matchNumber++,
          best_of: opts.knockoutBestOf,
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
        };
        semis[0].drops_to_match_id = thirdPlace.id;
        semis[0].drops_to_slot = "a";
        semis[1].drops_to_match_id = thirdPlace.id;
        semis[1].drops_to_slot = "b";
        matches.push(thirdPlace);
      }
    }
    return resolveByes(retagFinal(matches, wbFinal.id, opts.grandFinalReset, id, opts.knockoutBestOf, matchNumber, opts.groupId ?? null));
  }

  // ---- Lower bracket (double elimination), standard alternating pattern ----
  // LB "drop" rounds receive that WB round's losers; LB "consolidation"
  // rounds pair the previous LB round's winners among themselves. Round 0 is
  // effectively a drop round for WB round-0 losers (no prior LB winners yet).
  const lbRounds: MayhemMatch[][] = [];
  let feeder: MayhemMatch[] = wbRounds[0]; // whose losers seed LB round 0
  let prevLbWinnersRound: MayhemMatch[] | null = null;

  for (let wbR = 1; wbR < rounds; wbR++) {
    // Drop round: prevLbWinnersRound (or nothing on the very first) vs feeder losers
    const dropSize = feeder.length;
    const dropRound: MayhemMatch[] = [];
    for (let i = 0; i < dropSize; i++) {
      dropRound.push({
        id: id(),
        event_id: "main",
        bracket: "lower",
        group_id: opts.groupId ?? null,
        round_number: lbRounds.length + 1,
        match_number: matchNumber++,
        best_of: opts.knockoutBestOf,
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
    }
    // Feeder losers drop into slot A
    feeder.forEach((m, i) => {
      m.drops_to_match_id = dropRound[i].id;
      m.drops_to_slot = "a";
    });
    // Previous LB round winners feed into slot B (or, on round 0, pair
    // amongst themselves directly rather than a separate consolidation step)
    if (prevLbWinnersRound) {
      prevLbWinnersRound.forEach((m, i) => {
        m.advances_to_match_id = dropRound[i].id;
        m.advances_to_slot = "b";
      });
    } else if (dropRound.length > 1) {
      // WB round 0 losers pair among themselves: split drop round into
      // self-pairs by re-routing every 2nd entrant's slot A into the other's
      // slot B — simplest correct approach: pair feeder[2i] vs feeder[2i+1].
      // Rebuild as pairs of feeder losers directly instead of the 1:1 above.
      dropRound.length = 0;
      matches.splice(matches.length - dropSize, dropSize);
      matchNumber -= dropSize;
      for (let i = 0; i < feeder.length / 2; i++) {
        const match: MayhemMatch = {
          id: id(),
          event_id: "main",
          bracket: "lower",
          group_id: opts.groupId ?? null,
          round_number: lbRounds.length + 1,
          match_number: matchNumber++,
          best_of: opts.knockoutBestOf,
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
        };
        feeder[i * 2].drops_to_match_id = match.id;
        feeder[i * 2].drops_to_slot = "a";
        feeder[i * 2 + 1].drops_to_match_id = match.id;
        feeder[i * 2 + 1].drops_to_slot = "b";
        dropRound.push(match);
      }
    }
    matches.push(...dropRound);
    lbRounds.push(dropRound);

    // Consolidation round: dropRound winners pair among themselves (skip
    // after the last WB round — that's handled by the LB final vs WB final).
    if (dropRound.length > 1) {
      const consolRound: MayhemMatch[] = [];
      for (let i = 0; i < dropRound.length / 2; i++) {
        consolRound.push({
          id: id(),
          event_id: "main",
          bracket: "lower",
          group_id: opts.groupId ?? null,
          round_number: lbRounds.length + 1,
          match_number: matchNumber++,
          best_of: opts.knockoutBestOf,
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
      }
      dropRound.forEach((m, i) => {
        const target = consolRound[Math.floor(i / 2)];
        m.advances_to_match_id = target.id;
        m.advances_to_slot = i % 2 === 0 ? "a" : "b";
      });
      matches.push(...consolRound);
      lbRounds.push(consolRound);
      prevLbWinnersRound = consolRound;
    } else {
      prevLbWinnersRound = dropRound;
    }

    feeder = wbRounds[wbR];
  }

  // Grand Final: WB champion vs LB champion.
  const lbChamp = prevLbWinnersRound ?? lbRounds[lbRounds.length - 1];
  const grandFinal: MayhemMatch = {
    id: id(),
    event_id: "main",
    bracket: "grand_final",
    group_id: opts.groupId ?? null,
    round_number: rounds + 1,
    match_number: matchNumber++,
    best_of: opts.knockoutBestOf,
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
  };
  wbFinal.advances_to_match_id = grandFinal.id;
  wbFinal.advances_to_slot = "a";
  if (lbChamp.length === 1) {
    lbChamp[0].advances_to_match_id = grandFinal.id;
    lbChamp[0].advances_to_slot = "b";
  }
  matches.push(grandFinal);

  if (opts.grandFinalReset) {
    const reset: MayhemMatch = {
      id: id(),
      event_id: "main",
      bracket: "grand_final",
      group_id: opts.groupId ?? null,
      round_number: rounds + 2,
      match_number: matchNumber++,
      best_of: opts.knockoutBestOf,
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
    };
    matches.push(reset);
    // Reset is only played (UI-side) if the LB champion wins the first GF —
    // recordMatchResult() in mayhem-db.ts handles that conditional creation
    // logic by checking bracket === "grand_final" && !grandFinalReset yet.
  }

  return resolveByes(matches);
}

function retagFinal(
  matches: MayhemMatch[],
  _wbFinalId: string,
  _reset: boolean,
  _id: () => string,
  _bestOf: SeriesLength,
  _matchNumber: number,
  _groupId: string | null,
): MayhemMatch[] {
  // Single-elim: the WB final IS the grand final. Retag it for consistent
  // rendering/labels on /mayhemlive.
  return matches.map((m) =>
    m.advances_to_match_id === null && m.bracket === "upper" && m.drops_to_match_id === null
      ? { ...m, bracket: "grand_final" as MayhemMatchBracket }
      : m,
  );
}

/**
 * Auto-resolve bye matches (one real team + one null slot) transitively:
 * mark them completed, set the winner, and advance/drop as normal. Runs
 * until no more byes can be resolved (a chain of byes can cascade).
 */
export function resolveByes(matches: MayhemMatch[]): MayhemMatch[] {
  const byId = new Map(matches.map((m) => [m.id, m]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of byId.values()) {
      if (m.status !== "pending") continue;
      const hasA = m.team_a_id !== null;
      const hasB = m.team_b_id !== null;
      // Both slots permanently empty (no upstream match feeds this slot) and
      // not a first-round match — leave as pending; it'll fill in later.
      if (hasA === hasB) continue; // both filled (real match) or both empty (not ready)
      const winner = hasA ? m.team_a_id : m.team_b_id;
      m.status = "bye";
      m.winner_id = winner;
      if (m.advances_to_match_id && winner) {
        const target = byId.get(m.advances_to_match_id);
        if (target) {
          if (m.advances_to_slot === "a") target.team_a_id = winner;
          else if (m.advances_to_slot === "b") target.team_b_id = winner;
          changed = true;
        }
      }
      changed = true;
    }
  }
  return Array.from(byId.values());
}
