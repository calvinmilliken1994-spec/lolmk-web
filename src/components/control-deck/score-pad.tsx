"use client";

import { cn } from "@/lib/utils";

export type ScorePadFormat = "bo1" | "bo3" | "bo5";

/** A final result as games won by each side, plus drawn games. */
export interface ScorePadScore {
  gamesA: number;
  gamesB: number;
  gamesDrawn: number;
}

interface PadButton {
  key: string;
  side: "a" | "b" | "draw";
  label: string;
  score: ScorePadScore;
}

const WINS_NEEDED: Record<ScorePadFormat, number> = { bo1: 1, bo3: 2, bo5: 3 };

/**
 * Buttons for valid final scores only, so an impossible score can't be
 * entered.
 *
 * - Bo1: `A wins` / `B wins`.
 * - Bo3/Bo5: every winning score (A 2–0, A 2–1, …) for each side.
 * - `riftbound` adds the time-out results (a lead when time is called, e.g.
 *   `A 1–0`), `Draw`, and `Other…` for anything else (drawn games).
 *
 * Layout `pairs` (judge phone) puts A and B side by side per score, 60px
 * buttons with the draw/other row below at 52px. Layout `row` (desk) puts
 * every button on one line: A's scores best-first, then B's worst-first,
 * at 52px. Player-A buttons are brand-blue-muted, Player-B elevated.
 */
export function ScorePad({
  format,
  nameA,
  nameB,
  riftbound = false,
  layout = "pairs",
  disabled = false,
  onSelect,
  onOther,
  className,
}: {
  format: ScorePadFormat;
  nameA: string;
  nameB: string;
  riftbound?: boolean;
  layout?: "pairs" | "row";
  disabled?: boolean;
  onSelect: (score: ScorePadScore) => void;
  onOther?: () => void;
  className?: string;
}) {
  const { a, b, draw } = padButtons(format, nameA, nameB, riftbound);
  const big = layout === "pairs" ? "h-[60px] text-[18px]" : "h-[52px] text-[16px]";

  const scoreButton = (btn: PadButton) => (
    <button
      key={btn.key}
      type="button"
      disabled={disabled}
      onClick={() => onSelect(btn.score)}
      className={cn(
        "flex items-center justify-center rounded-sm border font-heading font-semibold text-ink disabled:opacity-50",
        big,
        btn.side === "a" ? "border-brand-blue-bright bg-brand-blue-muted" : "border-line-strong bg-elevated",
      )}
    >
      {btn.label}
    </button>
  );

  const extras = riftbound && (
    <div className="grid grid-cols-2 gap-2">
      {draw && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSelect(draw.score)}
          className="flex h-[52px] items-center justify-center rounded-sm border border-line-strong bg-surface text-[16px] text-ink disabled:opacity-50"
        >
          {draw.label}
        </button>
      )}
      <button
        type="button"
        disabled={disabled || !onOther}
        onClick={onOther}
        className="flex h-[52px] items-center justify-center rounded-sm border border-line-strong bg-transparent text-[16px] text-ink-secondary disabled:opacity-50"
      >
        Other…
      </button>
    </div>
  );

  if (layout === "row") {
    const all = [...a, ...[...b].reverse()];
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        <div className="grid auto-cols-fr grid-flow-col gap-2">
          {all.map(scoreButton)}
        </div>
        {extras}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="grid grid-cols-2 gap-2">{a.flatMap((btn, i) => [scoreButton(btn), scoreButton(b[i])])}</div>
      {extras}
    </div>
  );
}

/** The legal final scores for a format, A-side and B-side in matching order. */
export function padButtons(format: ScorePadFormat, nameA: string, nameB: string, riftbound: boolean) {
  const need = WINS_NEEDED[format];
  const scores: [number, number][] = [];
  if (format === "bo1") {
    scores.push([1, 0]);
  } else {
    // Completed matches, best result first: 2–0, 2–1 (Bo3); 3–0, 3–1, 3–2 (Bo5).
    for (let lost = 0; lost < need; lost++) scores.push([need, lost]);
    // Riftbound time-outs: whoever is ahead when time is called wins.
    if (riftbound) {
      for (let won = need - 1; won >= 1; won--) {
        for (let lost = 0; lost < won; lost++) scores.push([won, lost]);
      }
    }
  }

  const label = (name: string, won: number, lost: number) =>
    format === "bo1" ? `${name} wins` : `${name} ${won}–${lost}`;
  const a: PadButton[] = scores.map(([won, lost]) => ({
    key: `a${won}${lost}`,
    side: "a",
    label: label(nameA, won, lost),
    score: { gamesA: won, gamesB: lost, gamesDrawn: 0 },
  }));
  const b: PadButton[] = scores.map(([won, lost]) => ({
    key: `b${won}${lost}`,
    side: "b",
    label: label(nameB, won, lost),
    score: { gamesA: lost, gamesB: won, gamesDrawn: 0 },
  }));

  // A match draw: level games when time is called (Bo3 1–1, Bo5 2–2), or
  // 0–0 for an intentional draw in Bo1.
  const level = Math.max(0, need - 1);
  const draw: PadButton | null = riftbound
    ? {
        key: "draw",
        side: "draw",
        label: `Draw ${level}–${level}`,
        score: { gamesA: level, gamesB: level, gamesDrawn: 0 },
      }
    : null;

  return { a, b, draw };
}
