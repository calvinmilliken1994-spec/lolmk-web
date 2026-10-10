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
export const mayhemActions = {
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

export type MayhemActions = typeof mayhemActions;
