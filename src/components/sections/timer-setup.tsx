"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Coffee, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TimerBackground } from "@/components/sections/timer-background";
import {
  ABSOLUTE_MAX_PLAYERS,
  ABSOLUTE_MIN_PLAYERS,
  MAX_ROUNDS,
  MAX_SEGMENT_MINUTES,
  MAX_SUPPORTED_PLAYERS,
  MAX_TITLE_LENGTH,
  MIN_ROUNDS,
  MIN_SUPPORTED_PLAYERS,
  TIMER_BACKGROUNDS,
  clampInt,
  suggestedRoundsForPlayers,
  type TimerSetupConfig,
} from "@/lib/timer-schedule";

export function TimerSetup({
  initial,
  onLaunch,
}: {
  initial: TimerSetupConfig;
  onLaunch: (config: TimerSetupConfig) => void;
}) {
  const [config, setConfig] = useState<TimerSetupConfig>(initial);
  const [playerCountInput, setPlayerCountInput] = useState(String(initial.playerCount));
  const [roundMinutesInput, setRoundMinutesInput] = useState(String(initial.roundMinutes));
  const [breakMinutesInput, setBreakMinutesInput] = useState(String(initial.breakMinutes));
  const [roundsTouched, setRoundsTouched] = useState(false);

  const suggested = suggestedRoundsForPlayers(config.playerCount);
  const outOfPresetRange =
    config.playerCount < MIN_SUPPORTED_PLAYERS || config.playerCount > MAX_SUPPORTED_PLAYERS;

  const breakOptions = useMemo(
    () => Array.from({ length: Math.max(0, config.rounds - 1) }, (_, i) => i + 1),
    [config.rounds],
  );

  function updatePlayerCount(raw: string) {
    setPlayerCountInput(raw);
    const n = Number(raw);
    if (!raw || !Number.isFinite(n) || !Number.isInteger(n)) return;
    const clamped = clampInt(n, ABSOLUTE_MIN_PLAYERS, ABSOLUTE_MAX_PLAYERS);
    setConfig((c) => {
      const nextRounds =
        !roundsTouched && suggestedRoundsForPlayers(clamped) != null
          ? suggestedRoundsForPlayers(clamped)!
          : c.rounds;
      return {
        ...c,
        playerCount: clamped,
        rounds: nextRounds,
        breakAfterRounds: c.breakAfterRounds.filter((r) => r < nextRounds),
      };
    });
  }

  function updateRounds(n: number, markTouched = true) {
    if (markTouched) setRoundsTouched(true);
    const rounds = clampInt(n, MIN_ROUNDS, MAX_ROUNDS);
    setConfig((c) => ({
      ...c,
      rounds,
      // A shrunk round count can leave stale break selections pointing past
      // the new final round — drop anything that's no longer valid.
      breakAfterRounds: c.breakAfterRounds.filter((r) => r < rounds),
    }));
  }

  function resetRoundsToSuggested() {
    if (suggested == null) return;
    // Order matters: updateRounds(n, true) (its default) would immediately
    // re-mark rounds as manually touched, which defeats the point of a
    // "reset to suggested, let player count drive it again" action.
    updateRounds(suggested, false);
    setRoundsTouched(false);
  }

  function toggleBreak(round: number) {
    setConfig((c) => {
      const has = c.breakAfterRounds.includes(round);
      const breakAfterRounds = has
        ? c.breakAfterRounds.filter((r) => r !== round)
        : [...c.breakAfterRounds, round].sort((a, b) => a - b);
      return { ...c, breakAfterRounds };
    });
  }

  function updateRoundMinutes(raw: string) {
    setRoundMinutesInput(raw);
    const n = Number(raw);
    if (!raw || !Number.isFinite(n) || !Number.isInteger(n)) return;
    setConfig((c) => ({ ...c, roundMinutes: clampInt(n, 1, MAX_SEGMENT_MINUTES) }));
  }

  function updateBreakMinutes(raw: string) {
    setBreakMinutesInput(raw);
    const n = Number(raw);
    if (!raw || !Number.isFinite(n) || !Number.isInteger(n)) return;
    setConfig((c) => ({ ...c, breakMinutes: clampInt(n, 1, MAX_SEGMENT_MINUTES) }));
  }

  function updateTitle(raw: string) {
    setConfig((c) => ({ ...c, title: raw.slice(0, MAX_TITLE_LENGTH) }));
  }

  const totalMinutes =
    config.rounds * config.roundMinutes + config.breakAfterRounds.length * config.breakMinutes;
  const totalLabel =
    totalMinutes >= 60
      ? `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`
      : `${totalMinutes}m`;

  // Fields hold their own text state so an in-progress edit (empty string,
  // a trailing decimal point) isn't clobbered by the numeric config value
  // on every keystroke; launch instead sanitizes from config, which is
  // already clamped to valid integers as each field commits.
  const trimmedTitle = config.title.trim();
  const canLaunch = trimmedTitle.length > 0;

  function handleLaunch() {
    if (!canLaunch) return;
    onLaunch({ ...config, title: trimmedTitle });
  }

  return (
    <div className="min-h-screen bg-base text-ink">
      <header className="sticky top-0 z-10 border-b border-line-subtle bg-base/90 backdrop-blur-md">
        <div className="container-wide flex items-center justify-between py-4">
          <div className="flex items-center gap-4">
            <Link
              href="/tools"
              className="inline-flex items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink"
            >
              <ArrowLeft strokeWidth={1.75} className="h-4 w-4" />
              Tools
            </Link>
            <div className="h-4 w-px bg-line" />
            <h1 className="font-display text-heading-lg leading-none">Tournament Timer</h1>
          </div>
        </div>
      </header>

      <div className="relative">
        <div className="relative container-wide py-12 md:py-16">
        <div className="max-w-2xl space-y-2 mb-10">
          <h1 className="font-heading text-display-md text-ink leading-tight">Timer setup</h1>
          <p className="text-body-lg text-ink-secondary">
            Set the round count and intermissions before launching the round timer.
          </p>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.6fr)] gap-6 items-start max-w-7xl">
          <div className="space-y-6">
            <div className="bg-surface border border-line p-6 space-y-4">
              <h2 className="font-heading text-heading-md">Tournament</h2>
              <div className="space-y-1.5">
                <label className="text-label uppercase text-ink-muted" htmlFor="tournament-title">
                  Title
                </label>
                <input
                  id="tournament-title"
                  type="text"
                  maxLength={MAX_TITLE_LENGTH}
                  value={config.title}
                  onChange={(e) => updateTitle(e.target.value)}
                  placeholder="e.g. LoLMK Poro Cup"
                  className="w-full bg-elevated border border-line rounded-sm px-3 py-2.5 text-body-md"
                />
                {!canLaunch && (
                  <p className="text-body-sm text-danger">Title can&apos;t be empty.</p>
                )}
              </div>

              <div className="space-y-1.5">
                <p className="text-label uppercase text-ink-muted">Background</p>
                <div className="grid grid-cols-2 gap-2">
                  {TIMER_BACKGROUNDS.map((bg) => (
                    <button
                      key={bg.id}
                      type="button"
                      onClick={() => setConfig((c) => ({ ...c, background: bg.id }))}
                      className={`px-3 py-2.5 text-body-sm border rounded-sm transition-colors text-left ${
                        config.background === bg.id
                          ? "border-brand-red bg-brand-red/10 text-ink"
                          : "border-line text-ink-secondary hover:border-line-strong"
                      }`}
                    >
                      {bg.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="bg-surface border border-line p-6 space-y-4">
              <h2 className="font-heading text-heading-md">Players</h2>
              <div className="space-y-1.5">
                <label className="text-label uppercase text-ink-muted" htmlFor="player-count">
                  Player count
                </label>
                <input
                  id="player-count"
                  type="number"
                  min={ABSOLUTE_MIN_PLAYERS}
                  max={ABSOLUTE_MAX_PLAYERS}
                  step={1}
                  value={playerCountInput}
                  onChange={(e) => updatePlayerCount(e.target.value)}
                  className="w-full bg-elevated border border-line rounded-sm px-3 py-2.5 text-body-md"
                />
              </div>
              {outOfPresetRange ? (
                <p className="text-body-sm text-ink-secondary">
                  No standard preset covers {config.playerCount} players (presets run{" "}
                  {MIN_SUPPORTED_PLAYERS}–{MAX_SUPPORTED_PLAYERS}). Set the round count manually.
                </p>
              ) : (
                <p className="text-body-sm text-ink-secondary">
                  Suggested: <span className="text-ink font-semibold">{suggested} Swiss rounds</span>
                  {" "}for {config.playerCount} players.
                </p>
              )}
            </div>

            <div className="bg-surface border border-line p-6 space-y-4">
              <h2 className="font-heading text-heading-md">Rounds</h2>
              <div className="inline-flex items-center border border-line rounded-sm">
                <button
                  type="button"
                  className="px-4 py-2.5 hover:bg-elevated"
                  onClick={() => updateRounds(config.rounds - 1)}
                >
                  −
                </button>
                <span className="px-6 py-2.5 font-mono tabular text-body-md min-w-[3rem] text-center">
                  {config.rounds}
                </span>
                <button
                  type="button"
                  className="px-4 py-2.5 hover:bg-elevated"
                  onClick={() => updateRounds(config.rounds + 1)}
                >
                  +
                </button>
              </div>
              {suggested != null && config.rounds !== suggested && (
                <button
                  type="button"
                  onClick={resetRoundsToSuggested}
                  className="text-body-sm text-brand-red-bright hover:underline"
                >
                  Reset to suggested ({suggested})
                </button>
              )}

              <div className="flex flex-col items-start gap-3 pt-2">
                <label className="text-label uppercase text-ink-muted" htmlFor="round-minutes">
                  Minutes per round
                </label>
                <input
                  id="round-minutes"
                  type="number"
                  min={1}
                  max={MAX_SEGMENT_MINUTES}
                  step={1}
                  value={roundMinutesInput}
                  onChange={(e) => updateRoundMinutes(e.target.value)}
                  className="w-28 bg-elevated border border-line rounded-sm px-3 py-2.5 text-body-md"
                />
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-surface border border-line p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-heading text-heading-md">Intermissions</h2>
                <Coffee strokeWidth={1.75} className="h-5 w-5 text-brand-blue-bright" />
              </div>
              {breakOptions.length === 0 ? (
                <p className="text-body-sm text-ink-secondary">
                  Need at least 2 rounds to insert an intermission.
                </p>
              ) : (
                <div className="space-y-2">
                  {breakOptions.map((round) => (
                    <label
                      key={round}
                      className="flex items-center justify-between gap-3 cursor-pointer rounded-sm border border-line px-3 py-2.5 hover:border-line-strong"
                    >
                      <span className="text-body-sm text-ink-secondary">
                        After Round {round}
                      </span>
                      <input
                        type="checkbox"
                        checked={config.breakAfterRounds.includes(round)}
                        onChange={() => toggleBreak(round)}
                      />
                    </label>
                  ))}
                </div>
              )}

              <div className="space-y-1.5 pt-2">
                <label className="text-label uppercase text-ink-muted" htmlFor="break-minutes">
                  Intermission length (minutes)
                </label>
                <input
                  id="break-minutes"
                  type="number"
                  min={1}
                  max={MAX_SEGMENT_MINUTES}
                  step={1}
                  value={breakMinutesInput}
                  onChange={(e) => updateBreakMinutes(e.target.value)}
                  className="w-28 bg-elevated border border-line rounded-sm px-3 py-2.5 text-body-md"
                />
              </div>
            </div>

            <div className="bg-surface border border-line p-6 space-y-3">
              <p className="text-body-sm text-ink-secondary">
                {config.rounds} rounds · {config.breakAfterRounds.length}{" "}
                {config.breakAfterRounds.length === 1 ? "intermission" : "intermissions"} · ~
                {totalLabel} total
              </p>
              <Button size="lg" className="w-full" onClick={handleLaunch} disabled={!canLaunch}>
                <Play className="h-5 w-5" /> Launch timer
              </Button>
            </div>
          </div>

          <div className="space-y-6">
            <TimerPreview
              title={trimmedTitle || "Untitled tournament"}
              background={config.background}
              roundMinutes={config.roundMinutes}
            />
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

/**
 * Static preview of the live timer's look — same background treatment and
 * typography, a fixed round-length readout. Deliberately does NOT mount
 * <TournamentTimer>: that component hydrates/writes real run state to
 * localStorage, starts its ticking interval, and binds page-wide keyboard
 * shortcuts and fullscreen handlers, none of which should fire from a
 * setup-screen preview.
 */
function TimerPreview({
  title,
  background,
  roundMinutes,
}: {
  title: string;
  background: TimerSetupConfig["background"];
  roundMinutes: number;
}) {
  const clock = `${String(roundMinutes).padStart(2, "0")}:00`;
  return (
    <div className="relative overflow-hidden rounded-md border border-line bg-base aspect-video">
      <div aria-hidden className="grain pointer-events-none absolute inset-0" />
      <TimerBackground backgroundId={background} />
      <div className="relative flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="line-clamp-2 font-display text-[clamp(1rem,3.2vw,1.5rem)] leading-tight tracking-[0.02em] text-ink">
          {title}
        </p>
        <p className="font-display text-[clamp(2rem,9vw,3.5rem)] leading-none tabular tracking-[0.01em] text-ink">
          {clock}
        </p>
        <span className="rounded-sm bg-elevated px-2.5 py-1 text-label uppercase text-ink-muted">
          Round 1 preview
        </span>
      </div>
    </div>
  );
}
