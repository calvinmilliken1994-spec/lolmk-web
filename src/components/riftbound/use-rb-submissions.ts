"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RbActions } from "./rb-actions";
import {
  rbActiveFor,
  rbApplyOutcome,
  rbClassify,
  rbEnqueue,
  rbLoadQueue,
  rbMarkSending,
  rbSaveQueue,
  type RbSendOutcome,
  type RbSubmission,
} from "./rb-floor-model";

/** How often failed submissions are tried again while the page is open. */
const RETRY_MS = 5000;
/** How long "Sent" stays on screen. */
const SENT_SHOW_MS = 4000;

/**
 * The floor's submission queue: Sending / Sent / Failed, retries with the
 * same idempotency key, and persistence across a refresh.
 *
 * - `submit` adds a submission and sends it. A table can only have one
 *   active submission: a second tap (or a second `submit` for the same table)
 *   returns the first and sends nothing.
 * - `inFlight` is a synchronous guard per key, so two sends of one key can
 *   never overlap even before React re-renders.
 * - A thrown error (offline, server down) leaves the submission `failed`; it
 *   is sent again every few seconds, when the browser comes back online,
 *   and once after a refresh. The key never changes, and the server ignores a
 *   key it already recorded, so a retry after a lost response can't record a
 *   second result.
 * - `{ ok: false }` answers are final: "Reported by …" becomes a `conflict`
 *   notice and anything else a `rejected` one that waits for the judge.
 * - Active submissions live in sessionStorage under the tournament's slug,
 *   written on every change, so a refresh in the middle doesn't lose them.
 */
export function useRbSubmissions({
  slug,
  actions,
  onDelivered,
}: {
  slug: string;
  actions: RbActions;
  /** A result reached the server: refresh the state now. */
  onDelivered?: () => void;
}) {
  const [list, setList] = useState<RbSubmission[]>([]);
  const listRef = useRef<RbSubmission[]>([]);
  const inFlight = useRef(new Set<string>());
  const hydrated = useRef(false);
  const deliveredRef = useRef(onDelivered);
  useEffect(() => {
    deliveredRef.current = onDelivered;
  }, [onDelivered]);

  const update = useCallback(
    (fn: (l: RbSubmission[]) => RbSubmission[]) => {
      listRef.current = fn(listRef.current);
      setList(listRef.current);
      if (hydrated.current) rbSaveQueue(window.sessionStorage, slug, listRef.current);
    },
    [slug],
  );

  const send = useCallback(
    async (key: string) => {
      if (inFlight.current.has(key)) return;
      const sub = listRef.current.find((s) => s.key === key);
      if (!sub || sub.status === "sent" || sub.status === "conflict") return;
      inFlight.current.add(key);
      update((l) => rbMarkSending(l, key));
      let outcome: RbSendOutcome;
      try {
        const result = await actions.reportResult({
          matchId: sub.matchId,
          ...sub.payload,
          idempotencyKey: sub.key,
        });
        outcome = rbClassify(result);
      } catch (e) {
        outcome = rbClassify(null, e ?? new Error("No connection."));
      } finally {
        inFlight.current.delete(key);
      }
      update((l) => rbApplyOutcome(l, key, outcome));
      if (outcome.kind === "sent") {
        deliveredRef.current?.();
        setTimeout(() => update((l) => l.filter((s) => !(s.key === key && s.status === "sent"))), SENT_SHOW_MS);
      }
    },
    [actions, update],
  );

  const retryFailed = useCallback(() => {
    for (const s of listRef.current) if (s.status === "failed") void send(s.key);
  }, [send]);

  // After a refresh: read the queue back and send what was waiting.
  useEffect(() => {
    const restored = rbLoadQueue(window.sessionStorage, slug);
    hydrated.current = true;
    if (restored.length > 0) {
      update((l) => [...restored.filter((r) => !l.some((x) => x.key === r.key)), ...l]);
      retryFailed();
    }
  }, [slug, update, retryFailed]);

  useEffect(() => {
    const id = setInterval(retryFailed, RETRY_MS);
    window.addEventListener("online", retryFailed);
    return () => {
      clearInterval(id);
      window.removeEventListener("online", retryFailed);
    };
  }, [retryFailed]);

  const submit = useCallback(
    (sub: RbSubmission): RbSubmission => {
      const { list: next, sub: counted, added } = rbEnqueue(listRef.current, sub);
      if (added) {
        update(() => next);
        void send(counted.key);
      }
      return counted;
    },
    [send, update],
  );

  /** Send a failed or rejected submission again (same key). */
  const retry = useCallback(
    (key: string) => {
      void send(key);
    },
    [send],
  );

  /** Give up on a submission (or dismiss a conflict notice). Its key is never reused. */
  const discard = useCallback(
    (key: string) => {
      update((l) => l.filter((s) => s.key !== key));
    },
    [update],
  );

  return { list, submit, retry, discard, activeFor: (matchId: string) => rbActiveFor(list, matchId) };
}
