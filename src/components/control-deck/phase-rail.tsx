"use client";

import { cn } from "@/lib/utils";
import { DeckKicker } from "./status";
import type { DeckPhase } from "./types";

const DOT: Record<DeckPhase["status"], string> = {
  done: "bg-success",
  live: "bg-brand-red-bright",
  // Hollow dots are 8px plus a 1px border, as in the reference.
  next: "box-content border border-ink-disabled",
  off: "box-content border border-ink-disabled",
};

const ROW_TEXT: Record<DeckPhase["status"], string> = {
  done: "text-ink-secondary",
  live: "text-ink-secondary",
  next: "text-ink-muted",
  off: "text-ink-disabled line-through",
};

/**
 * Vertical phase list. Every row opens that phase's workspace; the selected
 * row gets the elevated fill + blue border (by default the live phase).
 */
export function PhaseRail({
  phases,
  selectedId,
  onSelect,
  className,
}: {
  phases: DeckPhase[];
  selectedId: string | null;
  onSelect?: (phaseId: string) => void;
  className?: string;
}) {
  return (
    <nav aria-label="Event phases" className={cn("flex flex-col gap-1 bg-deck-rail px-3 py-4", className)}>
      <DeckKicker className="mb-2 ml-2">PHASES</DeckKicker>
      {phases.map((phase) => {
        const selected = phase.id === selectedId;
        return (
          <button
            key={phase.id}
            type="button"
            aria-current={selected ? "step" : undefined}
            onClick={() => onSelect?.(phase.id)}
            className={cn(
              "flex items-center gap-2.5 rounded-sm border p-2 text-left text-[13px]",
              selected ? "border-brand-blue-bright bg-elevated text-ink" : cn("border-transparent", ROW_TEXT[phase.status]),
            )}
          >
            <span aria-hidden="true" className={cn("h-2 w-2 flex-none rounded-full", DOT[phase.status])} />
            <span className="flex-auto">{phase.label}</span>
            <span className="font-mono text-[11px] text-ink-muted">{phase.meta}</span>
          </button>
        );
      })}
    </nav>
  );
}
