"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertStrip, DeckShell, useDeckState } from "@/components/control-deck";
import { makeRbDeckDefinition, RbPhasePlaceholder } from "./rb-deck-definition";
import {
  RB_SCENE_LABEL,
  rbCurrentPhase,
  rbStatusChip,
  type RbDeskState,
  type RbPhaseId,
} from "./rb-deck-model";
import { RbCheckinWorkspace } from "./rb-checkin-workspace";
import { RbSetupWorkspace } from "./rb-setup-workspace";

/**
 * The Riftbound desk page body: DeckShell with the Riftbound DeckDefinition,
 * polling /api/rb/admin-state. Setup and Check-in have their own workspaces;
 * the other phases show RbPhasePlaceholder until the round desk exists.
 */
export function RbDesk({ initial }: { initial: RbDeskState }) {
  const slug = initial.tournament.slug;
  const { state, pending, error, setError, run, lastSyncedAt } = useDeckState<RbDeskState>({
    initial,
    url: `/api/rb/admin-state?slug=${encodeURIComponent(slug)}`,
  });
  const definition = useMemo(() => makeRbDeckDefinition(), []);

  // View whichever phase the operator picked; when the event moves to a new
  // phase, follow it.
  const live = rbCurrentPhase(state);
  const [picked, setPicked] = useState<RbPhaseId | null>(null);
  useEffect(() => setPicked(null), [live]);
  const selected = picked ?? live;

  const workspace =
    selected === "setup" ? (
      <RbSetupWorkspace state={state} run={run} pending={pending} />
    ) : selected === "checkin" ? (
      <RbCheckinWorkspace state={state} run={run} pending={pending} />
    ) : (
      <RbPhasePlaceholder state={state} phaseId={selected} />
    );

  return (
    // Covers the site header (z-50), like the live screens: the deck has its
    // own top bar and back link.
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-base">
      <DeckShell
        definition={definition}
        state={state}
        run={run}
        pending={pending}
        selectedPhaseId={selected}
        onSelectPhase={(id) => setPicked(id as RbPhaseId)}
        topBar={{
          backHref: "/tools/riftbound",
          backLabel: "Riftbound",
          title: `${state.tournament.name} · Riftbound`,
          status: rbStatusChip(state),
          onAirScene: RB_SCENE_LABEL[state.tournament.scene],
          lastSyncedAt,
        }}
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
