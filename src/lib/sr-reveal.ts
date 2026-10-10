/**
 * Timing of the Upper Bracket Round 1 reveal on /srlive. The sequence is
 * driven entirely off `ubr1_reveal_started_at`: row i shows at
 * i * REVEAL_ROW_INTERVAL_MS, and the full bracket fades in REVEAL_HOLD_MS
 * after the last row. Shared by the live screen and the desk's progress.
 */
export const REVEAL_ROW_INTERVAL_MS = 3000;
export const REVEAL_HOLD_MS = 1800;

export function ubr1RevealDurationMs(total: number): number {
  return total > 1 ? (total - 1) * REVEAL_ROW_INTERVAL_MS + REVEAL_HOLD_MS : REVEAL_HOLD_MS;
}

/** How many of `total` matchups are on screen `elapsedMs` after the start. */
export function ubr1VisibleCount(total: number, elapsedMs: number): number {
  if (total === 0) return 0;
  return Math.min(total, Math.floor(Math.max(0, elapsedMs) / REVEAL_ROW_INTERVAL_MS) + 1);
}
