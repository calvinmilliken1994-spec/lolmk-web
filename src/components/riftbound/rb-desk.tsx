"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertStrip, DeckShell, useDeckState, useNow, type DeckClock } from "@/components/control-deck";
import { clockRemainingMs } from "@/lib/rb-clock";
import { rbActions, type RbActions } from "./rb-actions";
import { RbBroadcast } from "./rb-broadcast";
import { RbCheckinWorkspace } from "./rb-checkin-workspace";
import { RbClockSheet } from "./rb-clock-sheet";
import { RbCutWorkspace } from "./rb-cut-workspace";
import { makeRbDeckDefinition, RbPhasePlaceholder } from "./rb-deck-definition";
import {
  RB_SCENE_LABEL,
  rbCurrentPhase,
  rbStatusChip,
  type RbDeskState,
  type RbPhaseId,
} from "./rb-deck-model";
import { formatClock, rbClockRound } from "./rb-round-model";
import { RbRoundWorkspace } from "./rb-round-workspace";
import { RbSetupWorkspace } from "./rb-setup-workspace";

/**
 * The Riftbound desk page body: DeckShell with the Riftbound DeckDefinition,
 * polling /api/rb/admin-state. Setup and Check-in have their own workspaces,
 * Swiss rounds is the round desk, Top cut is the match queue, and
 * Complete shows RbPhasePlaceholder.
 *
 * `actions` and `stateUrl` default to the real server actions and the
 * admin-state route; a test page can pass its own.
 */
export function RbDesk({
  initial,
  actions = rbActions,
  stateUrl,
}: {
  initial: RbDeskState;
  actions?: RbActions;
  stateUrl?: string;
}) {
  const slug = initial.tournament.slug;
  const { state, pending, error, setError, run, lastSyncedAt } = useDeckState<RbDeskState>({
    initial,
    url: stateUrl ?? `/api/rb/admin-state?slug=${encodeURIComponent(slug)}`,
  });
  const definition = useMemo(() => makeRbDeckDefinition(actions), [actions]);
  const now = useNow(1000);
  const [adjusting, setAdjusting] = useState(false);

  // View whichever phase the operator picked; when the event moves to a new
  // phase, follow it.
  const live = rbCurrentPhase(state);
  const [picked, setPicked] = useState<RbPhaseId | null>(null);
  useEffect(() => setPicked(null), [live]);
  const selected = picked ?? live;

  // The top-bar clock: the latest round while it is published (full time, not
  // started) or live. The remaining time is clockRemainingMs over the
  // server's timestamps; `now` only says what time it is.
  const clockRound = rbClockRound(state);
  const clock: DeckClock | null =
    clockRound && clockRound.duration_ms !== null && now !== null
      ? {
          display: formatClock(clockRemainingMs(clockRound, null, now)),
          paused: clockRound.paused_at !== null,
          onTogglePause:
            clockRound.status === "live"
              ? () =>
                  void run(() =>
                    clockRound.paused_at ? actions.resumeClock(clockRound.id) : actions.pauseClock(clockRound.id),
                  )
              : undefined,
          onAdjust: () => setAdjusting(true),
        }
      : null;

  const workspace =
    selected === "setup" ? (
      <RbSetupWorkspace state={state} run={run} pending={pending} />
    ) : selected === "checkin" ? (
      <RbCheckinWorkspace state={state} run={run} pending={pending} />
    ) : selected === "swiss" ? (
      <RbRoundWorkspace state={state} run={run} pending={pending} error={error} now={now} actions={actions} />
    ) : selected === "top_cut" ? (
      <RbCutWorkspace state={state} run={run} pending={pending} error={error} actions={actions} />
    ) : (
      <RbPhasePlaceholder state={state} phaseId={selected} />
    );

  const showBroadcast = state.tournament.status === "in_progress" || state.tournament.status === "completed";

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
          status: rbStatusChip(state, now),
          clock,
          onAirScene: RB_SCENE_LABEL[state.tournament.scene],
          lastSyncedAt,
        }}
        broadcast={
          showBroadcast ? <RbBroadcast state={state} run={run} pending={pending} now={now} actions={actions} /> : undefined
        }
      >
        {error && (
          <AlertStrip label="ERROR" onAcknowledge={() => setError(null)}>
            {error}
          </AlertStrip>
        )}
        {workspace}
      </DeckShell>
      {adjusting && clockRound && (
        <RbClockSheet
          round={clockRound}
          now={now}
          run={run}
          pending={pending}
          error={error}
          actions={actions}
          onClose={() => setAdjusting(false)}
        />
      )}
    </div>
  );
}
