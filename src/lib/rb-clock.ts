// Riftbound round clock (pure). Server timestamps in, remaining time out.
// Lives apart from rb-db.ts so client components can import it: rb-db pulls in
// the Postgres driver. rb-db re-exports everything here, so existing imports hold.

import type { RbClockFields, RbMatchClockFields, RbRound } from "../types/riftbound";

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------
//
// Server timestamps only. Nothing here keeps a countdown; every caller derives
// the remaining time from the stored fields and "now":
//
//   elapsed   = (paused_at ?? now) - started_at - paused_total_ms
//   remaining = duration_ms + extension_ms - elapsed
//
// Pausing freezes `elapsed` by moving the reference point from `now` to
// `paused_at`. Resuming folds the pause into paused_total_ms so elapsed picks
// up where it left off. Adjusting the clock changes duration_ms. A table
// extension is added on top for that table only.
//
// "Time" is never stored: a table is in time while remaining > 0.

type ClockNow = number | Date;
const toMs = (now: ClockNow): number => (typeof now === "number" ? now : now.getTime());

/** Milliseconds of play used so far, never negative. Null if the clock hasn't started. */
export function clockElapsedMs(round: RbClockFields, now: ClockNow): number | null {
  if (!round.started_at) return null;
  const start = new Date(round.started_at).getTime();
  const reference = round.paused_at ? new Date(round.paused_at).getTime() : toMs(now);
  return Math.max(0, reference - start - round.paused_total_ms);
}

/**
 * Time left on the clock in ms, clamped at 0 (an overrun is reported as 0;
 * use isTimeCalled to ask whether time has been called).
 *
 *  - null: no time limit (duration_ms is null, e.g. a top-cut round).
 *  - Not started: the full duration plus the table's extension.
 *  - Paused: frozen at the value it had at paused_at.
 *  - `match` adds that table's extension_ms. Omit it for the round-level clock.
 */
export function clockRemainingMs(
  round: RbClockFields,
  match?: RbMatchClockFields | null,
  now: ClockNow = Date.now(),
): number | null {
  if (round.duration_ms === null) return null;
  const total = round.duration_ms + (match?.extension_ms ?? 0);
  const elapsed = clockElapsedMs(round, now);
  if (elapsed === null) return Math.max(0, total);
  return Math.max(0, total - elapsed);
}

/** True once a started, timed clock has run out. A paused clock is never called at its frozen value unless that value is 0. */
export function isTimeCalled(
  round: RbClockFields,
  match?: RbMatchClockFields | null,
  now: ClockNow = Date.now(),
): boolean {
  if (!round.started_at) return false;
  const remaining = clockRemainingMs(round, match, now);
  return remaining !== null && remaining <= 0;
}

/**
 * Wall-clock instant (ms since epoch) at which time is called, or null when
 * there is no limit, the clock hasn't started, or it is paused (the end moves
 * while paused, so there is no fixed instant to publish).
 */
export function clockEndsAtMs(
  round: RbClockFields,
  match?: RbMatchClockFields | null,
): number | null {
  if (round.duration_ms === null || !round.started_at || round.paused_at) return null;
  return (
    new Date(round.started_at).getTime() +
    round.paused_total_ms +
    round.duration_ms +
    (match?.extension_ms ?? 0)
  );
}

/** Column changes for each clock action. Pure: the action applies them under the round lock. */
export type RbClockPatch = Partial<
  Pick<RbRound, "started_at" | "paused_at" | "paused_total_ms" | "duration_ms">
>;

export function clockStartPatch(round: RbClockFields, now: ClockNow): RbClockPatch {
  if (round.started_at) throw new Error("The clock has already started.");
  return { started_at: new Date(toMs(now)).toISOString(), paused_at: null, paused_total_ms: 0 };
}

export function clockPausePatch(round: RbClockFields, now: ClockNow): RbClockPatch {
  if (!round.started_at) throw new Error("The clock has not started.");
  if (round.paused_at) throw new Error("The clock is already paused.");
  return { paused_at: new Date(toMs(now)).toISOString() };
}

export function clockResumePatch(round: RbClockFields, now: ClockNow): RbClockPatch {
  if (!round.paused_at) throw new Error("The clock is not paused.");
  const pausedFor = Math.max(0, toMs(now) - new Date(round.paused_at).getTime());
  return { paused_at: null, paused_total_ms: round.paused_total_ms + pausedFor };
}

/** Add (or, if negative, remove) time from the round. Never goes below zero. */
export function clockAdjustPatch(round: RbClockFields, deltaMs: number): RbClockPatch {
  if (round.duration_ms === null) throw new Error("This round has no time limit.");
  if (!Number.isFinite(deltaMs)) throw new Error("Adjustment must be a number of milliseconds.");
  return { duration_ms: Math.max(0, Math.round(round.duration_ms + deltaMs)) };
}

