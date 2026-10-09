import {
  archiveTournament,
  generateBracket,
  removeTeam,
  reportMatchResult,
  resetUbr1Reveal,
  rollSeeds,
  setActiveMatch,
  setScene,
  setSignupsOpen,
  setTeamStatus,
  startCountdown,
  startUbr1Reveal,
  undoMatchResult,
  unlockSeeds,
  updateTeam,
  updateTournament,
  withdrawTeamApplication,
} from "@/app/tools/summoners-rift/actions";

/**
 * The server actions the SR desk calls, as one object so the desk can be
 * driven by a stand-in set (like rbActions and mayhemActions). Logo upload
 * stays with TeamLogoUpload, which calls its own actions.
 */
export const srActions = {
  archiveTournament,
  generateBracket,
  removeTeam,
  reportMatchResult,
  resetUbr1Reveal,
  rollSeeds,
  setActiveMatch,
  setScene,
  setSignupsOpen,
  setTeamStatus,
  startCountdown,
  startUbr1Reveal,
  undoMatchResult,
  unlockSeeds,
  updateTeam,
  updateTournament,
  withdrawTeamApplication,
};

export type SrActions = typeof srActions;
