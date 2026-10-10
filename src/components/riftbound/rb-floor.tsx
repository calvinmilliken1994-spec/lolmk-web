"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDeckState, useNow, type ScorePadScore } from "@/components/control-deck";
import { clockRemainingMs, isTimeCalled } from "@/lib/rb-clock";
import { cn } from "@/lib/utils";
import type { RbJudge } from "@/types/riftbound";
import { rbActions, type RbActions } from "./rb-actions";
import type { RbDeskState } from "./rb-deck-model";
import { RbFloorPad, RbFloorReview, type RbPadDraft } from "./rb-floor-pad";
import {
  rbActiveFor,
  rbDecidedOnTime,
  rbClockOffset,
  rbFloorList,
  rbFloorRound,
  rbJudgeFor,
  rbRangeLabel,
  type RbFloorFilter,
  type RbFloorRow,
  type RbSubmission,
} from "./rb-floor-model";
import { formatClock, kstTime, newDeskKey, resultPhrase } from "./rb-round-model";
import { useRbSubmissions } from "./use-rb-submissions";

type View =
  | { kind: "list" }
  | { kind: "pad"; matchId: string }
  | { kind: "review"; matchId: string; score: ScorePadScore };

const FILTERS: { id: RbFloorFilter; label: string }[] = [
  { id: "mine", label: "Mine" },
  { id: "all", label: "All" },
  { id: "flagged", label: "Flagged" },
];

const sectionLabel = "font-mono text-[11px] tracking-[0.08em] text-ink-muted";

/**
 * /tools/riftbound/[slug]/floor: the judges' phone view. Table list → score
 * pad → review card → Submit, on one page. Each step pushes a history entry,
 * so the phone's Back button goes one step back instead of leaving the page.
 *
 * `actions` and `stateUrl` default to the real server actions and the
 * admin-state route; a test page can pass its own.
 */
export function RbFloor({
  initial,
  adminName,
  actions = rbActions,
  stateUrl,
}: {
  initial: RbDeskState;
  adminName: string;
  actions?: RbActions;
  stateUrl?: string;
}) {
  const slug = initial.tournament.slug;
  const { state, run, pending, error, setError, refresh, lastSyncedAt } = useDeckState<RbDeskState>({
    initial,
    url: stateUrl ?? `/api/rb/admin-state?slug=${encodeURIComponent(slug)}`,
    intervalMs: 2000,
  });
  const subs = useRbSubmissions({ slug, actions, onDelivered: () => void refresh() });

  // Clock: server timestamps, corrected by how far this phone's clock is from the server's.
  const local = useNow(1000);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    setOffset(rbClockOffset(state.serverNow, Date.now()));
  }, [state.serverNow]);
  const now = local === null ? null : local + offset;

  const [navOnline, setNavOnline] = useState(true);
  useEffect(() => {
    setNavOnline(navigator.onLine);
    const up = () => setNavOnline(true);
    const down = () => setNavOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  const online = navOnline && (local === null || local - lastSyncedAt < 8000);

  // Who is judging: matched by name against the roster, else picked once and remembered.
  const judges = state.tournament.config.judges;
  const judgeStoreKey = `rb-floor-judge:${slug}`;
  const [pickedJudge, setPickedJudge] = useState<string | null>(null);
  useEffect(() => {
    try {
      setPickedJudge(window.localStorage.getItem(judgeStoreKey));
    } catch {
      // Storage blocked: the pick just doesn't stick.
    }
  }, [judgeStoreKey]);
  const judge: RbJudge | null = rbJudgeFor(judges, adminName, pickedJudge);
  const needsPick = judges.length > 0 && !rbJudgeFor(judges, adminName, null);

  // Views and history.
  const [stack, setStack] = useState<View[]>([{ kind: "list" }]);
  const view = stack[stack.length - 1];
  const stackLen = useRef(1);
  stackLen.current = stack.length;
  const push = useCallback((v: View) => {
    window.history.pushState({ rbf: stackLen.current }, "");
    setStack((s) => [...s, v]);
  }, []);
  useEffect(() => {
    const onPop = () => {
      const depth = (window.history.state as { rbf?: number } | null)?.rbf ?? 0;
      setStack((s) => s.slice(0, Math.min(s.length, depth + 1)));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const back = useCallback(() => window.history.back(), []);
  const toList = useCallback(() => {
    const n = stackLen.current - 1;
    setStack([{ kind: "list" }]);
    if (n > 0) window.history.go(-n);
  }, []);

  // List controls.
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RbFloorFilter>("mine");
  const [notice, setNotice] = useState<string | null>(null);

  const round = rbFloorRound(state);
  const list = useMemo(
    () => (round ? rbFloorList(state, round, now, { query, filter, judge, adminName }) : null),
    [state, round, now, query, filter, judge, adminName],
  );

  // The pad's settings for the table being scored.
  const [draft, setDraft] = useState<RbPadDraft | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const openPad = (row: RbFloorRow) => {
    if (!round || rbActiveFor(subs.list, row.matchId)) return;
    const match = state.matches.find((m) => m.id === row.matchId);
    if (!match) return;
    setNotice(null);
    setError(null);
    setSubmitted(false);
    setDraft((d) =>
      d && d.matchId === row.matchId
        ? d
        : {
            matchId: row.matchId,
            key: newDeskKey("floor"),
            // On by default once the table is past its end time.
            decidedOnTime: now !== null && isTimeCalled(round, match, now),
            dropA: false,
            dropB: false,
          },
    );
    push({ kind: "pad", matchId: row.matchId });
  };

  // Someone else reported the table while the pad was open: say who, back to the list.
  const viewMatchId = view.kind === "list" ? null : view.matchId;
  useEffect(() => {
    if (!viewMatchId) return;
    const m = state.matches.find((x) => x.id === viewMatchId);
    if (m && m.status === "completed" && !subs.list.some((s) => s.matchId === m.id)) {
      setNotice(`Table ${m.table_number} · Reported by ${m.reported_by_name ?? "someone"} at ${kstTime(m.reported_at ?? Date.now())}.`);
      toList();
    }
  }, [state.matches, viewMatchId, subs.list, toList]);

  const clockMs = round && round.status !== "closed" && now !== null ? clockRemainingMs(round, null, now) : null;
  const clock = round && round.status !== "closed" ? formatClock(clockMs) : "--:--";

  const submit = () => {
    if (view.kind !== "review" || !draft || !round) return;
    const match = state.matches.find((m) => m.id === view.matchId);
    if (!match) return;
    setSubmitted(true); // Synchronous guard against a double tap; the queue also refuses a second submission per table.
    const bestOf = state.tournament.config.bestOf;
    const { gamesA, gamesB, gamesDrawn } = view.score;
    const nameA = state.players.find((p) => p.id === match.player_a_id)?.display_name ?? "A";
    const nameB = state.players.find((p) => p.id === match.player_b_id)?.display_name ?? "B";
    const onTime = rbDecidedOnTime(bestOf, gamesA, gamesB, draft.decidedOnTime);
    const playerActive = (id: string | null) => state.players.find((p) => p.id === id)?.status === "active";
    const sub: RbSubmission = {
      key: draft.key,
      matchId: match.id,
      table: match.table_number,
      label: resultPhrase(nameA, nameB, gamesA, gamesB, onTime),
      payload: {
        gamesA,
        gamesB,
        gamesDrawn,
        decidedOnTime: onTime,
        dropA: draft.dropA && playerActive(match.player_a_id),
        dropB: draft.dropB && playerActive(match.player_b_id),
      },
      status: "sending",
      error: null,
      attempts: 0,
      createdAt: Date.now(),
    };
    subs.submit(sub);
    setDraft(null);
    toList();
  };

  const pad = view.kind !== "list" && round ? state.matches.find((m) => m.id === view.matchId) : undefined;

  return (
    <div className="fixed inset-0 z-[60] bg-base text-ink">
      <div className="mx-auto flex h-full w-full max-w-[480px] flex-col overflow-hidden bg-base font-sans leading-[normal]">
        {view.kind === "list" || !round || !pad || !draft ? (
          <ListView
            state={state}
            adminName={adminName}
            judge={judge}
            judges={judges}
            needsPick={needsPick}
            onPickJudge={(id) => {
              setPickedJudge(id);
              try {
                window.localStorage.setItem(judgeStoreKey, id);
              } catch {
                // Not remembered; fine.
              }
            }}
            round={round}
            list={list}
            clock={clock}
            online={online}
            query={query}
            onQuery={setQuery}
            filter={filter}
            onFilter={setFilter}
            subs={subs.list}
            onRetry={subs.retry}
            onDiscard={subs.discard}
            notice={notice}
            onDismissNotice={() => setNotice(null)}
            error={error}
            onDismissError={() => setError(null)}
            onOpen={openPad}
          />
        ) : view.kind === "pad" ? (
          <RbFloorPad
            state={state}
            round={round}
            match={pad}
            now={now}
            judge={judge}
            adminName={adminName}
            clock={clock}
            draft={draft}
            onDraft={setDraft}
            onBack={back}
            onScore={(score) => push({ kind: "review", matchId: pad.id, score })}
            run={run}
            pending={pending}
            error={error}
            actions={actions}
          />
        ) : (
          <RbFloorReview
            state={state}
            round={round}
            match={pad}
            score={view.score}
            draft={draft}
            adminName={adminName}
            submitted={submitted}
            onBack={back}
            onSubmit={submit}
          />
        )}
      </div>
    </div>
  );
}

function Banner({ children, onDismiss, dismissLabel = "Dismiss" }: { children: React.ReactNode; onDismiss: () => void; dismissLabel?: string }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-3 border border-warning-line bg-warning-surface px-3 text-[13px] text-warning-ink">
      <span className="py-2">{children}</span>
      <button type="button" onClick={onDismiss} className="min-h-11 shrink-0 px-2 text-[13px] text-ink">
        {dismissLabel}
      </button>
    </div>
  );
}

function ListView({
  state,
  adminName,
  judge,
  judges,
  needsPick,
  onPickJudge,
  round,
  list,
  clock,
  online,
  query,
  onQuery,
  filter,
  onFilter,
  subs,
  onRetry,
  onDiscard,
  notice,
  onDismissNotice,
  error,
  onDismissError,
  onOpen,
}: {
  state: RbDeskState;
  adminName: string;
  judge: RbJudge | null;
  judges: RbJudge[];
  needsPick: boolean;
  onPickJudge: (id: string) => void;
  round: ReturnType<typeof rbFloorRound>;
  list: ReturnType<typeof rbFloorList> | null;
  clock: string;
  online: boolean;
  query: string;
  onQuery: (q: string) => void;
  filter: RbFloorFilter;
  onFilter: (f: RbFloorFilter) => void;
  subs: RbSubmission[];
  onRetry: (key: string) => void;
  onDiscard: (key: string) => void;
  notice: string | null;
  onDismissNotice: () => void;
  error: string | null;
  onDismissError: () => void;
  onOpen: (row: RbFloorRow) => void;
}) {
  const t = state.tournament;
  const byMatch = new Map(subs.map((s) => [s.matchId, s]));
  const conflicts = subs.filter((s) => s.status === "conflict");
  const footer = subs.filter((s) => s.status !== "conflict");

  const sub = !round
    ? t.status === "in_progress"
      ? "Waiting for the next round to be published"
      : "The event hasn't started"
    : round.status === "closed"
      ? `Round ${round.number} is closed`
      : `${list?.outstandingTotal ?? 0} of ${list?.total ?? 0} outstanding · ${judge ? `your ${rbRangeLabel(judge)}` : "all tables"}`;

  return (
    <>
      <header className="flex flex-col gap-2.5 border-b border-line-strong bg-surface px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate font-mono text-[12px] uppercase text-ink-secondary">
            {t.name} · Judge · {adminName}
          </span>
          <span className={cn("shrink-0 text-[12px]", online ? "text-ink-muted" : "text-warning-ink")}>● {online ? "Online" : "Offline"}</span>
        </div>
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="font-heading text-[22px] font-semibold">{round ? `Round ${round.number}` : "Floor"}</p>
            <p className="mt-0.5 text-[13px] text-ink-secondary">{sub}</p>
          </div>
          <span className="font-display text-[52px] leading-[0.9] tabular-nums">{clock}</span>
        </div>
      </header>

      <div className="flex flex-col gap-2.5 border-b border-line px-4 py-3">
        <label htmlFor="rb-floor-find" className="text-[12px] text-ink-secondary">
          Find table or player
        </label>
        <input
          id="rb-floor-find"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="e.g. 7 or Mina"
          autoComplete="off"
          autoCorrect="off"
          enterKeyHint="search"
          className="h-[46px] rounded-sm border border-line-strong bg-surface px-3 text-[16px] text-ink placeholder:text-ink-disabled"
        />
        <div className="grid grid-cols-3 gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => onFilter(f.id)}
              className={cn(
                "h-11 rounded-sm border text-[13px]",
                filter === f.id ? "border-brand-blue-bright bg-elevated text-ink" : "border-line-strong bg-transparent text-ink-secondary",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        {needsPick && (
          <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">
            You&apos;re not on the judge roster. Judging as
            <select
              value=""
              onChange={(e) => e.target.value && onPickJudge(e.target.value)}
              className="h-11 rounded-sm border border-line-strong bg-surface px-3 text-[16px] text-ink"
            >
              <option value="">All tables</option>
              {judges.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name} · {rbRangeLabel(j)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-3">
        {notice && <Banner onDismiss={onDismissNotice}>{notice}</Banner>}
        {conflicts.map((s) => (
          <Banner key={s.key} onDismiss={() => onDiscard(s.key)}>
            Table {s.table} · {s.error}
          </Banner>
        ))}
        {error && <Banner onDismiss={onDismissError}>{error}</Banner>}

        {!list && <p className="py-6 text-center text-[14px] text-ink-muted">Nothing to report yet.</p>}

        {list && (
          <>
            <p className={sectionLabel}>OUTSTANDING</p>
            {list.outstanding.length === 0 && (
              <p className="py-3 text-[14px] text-ink-muted">
                {query ? "No outstanding table matches." : filter === "flagged" ? "No flagged tables." : "No outstanding tables."}
              </p>
            )}
            {list.outstanding.map((row) => (
              <OutstandingRow key={row.matchId} row={row} sub={byMatch.get(row.matchId)} onOpen={() => onOpen(row)} />
            ))}

            <p className={cn(sectionLabel, "mt-2")}>REPORTED</p>
            {list.reported.length === 0 && <p className="py-3 text-[14px] text-ink-muted">{query ? "No reported table matches." : "Nothing reported yet."}</p>}
            {list.reported.map((row) => (
              <div key={row.matchId} className="flex min-h-[50px] items-center gap-3 border border-line px-3 text-ink-secondary">
                <span className="w-11 shrink-0 font-mono text-[18px]">{row.table}</span>
                <span className="min-w-0 flex-1 text-[14px]">{row.line}</span>
                <span className="text-[12px] text-success-ink">✓</span>
              </div>
            ))}
          </>
        )}
      </div>

      {footer.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-line-strong bg-deck-rail px-4 py-2" aria-live="polite">
          {footer.map((s) => (
            <SubmissionRow key={s.key} sub={s} onRetry={() => onRetry(s.key)} onDiscard={() => onDiscard(s.key)} />
          ))}
        </div>
      )}
    </>
  );
}

function OutstandingRow({ row, sub, onOpen }: { row: RbFloorRow; sub: RbSubmission | undefined; onOpen: () => void }) {
  const flagged = row.kind === "flagged";
  const badge = sub ? (sub.status === "sending" ? "Sending…" : sub.status === "failed" ? "Waiting to send" : "Not sent") : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!!sub}
      data-table={row.table}
      className={cn(
        "flex min-h-[66px] w-full items-center gap-3 rounded-sm border px-3 text-left disabled:opacity-70",
        flagged ? "border-warning-line bg-warning-tile" : "border-line-strong bg-deck-tile",
      )}
    >
      <span className="w-11 shrink-0 font-mono text-[26px] font-semibold">{row.table}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[16px]">
          {row.nameA} <span className="text-ink-muted">vs</span> {row.nameB}
        </span>
        <span
          className={cn(
            "truncate text-[12px]",
            flagged ? "text-warning-ink" : row.kind === "over_time" ? "text-brand-red-bright" : row.mine ? "text-ink-secondary" : "text-ink-muted",
          )}
        >
          {row.line}
        </span>
      </span>
      {badge ? <span className="shrink-0 text-[12px] text-warning-ink">{badge}</span> : <span className="text-[20px] text-ink-muted">›</span>}
    </button>
  );
}

function SubmissionRow({ sub, onRetry, onDiscard }: { sub: RbSubmission; onRetry: () => void; onDiscard: () => void }) {
  const status =
    sub.status === "sending"
      ? "Sending…"
      : sub.status === "sent"
        ? "Sent ✓"
        : sub.status === "failed"
          ? "Failed · will retry"
          : "Rejected";
  return (
    <div className="flex min-h-11 items-center gap-2 text-[13px]" data-status={sub.status}>
      <div className="min-w-0 flex-1">
        <p className="truncate">
          <span className="font-mono">T{sub.table}</span> · {sub.label}
        </p>
        <p
          className={cn(
            "truncate text-[12px]",
            sub.status === "sent" ? "text-success-ink" : sub.status === "sending" ? "text-ink-secondary" : "text-warning-ink",
          )}
        >
          {status}
          {sub.error && sub.status !== "sent" ? ` · ${sub.error}` : ""}
        </p>
      </div>
      {(sub.status === "failed" || sub.status === "rejected") && (
        <>
          <button type="button" onClick={onRetry} className="h-11 rounded-sm border border-line-strong bg-elevated px-3 text-[13px]">
            Retry
          </button>
          <button type="button" onClick={onDiscard} className="h-11 px-2 text-[13px] text-ink-secondary">
            Discard
          </button>
        </>
      )}
    </div>
  );
}
