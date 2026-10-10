"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { DeckTopBar, type DeckTopBarProps } from "./deck-top-bar";
import { PhaseRail } from "./phase-rail";
import type { DeckDefinition, DeckPrimaryAction, DeckRun } from "./types";

/**
 * Four-zone layout shared by every tool's admin page
 * (docs/design/control-deck-v2/screens/desk-round-live.html):
 * top bar, phase rail (200px), the phase workspace, broadcast column
 * (340–420px).
 *
 * The reference sizes its columns content-box (rail 200px, workspace basis
 * 560px, broadcast 340px up to 420px, each plus padding and border). Tailwind
 * is border-box, so the bases below are the outer sizes: rail 200+24+1 =
 * 225px, workspace 560+40 = 600px, broadcast 340+32+1 = 373px (max
 * 420+32+1 = 453px). Below 1100px the workspace goes first at full width
 * and the rail and broadcast column stack under it.
 *
 * The workspace is `children` when given, otherwise the definition's
 * workspace component for the selected phase.
 */
export function DeckShell<S>({
  definition,
  state,
  topBar,
  broadcast,
  pending = false,
  run,
  selectedPhaseId,
  onSelectPhase,
  className,
  children,
}: {
  definition: DeckDefinition<S>;
  state: S;
  topBar: Omit<DeckTopBarProps, "primaryAction" | "pending" | "onRunPrimary">;
  /** Usually a BroadcastColumn. */
  broadcast?: ReactNode;
  pending?: boolean;
  /** useDeckState's run(); without it the primary action runs bare. */
  run?: DeckRun;
  /** Controlled selection; uncontrolled defaults to the live phase. */
  selectedPhaseId?: string;
  onSelectPhase?: (phaseId: string) => void;
  className?: string;
  children?: ReactNode;
}) {
  const phases = definition.phases(state);
  const livePhaseId = phases.find((p) => p.status === "live")?.id ?? phases[0]?.id ?? null;
  const [ownSelection, setOwnSelection] = useState<string | null>(null);
  const selected = selectedPhaseId ?? ownSelection ?? livePhaseId;

  const selectPhase = (id: string) => {
    if (onSelectPhase) onSelectPhase(id);
    else setOwnSelection(id);
  };

  const runPrimary = (action: DeckPrimaryAction) => {
    if (run) void run(action.run);
    else void action.run();
  };

  let workspace = children;
  if (workspace === undefined && selected) {
    const Workspace = definition.workspace(selected);
    workspace = <Workspace state={state} phaseId={selected} />;
  }

  return (
    <div className={cn("flex min-h-screen flex-col bg-base text-[14px] leading-[normal] text-ink", className)}>
      <DeckTopBar
        {...topBar}
        primaryAction={definition.primaryAction(state)}
        pending={pending}
        onRunPrimary={runPrimary}
      />
      <div className="flex min-h-0 flex-auto flex-wrap">
        <PhaseRail
          phases={phases}
          selectedId={selected}
          onSelect={selectPhase}
          className="flex-[0_0_225px] border-r border-line max-[1099px]:order-2 max-[1099px]:basis-full max-[1099px]:border-r-0 max-[1099px]:border-t"
        />
        <main className="flex min-w-0 flex-[999_1_600px] flex-col gap-4 p-5 max-[1099px]:order-1 max-[1099px]:basis-full">
          {workspace}
        </main>
        {broadcast && (
          <div className="flex min-w-0 max-w-[453px] flex-[1_1_373px] border-l border-line max-[1099px]:order-3 max-[1099px]:max-w-none max-[1099px]:basis-full max-[1099px]:border-l-0 max-[1099px]:border-t">
            {broadcast}
          </div>
        )}
      </div>
    </div>
  );
}
