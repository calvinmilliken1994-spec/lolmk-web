import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCaptainSession } from "@/lib/discord-auth";
import {
  getApplicationsForCaptain,
  getTeamsForCaptain,
  listSignupOpenTournaments,
} from "@/lib/sr-db";
import { isBlobConfigured } from "@/lib/team-logo";
import { isRiotConfigured } from "@/lib/riot";
import { CaptainDashboard } from "@/components/sr/captain-dashboard";
import { pageMetadata } from "@/lib/metadata";

export const metadata: Metadata = pageMetadata({
  title: "My team",
  description: "Register a Summoner's Rift team and manage your roster.",
  noindex: true,
});

export const dynamic = "force-dynamic";

/**
 * Captain "My team" screen — the server half.
 *
 * Same shape as the admin tool's page (gate + reads here, plain data handed
 * to a client component that calls the server actions), but sitting on a
 * SEPARATE auth boundary: getCaptainSession(), not isToolsSession(). A
 * captain session grants nothing under /tools, and this page never consults
 * the admin gate.
 *
 * Two reasons the gate lives here rather than in middleware.ts: that
 * matcher is scoped to /tools/:path*, and an Edge presence-check couldn't
 * do the live CAPTAIN_ROLE_ID re-verification getCaptainSession() performs
 * anyway. getCaptainSession() returns null — never throws — when
 * CAPTAIN_ROLE_ID is unset, so an unconfigured deployment lands everyone on
 * the login page's "not live yet" state instead of erroring.
 *
 * Reads are imported straight from @/lib/sr-db rather than re-exported
 * through ./actions.ts, for the reason that file documents: every export of
 * a "use server" module is a directly-callable RPC endpoint, and
 * getTeamsForCaptain() takes the discord id to scope by as an ARGUMENT —
 * exported across that boundary it would let anyone read any captain's
 * roster by passing someone else's id. Here the id can only come from the
 * verified session below.
 */
export default async function CaptainPage() {
  const captain = await getCaptainSession();
  if (!captain) redirect("/captain/login?next=/captain");

  const [teams, applications, openTournaments] = await Promise.all([
    getTeamsForCaptain(captain.discordUserId),
    getApplicationsForCaptain(captain.discordUserId),
    listSignupOpenTournaments(),
  ]);

  return (
    <CaptainDashboard
      username={captain.username}
      teams={teams}
      applications={applications}
      openTournaments={openTournaments}
      blobConfigured={isBlobConfigured()}
      riotConfigured={isRiotConfigured()}
    />
  );
}
