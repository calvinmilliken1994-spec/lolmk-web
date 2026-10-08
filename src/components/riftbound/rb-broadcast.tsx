"use client";

import { useState } from "react";
import {
  BroadcastColumn,
  BroadcastNote,
  ScenePreview,
  SceneProgram,
  type BroadcastScene,
  type DeckRun,
} from "@/components/control-deck";
import type { RbScene } from "@/types/riftbound";
import type { RbActions } from "./rb-actions";
import { RB_SCENE_LABEL, rbSceneAvailable, type RbDeskState } from "./rb-deck-model";
import { rbAutoFollowNext } from "./rb-round-model";

/**
 * Flip to true when the venue screen (/rblive/[slug]) exists. Until then both
 * monitors show a placeholder instead of an iframe that would 404.
 */
export const RB_VENUE_SCREEN_READY = false;

/** The "Announcement" scene in the design has no stored scene id yet (see RbScene), so it can't be taken. */
const ANNOUNCEMENT = "announcement";

const SCENE_BUTTONS: { id: RbScene | typeof ANNOUNCEMENT; label: string }[] = [
  { id: "pairings", label: RB_SCENE_LABEL.pairings },
  { id: "pairings_clock", label: RB_SCENE_LABEL.pairings_clock },
  { id: "clock", label: RB_SCENE_LABEL.clock },
  { id: "standings", label: RB_SCENE_LABEL.standings },
  { id: "top_cut", label: RB_SCENE_LABEL.top_cut },
  { id: ANNOUNCEMENT, label: "Announcement" },
  { id: "idle", label: RB_SCENE_LABEL.idle },
  { id: "champion", label: RB_SCENE_LABEL.champion },
];

function Placeholder({ label }: { label: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center">
      <span className="font-display text-[22px] tracking-[0.04em]">{label.toUpperCase()}</span>
      <span className="font-mono text-[10px] text-ink-muted">Venue screen preview arrives with the venue screen build</span>
    </div>
  );
}

/**
 * The Riftbound BroadcastColumn: scene picker into Preview, TAKE (setScene),
 * the Auto-follow checkbox (setAutoFollow) and the "auto-follow next" panel.
 * Preview loads `/rblive/<slug>?scene=<id>&preview=1`, which never writes;
 * Program shows the venue screen as it is.
 */
export function RbBroadcast({
  state,
  run,
  pending,
  now,
  actions,
}: {
  state: RbDeskState;
  run: DeckRun;
  pending: boolean;
  now: number | null;
  actions: RbActions;
}) {
  const t = state.tournament;
  const [previewId, setPreviewId] = useState<string>(t.scene);

  const scenes: BroadcastScene[] = SCENE_BUTTONS.filter(
    // Champion only exists once the event is over; the reference grid has seven buttons.
    (s) => s.id !== "champion" || rbSceneAvailable("champion", state),
  ).map((s) => ({
    id: s.id,
    label: s.label,
    available: s.id !== ANNOUNCEMENT && rbSceneAvailable(s.id as RbScene, state),
  }));
  const labelOf = (id: string) => SCENE_BUTTONS.find((s) => s.id === id)?.label ?? id;

  const previewSrc = RB_VENUE_SCREEN_READY
    ? `/rblive/${encodeURIComponent(t.slug)}?scene=${encodeURIComponent(previewId)}&preview=1`
    : null;
  const programSrc = RB_VENUE_SCREEN_READY ? `/rblive/${encodeURIComponent(t.slug)}` : null;

  const next = rbAutoFollowNext(state, now);
  const lines: string[] = [];
  if (!t.auto_follow) lines.push("Auto-follow is off. The program changes only on TAKE.");
  else {
    if (t.auto_follow_paused) lines.push("Paused by your last TAKE until the next phase change.");
    if (next.length === 0) lines.push("Nothing left to follow.");
    for (const step of next) lines.push(`${step.event} → ${step.scene}`);
  }

  return (
    <BroadcastColumn
      autoFollow={t.auto_follow}
      onAutoFollowChange={(enabled) => void run(() => actions.setAutoFollow(t.id, enabled))}
      preview={
        <ScenePreview sceneLabel={labelOf(previewId)} src={previewSrc}>
          <Placeholder label={labelOf(previewId)} />
        </ScenePreview>
      }
      program={
        <SceneProgram sceneLabel={labelOf(t.scene)} src={programSrc}>
          <Placeholder label={labelOf(t.scene)} />
        </SceneProgram>
      }
      scenes={scenes}
      programId={t.scene}
      previewId={previewId}
      onPreview={setPreviewId}
      onTake={() => void run(() => actions.setScene(t.id, previewId as RbScene))}
      pending={pending}
      toolSlot={<BroadcastNote title="AUTO-FOLLOW NEXT" lines={lines} />}
    />
  );
}
