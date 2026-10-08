"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  AlertStrip,
  DeckShell,
  useDeckState,
  type DeckDefinition,
  type DeckPrimaryAction,
  type DeckWorkspaceProps,
} from "@/components/control-deck";
import type { MayhemAdminState } from "@/types/mayhem";
import { mayhemActions, type MayhemActions } from "./mayhem-actions";
import { MayhemBroadcast } from "./mayhem-broadcast";
import {
  MAYHEM_SCENE_LABEL,
  MAYHEM_SCENE_ORDER,
  mayhemCurrentPhase,
  mayhemOnAirLabel,
  mayhemPhases,
  mayhemPrimarySpec,
  mayhemSceneUnavailableReason,
  mayhemStatusChip,
  mayhemTitle,
  type MayhemPhaseId,
  type MayhemPrimarySpec,
} from "./mayhem-deck-model";
import { MayhemEntrantsWorkspace } from "./mayhem-entrants-workspace";
import { MayhemCompleteWorkspace, MayhemGroupsWorkspace, MayhemKnockoutWorkspace } from "./mayhem-match-workspaces";
import { MayhemTeamsWorkspace } from "./mayhem-teams-workspace";

function runSpec(spec: MayhemPrimarySpec, actions: MayhemActions): Promise<unknown> {
  switch (spec.kind) {
    case "randomize":
      return actions.randomizeTeams();
    case "finalize_premade":
      return actions.finalizePremadeTeams();
    case "reveal_next":
      return actions.advanceReveal();
    case "generate_groups":
      return actions.generateGroups();
    case "knockout_from_groups":
      return actions.generateKnockoutFromGroups();
    case "knockout_from_teams":
      return actions.generateKnockoutFromAllTeams();
  }
}

const Unused: ComponentType<DeckWorkspaceProps<MayhemAdminState>> = () => null;

/** The Mayhem DeckDefinition. Workspaces are rendered by MayhemDesk (they need run/actions). */
export function makeMayhemDeckDefinition(actions: MayhemActions = mayhemActions): DeckDefinition<MayhemAdminState> {
  return {
    tool: "mayhem",
    phases: (state) => mayhemPhases(state),
    primaryAction: (state): DeckPrimaryAction | null => {
      const spec = mayhemPrimarySpec(state);
      if (!spec) return null;
      return { label: spec.label, enabled: spec.enabled, reason: spec.reason, hint: spec.hint, run: () => runSpec(spec, actions) };
    },
    scenes: MAYHEM_SCENE_ORDER.map((id) => ({
      id,
      label: MAYHEM_SCENE_LABEL[id],
      available: (state: MayhemAdminState) => mayhemSceneUnavailableReason(id, state) === null,
    })),
    // No auto-follow rules for Mayhem yet; the broadcast column hides the toggle.
    autoFollow: () => null,
    workspace: () => Unused,
  };
}

/**
 * The Mayhem admin page body: DeckShell polling /api/mayhem/admin-state.
 * Phases come from MayhemStage (Groups is "off" when the group stage is
 * disabled); each has its own workspace. `actions` and `stateUrl` default to
 * the real server actions and route.
 */
export function MayhemDesk({
  initial,
  actions = mayhemActions,
  stateUrl = "/api/mayhem/admin-state",
}: {
  initial: MayhemAdminState;
  actions?: MayhemActions;
  stateUrl?: string;
}) {
  const { state, pending, error, setError, run, lastSyncedAt } = useDeckState<MayhemAdminState>({ initial, url: stateUrl });
  const definition = useMemo(() => makeMayhemDeckDefinition(actions), [actions]);

  // View the phase the operator picked; follow the event when it moves on.
  const live = mayhemCurrentPhase(state);
  const [picked, setPicked] = useState<MayhemPhaseId | null>(null);
  useEffect(() => setPicked(null), [live]);
  const selected = picked ?? live;

  const props = { state, run, pending, actions };
  const workspace =
    selected === "entrants" ? (
      <MayhemEntrantsWorkspace {...props} />
    ) : selected === "teams" ? (
      <MayhemTeamsWorkspace {...props} />
    ) : selected === "groups" ? (
      <MayhemGroupsWorkspace {...props} />
    ) : selected === "knockout" ? (
      <MayhemKnockoutWorkspace {...props} />
    ) : (
      <MayhemCompleteWorkspace {...props} />
    );

  return (
    // Covers the site header (z-50), like the live screens: the deck has its own top bar.
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-base">
      <DeckShell
        definition={definition}
        state={state}
        run={run}
        pending={pending}
        selectedPhaseId={selected}
        onSelectPhase={(id) => setPicked(id as MayhemPhaseId)}
        topBar={{
          backHref: "/tools",
          backLabel: "Tools",
          title: mayhemTitle(state),
          status: mayhemStatusChip(state),
          onAirScene: mayhemOnAirLabel(state),
          lastSyncedAt,
        }}
        broadcast={<MayhemBroadcast state={state} run={run} pending={pending} actions={actions} />}
      >
        {error && (
          <AlertStrip label="ERROR" onAcknowledge={() => setError(null)}>
            {error}
          </AlertStrip>
        )}
        {workspace}
      </DeckShell>
    </div>
  );
}
