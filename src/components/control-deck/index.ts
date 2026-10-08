// Control Deck v2 shared kit. Spec: docs/design/control-deck-v2/.
export * from "./types";
export { useDeckState } from "./use-deck-state";
export { DeckShell } from "./deck-shell";
export { DeckTopBar, type DeckClock, type DeckTopBarProps } from "./deck-top-bar";
export { PhaseRail } from "./phase-rail";
export {
  BroadcastColumn,
  BroadcastNote,
  SceneGrid,
  ScenePreview,
  SceneProgram,
  TakeButton,
  type BroadcastScene,
} from "./broadcast-column";
export { LiveFrame, type LiveFrameTone } from "./live-frame";
export {
  ActivityLog,
  AlertStrip,
  DeckKicker,
  OnAirChip,
  PrimaryAction,
  SyncIndicator,
  type ActivityEntry,
} from "./status";
export { ScorePad, padButtons, type ScorePadFormat, type ScorePadScore } from "./score-pad";
export { DeckSheet } from "./sheet";
export { useNow } from "./use-now";
