"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { DeckPrimaryAction } from "./types";

/** Mono section label: PHASES, ACTIVITY, BROADCAST. */
export function DeckKicker({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("font-mono text-[11px] tracking-[0.08em] text-ink-muted", className)}>{children}</p>;
}

/** Red dot + "ON AIR" + the program scene's name. */
export function OnAirChip({ sceneLabel }: { sceneLabel: string }) {
  return (
    <div className="flex items-center gap-2 border border-brand-red bg-onair-surface px-2.5 py-1.5">
      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-brand-red-bright" />
      <span className="font-mono text-[12px] font-semibold tracking-[0.06em]">ON AIR</span>
      <span className="text-[13px] text-ink">{sceneLabel}</span>
    </div>
  );
}

const STALE_AFTER_MS = 10_000;

/** "● Synced Ns ago"; turns warning ink after 10s without a successful poll. */
export function SyncIndicator({ lastSyncedAt }: { lastSyncedAt: number }) {
  // `now` starts null so server and client render the same text; the
  // interval takes over after hydration.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const ageMs = now === null ? 0 : Math.max(0, now - lastSyncedAt);
  const stale = ageMs > STALE_AFTER_MS;
  return (
    <span
      role="status"
      className={cn("whitespace-nowrap text-[12px]", stale ? "text-warning-ink" : "text-ink-muted")}
    >
      ● Synced {ageLabel(ageMs)}
    </span>
  );
}

function ageLabel(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

/**
 * The single next step. Blocked: primary-disabled styling and the reason
 * underneath in warning ink. Enabled: brand red, optional neutral hint.
 */
export function PrimaryAction({
  action,
  pending = false,
  onRun,
}: {
  action: DeckPrimaryAction | null;
  pending?: boolean;
  onRun: (action: DeckPrimaryAction) => void;
}) {
  if (!action) return null;
  const blocked = !action.enabled;
  const note = blocked ? action.reason : action.hint;
  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        type="button"
        disabled={blocked || pending}
        onClick={() => onRun(action)}
        className={cn(
          "h-11 rounded-sm border px-5 font-heading text-[15px] font-semibold",
          blocked
            ? "cursor-not-allowed border-brand-red-muted bg-primary-disabled text-primary-disabled-ink"
            : "border-brand-red bg-brand-red text-ink hover:bg-brand-red-hover disabled:cursor-wait",
        )}
      >
        {action.label}
      </button>
      {note && <span className={cn("text-[12px]", blocked ? "text-warning-ink" : "text-ink-muted")}>{note}</span>}
    </div>
  );
}

/** Warning strip with an Acknowledge button (judge calls, disputes). */
export function AlertStrip({
  label = "ALERT",
  children,
  onAcknowledge,
  pending = false,
}: {
  label?: string;
  children: ReactNode;
  onAcknowledge?: () => void;
  pending?: boolean;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-2.5 border border-warning-line-quiet bg-warning-surface-strong px-3 py-2.5"
    >
      <span className="font-mono text-[11px] font-semibold text-warning-ink">{label}</span>
      <span className="flex-[1_1_240px] text-[13px]">{children}</span>
      {onAcknowledge && (
        <button
          type="button"
          disabled={pending}
          onClick={onAcknowledge}
          className="h-7 rounded-sm border border-warning-line-quiet bg-transparent px-2.5 text-[12px] text-ink disabled:opacity-50"
        >
          Acknowledge
        </button>
      )}
    </div>
  );
}

export interface ActivityEntry {
  id: string;
  /** Epoch ms or ISO string. */
  at: number | string;
  actor: string;
  text: string;
  /** Can be undone from the log (result reports, unpublish, drops). */
  reversible?: boolean;
}

const TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Seoul",
});

/**
 * Newest first. Undo appears only on the newest reversible entry, so the
 * desk can't unwind history out of order.
 */
export function ActivityLog({
  entries,
  onUndo,
  pending = false,
  className,
}: {
  entries: ActivityEntry[];
  onUndo?: (entry: ActivityEntry) => void;
  pending?: boolean;
  className?: string;
}) {
  const sorted = [...entries].sort((a, b) => toMs(b.at) - toMs(a.at));
  const undoId = onUndo ? sorted.find((e) => e.reversible)?.id : undefined;
  return (
    <section className={cn("border-t border-line pt-3", className)}>
      <DeckKicker className="mb-2">ACTIVITY</DeckKicker>
      <div className="flex flex-col gap-1">
        {sorted.map((entry) => (
          <div key={entry.id} className="flex min-h-7 items-center gap-3 text-[13px]">
            <span className="w-11 shrink-0 font-mono text-[12px] text-ink-muted">{TIME_FORMAT.format(toMs(entry.at))}</span>
            <span className="w-[52px] shrink-0 truncate text-ink-secondary">{entry.actor}</span>
            <span className="flex-auto">{entry.text}</span>
            {entry.id === undoId && (
              <button
                type="button"
                disabled={pending}
                onClick={() => onUndo?.(entry)}
                className="h-[26px] rounded-sm border border-line-strong bg-transparent px-2.5 text-[12px] text-link disabled:opacity-50"
              >
                Undo
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function toMs(at: number | string): number {
  return typeof at === "number" ? at : Date.parse(at);
}
