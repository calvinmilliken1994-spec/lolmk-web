export type TimerSegmentKind = "round" | "break" | "final";

/** Grouping used by the schedule rail on the timer page. */
export type TimerPhase = "rounds" | "break" | "topcut";

export interface TimerSegment {
  /** Stable id, e.g. "round-1". */
  id: string;
  kind: TimerSegmentKind;
  phase: TimerPhase;
  /** Full name shown in the readout, e.g. "Round 1", "Grand Final". */
  title: string;
  /** Compact label for the rail chip, e.g. "1", "BREAK". */
  short: string;
  /** Segment length in minutes. */
  minutes: number;
}
