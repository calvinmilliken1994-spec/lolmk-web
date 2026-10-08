import type { ComponentType } from "react";

/**
 * Control Deck v2 shared types. The visual spec lives in
 * docs/design/control-deck-v2/ (components.md has the prop sketches these
 * follow, behaviour.md the rules).
 */

export type DeckTool = "riftbound" | "sr" | "mayhem";

/** done = finished, live = happening now, next = not reached, off = skipped. */
export type DeckPhaseStatus = "done" | "live" | "next" | "off";

export interface DeckPhase {
  id: string;
  label: string;
  status: DeckPhaseStatus;
  /** Short mono note on the right of the rail row, e.g. a count or "LIVE". */
  meta?: string;
}

/**
 * The single next step for the operator. `null` from
 * `DeckDefinition.primaryAction` means there is no primary step right now
 * (e.g. Riftbound while top-cut matches are pending).
 */
export interface DeckPrimaryAction {
  label: string;
  enabled: boolean;
  /** Why it's blocked; shown in warning ink under a disabled button. */
  reason?: string;
  /** Neutral note under an enabled button. */
  hint?: string;
  run: () => Promise<unknown>;
}

export interface DeckSceneDef<S> {
  id: string;
  label: string;
  available: (state: S) => boolean;
}

export interface DeckWorkspaceProps<S> {
  state: S;
  phaseId: string;
}

export interface DeckDefinition<S> {
  tool: DeckTool;
  phases: (state: S) => DeckPhase[];
  primaryAction: (state: S) => DeckPrimaryAction | null;
  scenes: DeckSceneDef<S>[];
  /**
   * Scene the program should switch to for this transition, or null. The
   * write happens server-side (see docs/RIFTBOUND.md "Auto-follow"); the
   * client uses this only to describe what auto-follow will do next.
   */
  autoFollow: (prev: S, next: S) => string | null;
  workspace: (phaseId: string) => ComponentType<DeckWorkspaceProps<S>>;
}

/** `run()` from useDeckState: wraps a server action with pending/error state. */
export type DeckRun = <T>(fn: () => Promise<T>) => Promise<T | undefined>;
