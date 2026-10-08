"use client";

import { useState } from "react";
import { DeckKicker } from "@/components/control-deck";
import { cn } from "@/lib/utils";
import type { RbDeskState } from "./rb-deck-model";
import { RbFormatStep } from "./rb-format-step";
import { RbPlayersStep } from "./rb-players-step";
import { RbBasicsStep, RbCheckInStep, RbJudgesStep, RbVenueStep } from "./rb-setup-steps";
import { rbBasicsMissing, rbSetupSteps, type RbSetupStep, type RbSetupStepId } from "./rb-setup-model";
import type { DeckRun } from "@/components/control-deck";

const BADGE: Record<"done" | "open" | "todo" | "warn", string> = {
  done: "bg-success-surface text-success-ink",
  open: "bg-brand-blue text-ink",
  // The reference draws the hollow badge content-box, so its border adds 2px.
  todo: "box-content border border-line-strong text-ink-muted",
  warn: "bg-warning-surface text-warning-ink",
};

/**
 * The setup checklist: six step cards. A card is one of done ✓
 * (success-surface), open (number on brand-blue, the selected step), todo
 * (hollow number) or warn ! (warning-surface). Selecting a card opens its
 * panel on the right.
 */
export function RbSetupChecklist({
  steps,
  selected,
  onSelect,
}: {
  steps: RbSetupStep[];
  selected: RbSetupStepId;
  onSelect: (id: RbSetupStepId) => void;
}) {
  return (
    <section className="flex max-w-[420px] flex-[1_1_320px] flex-col gap-2">
      <DeckKicker className="text-brand-red-bright">BEFORE THE EVENT</DeckKicker>
      <h2 className="mb-1.5 font-heading text-[24px] font-semibold">Setup checklist</h2>
      {steps.map((step) => {
        const open = step.id === selected;
        const badge = open ? "open" : step.status;
        return (
          <button
            key={step.id}
            type="button"
            aria-current={open ? "step" : undefined}
            onClick={() => onSelect(step.id)}
            className={cn(
              "flex min-h-[82px] items-center gap-3 rounded-sm border p-3 text-left",
              open ? "border-brand-blue-bright bg-elevated" : "border-line bg-surface hover:border-line-strong",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "flex h-7 w-7 flex-none items-center justify-center font-mono text-[13px] font-semibold",
                BADGE[badge],
              )}
            >
              {badge === "done" ? "✓" : badge === "warn" ? "!" : step.number}
            </span>
            <span className="flex flex-auto flex-col gap-0.5">
              <span className="text-[15px] font-medium text-ink">{step.label}</span>
              <span className="text-[12px] text-ink-secondary">{step.detail}</span>
            </span>
            <span className="sr-only">
              {step.status === "done" ? "Done" : step.status === "warn" ? "Needs attention" : "To do"}
            </span>
          </button>
        );
      })}
    </section>
  );
}

/** Setup phase workspace: the checklist on the left, the selected step's panel on the right. */
export function RbSetupWorkspace({ state, run, pending }: { state: RbDeskState; run: DeckRun; pending: boolean }) {
  const steps = rbSetupSteps(state);
  const [selected, setSelected] = useState<RbSetupStepId>(() =>
    rbBasicsMissing(state).length > 0 ? "basics" : "format",
  );
  const props = { state, run, pending };

  return (
    <div className="flex flex-wrap content-start gap-5">
      <RbSetupChecklist steps={steps} selected={selected} onSelect={setSelected} />
      {selected === "basics" && <RbBasicsStep {...props} />}
      {selected === "format" && <RbFormatStep {...props} />}
      {selected === "players" && <RbPlayersStep {...props} />}
      {selected === "checkin" && <RbCheckInStep {...props} />}
      {selected === "judges" && <RbJudgesStep {...props} />}
      {selected === "venue" && <RbVenueStep {...props} />}
    </div>
  );
}
