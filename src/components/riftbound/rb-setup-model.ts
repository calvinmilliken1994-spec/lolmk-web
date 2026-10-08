// Pure setup-phase logic for the Riftbound desk: checklist step status and
// summaries, the lock rules the Format panel shows, and the Auto hints.
// Mirrors the server rules in rb-service.ts (updateConfig / requireBeforeRound1),
// which remain the authority; this only explains them to the operator.
//
// Relative imports (not "@/") so scripts/test-rb-setup.ts can load it.

import { resolveRoundCount, resolveTopCutSize } from "../../lib/swiss-engine";
import type { RbJudge, RbPlayer, RbTournamentFull } from "../../types/riftbound";

export type RbSetupStepId = "basics" | "format" | "players" | "checkin" | "judges" | "venue";

export const RB_SETUP_STEPS: { id: RbSetupStepId; label: string }[] = [
  { id: "basics", label: "Event basics" },
  { id: "format", label: "Format" },
  { id: "players", label: "Players" },
  { id: "checkin", label: "Check-in" },
  { id: "judges", label: "Judges" },
  { id: "venue", label: "Venue screen" },
];

export type RbStepStatus = "done" | "todo" | "warn";

export interface RbSetupStep {
  id: RbSetupStepId;
  label: string;
  /** 1-based position, shown in the badge when the step is open or todo. */
  number: number;
  status: RbStepStatus;
  /** Second line of the checklist card. */
  detail: string;
}

/** Players who count towards the field: not dropped or disqualified. */
export const isEntrant = (p: RbPlayer): boolean => p.status !== "dropped" && p.status !== "dq";

export const SWISS_ROUNDS_MAX = 15;

// ---------------------------------------------------------------------------
// Locks
// ---------------------------------------------------------------------------

/** A reason string when the setting is read-only, else null. */
export interface RbLocks {
  /** Event name, enforcement level and the basics: until the event is finished. */
  event: string | null;
  /** Match format, round length, scoring: until Round 1 is paired. */
  format: string | null;
  swissRounds: string | null;
  powerPair: string | null;
  topCut: string | null;
  /** Adding, editing and removing players: until Round 1 is paired. */
  players: string | null;
  swissPaired: number;
  round1Paired: boolean;
  finalPaired: boolean;
}

export function rbLocks(full: Pick<RbTournamentFull, "tournament" | "rounds">): RbLocks {
  const { tournament: t, rounds } = full;
  const swissPaired = rounds.filter((r) => r.stage === "swiss").length;
  const round1Paired = swissPaired > 0;
  const finalPaired =
    round1Paired && typeof t.config.swissRounds === "number" && swissPaired >= t.config.swissRounds;
  const finished = t.status === "completed" || t.status === "archived";
  const finishedReason = "The event is finished.";

  return {
    event: finished ? finishedReason : null,
    format: finished ? finishedReason : round1Paired ? "Round 1 is paired." : null,
    swissRounds: finished ? finishedReason : finalPaired ? "The final Swiss round is paired." : null,
    powerPair: finished ? finishedReason : finalPaired ? "The final Swiss round is paired." : null,
    topCut: finished ? finishedReason : t.config.topCutSeedIds ? "The cut has been made." : null,
    players: finished ? finishedReason : round1Paired ? "Round 1 is paired, so registration is closed." : null,
    swissPaired,
    round1Paired,
    finalPaired,
  };
}

// ---------------------------------------------------------------------------
// Format hints
// ---------------------------------------------------------------------------

export function rbEntrantCount(players: RbPlayer[]): number {
  return players.filter(isEntrant).length;
}

/** "Auto · 5 rounds at 28 registered. Fixed when Round 1 is paired." */
export function rbRoundsHint(full: Pick<RbTournamentFull, "tournament" | "players" | "rounds">): string {
  const { tournament: t, players } = full;
  const n = rbEntrantCount(players);
  const locks = rbLocks(full);
  if (locks.round1Paired) {
    const count = t.config.swissRounds as number;
    return `${count} rounds, fixed when Round 1 was paired. Editable until the final round is paired.`;
  }
  if (t.config.swissRounds === "auto") {
    if (n < 2) return "Auto · decided from the player count. Fixed when Round 1 is paired.";
    const rounds = resolveRoundCount(n, { swissRounds: "auto" });
    return `Auto · ${rounds} ${rounds === 1 ? "round" : "rounds"} at ${n} registered. Fixed when Round 1 is paired.`;
  }
  return `${t.config.swissRounds} rounds. Editable until the final round is paired.`;
}

/** "Auto · Top 8 at 17+ players. Top cut is untimed." */
export function rbCutHint(full: Pick<RbTournamentFull, "tournament" | "players">): string {
  const { tournament: t, players } = full;
  const n = rbEntrantCount(players);
  const untimed = "Top cut is untimed.";
  if (t.config.topCut === "auto") {
    const size = resolveTopCutSize(n, { topCut: "auto" });
    if (size === 8) return `Auto · Top 8 at 17+ players. ${untimed}`;
    if (size === 4) return `Auto · Top 4 at 7–16 players. ${untimed}`;
    return "Auto · No cut at 6 or fewer players. Swiss rank 1 is champion.";
  }
  if (t.config.topCut === 0) return "No top cut. Swiss rank 1 is champion.";
  const size = resolveTopCutSize(n, { topCut: t.config.topCut });
  if (size !== t.config.topCut) {
    return size === 0
      ? `Only ${n} players: too few for a Top ${t.config.topCut}, so there is no cut.`
      : `Only ${n} players: the cut shrinks to Top ${size}. ${untimed}`;
  }
  return `Top ${size} after the final Swiss round. ${untimed}`;
}

/** The three round counts offered next to Auto: one below, the current value, one above. */
export function rbRoundOptions(full: Pick<RbTournamentFull, "tournament" | "players">): number[] {
  const { tournament: t, players } = full;
  const base =
    typeof t.config.swissRounds === "number"
      ? t.config.swissRounds
      : resolveRoundCount(Math.max(2, rbEntrantCount(players)), { swissRounds: "auto" });
  const start = Math.min(Math.max(1, base - 1), SWISS_ROUNDS_MAX - 2);
  return [start, start + 1, start + 2];
}

export function rbCutLabel(cut: "auto" | 0 | 4 | 8): string {
  return cut === "auto" ? "Auto cut" : cut === 0 ? "No cut" : `Top ${cut}`;
}

export function rbFormatSummary(full: Pick<RbTournamentFull, "tournament" | "players">): string {
  const { config } = full.tournament;
  const rounds = config.swissRounds === "auto" ? "Auto rounds" : `${config.swissRounds} rounds`;
  return `Bo${config.bestOf} · ${config.roundMinutes} min · ${rounds} · ${rbCutLabel(config.topCut)}`;
}

/** "bye 2–0 · MW% floor 33%" etc., for the Advanced summary line. */
export function rbAdvancedSummary(full: Pick<RbTournamentFull, "tournament">): string {
  const s = full.tournament.config.scoring;
  return `Advanced · bye ${s.byeGamesWon}–${s.byeGamesLost} · MW% floor ${Math.round(s.winPercentFloor * 100)}% · tiebreakers`;
}

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

/** What Open check-in still needs from the basics, e.g. ["date", "venue"]. */
export function rbBasicsMissing(full: Pick<RbTournamentFull, "tournament">): string[] {
  const { tournament: t } = full;
  const missing: string[] = [];
  if (!t.name.trim()) missing.push("name");
  if (!t.config.date) missing.push("date");
  if (!t.config.venue?.trim()) missing.push("venue");
  return missing;
}

/** "Sat 12 Dec 2026" from "2026-12-12"; the date is a calendar date, so no time zone shifts it. */
export function rbFormatDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

// ---------------------------------------------------------------------------
// Judges
// ---------------------------------------------------------------------------

export function rbFormatRange(j: Pick<RbJudge, "from" | "to">): string {
  if (j.from === null) return "All tables";
  if (j.to === null) return `${j.from}+`;
  return j.from === j.to ? `${j.from}` : `${j.from}–${j.to}`;
}

/** "tables split 1–6 / 7–11 / 12+", or null when no judge has a range. */
export function rbJudgeSplit(judges: RbJudge[]): string | null {
  const ranged = judges.filter((j) => j.from !== null);
  if (ranged.length === 0) return null;
  return `tables split ${ranged.map(rbFormatRange).join(" / ")}`;
}

/** Judges whose table ranges overlap, as "A and B" pairs, so the desk can warn. */
export function rbJudgeOverlaps(judges: RbJudge[]): string[] {
  const span = (j: RbJudge) => [j.from ?? 1, j.to ?? Infinity] as const;
  const out: string[] = [];
  for (let i = 0; i < judges.length; i++) {
    for (let k = i + 1; k < judges.length; k++) {
      const [a1, a2] = span(judges[i]);
      const [b1, b2] = span(judges[k]);
      if (a1 <= b2 && b1 <= a2) out.push(`${judges[i].name || "Judge"} and ${judges[k].name || "Judge"}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------

const kstTime = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(
    new Date(iso),
  ) + " KST";

export function rbSetupSteps(full: RbTournamentFull): RbSetupStep[] {
  const { tournament: t, players } = full;
  const entrants = players.filter(isEntrant);
  const members = entrants.filter((p) => p.member_discord_id).length;
  const missing = rbBasicsMissing(full);
  const venuePath = `/rblive/${t.slug}`;
  const judges = t.config.judges;
  const checkedIn = entrants.filter((p) => p.status === "checked_in" || p.status === "active").length;

  const detail: Record<RbSetupStepId, string> = {
    basics: [
      t.config.date ? rbFormatDate(t.config.date) : "No date",
      t.config.venue?.trim() || "No venue",
      `/${t.slug}`,
    ].join(" · "),
    format: rbFormatSummary(full),
    players:
      entrants.length === 0
        ? "No players yet"
        : `${entrants.length} registered · ${members} ${members === 1 ? "member" : "members"}, ${entrants.length - members} ${entrants.length - members === 1 ? "guest" : "guests"}`,
    checkin:
      t.status === "draft"
        ? "Opens on event day"
        : t.status === "registration"
          ? `Open · ${checkedIn} of ${entrants.length} checked in`
          : "Closed",
    judges:
      judges.length === 0
        ? "Optional · no judges added"
        : [judges.map((j) => j.name).join(", "), rbJudgeSplit(judges)].filter(Boolean).join(" · "),
    venue: t.config.venueTestedAt
      ? `Tested ${kstTime(t.config.venueTestedAt)} · ${venuePath}`
      : `Not tested yet · open ${venuePath}`,
  };

  const status: Record<RbSetupStepId, RbStepStatus> = {
    basics: missing.length === 0 ? "done" : "todo",
    format: "done", // every option has a valid default; the server validates edits
    players: entrants.length >= 2 ? "done" : "todo",
    checkin: t.status === "draft" ? "todo" : "done",
    judges: judges.length > 0 ? "done" : "todo",
    venue: t.config.venueTestedAt ? "done" : "warn",
  };

  return RB_SETUP_STEPS.map((s, i) => ({
    id: s.id,
    label: s.label,
    number: i + 1,
    status: status[s.id],
    detail: detail[s.id],
  }));
}
