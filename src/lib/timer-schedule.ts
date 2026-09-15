import type { TimerSegment } from "@/types/timer";

/**
 * Standard Swiss-round count by player count, used to suggest a round count
 * in the timer setup screen. Player counts outside 4–512 have no preset —
 * the admin picks a round count manually rather than us silently guessing.
 */
export const SWISS_ROUND_PRESETS: { minPlayers: number; maxPlayers: number; rounds: number }[] = [
  { minPlayers: 4, maxPlayers: 8, rounds: 3 },
  { minPlayers: 9, maxPlayers: 16, rounds: 4 },
  { minPlayers: 17, maxPlayers: 32, rounds: 5 },
  { minPlayers: 33, maxPlayers: 64, rounds: 6 },
  { minPlayers: 65, maxPlayers: 128, rounds: 7 },
  { minPlayers: 129, maxPlayers: 256, rounds: 8 },
  { minPlayers: 257, maxPlayers: 512, rounds: 9 },
];

/** Range the Swiss-round preset table covers. Outside this, rounds must be set manually. */
export const MIN_SUPPORTED_PLAYERS = 4;
export const MAX_SUPPORTED_PLAYERS = 512;

/** Sanity bounds for the player-count field itself — independent of preset coverage. */
export const ABSOLUTE_MIN_PLAYERS = 1;
export const ABSOLUTE_MAX_PLAYERS = 100_000;

export const MIN_ROUNDS = 1;
export const MAX_ROUNDS = 20;

/** Shared bound for both round and break length fields, in the UI and the persisted validator. */
export const MAX_SEGMENT_MINUTES = 999;

export const DEFAULT_PLAYER_COUNT = 64;
export const DEFAULT_ROUND_MINUTES = 60;
export const DEFAULT_BREAK_MINUTES = 30;

export const MAX_TITLE_LENGTH = 60;
/** Matches the title the timer rendered before it became configurable. */
export const DEFAULT_TIMER_TITLE = "LoLMK Poro Cup";

/** Rounds to the nearest integer and clamps to [min, max]. Non-finite input falls back to min. */
export function clampInt(value: number, min: number, max: number): number {
  const n = Number.isFinite(value) ? Math.round(value) : min;
  return Math.min(max, Math.max(min, n));
}

/**
 * Background art for the live timer and its setup preview. Ids are the only
 * thing ever persisted — the file path is looked up from this table, so a
 * saved config can never point at an arbitrary image path.
 */
export type TimerBackgroundId = "lolmk" | "ggx" | "riftbound-cardback" | "riftbound-logo";

export interface TimerBackgroundOption {
  id: TimerBackgroundId;
  label: string;
  src: string;
  /** True for art that should tile as a rotated repeating pattern rather than one centered watermark. */
  tiled?: boolean;
  /** Pre-composited repeat tile (running-bond layout) used instead of `src` when `tiled` is true. */
  tileSrc?: string;
  /** Set instead of `src` for options that composite two images side by side. */
  pair?: [string, string];
}

export const TIMER_BACKGROUNDS: TimerBackgroundOption[] = [
  { id: "lolmk", label: "LoLMK Logo", src: "/images/timer/logo.png" },
  {
    id: "ggx",
    label: "LoLMK x GenG GGX",
    src: "/images/timer/ggxlogo.png",
    pair: ["/images/timer/logo.png", "/images/timer/ggxlogo.png"],
  },
  {
    id: "riftbound-cardback",
    label: "Riftbound Card Back",
    src: "/images/timer/riftboundcardback.png",
    tileSrc: "/images/timer/riftboundcardback-tile.png",
    tiled: true,
  },
  { id: "riftbound-logo", label: "Riftbound Logo", src: "/images/timer/riftboundlogo.png" },
];

export const DEFAULT_TIMER_BACKGROUND: TimerBackgroundId = "lolmk";

/** Suggested Swiss round count for a player count, per the standard table. Null outside 4–512. */
export function suggestedRoundsForPlayers(playerCount: number): number | null {
  const preset = SWISS_ROUND_PRESETS.find(
    (p) => playerCount >= p.minPlayers && playerCount <= p.maxPlayers,
  );
  return preset?.rounds ?? null;
}

export interface TimerSetupConfig {
  title: string;
  background: TimerBackgroundId;
  playerCount: number;
  rounds: number;
  roundMinutes: number;
  /** Round numbers (1-indexed) after which an intermission is inserted. Never `>= rounds`. */
  breakAfterRounds: number[];
  breakMinutes: number;
}

export const DEFAULT_TIMER_SETUP: TimerSetupConfig = {
  title: DEFAULT_TIMER_TITLE,
  background: DEFAULT_TIMER_BACKGROUND,
  playerCount: DEFAULT_PLAYER_COUNT,
  rounds: suggestedRoundsForPlayers(DEFAULT_PLAYER_COUNT) ?? 6,
  roundMinutes: DEFAULT_ROUND_MINUTES,
  breakAfterRounds: [],
  breakMinutes: DEFAULT_BREAK_MINUTES,
};

/**
 * Builds the ordered segment schedule the timer plays through. Round
 * titles/short labels are the competitive round number, which stays
 * sequential even though intermissions add extra entries to the array — so
 * "Round 5" is still round 5 in the schedule, not "segment 6".
 */
export function buildTimerSchedule(config: TimerSetupConfig): TimerSegment[] {
  const rounds = Math.max(MIN_ROUNDS, Math.min(MAX_ROUNDS, Math.floor(config.rounds)));
  // Breaks strictly before the final round only — a break "after round N" on
  // an N-round event would just run past the tournament, so it's dropped.
  const validBreaks = new Set(
    config.breakAfterRounds.filter((r) => Number.isInteger(r) && r >= 1 && r < rounds),
  );

  const segments: TimerSegment[] = [];
  for (let round = 1; round <= rounds; round++) {
    const isFinal = round === rounds;
    segments.push({
      id: `round-${round}`,
      kind: isFinal ? "final" : "round",
      phase: "rounds",
      title: `Round ${round}`,
      short: String(round),
      minutes: config.roundMinutes,
    });
    if (validBreaks.has(round)) {
      segments.push({
        id: `break-${round}`,
        kind: "break",
        phase: "break",
        title: "Intermission",
        short: "BREAK",
        minutes: config.breakMinutes,
      });
    }
  }
  return segments;
}

const SETUP_STORAGE_KEY = "lolmk-timer-setup-v1";

/**
 * Treats localStorage as untrusted input, same posture as the timer's own
 * persisted state. `title`/`background` are optional here on purpose: a
 * config saved before those fields existed is still valid and receives the
 * shipped defaults, rather than being discarded outright.
 */
export function validateTimerSetupConfig(value: unknown): TimerSetupConfig | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const { playerCount, rounds, roundMinutes, breakAfterRounds, breakMinutes, title, background } = v;

  if (
    typeof playerCount !== "number" ||
    !Number.isInteger(playerCount) ||
    playerCount < ABSOLUTE_MIN_PLAYERS ||
    playerCount > ABSOLUTE_MAX_PLAYERS ||
    typeof rounds !== "number" ||
    !Number.isInteger(rounds) ||
    rounds < MIN_ROUNDS ||
    rounds > MAX_ROUNDS ||
    typeof roundMinutes !== "number" ||
    !Number.isInteger(roundMinutes) ||
    roundMinutes <= 0 ||
    roundMinutes > MAX_SEGMENT_MINUTES ||
    typeof breakMinutes !== "number" ||
    !Number.isInteger(breakMinutes) ||
    breakMinutes <= 0 ||
    breakMinutes > MAX_SEGMENT_MINUTES ||
    !Array.isArray(breakAfterRounds) ||
    !breakAfterRounds.every((r) => Number.isInteger(r) && r >= 1 && r < rounds)
  ) {
    return null;
  }

  let resolvedTitle = DEFAULT_TIMER_TITLE;
  if (title !== undefined) {
    if (typeof title !== "string") return null;
    const trimmed = title.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_TITLE_LENGTH) return null;
    resolvedTitle = trimmed;
  }

  let resolvedBackground: TimerBackgroundId = DEFAULT_TIMER_BACKGROUND;
  if (background !== undefined) {
    if (typeof background !== "string" || !TIMER_BACKGROUNDS.some((b) => b.id === background)) {
      return null;
    }
    resolvedBackground = background as TimerBackgroundId;
  }

  return {
    title: resolvedTitle,
    background: resolvedBackground,
    playerCount,
    rounds,
    roundMinutes,
    breakAfterRounds: [...(breakAfterRounds as number[])],
    breakMinutes,
  };
}

export function loadTimerSetupConfig(): TimerSetupConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SETUP_STORAGE_KEY);
    if (!raw) return null;
    return validateTimerSetupConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Only ever persists a config that has already passed
 * `validateTimerSetupConfig` (the setup screen sanitizes at launch time) —
 * otherwise a fractional or out-of-range value typed into a number input
 * could be written to storage, then get silently discarded as invalid on
 * the next load instead of being clamped up front.
 */
export function saveTimerSetupConfig(config: TimerSetupConfig): void {
  try {
    localStorage.setItem(SETUP_STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* storage unavailable — setup just won't be remembered next visit */
  }
}
