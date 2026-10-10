import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LOCKER_LOGIN, LockerContent } from "@/components/locker/locker-content";
import { getMemberSession } from "@/lib/discord-auth";
import { pageMetadata } from "@/lib/metadata";

export const metadata: Metadata = pageMetadata({
  title: "Locker",
  description: "Your LoLMK tournaments, your team, and what you've signed up for.",
  path: "/locker",
  noindex: true,
});

export const dynamic = "force-dynamic";

/**
 * /locker: the signed-in member hub. Signed-out visitors go through Discord
 * sign-in and come back here (next=/locker).
 */
export default async function LockerPage() {
  const member = await getMemberSession();
  if (!member) redirect(LOCKER_LOGIN);
  return <LockerContent discordUserId={member.discordUserId} />;
}
