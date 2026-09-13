"use server";

import { revalidatePath } from "next/cache";
import { getMemberSession } from "@/lib/discord-auth";
import {
  addRiotId,
  ensureMemberProfileSchema,
  removeRiotId,
  resolveMemberRiotId,
  setPrimaryRiotId,
  updateProfile,
} from "@/lib/member-db";

/**
 * Verified-member self-service write layer.
 *
 * Auth boundary: every action begins with requireMember(), which reads the
 * `lolmk-member-session` cookie via getMemberSession() and validates it
 * against member_sessions + a live Discord role re-check. It does NOT call
 * isToolsSession() or getCaptainSession() — nothing here can be reached with
 * an admin or captain cookie alone.
 *
 * Ownership: every mutation is scoped to the caller's own discordUserId,
 * exactly like captain/actions.ts scopes to captain_discord_id. Nothing here
 * takes a target discord id as an argument that isn't the caller's own.
 */

async function requireMember() {
  const identity = await getMemberSession();
  if (!identity) throw new Error("Not authorized.");
  return identity;
}

function refresh() {
  revalidatePath("/members/profile");
  revalidatePath("/members");
}

export async function updateMyProfile(input: {
  bio?: string;
  preferredRoles?: string[];
  mainChampions?: string[];
  favoriteChampion?: string | null;
  playModes?: string[];
  directoryOptIn?: boolean;
}): Promise<void> {
  const member = await requireMember();
  await ensureMemberProfileSchema();
  await updateProfile(member.discordUserId, input);
  refresh();
}

export async function addMyRiotId(input: {
  gameName: string;
  tagLine: string;
  platform: string;
}): Promise<void> {
  const member = await requireMember();
  await addRiotId(member.discordUserId, input);
  refresh();
}

export async function removeMyRiotId(riotIdId: string): Promise<void> {
  const member = await requireMember();
  await removeRiotId(member.discordUserId, riotIdId);
  refresh();
}

export async function setMyPrimaryRiotId(riotIdId: string): Promise<void> {
  const member = await requireMember();
  await setPrimaryRiotId(member.discordUserId, riotIdId);
  refresh();
}

export async function resolveMyRiotId(
  riotIdId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const member = await requireMember();
  const result = await resolveMemberRiotId(member.discordUserId, riotIdId);
  if (result.ok) refresh();
  return result;
}
