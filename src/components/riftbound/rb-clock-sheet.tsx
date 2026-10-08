"use client";

import { DeckKicker, DeckSheet, type DeckRun } from "@/components/control-deck";
import { clockRemainingMs } from "@/lib/rb-clock";
import type { RbRound } from "@/types/riftbound";
import type { RbActions } from "./rb-actions";
import { formatClock } from "./rb-round-model";

const STEPS_MIN = [-5, -1, 1, 5];

/** ± Adjust from the top-bar clock: add or remove minutes on the round clock (adjustClock). */
export function RbClockSheet({
  round,
  now,
  run,
  pending,
  error,
  actions,
  onClose,
}: {
  round: RbRound;
  now: number | null;
  run: DeckRun;
  pending: boolean;
  error: string | null;
  actions: RbActions;
  onClose: () => void;
}) {
  const remaining = now === null ? null : clockRemainingMs(round, null, now);
  return (
    <DeckSheet kicker={`ROUND ${round.number} · CLOCK`} title="Adjust the clock" onClose={onClose}>
      {error && (
        <p role="alert" className="border border-warning-line-quiet bg-warning-surface-strong px-3 py-2 text-[13px] text-warning-ink">
          {error}
        </p>
      )}
      <p className="font-display text-[56px] leading-none tracking-[0.02em] tabular-nums">{formatClock(remaining)}</p>
      <section className="flex flex-col gap-2">
        <DeckKicker>ADD OR REMOVE TIME (MINUTES)</DeckKicker>
        <div className="grid grid-cols-4 gap-2">
          {STEPS_MIN.map((m) => (
            <button
              key={m}
              type="button"
              disabled={pending}
              onClick={() => void run(() => actions.adjustClock(round.id, m * 60_000))}
              className="h-12 rounded-sm border border-line-strong bg-elevated font-heading text-[16px] font-semibold text-ink hover:border-brand-blue-bright disabled:cursor-wait disabled:text-ink-disabled"
            >
              {m > 0 ? `+${m}` : `−${Math.abs(m)}`}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-ink-muted">
          Changes the whole round&apos;s time. A single table&apos;s extra time goes through its table sheet.
        </p>
      </section>
    </DeckSheet>
  );
}
