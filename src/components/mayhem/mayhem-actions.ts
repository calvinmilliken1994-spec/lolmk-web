import {
  addPlayer,
  advanceReveal,
  bulkAddPlayers,
  clearAllPlayers,
  finalizePremadeTeams,
  generateGroups,
  generateKnockoutFromAllTeams,
  generateKnockoutFromGroups,
  hideLastReveal,
  pauseAutoReveal,
  randomizeTeams,
  recordMatchResult,
  refreshTeamIdentities,
  removePlayer,
  reportBo1Winner,
  restartReveal,
  setActiveMatch,
  setRegistrationOpen,
  setScene,
  setTeamFormat,
  startAutoReveal,
  startCountdown,
  undoMatchResult,
  updateFormat,
} from "@/app/tools/mayhem/actions";

/**
 * The server actions the Mayhem desk calls, as one object so the desk can be
 * driven by a stand-in set (like rbActions for Riftbound).
 */
const serverMayhemActions = {
  addPlayer,
  advanceReveal,
  bulkAddPlayers,
  clearAllPlayers,
  finalizePremadeTeams,
  generateGroups,
  generateKnockoutFromAllTeams,
  generateKnockoutFromGroups,
  hideLastReveal,
  pauseAutoReveal,
  randomizeTeams,
  recordMatchResult,
  refreshTeamIdentities,
  removePlayer,
  reportBo1Winner,
  restartReveal,
  setActiveMatch,
  setRegistrationOpen,
  setScene,
  setTeamFormat,
  startAutoReveal,
  startCountdown,
  undoMatchResult,
  updateFormat,
};

type Tail<T extends unknown[]> = T extends [unknown, ...infer Rest] ? Rest : never;
export type MayhemActions = { [K in keyof typeof serverMayhemActions]: (...args: Tail<Parameters<(typeof serverMayhemActions)[K]>>) => ReturnType<(typeof serverMayhemActions)[K]> };
export function bindMayhemActions(selection: import("@/lib/mayhem-operation").MayhemSelection): MayhemActions {
  return Object.fromEntries(Object.entries(serverMayhemActions).map(([name, action]) => [name, (...args: unknown[]) =>
    (action as (selection: import("@/lib/mayhem-operation").MayhemSelection, ...args: unknown[]) => Promise<unknown>)(selection, ...args)])) as MayhemActions;
}
// Safe default for pure deck definitions/tests. The real desk always binds its
// own explicit event and generation, never a singleton/current fallback.
export const mayhemActions = bindMayhemActions({ eventId: "", generation: -1 });
