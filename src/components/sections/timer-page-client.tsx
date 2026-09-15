"use client";

import { useEffect, useState } from "react";
import { TournamentTimer, STORAGE_KEY as TIMER_RUN_STORAGE_KEY } from "@/components/sections/tournament-timer";
import { TimerSetup } from "@/components/sections/timer-setup";
import {
  DEFAULT_TIMER_SETUP,
  buildTimerSchedule,
  loadTimerSetupConfig,
  saveTimerSetupConfig,
  type TimerSetupConfig,
} from "@/lib/timer-schedule";

/**
 * Owns the setup <-> timer mode switch for /tools/timer. Always opens on
 * setup — a saved config from a previous visit pre-fills the form (so a
 * repeat admin doesn't have to re-enter everything) but no longer
 * auto-jumps into the live timer, since /tools/timer is meant to land on
 * setup every time it's opened from the Tools index, not resume whatever
 * was last launched.
 */
export function TimerPageClient() {
  const [mode, setMode] = useState<"setup" | "timer">("setup");
  const [config, setConfig] = useState<TimerSetupConfig>(DEFAULT_TIMER_SETUP);

  useEffect(() => {
    const saved = loadTimerSetupConfig();
    if (saved) {
      setConfig(saved);
    }
  }, []);

  function handleLaunch(next: TimerSetupConfig) {
    saveTimerSetupConfig(next);
    // A fresh launch means a (possibly) different schedule shape — round
    // count, minutes, or break positions may have changed. Drop any
    // in-progress run state rather than let it coincidentally validate
    // against the new schedule and resume mid-way through the wrong thing.
    try {
      localStorage.removeItem(TIMER_RUN_STORAGE_KEY);
    } catch {
      /* storage unavailable — nothing to clear */
    }
    setConfig(next);
    setMode("timer");
  }

  if (mode === "setup") {
    return <TimerSetup initial={config} onLaunch={handleLaunch} />;
  }

  return (
    <TournamentTimer
      schedule={buildTimerSchedule(config)}
      title={config.title}
      background={config.background}
      onEditSetup={() => setMode("setup")}
    />
  );
}
