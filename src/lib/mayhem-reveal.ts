/**
 * Pure time-based reveal-index resolver, shared by every reader
 * (getMayhemFull, the admin dashboard, the live venue screen, the public
 * page). Never mutates anything — every consumer just re-derives "how many
 * teams should be visible right now" from a persisted start timestamp, so
 * this keeps working correctly even if the admin's browser tab is closed:
 * there is no client-side timer driving server state, only a read-time
 * calculation from data already in Postgres.
 */
export interface AutoRevealInput {
  teamCount: number;
  /** When manual mode (`auto: false`) or reveal hasn't started yet in auto mode, revealIndex is returned unchanged. */
  manualIndex: number;
  auto: boolean;
  revealStartedAt: string | null;
  /** Only consulted when startOnCountdownEnd is true AND revealStartedAt is still null. */
  countdownEndsAt: string | null;
  startOnCountdownEnd: boolean;
  intervalMs: number;
  /** Injectable for deterministic tests; defaults to the real clock. */
  now?: number;
}

export function computeAutoRevealIndex(input: AutoRevealInput): number {
  if (!input.auto) return input.manualIndex;

  const effectiveStartMs = input.revealStartedAt
    ? new Date(input.revealStartedAt).getTime()
    : input.startOnCountdownEnd && input.countdownEndsAt
      ? new Date(input.countdownEndsAt).getTime()
      : null;

  if (effectiveStartMs === null) return 0;

  const now = input.now ?? Date.now();
  if (now < effectiveStartMs) return 0;

  const elapsedMs = now - effectiveStartMs;
  const revealed = Math.floor(elapsedMs / input.intervalMs) + 1;
  return Math.max(0, Math.min(input.teamCount, revealed));
}

export const DEFAULT_REVEAL_INTERVAL_MS = 10_000;
export const MIN_REVEAL_INTERVAL_MS = 2_000;
export const MAX_REVEAL_INTERVAL_MS = 60_000;
