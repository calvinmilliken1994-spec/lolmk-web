import assert from "node:assert/strict";

import { validatePersistedTimerState } from "../src/components/sections/tournament-timer";
import { getLiveChampions } from "../src/lib/champions";
import type { TimerSegment } from "../src/types/timer";

const schedule: TimerSegment[] = [
  { id: "round-1", title: "Round 1", short: "1", minutes: 60, phase: "rounds", kind: "round" },
  { id: "break", title: "Break", short: "B", minutes: 15, phase: "break", kind: "break" },
];

const validPaused = {
  index: 0,
  baseDurationMs: 3_600_000,
  durationMs: 3_600_000,
  remainingMs: 1_800_000,
  running: false,
  endsAt: null,
};

assert.deepEqual(validatePersistedTimerState(validPaused, schedule, 1_000), validPaused);

const validRunning = {
  ...validPaused,
  remainingMs: 2_000,
  running: true,
  endsAt: 3_000,
};
assert.deepEqual(validatePersistedTimerState(validRunning, schedule, 1_000), validRunning);

for (const invalid of [
  { ...validPaused, index: -1 },
  { ...validPaused, index: 0.5 },
  { ...validPaused, index: Number.NaN },
  { ...validPaused, baseDurationMs: 60_000 },
  { ...validPaused, durationMs: Number.POSITIVE_INFINITY },
  { ...validPaused, remainingMs: -1 },
  { ...validPaused, remainingMs: 3_600_001 },
  { ...validPaused, running: "yes" },
  { ...validPaused, endsAt: 3_000 },
  { ...validRunning, endsAt: null },
  { ...validRunning, endsAt: Number.NaN },
  { ...validRunning, endsAt: 3_601_001 },
]) {
  assert.equal(validatePersistedTimerState(invalid, schedule, 1_000), null);
}

assert.equal(validatePersistedTimerState(null, schedule, 1_000), null);
assert.equal(validatePersistedTimerState(validPaused, [], 1_000), null);

void (async () => {
  const tournament = {
    id: "archived-cup",
    slug: "archived-cup",
    name: "Archived Cup",
    format: "single_elim" as const,
    best_of: 3 as const,
    end_at: "2026-09-01T15:00:00.000Z",
    updated_at: "2026-09-02T00:00:00.000Z",
  };
  const champion = {
    id: "team-1",
    name: "Old Guard",
    logo_url: null,
    seed: 1,
    players: [],
  };
  const queries = {
    listTournaments: async () => [tournament],
    getChampions: async () => new Map([[tournament.id, champion]]),
    getRunnersUp: async () => new Map(),
    getCounts: async () => new Map([[tournament.id, 8]]),
  };
  const archived = await getLiveChampions(queries);
  assert.equal(archived[0]?.champion.name, "Old Guard");
  assert.equal(archived[0]?.teams, 8);

  const failedList = await getLiveChampions({
    ...queries,
    listTournaments: async () => {
      throw new Error("list unavailable");
    },
  });
  assert.deepEqual(failedList, []);

  for (const failingQuery of ["getChampions", "getRunnersUp", "getCounts"] as const) {
    const failed = await getLiveChampions({
      ...queries,
      [failingQuery]: async () => {
        throw new Error(`${failingQuery} unavailable`);
      },
    });
    assert.deepEqual(failed, []);
  }

  console.log("Production regression checks passed.");
})();
