"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  Coffee,
  Maximize,
  Minimize,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings,
  Trophy,
} from "lucide-react";
import type { TimerSegment } from "@/types/timer";
import { cn } from "@/lib/utils";
import { TimerBackground } from "@/components/sections/timer-background";
import type { TimerBackgroundId } from "@/lib/timer-schedule";

export const STORAGE_KEY = "lolmk-poro-cup-timer-v2";
const MINUTE = 60_000;
const WARNING_MS = 5 * MINUTE; // amber-ish urgency
const URGENT_MS = 60_000; // final minute

export type TimerState = {
  index: number;
  /** The segment's scheduled length — what Reset returns to, unaffected by +/- adjustments. */
  baseDurationMs: number;
  durationMs: number;
  remainingMs: number;
  running: boolean;
  /** Wall-clock ms when the round hits 00:00. Null while paused. */
  endsAt: number | null;
};

/**
 * Treat localStorage as untrusted input. A partial shape check is not enough:
 * NaN, negative durations, fractional/out-of-range indexes, or an inconsistent
 * running/endsAt pair can otherwise hydrate into a broken clock indefinitely.
 */
export function validatePersistedTimerState(
  value: unknown,
  schedule: TimerSegment[],
  now = Date.now(),
): TimerState | null {
  if (!value || typeof value !== "object") return null;
  const saved = value as Record<string, unknown>;
  const index = saved.index;
  if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= schedule.length) {
    return null;
  }

  const segment = schedule[index as number];
  const baseDurationMs = saved.baseDurationMs;
  const durationMs = saved.durationMs;
  const remainingMs = saved.remainingMs;
  const running = saved.running;
  const endsAt = saved.endsAt;

  if (
    typeof baseDurationMs !== "number" ||
    !Number.isFinite(baseDurationMs) ||
    baseDurationMs !== segment.minutes * MINUTE ||
    typeof durationMs !== "number" ||
    !Number.isFinite(durationMs) ||
    durationMs < 0 ||
    typeof remainingMs !== "number" ||
    !Number.isFinite(remainingMs) ||
    remainingMs < 0 ||
    remainingMs > durationMs ||
    typeof running !== "boolean"
  ) {
    return null;
  }

  if (running) {
    if (
      typeof endsAt !== "number" ||
      !Number.isFinite(endsAt) ||
      endsAt < 0 ||
      endsAt > now + durationMs
    ) {
      return null;
    }
  } else if (endsAt !== null) {
    return null;
  }

  return { index: index as number, baseDurationMs, durationMs, remainingMs, running, endsAt };
}

type Action =
  | { type: "toggle"; now: number }
  | { type: "tick"; now: number }
  | { type: "reset" }
  | { type: "select"; index: number; minutes: number }
  | { type: "adjust"; deltaMs: number; now: number }
  | { type: "hydrate"; state: TimerState };

function reducer(state: TimerState, action: Action): TimerState {
  switch (action.type) {
    case "toggle": {
      if (state.running) {
        const rem = Math.max(0, (state.endsAt ?? action.now) - action.now);
        return { ...state, running: false, endsAt: null, remainingMs: rem };
      }
      if (state.remainingMs <= 0) return state;
      return {
        ...state,
        running: true,
        endsAt: action.now + state.remainingMs,
      };
    }
    case "tick": {
      if (!state.running || state.endsAt == null) return state;
      const rem = Math.max(0, state.endsAt - action.now);
      if (rem <= 0) {
        return { ...state, running: false, endsAt: null, remainingMs: 0 };
      }
      return { ...state, remainingMs: rem };
    }
    case "reset":
      return {
        ...state,
        running: false,
        endsAt: null,
        durationMs: state.baseDurationMs,
        remainingMs: state.baseDurationMs,
      };
    case "select": {
      const durationMs = action.minutes * MINUTE;
      return {
        index: action.index,
        baseDurationMs: durationMs,
        durationMs,
        remainingMs: durationMs,
        running: false,
        endsAt: null,
      };
    }
    case "adjust": {
      // Shift durationMs by the same delta as remainingMs so the elapsed
      // portion (and therefore the progress bar fill) doesn't move just
      // because the round's total length changed.
      if (state.running && state.endsAt != null) {
        const currentRemaining = Math.max(0, state.endsAt - action.now);
        const remainingMs = Math.max(0, currentRemaining + action.deltaMs);
        const durationMs = Math.max(remainingMs, state.durationMs + action.deltaMs);
        return { ...state, endsAt: action.now + remainingMs, remainingMs, durationMs };
      }
      const remainingMs = Math.max(0, state.remainingMs + action.deltaMs);
      const durationMs = Math.max(remainingMs, state.durationMs + action.deltaMs);
      return { ...state, remainingMs, durationMs };
    }
    case "hydrate":
      return action.state;
    default:
      return state;
  }
}

function initState(schedule: TimerSegment[]): TimerState {
  const durationMs = schedule[0].minutes * MINUTE;
  return {
    index: 0,
    baseDurationMs: durationMs,
    durationMs,
    remainingMs: durationMs,
    running: false,
    endsAt: null,
  };
}

/** Ceil to the second so a fresh 60-minute round reads "60:00", not "59:59". */
function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

type Urgency = "normal" | "warning" | "urgent" | "done";

function urgencyFor(ms: number): Urgency {
  if (ms <= 0) return "done";
  if (ms <= URGENT_MS) return "urgent";
  if (ms <= WARNING_MS) return "warning";
  return "normal";
}

export function TournamentTimer({
  schedule,
  title,
  background,
  onEditSetup,
}: {
  schedule: TimerSegment[];
  title: string;
  background: TimerBackgroundId;
  onEditSetup?: () => void;
}) {
  const [state, dispatch] = useReducer(reducer, schedule, initState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const [hydrated, setHydrated] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const seg = schedule[state.index] ?? schedule[0];
  const urgency = urgencyFor(state.remainingMs);
  const consumed =
    state.durationMs > 0
      ? Math.min(1, Math.max(0, 1 - state.remainingMs / state.durationMs))
      : 0;

  // ---- Actions (stable; read latest state via stateRef) -------------------
  const toggle = useCallback(() => dispatch({ type: "toggle", now: Date.now() }), []);
  const reset = useCallback(() => dispatch({ type: "reset" }), []);
  const adjust = useCallback(
    (deltaMs: number) => dispatch({ type: "adjust", deltaMs, now: Date.now() }),
    [],
  );
  const selectSegment = useCallback(
    (index: number) => {
      const target = schedule[index];
      if (!target) return;
      dispatch({ type: "select", index, minutes: target.minutes });
    },
    [schedule],
  );
  const goNext = useCallback(
    () => selectSegment(Math.min(schedule.length - 1, stateRef.current.index + 1)),
    [schedule, selectSegment],
  );
  const goPrev = useCallback(
    () => selectSegment(Math.max(0, stateRef.current.index - 1)),
    [schedule, selectSegment],
  );

  const toggleFullscreen = useCallback(() => {
    if (typeof document === "undefined") return;
    if (!document.fullscreenElement) {
      rootRef.current?.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  // ---- Hydrate persisted state on mount -----------------------------------
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = validatePersistedTimerState(JSON.parse(raw), schedule);
        if (saved) {
          const now = Date.now();
          let next: TimerState;
          if (saved.running) {
            // Validation guarantees a finite endsAt for running state.
            const rem = Math.max(0, saved.endsAt! - now);
            next = rem <= 0
              ? { ...saved, running: false, endsAt: null, remainingMs: 0 }
              : { ...saved, remainingMs: rem };
          } else {
            next = saved;
          }
          dispatch({ type: "hydrate", state: next });
        }
      }
    } catch {
      /* corrupt or unavailable storage — fall back to defaults */
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Persist -------------------------------------------------------------
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state, hydrated]);

  // ---- Ticking -------------------------------------------------------------
  useEffect(() => {
    if (!state.running) return;
    const tick = () => dispatch({ type: "tick", now: Date.now() });
    const id = window.setInterval(tick, 200);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [state.running]);

  // ---- Lock background scroll while the display owns the screen ------------
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // ---- Fullscreen state ----------------------------------------------------
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // ---- Keyboard shortcuts --------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      switch (e.code) {
        case "Space":
          e.preventDefault();
          toggle();
          break;
        case "KeyR":
          reset();
          break;
        case "ArrowRight":
          e.preventDefault();
          goNext();
          break;
        case "ArrowLeft":
          e.preventDefault();
          goPrev();
          break;
        case "KeyF":
          toggleFullscreen();
          break;
        case "Equal":
        case "NumpadAdd":
          adjust(MINUTE);
          break;
        case "Minus":
        case "NumpadSubtract":
          adjust(-MINUTE);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, reset, goNext, goPrev, toggleFullscreen, adjust]);

  const clock = formatClock(state.remainingMs);
  const numberColor =
    urgency === "done" || urgency === "urgent"
      ? "text-brand-red-bright"
      : "text-ink";
  const numberGlow =
    urgency === "done" || urgency === "urgent"
      ? "drop-shadow-[0_0_45px_rgba(233,69,96,0.35)]"
      : "drop-shadow-[0_0_60px_rgba(10,14,26,0)]";

  const status = getStatus(state.running, state.remainingMs, state.durationMs);

  const indexed = schedule.map((s, i) => ({ seg: s, i }));
  // Group by contiguous runs of the same phase, in schedule order, so
  // multiple intermissions render at their real position on the rail
  // instead of every break clumping together after all round chips.
  type Group = { phase: TimerSegment["phase"]; items: typeof indexed };
  const groups: Group[] = [];
  for (const item of indexed) {
    const last = groups[groups.length - 1];
    if (last && last.phase === item.seg.phase) {
      last.items.push(item);
    } else {
      groups.push({ phase: item.seg.phase, items: [item] });
    }
  }

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[60] overflow-y-auto overflow-x-hidden bg-base text-ink"
    >
      {/* Ambient brand light, matching the tournament hero treatment. */}
      <div aria-hidden className="grain pointer-events-none absolute inset-0" />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[22%] h-[55vh] w-[80vw] max-w-[1200px] -translate-x-1/2 rounded-full bg-brand-red/10 blur-[130px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 bottom-0 h-[55vh] w-[45vw] rounded-full bg-brand-blue/12 blur-[130px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 -top-24 h-[45vh] w-[40vw] rounded-full bg-brand-blue/10 blur-[130px]"
      />
      <TimerBackground backgroundId={background} />

      <div className="relative flex min-h-full flex-col px-5 py-5 sm:px-8 md:px-12 md:py-7">
        {/* Utility row */}
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="group inline-flex items-center gap-2.5 text-ink-muted transition-colors hover:text-ink"
            aria-label="Back to lolmk.gg"
          >
            <span className="font-mono text-body-sm tracking-tight">lolmk.gg</span>
          </Link>
          <div className="flex items-center gap-2.5">
            {onEditSetup && (
              <button
                type="button"
                onClick={onEditSetup}
                className="inline-flex items-center gap-2 rounded-md border border-line-strong px-3.5 py-2 text-label uppercase text-ink-secondary transition-colors hover:border-brand-red hover:text-ink"
                aria-label="Edit tournament setup"
              >
                <Settings strokeWidth={1.75} className="h-4 w-4" />
                <span className="hidden sm:inline">Setup</span>
              </button>
            )}
            <button
              type="button"
              onClick={toggleFullscreen}
              className="inline-flex items-center gap-2 rounded-md border border-line-strong px-3.5 py-2 text-label uppercase text-ink-secondary transition-colors hover:border-brand-red hover:text-ink"
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              {isFullscreen ? (
                <Minimize strokeWidth={1.75} className="h-4 w-4" />
              ) : (
                <Maximize strokeWidth={1.75} className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">{isFullscreen ? "Exit" : "Fullscreen"}</span>
            </button>
          </div>
        </div>

        {/* Event identity */}
        <header className="mt-3 flex flex-col items-center gap-2 text-center sm:mt-5">
          <h1 className="font-display text-[clamp(2.25rem,6vw,5rem)] leading-[0.9] tracking-[0.02em] text-ink">
            {title}
          </h1>
        </header>

        {/* Timer core */}
        <div className="flex flex-1 flex-col items-center justify-center gap-7 py-6 sm:gap-9">
          <div className="flex w-full flex-col items-center gap-4 sm:gap-5">
            {/* The clock */}
            <div
              role="timer"
              aria-label={`${clock} remaining in ${seg.title}`}
              className={cn(
                "flex max-w-full items-center justify-center font-display leading-[0.75] tabular tracking-[0.01em] transition-colors duration-300",
                "text-[clamp(3rem,16vw,21rem)]",
                numberColor,
                numberGlow,
                urgency === "done" && "motion-safe:animate-time-flash",
              )}
            >
              {clock.split("").map((ch, i) => (
                <span
                  key={i}
                  aria-hidden
                  className="inline-flex justify-center leading-[0.75]"
                  style={{ width: ch === ":" ? "0.34em" : "0.62em" }}
                >
                  {ch}
                </span>
              ))}
            </div>

            {/* Round + status */}
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
              {seg.phase === "topcut" && (
                <span className="rounded-sm bg-brand-blue-muted px-2.5 py-1 text-label uppercase text-brand-blue-bright">
                  Top Cut
                </span>
              )}
              <span className="font-display text-[clamp(2rem,4.5vw,3.75rem)] leading-none tracking-[0.03em] text-ink">
                {seg.title}
              </span>
              <StatusPill status={status} running={state.running} />
            </div>

            {/* Progress */}
            <div className="h-2.5 w-full max-w-[1180px] overflow-hidden rounded-full bg-line-subtle">
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-200 ease-linear",
                  urgency === "urgent" || urgency === "done"
                    ? "bg-brand-red-bright"
                    : urgency === "warning"
                      ? "bg-warning"
                      : "bg-brand-red",
                )}
                style={{ width: `${consumed * 100}%` }}
              />
            </div>
          </div>

          {/* Controls */}
          <div className="flex w-full max-w-md flex-col items-center gap-3 sm:w-auto sm:max-w-none sm:flex-row sm:gap-3.5">
            {/* Primary transport */}
            <div className="flex w-full items-center justify-center gap-3 sm:w-auto sm:gap-3.5">
              <button
                type="button"
                onClick={toggle}
                disabled={state.remainingMs <= 0}
                className={cn(
                  "inline-flex min-w-0 flex-1 items-center justify-center gap-2.5 rounded-md px-6 py-4 text-body-lg font-bold uppercase tracking-[0.06em] transition-colors duration-150 ease-out-soft sm:min-w-[9.5rem] sm:flex-none sm:px-9",
                  "bg-brand-red text-ink hover:bg-brand-red-hover active:bg-brand-red-muted",
                  "disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-disabled",
                )}
              >
                {state.running ? (
                  <>
                    <Pause strokeWidth={2} className="h-5 w-5 fill-current" />
                    Pause
                  </>
                ) : (
                  <>
                    <Play strokeWidth={2} className="h-5 w-5 fill-current" />
                    Start
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={reset}
                className="inline-flex min-w-0 flex-1 items-center justify-center gap-2.5 rounded-md border border-line-strong px-5 py-4 text-body-lg font-bold uppercase tracking-[0.06em] text-ink transition-colors duration-150 ease-out-soft hover:border-brand-red sm:flex-none sm:px-7"
              >
                <RotateCcw strokeWidth={2} className="h-5 w-5" />
                Reset
              </button>
            </div>

            {/* Minute adjust */}
            <div className="flex items-center justify-center gap-3 sm:gap-3.5">
              <IconButton
                onClick={() => adjust(-MINUTE)}
                label="Subtract one minute"
                disabled={state.remainingMs <= 0 && !state.running}
              >
                <Minus strokeWidth={2} className="h-4 w-4" />
                <span className="tabular">1:00</span>
              </IconButton>
              <IconButton onClick={() => adjust(MINUTE)} label="Add one minute">
                <Plus strokeWidth={2} className="h-4 w-4" />
                <span className="tabular">1:00</span>
              </IconButton>
            </div>
          </div>
        </div>

        {/* Schedule rail */}
        <div className="flex flex-col items-center gap-5">
          <div className="flex flex-wrap items-end justify-center gap-x-4 gap-y-5 sm:gap-x-8">
            {groups.map((group, gi) => (
              <div key={group.items[0].seg.id} className="flex items-end gap-4 sm:gap-8">
                <div className="flex flex-col items-center gap-2.5">
                  <div className="flex items-center gap-2 sm:gap-2.5">
                    {group.items.map(({ seg: s, i }) => (
                      <SegmentChip
                        key={s.id}
                        segment={s}
                        state={i === state.index ? "active" : i < state.index ? "done" : "upcoming"}
                        onSelect={() => selectSegment(i)}
                      />
                    ))}
                  </div>
                  <span className="uppercase text-ink-muted text-[0.6rem] tracking-[0.12em] sm:text-label sm:tracking-[0.18em]">
                    {phaseCaption(group.phase, group.items.map((x) => x.seg))}
                  </span>
                </div>
                {gi < groups.length - 1 && (
                  <div aria-hidden className="mb-7 hidden h-12 w-px bg-line lg:block" />
                )}
              </div>
            ))}
          </div>

          <p className="hidden flex-wrap items-center justify-center gap-x-5 gap-y-1 text-center text-caption uppercase tracking-[0.14em] text-ink-muted md:flex">
            <Shortcut keyLabel="Space">start / pause</Shortcut>
            <Shortcut keyLabel="R">reset</Shortcut>
            <Shortcut keyLabel="← →">change round</Shortcut>
            <Shortcut keyLabel="± ">adjust minute</Shortcut>
            <Shortcut keyLabel="F">fullscreen</Shortcut>
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

type Status = { label: string; tone: "live" | "paused" | "ready" | "done" };

function getStatus(running: boolean, remainingMs: number, durationMs: number): Status {
  if (remainingMs <= 0) return { label: "Time", tone: "done" };
  if (running) return { label: "Live", tone: "live" };
  if (remainingMs < durationMs) return { label: "Paused", tone: "paused" };
  return { label: "Ready", tone: "ready" };
}

function StatusPill({ status, running }: { status: Status; running: boolean }) {
  const tone: Record<Status["tone"], string> = {
    live: "bg-brand-red-muted text-brand-red-bright",
    done: "bg-danger/20 text-danger",
    paused: "bg-elevated text-ink-secondary",
    ready: "bg-elevated text-ink-muted",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-sm px-2.5 py-1 text-label uppercase",
        tone[status.tone],
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-1.5 w-1.5 rounded-full bg-current",
          running && "motion-safe:animate-pulse-dot",
        )}
      />
      {status.label}
    </span>
  );
}

function SegmentChip({
  segment,
  state,
  onSelect,
}: {
  segment: TimerSegment;
  state: "active" | "done" | "upcoming";
  onSelect: () => void;
}) {
  const isBreak = segment.kind === "break";
  const isFinal = segment.kind === "final";

  const classes = chipClasses(segment.kind, state);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={state === "active" ? "true" : undefined}
      aria-label={`${segment.title}${state === "done" ? " — done" : ""}`}
      className={cn(
        "relative flex h-14 flex-col items-center justify-center gap-0.5 rounded-sm border px-2 transition-colors duration-150 ease-out-soft sm:h-[3.75rem] sm:px-3",
        isBreak ? "w-[4.25rem] sm:w-[5.25rem]" : "w-11 sm:w-[3.75rem]",
        classes,
      )}
    >
      {isBreak ? (
        <>
          <Coffee strokeWidth={1.75} className="h-5 w-5" />
          <span className="text-[0.55rem] font-semibold uppercase tracking-[0.14em] sm:text-[0.6rem] sm:tracking-[0.16em]">
            Break
          </span>
        </>
      ) : (
        <>
          {isFinal && (
            <Trophy strokeWidth={1.75} className="absolute right-1 top-1 h-3 w-3 opacity-80" />
          )}
          <span className="font-display text-[1.65rem] leading-none tracking-[0.02em] sm:text-[2rem]">
            {segment.short}
          </span>
          {isFinal && (
            <span className="text-[0.5rem] font-bold uppercase tracking-[0.14em] sm:text-[0.55rem] sm:tracking-[0.16em]">
              Final
            </span>
          )}
        </>
      )}
    </button>
  );
}

function chipClasses(kind: TimerSegment["kind"], state: "active" | "done" | "upcoming"): string {
  if (state === "active") {
    if (kind === "break") return "border-transparent bg-brand-blue text-ink";
    return "border-transparent bg-brand-red text-ink";
  }
  if (state === "done") {
    return "border-line-subtle text-ink-disabled hover:border-line hover:text-ink-muted";
  }
  // upcoming
  if (kind === "break") {
    return "border-brand-blue bg-brand-blue-muted text-brand-blue-bright hover:border-brand-blue-bright";
  }
  if (kind === "final") {
    return "border-brand-red-muted text-brand-red-bright hover:border-brand-red";
  }
  return "border-line text-ink-secondary hover:border-line-strong hover:text-ink";
}

function IconButton({
  onClick,
  label,
  disabled,
  children,
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="inline-flex items-center gap-1.5 rounded-md border border-line-strong px-4 py-4 text-body-sm font-semibold text-ink-secondary transition-colors duration-150 ease-out-soft hover:border-brand-red hover:text-ink disabled:cursor-not-allowed disabled:border-line disabled:text-ink-disabled"
    >
      {children}
    </button>
  );
}

function Shortcut({ keyLabel, children }: { keyLabel: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <kbd className="rounded-sm border border-line bg-surface px-1.5 py-0.5 font-mono text-[0.65rem] not-italic text-ink-secondary">
        {keyLabel}
      </kbd>
      <span>{children}</span>
    </span>
  );
}

function phaseCaption(phase: TimerSegment["phase"], items: TimerSegment[]): string {
  if (phase === "break") return "Intermission";
  if (phase === "topcut") return "Top Cut";
  const nums = items.map((s) => s.short);
  return nums.length > 1 ? `Rounds ${nums[0]}–${nums[nums.length - 1]}` : `Round ${nums[0]}`;
}
