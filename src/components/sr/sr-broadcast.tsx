"use client";

import { useState } from "react";
import {
  BroadcastColumn,
  DeckKicker,
  ScenePreview,
  SceneProgram,
  useNow,
  type BroadcastScene,
  type DeckRun,
} from "@/components/control-deck";
import { cn } from "@/lib/utils";
import type { SrAdminState, SrMatchScene } from "@/types/sr-tournament";
import type { SrActions } from "./sr-actions";
import { SR_SCENE_LABEL, SR_SCENE_ORDER, srOnAirLabel, srSceneUnavailableReason, srUbr1Reveal } from "./sr-deck-model";

const toolButton =
  "h-9 rounded-sm border border-line-strong bg-transparent px-3 text-[13px] text-ink-secondary hover:text-ink disabled:cursor-not-allowed disabled:border-line disabled:text-ink-disabled";

interface ToolProps {
  state: SrAdminState;
  run: DeckRun;
  pending: boolean;
  actions: SrActions;
}

/**
 * The SR BroadcastColumn: the shared Preview → TAKE → Program flow over the
 * six SR scenes, with the UBR1 reveal and the starting-soon countdown in the
 * tool slot.
 *
 * Preview loads `/srlive/<slug>?scene=<id>&preview=1` (read-only, muted);
 * Program is `/srlive/<slug>?muted=1`, what the room sees without the desk
 * doubling the reveal cue. TAKE calls setScene. SR has no auto-follow rules,
 * so the Auto-follow toggle is hidden.
 *
 * Start (a queue row or the primary action) and the reveal act on the live
 * screen at once, not through TAKE: setActiveMatch switches to the Match
 * scene, and the reveal plays on the Bracket scene.
 */
export function SrBroadcast({ state, run, pending, actions }: ToolProps) {
  const t = state.tournament;
  const [previewId, setPreviewId] = useState<SrMatchScene>(t.scene);
  const slug = encodeURIComponent(t.slug);

  const scenes: BroadcastScene[] = SR_SCENE_ORDER.map((id) => ({
    id,
    label: SR_SCENE_LABEL[id],
    available: srSceneUnavailableReason(id, state) === null,
  }));

  return (
    <BroadcastColumn
      preview={<ScenePreview sceneLabel={SR_SCENE_LABEL[previewId]} src={`/srlive/${slug}?scene=${encodeURIComponent(previewId)}&preview=1`} />}
      program={<SceneProgram sceneLabel={srOnAirLabel(state)} src={`/srlive/${slug}?muted=1`} />}
      scenes={scenes}
      programId={t.scene}
      previewId={previewId}
      onPreview={(id) => setPreviewId(id as SrMatchScene)}
      onTake={() => void run(() => actions.setScene(t.id, previewId))}
      pending={pending}
      toolSlot={
        <div className="flex flex-col gap-3.5">
          <RevealTool state={state} run={run} pending={pending} actions={actions} />
          <CountdownTool state={state} run={run} pending={pending} actions={actions} />
          <div className="flex flex-wrap gap-3 text-[12px]">
            <a href={`/srlive/${slug}`} target="_blank" rel="noreferrer" className="text-link hover:text-ink">
              Open /srlive full screen ↗
            </a>
            <a href={`/tournaments/summoners-rift/${slug}`} target="_blank" rel="noreferrer" className="text-link hover:text-ink">
              Public bracket ↗
            </a>
          </div>
        </div>
      }
    />
  );
}

/** UBR1 REVEAL (sr-desk-live.html): progress, Start / Replay, Reset. Timed by the server's start stamp. */
function RevealTool({ state, run, pending, actions }: ToolProps) {
  const now = useNow(500);
  const v = srUbr1Reveal(state, now ?? 0);
  if (v.total === 0) return null;
  const t = state.tournament;
  return (
    <section aria-label="UBR1 reveal" className="flex flex-col gap-2 border border-line p-2.5">
      <DeckKicker className="text-[11px]">UBR1 REVEAL</DeckKicker>
      <div className="flex gap-1" aria-hidden="true">
        {Array.from({ length: v.total }, (_, i) => (
          <span key={i} className={cn("h-1.5 flex-1", i < v.shown ? "bg-brand-red-bright" : "bg-elevated")} />
        ))}
      </div>
      <span className="text-[13px] text-ink-secondary" data-reveal-progress>
        {v.started ? `${v.shown} of ${v.total} matchups revealed${v.running ? " · playing" : ""}` : `Not started · ${v.total} matchups`}
      </span>
      <div className="grid grid-cols-2 gap-1.5">
        <button type="button" disabled={pending || v.running} onClick={() => void run(() => actions.startUbr1Reveal(t.id))} className={toolButton}>
          {v.started ? "Replay reveal" : "Start reveal"}
        </button>
        <button type="button" disabled={pending || !v.started} onClick={() => void run(() => actions.resetUbr1Reveal(t.id))} className={toolButton}>
          Reset
        </button>
      </div>
      <span className="text-[12px] text-ink-muted">Plays at once on the Bracket scene, one matchup every 3 seconds.</span>
    </section>
  );
}

/** Starting-soon countdown (the old desk's control): starts the clock and takes Starting soon. */
function CountdownTool({ state, run, pending, actions }: ToolProps) {
  const [minutes, setMinutes] = useState(10);
  const valid = Number.isInteger(minutes) && minutes >= 1 && minutes <= 60;
  const ends = state.tournament.countdown_ends_at;
  return (
    <section aria-label="Countdown" className="flex flex-col gap-2 border border-line p-2.5">
      <DeckKicker className="text-[11px]">STARTING-SOON COUNTDOWN</DeckKicker>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={1}
          max={60}
          value={minutes}
          onChange={(e) => setMinutes(Number(e.target.value))}
          aria-label="Countdown minutes"
          className="h-9 w-16 rounded-sm border border-line-strong bg-base px-2 font-mono text-[13px] text-ink"
        />
        <span className="text-[12px] text-ink-muted">min</span>
        <button
          type="button"
          disabled={pending || !valid}
          onClick={() => void run(() => actions.startCountdown(state.tournament.id, minutes * 60))}
          className={toolButton}
        >
          Start countdown
        </button>
      </div>
      <span className="text-[12px] text-ink-muted">
        {valid ? "Goes on air at once, on the Starting soon scene." : "Between 1 and 60 minutes."}
        {ends
          ? ` Last one ends ${new Date(ends).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" })}.`
          : ""}
      </span>
    </section>
  );
}
