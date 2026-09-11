"use server";

import { sql } from "@vercel/postgres";
import { revalidatePath } from "next/cache";
import { isToolsSession } from "@/lib/tools-auth";
import { ensureSchema, getMayhemFull, newId, SINGLETON_EVENT_ID } from "@/lib/mayhem-db";
import { pickTeamIdentities, shuffle } from "@/lib/mayhem-icons";
import { buildKnockoutBracket } from "@/lib/mayhem-bracket";
import {
  applyBracketResult,
  retractBracketResult,
  type BracketMatch,
} from "@/lib/bracket-engine";
import { buildGroupRoundRobin, computeGroupStandings } from "@/lib/mayhem-groups";
import type { MayhemFormatConfig, MayhemScene } from "@/types/mayhem";

async function requireAdmin() {
  const ok = await isToolsSession();
  if (!ok) throw new Error("Not authorized.");
}

function touch() {
  return sql`UPDATE mayhem_events SET updated_at = now() WHERE id = ${SINGLETON_EVENT_ID}`;
}

function refresh() {
  revalidatePath("/tools/mayhem");
  revalidatePath("/mayhemlive");
}

async function persistMayhemBracket(matches: BracketMatch[]): Promise<void> {
  for (const match of matches) {
    await sql.query(
      `UPDATE mayhem_matches SET team_a_id = $2, team_b_id = $3,
         team_a_score = $4, team_b_score = $5, winner_id = $6, status = $7
       WHERE id = $1 AND event_id = $8`,
      [
        match.id,
        match.team_a_id,
        match.team_b_id,
        match.team_a_score,
        match.team_b_score,
        match.winner_id,
        match.status,
        SINGLETON_EVENT_ID,
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export async function addPlayer(displayName: string) {
  await requireAdmin();
  await ensureSchema();
  const name = displayName.trim();
  if (!name) return;
  const { rows } = await sql`
    SELECT COALESCE(MAX(entry_order), -1) + 1 AS next
    FROM mayhem_players WHERE event_id = ${SINGLETON_EVENT_ID}
  `;
  await sql`
    INSERT INTO mayhem_players (id, event_id, display_name, entry_order, team_id)
    VALUES (${newId("player")}, ${SINGLETON_EVENT_ID}, ${name}, ${rows[0].next}, NULL)
  `;
  await touch();
  refresh();
}

export async function removePlayer(playerId: string) {
  await requireAdmin();
  await sql`DELETE FROM mayhem_players WHERE id = ${playerId} AND event_id = ${SINGLETON_EVENT_ID}`;
  await touch();
  refresh();
}

export async function renamePlayer(playerId: string, displayName: string) {
  await requireAdmin();
  const name = displayName.trim();
  if (!name) return;
  await sql`
    UPDATE mayhem_players SET display_name = ${name}
    WHERE id = ${playerId} AND event_id = ${SINGLETON_EVENT_ID}
  `;
  await touch();
  refresh();
}

/**
 * Rename existing teams to fresh icon identities without touching rosters
 * or match state. Use this to fix teams that were created before the
 * filesystem-icon-discovery bug was fixed (see mayhem-icons.ts) and ended up
 * with generic "Team 1"-style names instead of real icon names.
 */
export async function refreshTeamIdentities() {
  await requireAdmin();
  const full = await getMayhemFull();
  if (full.teams.length === 0) return;

  const identities = shuffle(pickTeamIdentities(full.teams.length));
  const orderedTeams = [...full.teams].sort((a, b) => a.reveal_order - b.reveal_order);
  for (let i = 0; i < orderedTeams.length; i++) {
    const identity = identities[i];
    await sql`
      UPDATE mayhem_teams SET name = ${identity.name}, icon_url = ${identity.iconUrl}
      WHERE id = ${orderedTeams[i].id}
    `;
  }
  await touch();
  refresh();
}

export async function clearAllPlayers() {
  await requireAdmin();
  await sql`DELETE FROM mayhem_matches WHERE event_id = ${SINGLETON_EVENT_ID}`;
  await sql`DELETE FROM mayhem_teams WHERE event_id = ${SINGLETON_EVENT_ID}`;
  await sql`DELETE FROM mayhem_groups WHERE event_id = ${SINGLETON_EVENT_ID}`;
  await sql`DELETE FROM mayhem_players WHERE event_id = ${SINGLETON_EVENT_ID}`;
  await sql`
    UPDATE mayhem_events
    SET stage = 'collecting', scene = 'idle', reveal_index = 0,
        active_match_id = NULL, champion_team_id = NULL, countdown_ends_at = NULL
    WHERE id = ${SINGLETON_EVENT_ID}
  `;
  refresh();
}

// ---------------------------------------------------------------------------
// Randomization
// ---------------------------------------------------------------------------

/**
 * Confirm the entrant list and randomize teams. Requires player count to be
 * a multiple of 5, at least 20 (4 teams). Persists the result immediately —
 * never recalculated on refresh. Calling this again on an already-randomized
 * event is a deliberate reroll and requires the caller to have confirmed
 * (the UI gates this with a second confirmation dialog).
 */
export async function randomizeTeams() {
  await requireAdmin();
  await ensureSchema();

  const { rows: playerRows } = await sql`
    SELECT id, display_name FROM mayhem_players
    WHERE event_id = ${SINGLETON_EVENT_ID}
    ORDER BY entry_order ASC
  `;
  const count = playerRows.length;
  if (count < 20) throw new Error("Need at least 20 players (4 teams of 5).");
  if (count % 5 !== 0) throw new Error("Player count must be a multiple of 5.");

  const teamCount = count / 5;
  const shuffledPlayers = shuffle(playerRows);
  const identities = shuffle(pickTeamIdentities(teamCount));

  // Wipe any prior randomization (reroll case).
  await sql`DELETE FROM mayhem_matches WHERE event_id = ${SINGLETON_EVENT_ID}`;
  await sql`DELETE FROM mayhem_groups WHERE event_id = ${SINGLETON_EVENT_ID}`;
  await sql`UPDATE mayhem_players SET team_id = NULL WHERE event_id = ${SINGLETON_EVENT_ID}`;
  await sql`DELETE FROM mayhem_teams WHERE event_id = ${SINGLETON_EVENT_ID}`;

  for (let t = 0; t < teamCount; t++) {
    const teamId = newId("team");
    const identity = identities[t];
    await sql`
      INSERT INTO mayhem_teams (id, event_id, name, icon_url, seed, reveal_order, group_id)
      VALUES (${teamId}, ${SINGLETON_EVENT_ID}, ${identity.name}, ${identity.iconUrl}, ${t + 1}, ${t}, NULL)
    `;
    const roster = shuffledPlayers.slice(t * 5, t * 5 + 5);
    for (const p of roster) {
      await sql`UPDATE mayhem_players SET team_id = ${teamId} WHERE id = ${p.id}`;
    }
  }

  await sql`
    UPDATE mayhem_events
    SET stage = 'randomized', scene = 'reveal', reveal_index = 0
    WHERE id = ${SINGLETON_EVENT_ID}
  `;
  refresh();
}

// ---------------------------------------------------------------------------
// Presentation / scene control
// ---------------------------------------------------------------------------

export async function setScene(scene: MayhemScene) {
  await requireAdmin();
  await sql`UPDATE mayhem_events SET scene = ${scene} WHERE id = ${SINGLETON_EVENT_ID}`;
  refresh();
}

export async function startCountdown(seconds: number) {
  await requireAdmin();
  const endsAt = new Date(Date.now() + seconds * 1000).toISOString();
  await sql`
    UPDATE mayhem_events
    SET scene = 'starting_soon', countdown_ends_at = ${endsAt}
    WHERE id = ${SINGLETON_EVENT_ID}
  `;
  refresh();
}

export async function advanceReveal() {
  await requireAdmin();
  const full = await getMayhemFull();
  const next = Math.min(full.event.reveal_index + 1, full.teams.length);
  const scene = next >= full.teams.length ? "teams" : "reveal";
  await sql`
    UPDATE mayhem_events SET reveal_index = ${next}, scene = ${scene}
    WHERE id = ${SINGLETON_EVENT_ID}
  `;
  refresh();
}

// ---------------------------------------------------------------------------
// Format config
// ---------------------------------------------------------------------------

export async function updateFormat(format: MayhemFormatConfig) {
  await requireAdmin();
  if (format.knockout.doubleElimination && format.knockout.thirdPlaceMatch) {
    throw new Error("Third-place matches are not supported for double elimination.");
  }
  const full = await getMayhemFull();
  if (full.matches.some((match) => match.bracket !== "group")) {
    throw new Error("Knockout settings can't be changed after the bracket is generated.");
  }
  await sql`
    UPDATE mayhem_events SET format = ${JSON.stringify(format)}::jsonb
    WHERE id = ${SINGLETON_EVENT_ID}
  `;
  refresh();
}

// ---------------------------------------------------------------------------
// Group stage
// ---------------------------------------------------------------------------

export async function generateGroups() {
  await requireAdmin();
  const full = await getMayhemFull();
  const { groupCount, seeding, seriesLength, advancePerGroup } = full.event.format.groupStage;
  if (full.teams.length < groupCount * 2) {
    throw new Error("Not enough teams for that many groups.");
  }

  await sql`DELETE FROM mayhem_matches WHERE event_id = ${SINGLETON_EVENT_ID}`;
  await sql`DELETE FROM mayhem_groups WHERE event_id = ${SINGLETON_EVENT_ID}`;
  await sql`UPDATE mayhem_teams SET group_id = NULL WHERE event_id = ${SINGLETON_EVENT_ID}`;

  const orderedTeams =
    seeding === "random" ? shuffle(full.teams) : [...full.teams].sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0));

  const groupIds: string[] = [];
  for (let g = 0; g < groupCount; g++) {
    const groupId = newId("group");
    groupIds.push(groupId);
    const label = `Group ${String.fromCharCode(65 + g)}`;
    await sql`
      INSERT INTO mayhem_groups (id, event_id, label, advance_count)
      VALUES (${groupId}, ${SINGLETON_EVENT_ID}, ${label}, ${advancePerGroup})
    `;
  }

  // Snake-distribute teams across groups for balance.
  const buckets: string[][] = groupIds.map(() => []);
  orderedTeams.forEach((team, i) => {
    const g = i % groupCount;
    buckets[g].push(team.id);
  });
  for (let g = 0; g < groupCount; g++) {
    for (const teamId of buckets[g]) {
      await sql`UPDATE mayhem_teams SET group_id = ${groupIds[g]} WHERE id = ${teamId}`;
    }
  }

  let matchNumber = 1;
  for (let g = 0; g < groupCount; g++) {
    const matches = buildGroupRoundRobin(buckets[g], groupIds[g], seriesLength, matchNumber, () =>
      newId("match"),
    );
    matchNumber += matches.length;
    for (const m of matches) {
      await sql`
        INSERT INTO mayhem_matches (
          id, event_id, bracket, group_id, round_number, match_number, best_of,
          team_a_id, team_b_id, team_a_score, team_b_score, winner_id, status,
          advances_to_match_id, advances_to_slot, drops_to_match_id, drops_to_slot
        ) VALUES (
          ${m.id}, ${SINGLETON_EVENT_ID}, ${m.bracket}, ${m.group_id}, ${m.round_number}, ${m.match_number}, ${m.best_of},
          ${m.team_a_id}, ${m.team_b_id}, ${m.team_a_score}, ${m.team_b_score}, ${m.winner_id}, ${m.status},
          ${m.advances_to_match_id}, ${m.advances_to_slot}, ${m.drops_to_match_id}, ${m.drops_to_slot}
        )
      `;
    }
  }

  await sql`UPDATE mayhem_events SET stage = 'group_stage', scene = 'groups' WHERE id = ${SINGLETON_EVENT_ID}`;
  refresh();
}

/** Take group standings, seed qualifiers into the knockout bracket. */
export async function generateKnockoutFromGroups() {
  await requireAdmin();
  const full = await getMayhemFull();
  const qualifiers: string[] = [];

  for (const group of full.groups) {
    const teamIds = full.teams.filter((t) => t.group_id === group.id).map((t) => t.id);
    const groupMatches = full.matches.filter((m) => m.group_id === group.id);
    const standings = computeGroupStandings(teamIds, groupMatches);
    qualifiers.push(...standings.slice(0, group.advance_count).map((s) => s.teamId));
  }

  await generateKnockoutBracket(qualifiers);
}

/** Generate a knockout bracket directly (no group stage) from all teams, seeded by `seed`. */
export async function generateKnockoutFromAllTeams() {
  await requireAdmin();
  const full = await getMayhemFull();
  const seeded = [...full.teams].sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0)).map((t) => t.id);
  await generateKnockoutBracket(seeded);
}

async function generateKnockoutBracket(teamIdsBySeed: string[]) {
  const full = await getMayhemFull();
  const { knockout } = full.event.format;

  // Only clear knockout-stage matches (upper/lower/grand_final/third_place),
  // preserve group-stage match history.
  await sql`
    DELETE FROM mayhem_matches
    WHERE event_id = ${SINGLETON_EVENT_ID} AND bracket != 'group'
  `;

  const startNumber =
    full.matches.filter((m) => m.bracket === "group").reduce((max, m) => Math.max(max, m.match_number), 0) + 1;

  const matches = buildKnockoutBracket(teamIdsBySeed, {
    knockoutBestOf: knockout.seriesLength,
    doubleElimination: knockout.doubleElimination,
    thirdPlaceMatch: knockout.thirdPlaceMatch,
    grandFinalReset: knockout.grandFinalReset,
    startMatchNumber: startNumber,
    idFactory: () => newId("match"),
  });

  for (const m of matches) {
    await sql`
      INSERT INTO mayhem_matches (
        id, event_id, bracket, group_id, round_number, match_number, best_of,
        team_a_id, team_b_id, team_a_score, team_b_score, winner_id, status,
        advances_to_match_id, advances_to_slot, drops_to_match_id, drops_to_slot
      ) VALUES (
        ${m.id}, ${SINGLETON_EVENT_ID}, ${m.bracket}, ${m.group_id}, ${m.round_number}, ${m.match_number}, ${m.best_of},
        ${m.team_a_id}, ${m.team_b_id}, ${m.team_a_score}, ${m.team_b_score}, ${m.winner_id}, ${m.status},
        ${m.advances_to_match_id}, ${m.advances_to_slot}, ${m.drops_to_match_id}, ${m.drops_to_slot}
      )
    `;
  }

  await sql`UPDATE mayhem_events SET stage = 'knockout', scene = 'bracket' WHERE id = ${SINGLETON_EVENT_ID}`;
  refresh();
}

// ---------------------------------------------------------------------------
// Live match control
// ---------------------------------------------------------------------------

export async function setActiveMatch(matchId: string | null) {
  await requireAdmin();
  await sql`
    UPDATE mayhem_events SET active_match_id = ${matchId}, scene = ${matchId ? "match" : "bracket"}
    WHERE id = ${SINGLETON_EVENT_ID}
  `;
  refresh();
}

/** Record a clinching result and persist all advancement/reset/bye effects. */
export async function recordMatchResult(matchId: string, teamAScore: number, teamBScore: number) {
  await requireAdmin();
  const full = await getMayhemFull();
  const graph = full.matches as unknown as BracketMatch[];
  const result = applyBracketResult(graph, matchId, teamAScore, teamBScore);
  await persistMayhemBracket(graph);

  if (result.championId) {
    await sql`
      UPDATE mayhem_events
      SET champion_team_id = ${result.championId}, scene = 'champion', active_match_id = NULL, stage = 'completed'
      WHERE id = ${SINGLETON_EVENT_ID}
    `;
  } else if (full.event.stage !== "completed") {
    await sql`UPDATE mayhem_events SET active_match_id = NULL, scene = 'bracket' WHERE id = ${SINGLETON_EVENT_ID}`;
  }

  refresh();
}

/** Undo a result and retract dependent auto-resolved byes transitively. */
export async function undoMatchResult(matchId: string) {
  await requireAdmin();
  const full = await getMayhemFull();
  const graph = full.matches as unknown as BracketMatch[];
  const match = graph.find((candidate) => candidate.id === matchId);
  const previousWinner = match?.winner_id ?? null;
  retractBracketResult(graph, matchId);
  await persistMayhemBracket(graph);

  if (previousWinner && full.event.champion_team_id === previousWinner) {
    await sql`
      UPDATE mayhem_events SET champion_team_id = NULL, stage = 'knockout',
        scene = 'bracket', active_match_id = NULL
      WHERE id = ${SINGLETON_EVENT_ID}
    `;
  }
  refresh();
}
