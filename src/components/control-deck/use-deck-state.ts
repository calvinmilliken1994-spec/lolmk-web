"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { DeckRun } from "./types";

/**
 * Shared poll + action runner for control-deck admin pages, extracted from
 * the logic duplicated in MayhemAdmin (poll, fetchSeq, run, lastSyncedAt)
 * and SR's useRunner (pending + verbatim error message).
 *
 * - Polls `url` every `intervalMs` (default 2s) with `cache: "no-store"`.
 * - Every fetch, poll or post-action, takes an incrementing sequence number
 *   and only the latest one is applied. Without this, an action's own
 *   immediate refresh can be overwritten a moment later by a slower poll
 *   response that was already stale when it started.
 * - `run(fn)` clears the error, runs `fn` inside a transition (so `pending`
 *   covers it), then refreshes immediately instead of waiting for the next
 *   tick. Errors are surfaced verbatim: a thrown Error's message (SR/Mayhem
 *   actions throw) or the `error` of an `{ ok: false, error }` result
 *   (Riftbound actions return one, because Next hides thrown messages in
 *   production). Resolves to the action's result, or undefined on failure.
 * - `lastSyncedAt` is the time of the last successful fetch, for
 *   SyncIndicator.
 */
export function useDeckState<S>({
  initial,
  url,
  intervalMs = 2000,
  parse,
}: {
  initial: S;
  /** State endpoint; null disables polling (e.g. mock data). */
  url: string | null;
  intervalMs?: number;
  /** Optional mapping from the endpoint's JSON to S. */
  parse?: (json: unknown) => S;
}) {
  const [state, setState] = useState<S>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number>(() => Date.now());

  // Keep `parse` out of refresh's dependencies so an inline arrow doesn't
  // restart the poll interval on every render.
  const parseRef = useRef(parse);
  useEffect(() => {
    parseRef.current = parse;
  }, [parse]);

  const fetchSeq = useRef(0);
  const refresh = useCallback(async () => {
    if (!url) return;
    const seq = ++fetchSeq.current;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return;
      const json: unknown = await res.json();
      if (seq !== fetchSeq.current) return;
      setState(parseRef.current ? parseRef.current(json) : (json as S));
      setLastSyncedAt(Date.now());
    } catch {
      // Transient network hiccup; the next poll tick recovers.
    }
  }, [url]);

  useEffect(() => {
    if (!url) return;
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [refresh, url, intervalMs]);

  const run = useCallback<DeckRun>(
    <T,>(fn: () => Promise<T>) =>
      new Promise<T | undefined>((resolve) => {
        setError(null);
        startTransition(async () => {
          try {
            const result = await fn();
            const failure = actionFailure(result);
            if (failure !== null) {
              setError(failure);
              resolve(undefined);
              return;
            }
            await refresh();
            resolve(result);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Something went wrong.");
            resolve(undefined);
          }
        });
      }),
    [refresh],
  );

  return { state, setState, pending, error, setError, run, refresh, lastSyncedAt };
}

/** The error message of an `{ ok: false, error }` action result, else null. */
function actionFailure(result: unknown): string | null {
  if (typeof result !== "object" || result === null || !("ok" in result)) return null;
  const r = result as { ok: unknown; error?: unknown };
  if (r.ok !== false) return null;
  return typeof r.error === "string" && r.error ? r.error : "Something went wrong.";
}
