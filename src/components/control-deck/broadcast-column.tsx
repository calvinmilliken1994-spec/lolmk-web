"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { LiveFrame } from "./live-frame";
import { DeckKicker } from "./status";

export interface BroadcastScene {
  id: string;
  label: string;
  available: boolean;
}

/** Preview monitor: what TAKE will put on air. Writes nothing. */
export function ScenePreview({
  sceneLabel,
  src,
  children,
}: {
  sceneLabel: string;
  /** Live screen with `?scene=<id>&preview=1`, or null to show `children`. */
  src: string | null;
  children?: ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[12px] text-ink-secondary">
        <span className="font-mono text-link">PREVIEW</span> · {sceneLabel}
      </p>
      <LiveFrame src={src} title={`Preview: ${sceneLabel}`} tone="preview">
        {children}
      </LiveFrame>
    </div>
  );
}

/** Program monitor: the venue screen as it is right now. */
export function SceneProgram({
  sceneLabel,
  src,
  children,
}: {
  sceneLabel: string;
  src: string | null;
  children?: ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[12px] text-ink-secondary">
        <span className="font-mono text-brand-red-bright">● PROGRAM</span> · {sceneLabel}
      </p>
      <LiveFrame src={src} title={`Program: ${sceneLabel}`} tone="program">
        {children}
      </LiveFrame>
    </div>
  );
}

export function TakeButton({ disabled, onTake }: { disabled?: boolean; onTake: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onTake}
      className="h-12 rounded-sm bg-brand-red font-heading text-[16px] font-bold tracking-[0.08em] text-ink hover:bg-brand-red-hover disabled:cursor-not-allowed disabled:bg-primary-disabled disabled:text-primary-disabled-ink"
    >
      TAKE ▸ ON AIR
    </button>
  );
}

/** 2-column scene picker. Clicking loads the scene into preview. */
export function SceneGrid({
  scenes,
  programId,
  previewId,
  onPreview,
}: {
  scenes: BroadcastScene[];
  programId: string | null;
  previewId: string | null;
  onPreview: (sceneId: string) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[12px] text-ink-secondary">Load a scene into preview</p>
      <div className="grid grid-cols-2 gap-1.5">
        {scenes.map((scene) => {
          const onProgram = scene.id === programId;
          const inPreview = scene.id === previewId;
          return (
            <button
              key={scene.id}
              type="button"
              disabled={!scene.available}
              aria-pressed={inPreview}
              onClick={() => onPreview(scene.id)}
              className={cn(
                "h-10 rounded-sm border text-[13px]",
                !scene.available
                  ? "cursor-not-allowed border-dashed border-line bg-transparent text-ink-disabled"
                  : onProgram
                    ? "border-brand-red bg-onair-surface text-ink"
                    : inPreview
                      ? "border-brand-blue-bright bg-brand-blue-muted text-ink"
                      : "border-line-strong bg-surface text-ink-secondary hover:text-ink",
              )}
            >
              {scene.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Right-hand column: header with Auto-follow, preview monitor, TAKE,
 * program monitor, scene grid, then an optional tool slot (UBR1 reveal for
 * SR, team reveal for Mayhem, "auto-follow next" for Riftbound).
 *
 * `preview` and `program` are the monitors (usually ScenePreview and
 * SceneProgram), passed in so each tool picks its frame sources.
 */
export function BroadcastColumn({
  autoFollow,
  onAutoFollowChange,
  preview,
  program,
  scenes,
  programId,
  previewId,
  onPreview,
  onTake,
  pending = false,
  toolSlot,
  className,
}: {
  autoFollow?: boolean;
  /**
   * Omit when the tool defines no auto-follow rules (Mayhem, for now): the
   * Auto-follow checkbox is then hidden rather than shown doing nothing.
   */
  onAutoFollowChange?: (next: boolean) => void;
  preview: ReactNode;
  program: ReactNode;
  scenes: BroadcastScene[];
  programId: string | null;
  previewId: string | null;
  onPreview: (sceneId: string) => void;
  onTake: () => void;
  pending?: boolean;
  toolSlot?: ReactNode;
  className?: string;
}) {
  return (
    <aside aria-label="Broadcast" className={cn("flex min-w-0 flex-auto flex-col gap-3.5 bg-deck-rail p-4", className)}>
      <div className="flex items-center justify-between">
        <DeckKicker>BROADCAST</DeckKicker>
        {onAutoFollowChange && (
          <label className="flex items-center gap-2 text-[12px] text-ink-secondary">
            <input
              type="checkbox"
              checked={autoFollow ?? false}
              disabled={pending}
              onChange={(e) => onAutoFollowChange(e.target.checked)}
              // UA checkbox margins (3px, 4px left), which preflight strips.
              className="m-[3px] ml-1 h-4 w-4 accent-brand-blue-bright"
            />
            Auto-follow
          </label>
        )}
      </div>
      {preview}
      <TakeButton disabled={pending || !previewId || previewId === programId} onTake={onTake} />
      {program}
      <SceneGrid scenes={scenes} programId={programId} previewId={previewId} onPreview={onPreview} />
      {toolSlot}
    </aside>
  );
}

/** Quiet bordered note for the broadcast tool slot. */
export function BroadcastNote({ title, lines }: { title: string; lines: ReactNode[] }) {
  return (
    <div className="flex flex-col gap-1 border border-line p-2.5 text-[12px] text-ink-secondary">
      <span className="font-mono text-[11px] text-ink-muted">{title}</span>
      {lines.map((line, i) => (
        <span key={i}>{line}</span>
      ))}
    </div>
  );
}
