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
 * - `lastSyncedAt` is the time the desk was last confirmed current (a fresh
 *   state, or a revision check that found nothing new), for SyncIndicator.
 * - With `revUrl`, each background tick fetches only the tournament's
 *   revision (~40 bytes, see `@/lib/live-revision`) and downloads the full
 *   state only when it changed, or at least once a minute as a backstop.
 *   Ticks pause while the tab is hidden, and a check runs immediately when
 *   it's shown again, refocused or back online. Actions still refresh the
 *   full state immediately, so the desk feels exactly as before.
 */
export function useDeckState<S>({
  initial,
  url,
  intervalMs = 2000,
  parse,
  revUrl = null,
}: {
  initial: S;
  /** State endpoint; null disables polling (e.g. mock data). */
  url: string | null;
  intervalMs?: number;
  /** Optional mapping from the endpoint's JSON to S. */
  parse?: (json: unknown) => S;
  /** Revision endpoint; when set, background ticks only download on change. */
  revUrl?: string | null;
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
  // Revision of the state on screen (read server-side before the data, so
  // it's never newer than it) and when it was fetched.
  const shownRev = useRef<string | null>(null);
  const fullAt = useRef(0);
  const refresh = useCallback(async () => {
    if (!url) return;
    const seq = ++fetchSeq.current;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return;
      const json: unknown = await res.json();
      if (seq !== fetchSeq.current) return;
      const rev = (json as { rev?: unknown } | null)?.rev;
      shownRev.current = typeof rev === "string" ? rev : null;
      fullAt.current = Date.now();
      setState(parseRef.current ? parseRef.current(json) : (json as S));
      setLastSyncedAt(Date.now());
    } catch {
      // Transient network hiccup; the next poll tick recovers.
    }
  }, [url]);

  useEffect(() => {
    if (!url) return;
    if (!revUrl) {
      const id = setInterval(refresh, intervalMs);
      return () => clearInterval(id);
    }
    let busy = false;
    const tick = async () => {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      try {
        const seq = fetchSeq.current;
        const res = await fetch(revUrl, { cache: "no-store" });
        if (!res.ok) return;
        const { rev } = (await res.json()) as { rev?: string };
        const fresh = Date.now() - fullAt.current < BACKSTOP_MS;
        if (rev && rev === shownRev.current && fresh) {
          // Nothing new. Only claim "synced" if no newer fetch started meanwhile.
          if (seq === fetchSeq.current) setLastSyncedAt(Date.now());
          return;
        }
        await refresh();
      } catch {
        // Transient network hiccup; the next tick recovers.
      } finally {
        busy = false;
      }
    };
    const id = setInterval(tick, intervalMs);
    const wake = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
    };
  }, [refresh, url, revUrl, intervalMs]);

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

/** With `revUrl`, download the full state at least this often regardless. */
const BACKSTOP_MS = 60_000;

/** The error message of an `{ ok: false, error }` action result, else null. */
function actionFailure(result: unknown): string | null {
  if (typeof result !== "object" || result === null || !("ok" in result)) return null;
  const r = result as { ok: unknown; error?: unknown };
  if (r.ok !== false) return null;
  return typeof r.error === "string" && r.error ? r.error : "Something went wrong.";
}
