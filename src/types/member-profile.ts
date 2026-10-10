// Verified-member profile types. Distinct from src/types/member.ts, which
// backs the OLD content-driven "Featured Members" homepage section
// (src/data/members.json, hand-authored streamer/creator blurbs). This file
// is the NEW self-service profile system: a real Discord-authenticated
// member edits their own row, and only rows that opt in ever render on the
// public /members directory.

import type { SrPlayerRole } from "@/types/sr-tournament";

/** Reuses the roster role vocabulary — no reason to invent a second one. */
export type MemberPreferredRole = SrPlayerRole;

export type MemberPlayMode = "RANKED" | "CASUAL" | "ARAM";

export const MEMBER_PLAY_MODES: MemberPlayMode[] = ["RANKED", "CASUAL", "ARAM"];

/**
 * Computed from the caller's LIVE Discord roles at login/reverify time —
 * never hand-set by the member themselves. `null` means "not staff": the
 * member can still have a profile and opt into the directory checkbox, but
 * they will never render in the Admins/Game Coordinators sections, because
 * those are the only two groups this directory shows.
 */
export type MemberDirectoryCategory = "admin" | "coordinator" | null;

export const RIOT_PLATFORMS = [
  "na1",
  "euw1",
  "eun1",
  "kr",
  "jp1",
  "br1",
  "la1",
  "la2",
  "oc1",
  "tr1",
  "ru",
] as const;

export type RiotPlatform = (typeof RIOT_PLATFORMS)[number];

export const RIOT_PLATFORM_LABELS: Record<RiotPlatform, string> = {
  na1: "NA",
  euw1: "EUW",
  eun1: "EUNE",
  kr: "KR",
  jp1: "JP",
  br1: "BR",
  la1: "LAN",
  la2: "LAS",
  oc1: "OCE",
  tr1: "TR",
  ru: "RU",
};

export interface MemberProfile {
  discordUserId: string;
  /** Cached from Discord at last login: guild nickname > global display name > username. */
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  preferredRoles: MemberPreferredRole[];
  mainChampions: string[];
  favoriteChampion: string | null;
  playModes: MemberPlayMode[];
  directoryOptIn: boolean;
  directoryCategory: MemberDirectoryCategory;
  createdAt: string;
  updatedAt: string;
}

export interface MemberRiotId {
  id: string;
  discordUserId: string;
  gameName: string;
  tagLine: string;
  platform: RiotPlatform;
  /** Resolved via an explicit "Resolve" action, never automatically. Null until then. */
  puuid: string | null;
  isPrimary: boolean;
  lastResolvedAt: string | null;
  createdAt: string;
}

/** Cached Riot enrichment for one Riot ID — refreshed only on explicit request. */
export interface MemberRiotEnrichment {
  riotIdId: string;
  profileIconId: number | null;
  /** Up to 3, most points first. Champion identity resolved via Data Dragon at read time, not stored. */
  topChampionMasteries: { championId: number; championPoints: number; championLevel: number }[];
  fetchedAt: string;
}

/** A directory entry as a visitor sees it — self-reported fields only, never the Discord id. */
export interface MemberDirectoryEntry {
  /** Display name with any "RiotName#TAG (Name)" nickname pattern stripped to the name. */
  displayName: string;
  /** Primary linked Riot ID, else one parsed from the Discord nickname. Null when neither exists. */
  riotId: string | null;
  avatarUrl: string | null;
  /** "member" when the person has no staff category (opted-in members). */
  category: "admin" | "coordinator" | "member";
  bio: string;
  preferredRoles: MemberPreferredRole[];
  favoriteChampion: string | null;
}
