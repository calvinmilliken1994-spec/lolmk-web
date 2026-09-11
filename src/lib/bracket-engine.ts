// Generic single/double-elimination bracket engine, shared by ARAM Mayhem
// and the Summoner's Rift tournament tool.
//
// This was originally mayhem-bracket.ts (ARAM-only). It is now parameterized
// by tournamentId + match id type so both tools share one implementation
// instead of maintaining two copies of non-trivial bracket-linking logic.
// ARAM Mayhem keeps importing from mayhem-bracket.ts, which re-exports this
// module unchanged (see the compat shim at the bottom of that file) — no
// caller-visible behavior change for Mayhem.
//
// Deliberately format-agnostic: instead of hand-placing matches per team
// count (like src/components/sections/bracket-flow.tsx does for the fixed
// League tournament sizes), this generates a normalized match graph for any
// team count by padding to the next power of two with byes, using the
// standard seeding algorithm, and auto-resolving byes transitively.

export type BracketSide = "upper" | "lower" | "grand_final" | "third_place";
export type BracketMatchStatus = "pending" | "scheduled" | "in_progress" | "completed" | "bye";

/** Minimal match shape the engine needs — both MayhemMatch and SrMatch satisfy it. */
export interface BracketMatch {
  id: string;
  event_id: string; // tournament/event id this match belongs to (naming kept for Mayhem compat)
  bracket: BracketSide;
  group_id: string | null;
  round_number: number;
  match_number: number;
  best_of: 1 | 3 | 5;
  team_a_id: string | null;
  team_b_id: string | null;
  team_a_score: number;
  team_b_score: number;
  winner_id: string | null;
  status: BracketMatchStatus;
  advances_to_match_id: string | null;
  advances_to_slot: "a" | "b" | null;
  drops_to_match_id: string | null;
  drops_to_slot: "a" | "b" | null;
}

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

export interface BuildOptions {
  /** Tournament/event id the generated matches belong to. */
  tournamentId: string;
  knockoutBestOf: 1 | 3 | 5;
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
): BracketMatch[] {
  const id = opts.idFactory ?? defaultId;
  const eventId = opts.tournamentId;
  const n = teamIdsBySeed.length;
  if (opts.doubleElimination && opts.thirdPlaceMatch) {
    throw new Error("Third-place matches are not supported for double-elimination brackets.");
  }
  const size = nextPowerOfTwo(Math.max(n, 2));
  const rounds = Math.log2(size);
  const seedOrder = standardSeedOrder(size);
  const seedTeam = (seed: number): string | null => teamIdsBySeed[seed - 1] ?? null;

  let matchNumber = opts.startMatchNumber ?? 1;
  const matches: BracketMatch[] = [];

  function makeMatch(bracket: BracketSide, roundNumber: number): BracketMatch {
    return {
      id: id(),
      event_id: eventId,
      bracket,
      group_id: opts.groupId ?? null,
      round_number: roundNumber,
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
  }

  // ---- Upper (or single-elim only) bracket ----
  const wbRounds: BracketMatch[][] = [];
  for (let r = 0; r < rounds; r++) {
    const matchesInRound = size / 2 ** (r + 1);
    const round: BracketMatch[] = [];
    for (let i = 0; i < matchesInRound; i++) {
      const m = makeMatch("upper", r + 1);
      if (r === 0) {
        m.team_a_id = seedTeam(seedOrder[i * 2]);
        m.team_b_id = seedTeam(seedOrder[i * 2 + 1]);
      }
      round.push(m);
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
        const thirdPlace = makeMatch("third_place", wbRounds.length);
        semis[0].drops_to_match_id = thirdPlace.id;
        semis[0].drops_to_slot = "a";
        semis[1].drops_to_match_id = thirdPlace.id;
        semis[1].drops_to_slot = "b";
        matches.push(thirdPlace);
      }
    }
    return resolveByes(retagFinal(matches));
  }

  // ---- Lower bracket (double elimination) ----
  //
  // Standard structure, expressed as an alternation of two round kinds:
  //
  //  - "minor" round: pairs the current LB survivors among themselves,
  //    halving their count (survivors[2i] vs survivors[2i+1]).
  //  - "major" round: the current LB survivors face the next wave of
  //    upper-bracket losers, one-to-one (same count on both sides — this
  //    always holds for a standard power-of-two bracket, see below).
  //
  // Sequence: minor(UBR1 losers) -> major(vs UBR2 losers) -> minor -> major
  // (vs UBR3 losers) -> ... -> major(vs UBR[rounds] loser) = LB final.
  // The very last major round (facing the WB-final loser) is the LB final
  // and is NOT followed by another minor round.
  //
  // Why the sizes always match: UBR_k has size/2^k matches. The minor round
  // right after UBR1's losers are collected halves size/2 -> size/4, which
  // equals UBR2's match count. Each subsequent major round preserves that
  // count (paired 1:1 with the same-sized next UB-loser wave), and each
  // following minor round halves it again to match the round after that.
  // This identity holds by induction for any power-of-two team count, so no
  // padding/reconciliation between LB and UB round sizes is ever needed.
  if (rounds < 2) {
    // Degenerate case (2 teams): no lower bracket rounds are possible.
    // Only realistic for tools with very small minimum team counts; the
    // grand final below simply has no LB challenger.
    return resolveByes(finishGrandFinal(matches, wbFinal, [], opts, makeMatch));
  }

  const ubLosersRound1 = wbRounds[0];
  // These are WB round-1 matches: their *winner* already advances into WB
  // round 2 (wired by the "Link WB round r -> r+1" step above) — only their
  // *loser* drops into LB round 1. Using pairAmongThemselves here would
  // overwrite that WB advancement link; use the drop-specific helper.
  let survivors: BracketMatch[] = dropIntoNewRound(ubLosersRound1, "lower", 1, makeMatch);
  matches.push(...survivors);

  for (let wbR = 1; wbR < rounds; wbR++) {
    const feederLosers = wbRounds[wbR]; // UB round (wbR+1)'s losers
    const roundNumber = survivors[0].round_number + 1;
    const majorRound = pairAgainstFeeder(survivors, feederLosers, "lower", roundNumber, makeMatch);
    matches.push(...majorRound);
    survivors = majorRound;

    const isLastWbRound = wbR === rounds - 1;
    if (!isLastWbRound && survivors.length > 1) {
      const minorRound = pairAmongThemselves(survivors, "lower", roundNumber + 1, makeMatch);
      matches.push(...minorRound);
      survivors = minorRound;
    }
  }

  // `survivors` now holds the single LB final winner slot (the LB champion).
  return resolveByes(finishGrandFinal(matches, wbFinal, survivors, opts, makeMatch));
}

/** Pair a list of same-bracket matches among themselves, halving their count. */
function pairAmongThemselves(
  source: BracketMatch[],
  bracket: BracketSide,
  roundNumber: number,
  makeMatch: (bracket: BracketSide, roundNumber: number) => BracketMatch,
): BracketMatch[] {
  const round: BracketMatch[] = [];
  for (let i = 0; i < source.length / 2; i++) {
    round.push(makeMatch(bracket, roundNumber));
  }
  source.forEach((m, i) => {
    const target = round[Math.floor(i / 2)];
    m.advances_to_match_id = target.id;
    m.advances_to_slot = i % 2 === 0 ? "a" : "b";
  });
  return round;
}

/**
 * Pair a list of WB matches' *losers* (via drops_to_match_id, not
 * advances_to_match_id) among themselves, halving their count. Use this
 * instead of pairAmongThemselves when `source` still needs its
 * advances_to_match_id left untouched (e.g. WB round-1 matches, whose
 * winners already advance into WB round 2).
 */
function dropIntoNewRound(
  source: BracketMatch[],
  bracket: BracketSide,
  roundNumber: number,
  makeMatch: (bracket: BracketSide, roundNumber: number) => BracketMatch,
): BracketMatch[] {
  const round: BracketMatch[] = [];
  for (let i = 0; i < source.length / 2; i++) {
    round.push(makeMatch(bracket, roundNumber));
  }
  source.forEach((m, i) => {
    const target = round[Math.floor(i / 2)];
    m.drops_to_match_id = target.id;
    m.drops_to_slot = i % 2 === 0 ? "a" : "b";
  });
  return round;
}

/** Pair LB survivors (slot A) 1:1 against a new wave of UB losers (slot B). */
function pairAgainstFeeder(
  survivors: BracketMatch[],
  feederLosers: BracketMatch[],
  bracket: BracketSide,
  roundNumber: number,
  makeMatch: (bracket: BracketSide, roundNumber: number) => BracketMatch,
): BracketMatch[] {
  const round: BracketMatch[] = [];
  for (let i = 0; i < survivors.length; i++) {
    round.push(makeMatch(bracket, roundNumber));
  }
  survivors.forEach((m, i) => {
    m.advances_to_match_id = round[i].id;
    m.advances_to_slot = "a";
  });
  feederLosers.forEach((m, i) => {
    // Cross the incoming upper-bracket loser wave. Pairing the same index
    // sends an upper-round loser straight back against the survivor from
    // its own branch, producing an immediate rematch.
    const target = round[round.length - 1 - i];
    m.drops_to_match_id = target.id;
    m.drops_to_slot = "b";
  });
  return round;
}

function finishGrandFinal(
  matches: BracketMatch[],
  wbFinal: BracketMatch,
  lbChamp: BracketMatch[],
  opts: BuildOptions,
  makeMatch: (bracket: BracketSide, roundNumber: number) => BracketMatch,
): BracketMatch[] {
  const grandFinal = makeMatch("grand_final", 1);
  wbFinal.advances_to_match_id = grandFinal.id;
  wbFinal.advances_to_slot = "a";
  if (lbChamp.length === 1) {
    lbChamp[0].advances_to_match_id = grandFinal.id;
    lbChamp[0].advances_to_slot = "b";
  }
  matches.push(grandFinal);

  if (opts.grandFinalReset) {
    const reset = makeMatch("grand_final", grandFinal.round_number + 1);
    matches.push(reset);
    // Reset is only played (UI-side) if the LB champion wins the first GF —
    // recordMatchResult() (mayhem-db.ts / sr-db.ts) handles that conditional
    // creation logic by checking bracket === "grand_final" && !grandFinalReset yet.
  }

  return matches;
}

function retagFinal(matches: BracketMatch[]): BracketMatch[] {
  // Single-elim: the WB final IS the grand final. Retag it for consistent
  // rendering/labels on the live screen. Grand-final rounds are local to
  // that bracket section: GF1 is always round 1 and a reset is round 2.
  return matches.map((m) =>
    m.advances_to_match_id === null && m.bracket === "upper" && m.drops_to_match_id === null
      ? { ...m, bracket: "grand_final" as BracketSide, round_number: 1 }
      : m,
  );
}

/**
 * Auto-resolve bye matches (one real team + one permanently-empty slot)
 * transitively: mark them completed, set the winner, and advance/drop as
 * normal. Runs until no more byes can be resolved (a chain of byes, or a
 * chain of "no loser to drop" from byes, can both cascade).
 *
 * Critical distinction this function must get right: an empty slot is only
 * a genuine bye if NO team will ever arrive there — either because no
 * match feeds that slot at all (a first-round seed bye), or because the
 * match that feeds it can itself never produce an occupant (see "fully
 * dead" below). An empty slot fed by a real, still-undecided match is NOT a
 * bye — it must wait for that match to actually be played. Treating
 * "temporarily empty, pending a real result" the same as "permanently
 * empty" would crown a false winner before the deciding match happens.
 *
 * A subtler case this must also handle: a lower-bracket match can have BOTH
 * of its incoming slots dead at once — e.g. two upper-bracket round-1 byes
 * both drop into the same LB match, so neither slot will ever receive a
 * team. Such a match is "fully dead": it will never be played, produces no
 * winner, and its own downstream slot(s) must be marked dead too — which
 * can cascade further (a chain of consecutive fully-dead LB rounds when
 * enough seeds are byes). This is computed as a fixed point over the whole
 * match set before any bye winners are assigned.
 */
export function resolveByes(matches: BracketMatch[]): BracketMatch[] {
  const byId = new Map(matches.map((m) => [m.id, m]));

  // Every (matchId, slot) pair that some other match's advances_to/drops_to
  // targets — i.e. every slot that has a real feeder match, whether or not
  // that feeder has been decided yet.
  const hasIncoming = new Set<string>();
  for (const m of matches) {
    if (m.advances_to_match_id && m.advances_to_slot) {
      hasIncoming.add(`${m.advances_to_match_id}:${m.advances_to_slot}`);
    }
    if (m.drops_to_match_id && m.drops_to_slot) {
      hasIncoming.add(`${m.drops_to_match_id}:${m.drops_to_slot}`);
    }
  }

  // The grand-final *reset* match (when enabled) is a deliberate exception:
  // it has zero incoming links by design (see finishGrandFinal) because it
  // is populated later, conditionally, by application code — only if the
  // lower-bracket champion wins the first grand final. It must never be
  // treated as "fully dead" just because nothing structurally feeds it.
  const hasAnyIncoming = (matchId: string) =>
    hasIncoming.has(`${matchId}:a`) || hasIncoming.has(`${matchId}:b`);
  const grandFinals = matches
    .filter((m) => m.bracket === "grand_final")
    .sort((a, b) => a.round_number - b.round_number);
  const deferredResetId = grandFinals.length > 1 ? grandFinals[grandFinals.length - 1].id : null;
  const isDeferredResetMatch = (m: BracketMatch) =>
    m.id === deferredResetId && !hasAnyIncoming(m.id);

  // Fixed-point pass 1: compute every dead slot, including cascades through
  // fully-dead matches (both slots dead => the match itself is dead => its
  // own outgoing slot(s) are dead too).
  const dead = new Set<string>();
  for (const m of matches) {
    if (isDeferredResetMatch(m)) continue;
    if (m.team_a_id === null && !hasIncoming.has(`${m.id}:a`)) dead.add(`${m.id}:a`);
    if (m.team_b_id === null && !hasIncoming.has(`${m.id}:b`)) dead.add(`${m.id}:b`);
    if (m.status === "bye" && m.drops_to_match_id && m.drops_to_slot) {
      dead.add(`${m.drops_to_match_id}:${m.drops_to_slot}`);
    }
  }
  let deadChanged = true;
  while (deadChanged) {
    deadChanged = false;
    for (const m of byId.values()) {
      if (isDeferredResetMatch(m)) continue;
      // A match is "fully dead" once both its slots are confirmed dead
      // (whether built-in-empty or filled-in-during-play — but a match
      // that already has a real team in a slot is never fully dead).
      const aDead = m.team_a_id === null && dead.has(`${m.id}:a`);
      const bDead = m.team_b_id === null && dead.has(`${m.id}:b`);
      if (!aDead || !bDead) continue;
      // Fully dead: propagate to whatever this match would have fed.
      if (m.advances_to_match_id && m.advances_to_slot) {
        const key = `${m.advances_to_match_id}:${m.advances_to_slot}`;
        if (!dead.has(key)) {
          dead.add(key);
          deadChanged = true;
        }
      }
      if (m.drops_to_match_id && m.drops_to_slot) {
        const key = `${m.drops_to_match_id}:${m.drops_to_slot}`;
        if (!dead.has(key)) {
          dead.add(key);
          deadChanged = true;
        }
      }
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const m of byId.values()) {
      if (m.status !== "pending") continue;
      if (isDeferredResetMatch(m)) continue; // never auto-resolved; app code populates it
      const hasA = m.team_a_id !== null;
      const hasB = m.team_b_id !== null;
      if (hasA && hasB) continue; // real match, both teams present — wait for it to be played

      if (!hasA && !hasB) {
        // Fully dead (both slots confirmed dead, no team will ever arrive):
        // resolve with no winner so it stops being iterated as "pending"
        // forever, but don't treat it as a bye advancing a team — there is
        // no team to advance. Its downstream dead-slot propagation is
        // already accounted for in the fixed point above.
        if (dead.has(`${m.id}:a`) && dead.has(`${m.id}:b`)) {
          m.status = "bye";
          m.winner_id = null;
          changed = true;
        }
        continue;
      }

      // Exactly one slot filled. Only resolve as a bye once the empty slot
      // is a *confirmed* dead end. If it's fed by a real match that hasn't
      // been decided yet, leave this match pending — it will fill in
      // naturally (as an ordinary two-team match) once that feeder plays.
      const emptySlot = hasA ? "b" : "a";
      if (!dead.has(`${m.id}:${emptySlot}`)) continue;

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

/** A reported series must end exactly when one side reaches the win target. */
export function validateClinchingScore(bestOf: 1 | 3 | 5, teamAScore: number, teamBScore: number): void {
  if (!Number.isInteger(teamAScore) || !Number.isInteger(teamBScore) || teamAScore < 0 || teamBScore < 0) {
    throw new Error("Scores must be non-negative whole numbers.");
  }
  const winsNeeded = Math.floor(bestOf / 2) + 1;
  const winnerScore = Math.max(teamAScore, teamBScore);
  const loserScore = Math.min(teamAScore, teamBScore);
  if (winnerScore !== winsNeeded || loserScore >= winsNeeded) {
    throw new Error(`A best-of-${bestOf} result must finish when one team reaches ${winsNeeded} wins.`);
  }
}

export interface AppliedBracketResult {
  matches: BracketMatch[];
  winnerId: string;
  loserId: string;
  championId: string | null;
}

/** Apply one result, including advancement, bye cascades, and GF reset state. */
export function applyBracketResult(
  matches: BracketMatch[],
  matchId: string,
  teamAScore: number,
  teamBScore: number,
): AppliedBracketResult {
  const byId = new Map(matches.map((m) => [m.id, m]));
  const match = byId.get(matchId);
  if (!match) throw new Error("Match not found.");
  if (match.status === "completed") throw new Error("This match already has a result.");
  if (!match.team_a_id || !match.team_b_id) {
    throw new Error("Both teams must be set before reporting a result.");
  }
  validateClinchingScore(match.best_of, teamAScore, teamBScore);

  const winnerId = teamAScore > teamBScore ? match.team_a_id : match.team_b_id;
  const loserId = winnerId === match.team_a_id ? match.team_b_id : match.team_a_id;
  match.team_a_score = teamAScore;
  match.team_b_score = teamBScore;
  match.winner_id = winnerId;
  match.status = "completed";

  if (match.advances_to_match_id && match.advances_to_slot) {
    const target = byId.get(match.advances_to_match_id);
    if (!target) throw new Error("Bracket advancement target is missing.");
    if (match.advances_to_slot === "a") target.team_a_id = winnerId;
    else target.team_b_id = winnerId;
  }
  if (match.drops_to_match_id && match.drops_to_slot) {
    const target = byId.get(match.drops_to_match_id);
    if (!target) throw new Error("Bracket drop target is missing.");
    if (match.drops_to_slot === "a") target.team_a_id = loserId;
    else target.team_b_id = loserId;
  }

  resolveByes(matches);

  const grandFinals = matches
    .filter((m) => m.bracket === "grand_final")
    .sort((a, b) => a.round_number - b.round_number);
  const isGf1 = grandFinals[0]?.id === matchId;
  const reset = grandFinals[1];
  let championId: string | null = null;
  if (isGf1 && reset) {
    if (winnerId === match.team_b_id) {
      reset.team_a_id = match.team_a_id;
      reset.team_b_id = match.team_b_id;
      reset.status = "pending";
    } else {
      reset.team_a_id = null;
      reset.team_b_id = null;
      reset.winner_id = null;
      reset.status = "bye";
      championId = winnerId;
    }
  } else if (match.bracket === "grand_final") {
    championId = winnerId;
  }

  return { matches, winnerId, loserId, championId };
}

/**
 * Retract a result and every auto-resolved bye that depended on it. A real
 * downstream match that is completed or already has both teams still blocks
 * undo; only mechanical bye propagation is rolled back automatically.
 */
export function retractBracketResult(matches: BracketMatch[], matchId: string): BracketMatch[] {
  const byId = new Map(matches.map((m) => [m.id, m]));
  const root = byId.get(matchId);
  if (!root) throw new Error("Match not found.");
  if (root.status !== "completed") throw new Error("This match has no result to undo.");

  const clearOutcome = (source: BracketMatch, kind: "advance" | "drop") => {
    const targetId = kind === "advance" ? source.advances_to_match_id : source.drops_to_match_id;
    const slot = kind === "advance" ? source.advances_to_slot : source.drops_to_slot;
    const occupant = kind === "advance"
      ? source.winner_id
      : source.winner_id === source.team_a_id
        ? source.team_b_id
        : source.team_a_id;
    if (!targetId || !slot || !occupant) return;
    const target = byId.get(targetId);
    if (!target) throw new Error("Bracket downstream target is missing.");

    if (target.status === "completed") {
      throw new Error("Can't undo — a downstream match already has a result.");
    }
    if (target.status !== "bye" && target.team_a_id && target.team_b_id) {
      throw new Error("Can't undo — a downstream match already has both teams.");
    }
    if (target.status === "bye") {
      // Retract its own mechanical winner first; this recursively clears a
      // chain of bye advancements before clearing the slot that created it.
      clearOutcome(target, "advance");
      clearOutcome(target, "drop");
      target.team_a_score = 0;
      target.team_b_score = 0;
      target.winner_id = null;
      target.status = "pending";
    }
    if (slot === "a" && target.team_a_id === occupant) target.team_a_id = null;
    if (slot === "b" && target.team_b_id === occupant) target.team_b_id = null;
  };

  clearOutcome(root, "advance");
  clearOutcome(root, "drop");

  const grandFinals = matches
    .filter((m) => m.bracket === "grand_final")
    .sort((a, b) => a.round_number - b.round_number);
  if (grandFinals[0]?.id === root.id && grandFinals[1]) {
    const reset = grandFinals[1];
    if (reset.status === "completed") {
      throw new Error("Can't undo — the grand-final reset has already been played.");
    }
    reset.team_a_id = null;
    reset.team_b_id = null;
    reset.team_a_score = 0;
    reset.team_b_score = 0;
    reset.winner_id = null;
    reset.status = "pending";
  }

  root.team_a_score = 0;
  root.team_b_score = 0;
  root.winner_id = null;
  root.status = "pending";
  return matches;
}
