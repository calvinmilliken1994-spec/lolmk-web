/**
 * Short-TTL in-process memo for the public venue/state routes.
 *
 * The live screens poll on an interval, and every poll used to run the full
 * DB reads on its own — N open tabs meant N identical reads per tick, all of
 * it metering against Neon's monthly egress allowance. This memo coalesces
 * every request for the same key inside a TTL window into one load, so the
 * DB sees at most one read per window per serverless instance no matter how
 * many screens are open.
 *
 * Deliberately in-process and short-lived (seconds): it is a request-shape
 * dedupe, not a cache layer. Staleness is bounded by TTL + poll interval,
 * which is fine for venue screens — the countdown clock is computed
 * client-side from serverNow, and admin desks poll the *-admin-state routes,
 * which are NOT memoized so every admin action is reflected immediately.
 *
 * Errors are never cached: a rejected load propagates and the entry is
 * dropped, so the next poll retries.
 */

interface MemoEntry {
  at: number;
  promise: Promise<unknown>;
}

const entries = new Map<string, MemoEntry>();

/** Sweep expired entries so the map cannot grow with slug churn. */
function sweep(now: number, ttlMs: number): void {
  for (const [key, entry] of entries) {
    if (now - entry.at > ttlMs * 4) entries.delete(key);
  }
}

/**
 * Run `load` at most once per `ttlMs` for `key`; concurrent callers share the
 * in-flight promise. A resolved `null` is cached like any other value (the
 * routes treat null as an authoritative 404).
 */
export async function memoizedLoad<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  sweep(now, ttlMs);

  const hit = entries.get(key);
  if (hit && now - hit.at <= ttlMs) {
    return hit.promise as Promise<T>;
  }

  const promise = load().catch((error) => {
    // Drop the entry so the failure is not served for the rest of the window.
    if (entries.get(key)?.promise === promise) entries.delete(key);
    throw error;
  });
  entries.set(key, { at: now, promise });
  return promise;
}

/** Test helper: forget everything. */
export function resetVenueMemo(): void {
  entries.clear();
}
