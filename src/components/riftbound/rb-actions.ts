"use client";

// The server actions the Riftbound desk calls, gathered in one object so the
// desk components take them as a prop. In the app that is `rbActions`; a test
// page with no database or Discord login can pass its own implementation of
// the same shape.

import {
  acknowledgeFlag,
  addExtension,
  adjustClock,
  closeCheckInAndPairRound1,
  closeRound,
  completeEvent,
  cutToTop,
  flagTable,
  openCheckIn,
  pairNextRound,
  pauseClock,
  publishRound,
  reportResult,
  reportTopCutResult,
  resumeClock,
  setAutoFollow,
  setMatchStarted,
  setScene,
  startClock,
  swapDraftPairing,
  undoDrop,
  undoResult,
  undoTopCutResult,
  unpublishRound,
} from "@/app/tools/riftbound/actions";

export const rbActions = {
  acknowledgeFlag,
  addExtension,
  adjustClock,
  closeCheckInAndPairRound1,
  closeRound,
  completeEvent,
  cutToTop,
  flagTable,
  openCheckIn,
  pairNextRound,
  pauseClock,
  publishRound,
  reportResult,
  reportTopCutResult,
  resumeClock,
  setAutoFollow,
  setMatchStarted,
  setScene,
  startClock,
  swapDraftPairing,
  undoDrop,
  undoResult,
  undoTopCutResult,
  unpublishRound,
};

export type RbActions = typeof rbActions;
