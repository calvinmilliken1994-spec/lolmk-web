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
import type { SrAdminState } from "@/types/sr-tournament";
import { srActions, type SrActions } from "./sr-actions";
import { SrBroadcast } from "./sr-broadcast";
import {
  SR_SCENE_LABEL,
  SR_SCENE_ORDER,
  srCurrentPhase,
  srOnAirLabel,
  srPhases,
  srPrimarySpec,
  srSceneUnavailableReason,
  srStatusChip,
  srTitle,
  type SrPhaseId,
  type SrPrimarySpec,
} from "./sr-deck-model";
import { SrCompleteWorkspace, SrMatchQueueWorkspace } from "./sr-match-workspaces";
import { SrSeedingWorkspace, SrSetupWorkspace } from "./sr-setup-workspace";
import { SrSignupsWorkspace } from "./sr-signups-workspace";

function runSpec(spec: SrPrimarySpec, tournamentId: string, actions: SrActions): Promise<unknown> {
  switch (spec.kind) {
    case "open_signups":
      return actions.setSignupsOpen(tournamentId, true);
    case "roll_seeds":
      return actions.rollSeeds(tournamentId);
    case "generate_bracket":
      return actions.generateBracket(tournamentId);
    case "start_reveal":
      return actions.startUbr1Reveal(tournamentId);
    case "start_match":
      return actions.setActiveMatch(tournamentId, spec.matchId);
  }
}

const Unused: ComponentType<DeckWorkspaceProps<SrAdminState>> = () => null;

/** The SR DeckDefinition. Workspaces are rendered by SrDesk (they need run/actions). */
export function makeSrDeckDefinition(actions: SrActions = srActions): DeckDefinition<SrAdminState> {
  return {
    tool: "sr",
    phases: (state) => srPhases(state),
    primaryAction: (state): DeckPrimaryAction | null => {
      const spec = srPrimarySpec(state);
      if (!spec) return null;
      return {
        label: spec.label,
        enabled: spec.enabled,
        reason: spec.reason,
        hint: spec.hint,
        run: () => runSpec(spec, state.tournament.id, actions),
      };
    },
    scenes: SR_SCENE_ORDER.map((id) => ({
      id,
      label: SR_SCENE_LABEL[id],
      available: (state: SrAdminState) => srSceneUnavailableReason(id, state) === null,
    })),
    // No auto-follow rules for SR; the broadcast column hides the toggle.
    autoFollow: () => null,
    workspace: () => Unused,
  };
}

/**
 * The SR tournament desk: DeckShell polling /api/sr/admin-state?t=<id>.
 * The phase rail (Setup, Signups, Seeding, Bracket, Live, Complete) replaces
 * the old "Run order" steps; each phase has its own workspace.
 */
export function SrDesk({
  initial,
  blobConfigured,
  actions = srActions,
  stateUrl,
}: {
  initial: SrAdminState;
  blobConfigured: boolean;
  actions?: SrActions;
  stateUrl?: string | null;
}) {
  const url = stateUrl === undefined ? `/api/sr/admin-state?t=${encodeURIComponent(initial.tournament.id)}` : stateUrl;
  const { state, pending, error, setError, run, refresh, lastSyncedAt } = useDeckState<SrAdminState>({ initial, url });
  const definition = useMemo(() => makeSrDeckDefinition(actions), [actions]);

  // View the phase the operator picked; follow the event when it moves on.
  const live = srCurrentPhase(state);
  const [picked, setPicked] = useState<SrPhaseId | null>(null);
  useEffect(() => setPicked(null), [live]);
  const selected = picked ?? live;

  const props = { state, run, pending, actions, refresh: () => void refresh(), blobConfigured };
  const workspace =
    selected === "setup" ? (
      <SrSetupWorkspace {...props} />
    ) : selected === "signups" ? (
      <SrSignupsWorkspace {...props} />
    ) : selected === "seeding" ? (
      <SrSeedingWorkspace {...props} />
    ) : selected === "bracket" || selected === "live" ? (
      <SrMatchQueueWorkspace {...props} />
    ) : (
      <SrCompleteWorkspace {...props} />
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
        onSelectPhase={(id) => setPicked(id as SrPhaseId)}
        topBar={{
          backHref: "/tools/summoners-rift",
          backLabel: "Summoner's Rift",
          title: srTitle(state),
          status: srStatusChip(state),
          onAirScene: srOnAirLabel(state),
          lastSyncedAt,
        }}
        broadcast={<SrBroadcast state={state} run={run} pending={pending} actions={actions} />}
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
