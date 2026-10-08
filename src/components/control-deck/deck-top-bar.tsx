"use client";

import Link from "next/link";
import { OnAirChip, PrimaryAction, SyncIndicator } from "./status";
import type { DeckPrimaryAction } from "./types";

export interface DeckClock {
  /** Pre-formatted, e.g. "04:12". */
  display: string;
  paused?: boolean;
  onTogglePause?: () => void;
  onAdjust?: () => void;
}

export interface DeckTopBarProps {
  backHref: string;
  backLabel: string;
  title: string;
  /** Mono status chip, e.g. "ROUND 3 / 5 · LIVE". */
  status?: string;
  clock?: DeckClock | null;
  /** Program scene label for the ON AIR chip; omit to hide the chip. */
  onAirScene?: string | null;
  lastSyncedAt?: number | null;
  primaryAction?: DeckPrimaryAction | null;
  pending?: boolean;
  onRunPrimary?: (action: DeckPrimaryAction) => void;
}

const smallButton =
  "h-[22px] rounded-sm border border-line-strong bg-elevated px-2 text-[11px] text-ink disabled:text-ink-disabled";

export function DeckTopBar({
  backHref,
  backLabel,
  title,
  status,
  clock,
  onAirScene,
  lastSyncedAt,
  primaryAction,
  pending,
  onRunPrimary,
}: DeckTopBarProps) {
  return (
    <header className="flex flex-wrap items-center gap-4 border-b border-line-strong bg-surface px-5 py-3">
      <div className="flex min-w-0 flex-[1_1_320px] items-center gap-3">
        <Link href={backHref} className="text-[13px] text-link no-underline hover:text-ink">
          ← {backLabel}
        </Link>
        <span aria-hidden="true" className="h-[18px] w-px bg-line-strong" />
        <h1 className="truncate font-heading text-[20px] font-semibold">{title}</h1>
        {status && (
          <span className="whitespace-nowrap border border-line-strong px-2 py-[3px] font-mono text-[12px] text-ink-secondary">
            {status}
          </span>
        )}
      </div>

      {clock && (
        <div className="flex items-center gap-2.5">
          <span className="font-display text-[40px] leading-none tracking-[0.02em] tabular-nums">{clock.display}</span>
          {(clock.onTogglePause || clock.onAdjust) && (
            <div className="flex flex-col gap-1">
              {clock.onTogglePause && (
                <button type="button" disabled={pending} onClick={clock.onTogglePause} className={smallButton}>
                  {clock.paused ? "Resume" : "Pause"}
                </button>
              )}
              {clock.onAdjust && (
                <button type="button" disabled={pending} onClick={clock.onAdjust} className={smallButton}>
                  ± Adjust
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {onAirScene && <OnAirChip sceneLabel={onAirScene} />}
      {lastSyncedAt != null && <SyncIndicator lastSyncedAt={lastSyncedAt} />}
      {primaryAction && onRunPrimary && (
        <PrimaryAction action={primaryAction} pending={pending} onRun={onRunPrimary} />
      )}
    </header>
  );
}
