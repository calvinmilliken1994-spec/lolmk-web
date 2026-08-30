import scheduleData from "@/data/poro-cup-schedule.json";
import type { TimerSegment } from "@/types/timer";

/**
 * The LoLMK Poro Cup match schedule that drives the /tools/timer page.
 *
 * Today this reads a static JSON file. Durations are edited there — every
 * round is 60 minutes and the break is 15. Per the data-access convention in
 * CLAUDE.md, components never import the JSON directly; they go through here,
 * so a future move to a CMS or the tournament bot API is a change to this
 * helper only.
 */
export function getPoroCupSchedule(): TimerSegment[] {
  return scheduleData as TimerSegment[];
}
