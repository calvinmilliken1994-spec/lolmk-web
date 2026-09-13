import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getMemberSession } from "@/lib/discord-auth";
import { getProfile, listRiotIds } from "@/lib/member-db";
import { isRiotConfigured } from "@/lib/riot";
import { listChampions } from "@/lib/ddragon";
import { MemberProfileEditor } from "@/components/members/member-profile-editor";

export const metadata: Metadata = {
  title: "My profile",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Verified-member "My profile" screen. Same shape as /captain: the server
 * component owns the auth gate and every read, then hands plain data to a
 * client component that calls the server actions in ./actions.ts.
 *
 * getMemberSession() is a THIRD, separate auth boundary from
 * isToolsSession() and getCaptainSession() — see discord-auth.ts. Nothing
 * here can be reached with an admin or captain cookie alone.
 */
export default async function MemberProfilePage() {
  const member = await getMemberSession();
  if (!member) redirect(`/api/auth/member/login?next=${encodeURIComponent("/members/profile")}`);

  const [profile, riotIds, champions] = await Promise.all([
    getProfile(member.discordUserId),
    listRiotIds(member.discordUserId),
    listChampions(),
  ]);

  // A row always exists by the time getMemberSession() succeeds — the OAuth
  // callback enrolls it on every login — but this guards the type and gives
  // an honest message on the freak case of a session surviving a data wipe.
  if (!profile) redirect(`/api/auth/member/login?next=${encodeURIComponent("/members/profile")}`);

  return (
    <MemberProfileEditor
      profile={profile}
      riotIds={riotIds}
      champions={champions}
      riotConfigured={isRiotConfigured()}
    />
  );
}
