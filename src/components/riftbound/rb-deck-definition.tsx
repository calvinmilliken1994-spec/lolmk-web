"use client";

import {
  DeckKicker,
  type DeckDefinition,
  type DeckPrimaryAction,
  type DeckWorkspaceProps,
} from "@/components/control-deck";
import {
  closeCheckInAndPairRound1,
  closeRound,
  completeEvent,
  cutToTop,
  openCheckIn,
  pairNextRound,
  publishRound,
  startClock,
} from "@/app/tools/riftbound/actions";
import { RB_SCENES, type RbScene } from "@/types/riftbound";
import {
  outstandingTables,
  rbAutoFollow,
  rbPhases,
  rbPrimarySpec,
  RB_SCENE_LABEL,
  type RbDeskState,
  type RbPhaseId,
  type RbPrimarySpec,
} from "./rb-deck-model";

/** Bind a primary-action spec to the server action it stands for. */
function runSpec(spec: RbPrimarySpec, state: RbDeskState): Promise<unknown> {
  if (spec.confirm && !window.confirm(spec.confirm)) return Promise.resolve(undefined);
  const tid = state.tournament.id;
  switch (spec.kind) {
    case "open_checkin":
      return openCheckIn(tid);
    case "close_checkin":
      return closeCheckInAndPairRound1(tid);
    case "publish_round":
      return publishRound(spec.roundId as string);
    case "start_clock":
      return startClock(spec.roundId as string);
    case "close_round":
      return closeRound(spec.roundId as string);
    case "pair_next":
      return pairNextRound(tid);
    case "cut":
      return cutToTop(tid);
    case "complete":
      return completeEvent(tid);
  }
}

function sceneAvailable(scene: RbScene, state: RbDeskState): boolean {
  if (scene === "top_cut") return Boolean(state.tournament.config.topCutSeedIds);
  if (scene === "champion") return state.tournament.status === "completed" || state.tournament.status === "archived";
  if (scene === "standings" || scene === "pairings" || scene === "pairings_clock" || scene === "clock") {
    return state.rounds.length > 0;
  }
  return true;
}

const PHASE_TITLE: Record<RbPhaseId, string> = {
  setup: "Setup",
  checkin: "Check-in",
  swiss: "Swiss rounds",
  top_cut: "Top cut",
  complete: "Complete",
};

/**
 * Stand-in workspace for the phases whose real workspaces come with the
 * round desk (RbRoundWorkspace). It still shows where the event stands so the
 * primary action in the top bar can be followed.
 */
export function RbPhasePlaceholder({ state, phaseId }: DeckWorkspaceProps<RbDeskState>) {
  const phase = phaseId as RbPhaseId;
  const rounds = [...state.rounds].sort((a, b) => a.number - b.number);
  return (
    <section className="flex max-w-[640px] flex-col gap-2">
      <DeckKicker className="text-brand-red-bright">{PHASE_TITLE[phase].toUpperCase()}</DeckKicker>
      <h2 className="mb-1.5 font-heading text-[24px] font-semibold">{PHASE_TITLE[phase]}</h2>
      <p className="text-[13px] text-ink-secondary">
        The table workspace for this phase isn&apos;t built yet. The primary action at the top still moves the event
        forward.
      </p>
      {rounds.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {rounds
            .filter((r) => (phase === "top_cut" ? r.stage === "top_cut" : phase === "swiss" ? r.stage === "swiss" : true))
            .map((r) => {
              const open = outstandingTables(state, r);
              return (
                <li
                  key={r.id}
                  className="flex items-center justify-between border border-line bg-surface px-3 py-2.5 text-[13px]"
                >
                  <span>
                    {r.stage === "top_cut" ? "Top cut · " : ""}Round {r.number}
                  </span>
                  <span className="font-mono text-[12px] text-ink-muted">
                    {r.status.toUpperCase()}
                    {r.status !== "closed" && open > 0 ? ` · ${open} outstanding` : ""}
                  </span>
                </li>
              );
            })}
        </ul>
      )}
    </section>
  );
}

/** The Riftbound DeckDefinition. Binds rb-deck-model.ts to the task-3 server actions. */
export function makeRbDeckDefinition(): DeckDefinition<RbDeskState> {
  return {
    tool: "riftbound",
    phases: (state) => rbPhases(state),
    primaryAction: (state): DeckPrimaryAction | null => {
      const spec = rbPrimarySpec(state);
      if (!spec) return null;
      return {
        label: spec.label,
        enabled: spec.enabled,
        reason: spec.reason,
        hint: spec.hint,
        run: () => runSpec(spec, state),
      };
    },
    scenes: RB_SCENES.map((id) => ({
      id,
      label: RB_SCENE_LABEL[id],
      available: (state: RbDeskState) => sceneAvailable(id, state),
    })),
    autoFollow: (prev, next) => rbAutoFollow(prev, next),
    workspace: () => RbPhasePlaceholder,
  };
}
