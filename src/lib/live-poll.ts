/**
 * Client-side change-driven polling for the live tournament screens.
 *
 * Every `intervalMs` the screen asks the format's `/rev` endpoint for the
 * tournament's revision, a ~40-byte response, and downloads the full state
 * only when the revision has changed. An admin action shows up on every
 * screen within about one interval, at a fraction of the Neon egress that
 * re-downloading the full state on every tick cost.
 *
 * - The full fetch passes the revision it saw (`&rev=`), and the state
 *   routes key their memo on it, so a memoized body is never older than
 *   the change that prompted the fetch. The `rev` inside the body is read
 *   before the data, and that's what's remembered, so a screen can't mark
 *   itself current with older data.
 * - A full fetch also runs at least every `fullEveryMs` regardless, as a
 *   backstop for anything outside the revision (it also refreshes
 *   `serverNow` for clock offsets).
 * - With `pauseWhenHidden`, nothing is fetched while the tab is hidden, and
 *   a check runs immediately when it becomes visible, regains focus, or
 *   comes back online.
 */
export interface RevisionPollOptions {
  /** The format's /rev URL for this tournament. */
  revUrl: string;
  /** The full-state URL; `rev=<seen>` is appended. */
  stateUrl: string;
  /** Revision check cadence. */
  intervalMs?: number;
  /** Full refresh at least this often, changed or not. */
  fullEveryMs?: number;
  pauseWhenHidden?: boolean;
  /** Run a check straight away instead of after the first interval. */
  immediate?: boolean;
  /** A fresh full state arrived. */
  onState: (json: unknown) => void;
  /** 404 or 401 from either endpoint: authoritatively not available. */
  onGone?: (status: number) => void;
  /** The screen is confirmed current (unchanged revision or a fresh state). */
  onSynced?: () => void;
}

export function startRevisionPoll(o: RevisionPollOptions): () => void {
  const intervalMs = o.intervalMs ?? 2000;
  const fullEveryMs = o.fullEveryMs ?? 60_000;
  let lastRev: string | null | undefined;
  let lastFullAt = 0;
  let busy = false;
  let stopped = false;

  const gone = (status: number) => status === 404 || status === 401;

  async function full(seen: string | null) {
    const sep = o.stateUrl.includes("?") ? "&" : "?";
    const res = await fetch(`${o.stateUrl}${sep}rev=${encodeURIComponent(seen ?? "")}`, { cache: "no-store" });
    if (stopped) return;
    if (res.ok) {
      const json = (await res.json()) as { rev?: string | null };
      if (stopped) return;
      lastRev = json.rev ?? null;
      lastFullAt = Date.now();
      o.onState(json);
      o.onSynced?.();
    } else if (gone(res.status)) {
      lastRev = undefined;
      o.onGone?.(res.status);
    }
    // Anything else is transient: keep the last good state and retry next tick.
  }

  async function tick() {
    if (stopped || busy) return;
    if (o.pauseWhenHidden && document.visibilityState === "hidden") return;
    busy = true;
    try {
      const res = await fetch(o.revUrl, { cache: "no-store" });
      if (stopped) return;
      if (gone(res.status)) {
        lastRev = undefined;
        o.onGone?.(res.status);
        return;
      }
      if (!res.ok) return;
      const { rev } = (await res.json()) as { rev?: string };
      if (stopped) return;
      if (rev && rev === lastRev && Date.now() - lastFullAt < fullEveryMs) {
        o.onSynced?.();
        return;
      }
      await full(rev ?? null);
    } catch {
      // Network hiccup: keep the last good state.
    } finally {
      busy = false;
    }
  }

  const id = window.setInterval(tick, intervalMs);
  const wake = () => {
    if (document.visibilityState === "visible") void tick();
  };
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("focus", wake);
  window.addEventListener("online", wake);
  if (o.immediate) void tick();

  return () => {
    stopped = true;
    window.clearInterval(id);
    document.removeEventListener("visibilitychange", wake);
    window.removeEventListener("focus", wake);
    window.removeEventListener("online", wake);
  };
}
