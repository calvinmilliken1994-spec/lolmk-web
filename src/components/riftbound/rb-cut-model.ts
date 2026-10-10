// Pure desk logic for the Top cut workspace: the current cut round as a match
// queue, finished matches, the newest result that can still be undone, and the
// bracket overview. No React, no server actions.
//
// Relative imports (not "@/") so scripts/test-rb-cut.ts can load it.

import { cutLevelName, rbCutView, type CutView } from "../../lib/rb-cut";
import type { RbMatch, RbRound } from "../../types/riftbound";
import type { RbDeskState } from "./rb-deck-model";
import { playerName } from "./rb-round-model";

export type RbCutRowStatus = "waiting" | "live" | "done" | "bye";

export interface RbCutRow {
  matchId: string;
  table: number;
  a: { id: string; name: string; seed: number };
  /** Null for a match whose opponent dropped after the cut (a bye). */
  b: { id: string; name: string; seed: number } | null;
  status: RbCutRowStatus;
  /** "2–1" from the higher seed's side as listed. Null until reported. */
  score: string | null;
  winner: "a" | "b" | null;
  reportedBy: string | null;
}

export interface RbCutDesk {
  seeds: string[];
  /** Bracket cards and lines for the overview. Null if the stored rounds don't fit the bracket. */
  view: CutView | null;
  /** The newest top-cut round, or null before the first is paired. */
  round: RbRound | null;
  /** "Quarterfinals", "Semifinals", "Final". */
  roundName: string;
  isFinal: boolean;
  /** Tables to play, in table order. */
  queue: RbCutRow[];
  /** Reported tables (and byes) of this round. */
  finished: RbCutRow[];
  /** Reported results of earlier rounds, newest round first. */
  earlier: RbCutRow[];
  /** The round is published, so results can be reported. */
  reportable: boolean;
  finalReported: boolean;
  /** The newest result that Undo would clear: reported in an open round, newest by time. */
  undo: { matchId: string; table: number; text: string } | null;
}

const byTable = (a: { table_number: number }, b: { table_number: number }) => a.table_number - b.table_number;
const byNumber = (a: RbRound, b: RbRound) => a.number - b.number;

export function rbCutRounds(state: Pick<RbDeskState, "rounds">): RbRound[] {
  return state.rounds.filter((r) => r.stage === "top_cut").sort(byNumber);
}

function rowFor(state: RbDeskState, m: RbMatch): RbCutRow {
  const seeds = state.tournament.config.topCutSeedIds ?? [];
  const seat = (id: string) => ({ id, name: playerName(state, id), seed: seeds.indexOf(id) + 1 });
  const done = m.status === "completed";
  const winner = done ? (m.games_a > m.games_b ? "a" : "b") : m.status === "bye" ? "a" : null;
  return {
    matchId: m.id,
    table: m.table_number,
    a: seat(m.player_a_id),
    b: m.player_b_id ? seat(m.player_b_id) : null,
    status: m.status === "bye" ? "bye" : done ? "done" : m.started_at ? "live" : "waiting",
    score: done ? `${m.games_a}–${m.games_b}` : null,
    winner,
    reportedBy: m.reported_by_name,
  };
}

export function rbCutDesk(state: RbDeskState): RbCutDesk {
  const seeds = state.tournament.config.topCutSeedIds ?? [];
  const rounds = rbCutRounds(state);
  const round = rounds.at(-1) ?? null;
  const matchesOf = (r: RbRound) => state.matches.filter((m) => m.round_id === r.id).sort(byTable);

  let view: CutView | null = null;
  if (seeds.length >= 2) {
    const names = new Map(state.players.map((p) => [p.id, p.display_name]));
    const records = new Map(state.standings.map((s) => [s.playerId, s.record]));
    try {
      view = rbCutView(seeds, state.tournament.config.bestOf, rounds, state.matches, names, records);
    } catch {
      view = null;
    }
  }

  const depth = view?.depth ?? 0;
  const level = round ? rounds.length - 1 : 0;
  const roundName = round && depth > 0 ? cutLevelName(depth, level).text : "";
  const current = round ? matchesOf(round) : [];
  const rows = current.map((m) => rowFor(state, m));
  const queue = rows.filter((r) => r.status === "waiting" || r.status === "live");
  const finished = rows.filter((r) => r.status === "done" || r.status === "bye");
  const earlier = rounds
    .slice(0, -1)
    .reverse()
    .flatMap((r) => matchesOf(r).map((m) => rowFor(state, m)))
    .filter((r) => r.status === "done" || r.status === "bye");

  const isFinal = current.length === 1 && depth > 0 && level === depth - 1;
  const open = round !== null && round.status !== "closed" && round.status !== "draft";

  // Undo clears the newest result of an open round: the one the desk just entered.
  let undo: RbCutDesk["undo"] = null;
  if (open) {
    const last = current
      .filter((m) => m.status === "completed" && m.reported_at)
      .sort((a, b) => String(b.reported_at).localeCompare(String(a.reported_at)) || b.table_number - a.table_number)[0];
    if (last) {
      const row = rowFor(state, last);
      undo = {
        matchId: last.id,
        table: last.table_number,
        text: `${row.winner === "a" ? row.a.name : row.b?.name ?? "—"} won ${row.score}`,
      };
    }
  }

  return {
    seeds,
    view,
    round,
    roundName,
    isFinal,
    queue,
    finished,
    earlier,
    reportable: round !== null && (round.status === "published" || round.status === "live"),
    finalReported: isFinal && current[0]?.status === "completed",
    undo,
  };
}

/** One line for the header under the round name. */
export function rbCutProgress(desk: RbCutDesk): string {
  if (!desk.round) return "The first top-cut round hasn't been paired.";
  const total = desk.queue.length + desk.finished.length;
  const done = desk.finished.length;
  if (desk.round.status === "draft") return `${total} ${total === 1 ? "match" : "matches"} paired. Publish the round to start reporting.`;
  if (desk.round.status === "closed") return "Round closed.";
  if (desk.finalReported) return "The final is reported. Complete the event to crown the champion.";
  return `${done} of ${total} reported`;
}
