"use server";

import { sql } from "@vercel/postgres";
import { revalidatePath } from "next/cache";
import { isToolsSession } from "@/lib/tools-auth";
import { ensureSchema, getMayhemFull, newId, SINGLETON_EVENT_ID } from "@/lib/mayhem-db";
import { pickTeamIdentities, shuffle } from "@/lib/mayhem-icons";
import { buildKnockoutBracket } from "@/lib/mayhem-bracket";
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

/**
 * Record a match result. Winner takes the series (score is informational —
 * best_of just tells the admin/venue screen how many games to expect).
 * Auto-advances the winner and drops the loser per the match's links.
 */
export async function recordMatchResult(matchId: string, teamAScore: number, teamBScore: number) {
  await requireAdmin();
  const full = await getMayhemFull();
  const match = full.matches.find((m) => m.id === matchId);
  if (!match || !match.team_a_id || !match.team_b_id) return;

  const winnerId = teamAScore > teamBScore ? match.team_a_id : match.team_b_id;
  const loserId = winnerId === match.team_a_id ? match.team_b_id : match.team_a_id;

  await sql`
    UPDATE mayhem_matches
    SET team_a_score = ${teamAScore}, team_b_score = ${teamBScore},
        winner_id = ${winnerId}, status = 'completed'
    WHERE id = ${matchId}
  `;

  if (match.advances_to_match_id && match.advances_to_slot) {
    const col = match.advances_to_slot === "a" ? "team_a_id" : "team_b_id";
    await sql.query(
      `UPDATE mayhem_matches SET ${col} = $1 WHERE id = $2`,
      [winnerId, match.advances_to_match_id],
    );
  }
  if (match.drops_to_match_id && match.drops_to_slot && loserId) {
    const col = match.drops_to_slot === "a" ? "team_a_id" : "team_b_id";
    await sql.query(
      `UPDATE mayhem_matches SET ${col} = $1 WHERE id = $2`,
      [loserId, match.drops_to_match_id],
    );
  }

  // Champion detection: grand final (final one, no downstream) completed.
  if (match.bracket === "grand_final" && !match.advances_to_match_id) {
    await sql`
      UPDATE mayhem_events
      SET champion_team_id = ${winnerId}, scene = 'champion', active_match_id = NULL, stage = 'completed'
      WHERE id = ${SINGLETON_EVENT_ID}
    `;
  } else {
    await sql`UPDATE mayhem_events SET active_match_id = NULL, scene = 'bracket' WHERE id = ${SINGLETON_EVENT_ID}`;
  }

  refresh();
}

/** Undo a completed match's result — only safe while downstream matches haven't started. */
export async function undoMatchResult(matchId: string) {
  await requireAdmin();
  const full = await getMayhemFull();
  const match = full.matches.find((m) => m.id === matchId);
  if (!match) return;

  const downstream = [match.advances_to_match_id, match.drops_to_match_id]
    .filter(Boolean)
    .map((id) => full.matches.find((m) => m.id === id))
    .filter(Boolean);
  const downstreamStarted = downstream.some(
    (m) => m!.status === "completed" || (m!.team_a_id && m!.team_b_id),
  );
  if (downstreamStarted) {
    throw new Error("Can't undo — a downstream match already has both teams or a result.");
  }

  await sql`
    UPDATE mayhem_matches
    SET team_a_score = 0, team_b_score = 0, winner_id = NULL, status = 'pending'
    WHERE id = ${matchId}
  `;
  if (match.advances_to_match_id && match.advances_to_slot) {
    const col = match.advances_to_slot === "a" ? "team_a_id" : "team_b_id";
    await sql.query(`UPDATE mayhem_matches SET ${col} = NULL WHERE id = $1`, [match.advances_to_match_id]);
  }
  if (match.drops_to_match_id && match.drops_to_slot) {
    const col = match.drops_to_slot === "a" ? "team_a_id" : "team_b_id";
    await sql.query(`UPDATE mayhem_matches SET ${col} = NULL WHERE id = $1`, [match.drops_to_match_id]);
  }
  await sql`UPDATE mayhem_events SET champion_team_id = NULL WHERE id = ${SINGLETON_EVENT_ID} AND champion_team_id = ${match.winner_id}`;
  refresh();
}
