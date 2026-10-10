"use client";

import { useEffect, useState } from "react";
import {
  BroadcastColumn,
  DeckKicker,
  ScenePreview,
  SceneProgram,
  type BroadcastScene,
  type DeckRun,
} from "@/components/control-deck";
import { MAX_REVEAL_INTERVAL_MS, MIN_REVEAL_INTERVAL_MS } from "@/lib/mayhem-reveal";
import { cn } from "@/lib/utils";
import type { MayhemAdminState, MayhemScene } from "@/types/mayhem";
import type { MayhemActions } from "./mayhem-actions";
import {
  MAYHEM_SCENE_LABEL,
  MAYHEM_SCENE_ORDER,
  MAYHEM_SCENE_TITLE,
  mayhemReveal,
  mayhemRevealStarted,
  mayhemSceneUnavailableReason,
} from "./mayhem-deck-model";

const toolButton =
  "h-9 rounded-sm border border-line-strong bg-transparent text-[13px] text-ink-secondary hover:text-ink disabled:cursor-not-allowed disabled:border-line disabled:text-ink-disabled";

const MIN_S = MIN_REVEAL_INTERVAL_MS / 1000;
const MAX_S = MAX_REVEAL_INTERVAL_MS / 1000;

/**
 * The Mayhem BroadcastColumn: the shared Preview → TAKE → Program flow, the
 * eight scenes, and the team reveal + countdown in the tool slot.
 *
 * Preview loads `/mayhemlive?scene=<id>&preview=1` (never writes); Program is
 * `/mayhemlive` as the room sees it. TAKE calls setScene. Mayhem defines no
 * auto-follow rules yet, so there is no Auto-follow toggle.
 *
 * The reveal buttons act on the live screen at once, not through TAKE: Reveal
 * next, auto-reveal, Hide last and Restart all write straight to the event,
 * and the server actions also switch the program to the Reveal scene.
 */
export function MayhemBroadcast({
  state,
  run,
  pending,
  actions,
}: {
  state: MayhemAdminState;
  run: DeckRun;
  pending: boolean;
  actions: MayhemActions;
}) {
  const scene = state.event.scene;
  const [previewId, setPreviewId] = useState<MayhemScene>(scene);

  const scenes: BroadcastScene[] = MAYHEM_SCENE_ORDER.map((id) => ({
    id,
    label: MAYHEM_SCENE_LABEL[id],
    available: mayhemSceneUnavailableReason(id, state) === null,
  }));

  const previewSrc = `/mayhemlive?scene=${encodeURIComponent(previewId)}&preview=1`;

  return (
    <BroadcastColumn
      preview={<ScenePreview sceneLabel={MAYHEM_SCENE_TITLE[previewId]} src={previewSrc} />}
      program={<SceneProgram sceneLabel={MAYHEM_SCENE_TITLE[scene]} src="/mayhemlive" />}
      scenes={scenes}
      programId={scene}
      previewId={previewId}
      onPreview={(id) => setPreviewId(id as MayhemScene)}
      onTake={() => void run(() => actions.setScene(previewId))}
      pending={pending}
      toolSlot={
        <div className="flex flex-col gap-3.5">
          {state.teams.length > 0 && <RevealTool state={state} run={run} pending={pending} actions={actions} />}
          <CountdownTool state={state} run={run} pending={pending} actions={actions} />
          <a href="/mayhemlive" target="_blank" rel="noreferrer" className="text-[12px] text-link hover:text-ink">
            Open /mayhemlive full screen ↗
          </a>
        </div>
      }
    />
  );
}

interface ToolProps {
  state: MayhemAdminState;
  run: DeckRun;
  pending: boolean;
  actions: MayhemActions;
}

/** TEAM REVEAL (mayhem-desk-teams.html): progress, Reveal next, auto-reveal, Hide last, Restart. */
function RevealTool({ state, run, pending, actions }: ToolProps) {
  const v = mayhemReveal(state);
  const [interval, setIntervalSeconds] = useState(v.intervalSeconds);
  const [afterCountdown, setAfterCountdown] = useState(false);
  // Follow the server's interval when auto-reveal is (re)armed elsewhere.
  useEffect(() => {
    if (v.running) setIntervalSeconds(v.intervalSeconds);
  }, [v.running, v.intervalSeconds]);

  const validInterval = Number.isInteger(interval) && interval >= MIN_S && interval <= MAX_S;
  const toggleAuto = (on: boolean) =>
    void run(() => (on ? actions.startAutoReveal(interval, afterCountdown) : actions.pauseAutoReveal()));
  const restart = () => {
    if (
      window.confirm(
        "Restart the reveal? Every team comes off the venue screen, auto-reveal stops, and re-roll unlocks again.",
      )
    ) {
      void run(() => actions.restartReveal());
    }
  };

  return (
    <section aria-label="Team reveal" className="flex flex-col gap-2.5 border border-line-strong bg-surface p-3">
      <DeckKicker className="text-[11px]">TEAM REVEAL</DeckKicker>
      <div className="flex gap-1" aria-hidden="true">
        {Array.from({ length: v.total }, (_, i) => (
          <span key={i} className={cn("h-2 flex-1", i < v.shown ? "bg-brand-red-bright" : "bg-elevated")} />
        ))}
      </div>
      <span className="text-[13px] text-ink-secondary" data-reveal-progress>
        {v.shown} of {v.total} teams shown on screen
        {v.running && (v.waitingForCountdown ? " · auto-reveal waits for the countdown" : " · auto-reveal running")}
      </span>
      <button
        type="button"
        disabled={pending || v.running || v.shown >= v.total}
        onClick={() => void run(() => actions.advanceReveal())}
        className={cn(toolButton, "border-brand-blue-bright bg-brand-blue-muted font-semibold text-ink")}
      >
        {v.shown >= v.total ? "Every team is on screen" : `Reveal next team (${v.shown + 1})`}
      </button>
      <label className="flex min-h-9 items-center justify-between gap-2 text-[13px]">
        <span className="flex items-center gap-1.5">
          Auto-reveal every
          <input
            type="number"
            min={MIN_S}
            max={MAX_S}
            value={interval}
            disabled={pending || v.running}
            onChange={(e) => setIntervalSeconds(Number(e.target.value))}
            aria-label="Seconds between each team reveal"
            className="h-7 w-12 rounded-sm border border-line-strong bg-base px-1.5 text-center font-mono text-[12px] text-ink disabled:text-ink-muted"
          />
          s
        </span>
        <input
          type="checkbox"
          checked={v.running}
          disabled={pending || (!v.running && (!validInterval || v.shown >= v.total))}
          onChange={(e) => toggleAuto(e.target.checked)}
          aria-label="Auto-reveal"
          className="h-4 w-4 accent-brand-blue-bright"
        />
      </label>
      {!v.running && (
        <label className="flex items-center gap-2 text-[12px] text-ink-secondary">
          <input
            type="checkbox"
            checked={afterCountdown}
            disabled={pending || !state.event.countdown_ends_at}
            onChange={(e) => setAfterCountdown(e.target.checked)}
            className="h-3.5 w-3.5 accent-brand-blue-bright"
          />
          Start when the countdown ends
        </label>
      )}
      {!v.running && v.shown > 0 && v.shown < v.total && (
        <span className="text-[12px] text-ink-muted">Auto-reveal starts again from team 1.</span>
      )}
      {!validInterval && !v.running && (
        <span className="text-[12px] text-warning-ink">
          Between {MIN_S} and {MAX_S} seconds.
        </span>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        <button type="button" disabled={pending || v.shown === 0} onClick={() => void run(() => actions.hideLastReveal())} className={toolButton}>
          Hide last
        </button>
        <button
          type="button"
          disabled={pending || !mayhemRevealStarted(state)}
          onClick={restart}
          className={toolButton}
        >
          Restart reveal
        </button>
      </div>
    </section>
  );
}

/** Starting-soon countdown (the old desk's control): runs the clock and takes Starting soon. */
function CountdownTool({ state, run, pending, actions }: ToolProps) {
  const [seconds, setSeconds] = useState(60);
  const ends = state.event.countdown_ends_at;
  return (
    <section aria-label="Countdown" className="flex flex-col gap-2 border border-line p-3">
      <DeckKicker className="text-[11px]">STARTING-SOON COUNTDOWN</DeckKicker>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={10}
          value={seconds}
          onChange={(e) => setSeconds(Number(e.target.value))}
          aria-label="Countdown seconds"
          className="h-9 w-20 rounded-sm border border-line-strong bg-base px-2 font-mono text-[13px] text-ink"
        />
        <span className="text-[12px] text-ink-muted">sec</span>
        <button type="button" disabled={pending} onClick={() => void run(() => actions.startCountdown(seconds))} className={cn(toolButton, "px-3")}>
          Start countdown
        </button>
      </div>
      <span className="text-[12px] text-ink-muted">
        Goes on air at once, on the Starting soon scene.
        {ends ? ` Last one ends ${new Date(ends).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Seoul" })}.` : ""}
      </span>
    </section>
  );
}
