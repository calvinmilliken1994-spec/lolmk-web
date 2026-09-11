// Compat shim: ARAM Mayhem's bracket generation now lives in the shared
// bracket-engine.ts (also used by the Summoner's Rift tournament tool).
// This file just adapts MayhemMatch's `event_id: "main"` shape to the
// generic engine's `tournamentId` option so every existing call site in
// src/app/tools/mayhem/actions.ts keeps working unchanged.

import type { MayhemMatch, SeriesLength } from "@/types/mayhem";
import {
  buildKnockoutBracket as buildGenericKnockoutBracket,
  resolveByes as resolveGenericByes,
  type BracketMatch,
  type BuildOptions as GenericBuildOptions,
} from "./bracket-engine";

const MAYHEM_EVENT_ID = "main";

interface BuildOptions {
  knockoutBestOf: SeriesLength;
  doubleElimination: boolean;
  thirdPlaceMatch: boolean;
  grandFinalReset: boolean;
  groupId?: string | null;
  startMatchNumber?: number;
  idFactory?: () => string;
}

function toMayhemMatch(m: BracketMatch): MayhemMatch {
  return { ...m } as MayhemMatch;
}

export function buildKnockoutBracket(
  teamIdsBySeed: string[],
  opts: BuildOptions,
): MayhemMatch[] {
  const genericOpts: GenericBuildOptions = { ...opts, tournamentId: MAYHEM_EVENT_ID };
  return buildGenericKnockoutBracket(teamIdsBySeed, genericOpts).map(toMayhemMatch);
}

export function resolveByes(matches: MayhemMatch[]): MayhemMatch[] {
  return resolveGenericByes(matches as unknown as BracketMatch[]).map(toMayhemMatch);
}
