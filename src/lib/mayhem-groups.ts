import type { MayhemMatch, MayhemTeam } from "@/types/mayhem";

/** Round-robin schedule (circle method) for one group of team IDs. */
export function buildGroupRoundRobin(
  teamIds: string[],
  groupId: string,
  bestOf: 1 | 3 | 5,
  startMatchNumber: number,
  idFactory: () => string,
): MayhemMatch[] {
  const ids = [...teamIds];
  const hasBye = ids.length % 2 !== 0;
  if (hasBye) ids.push("__bye__");
  const n = ids.length;
  const rounds = n - 1;
  const half = n / 2;
  const matches: MayhemMatch[] = [];
  let matchNumber = startMatchNumber;

  const arr = [...ids];
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < half; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a === "__bye__" || b === "__bye__") continue;
      matches.push({
        id: idFactory(),
        event_id: "main",
        bracket: "group",
        group_id: groupId,
        round_number: r + 1,
        match_number: matchNumber++,
        best_of: bestOf,
        team_a_id: a,
        team_b_id: b,
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
    // Rotate all but the first element.
    const fixed = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop()!);
    arr.splice(0, arr.length, fixed, ...rest);
  }
  return matches;
}

export interface GroupStanding {
  teamId: string;
  wins: number;
  losses: number;
  matchesPlayed: number;
}

/** Compute standings for a group from its completed matches, sorted best-first. */
export function computeGroupStandings(
  teamIds: string[],
  matches: MayhemMatch[],
): GroupStanding[] {
  const table = new Map<string, GroupStanding>(
    teamIds.map((id) => [id, { teamId: id, wins: 0, losses: 0, matchesPlayed: 0 }]),
  );
  for (const m of matches) {
    if (m.status !== "completed" || !m.winner_id) continue;
    const loserId = m.winner_id === m.team_a_id ? m.team_b_id : m.team_a_id;
    const winnerRow = table.get(m.winner_id);
    if (winnerRow) {
      winnerRow.wins += 1;
      winnerRow.matchesPlayed += 1;
    }
    if (loserId) {
      const loserRow = table.get(loserId);
      if (loserRow) {
        loserRow.losses += 1;
        loserRow.matchesPlayed += 1;
      }
    }
  }
  return Array.from(table.values()).sort((a, b) => b.wins - a.wins);
}
