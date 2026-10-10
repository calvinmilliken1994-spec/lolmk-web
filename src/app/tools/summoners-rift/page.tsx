import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isToolsSession } from "@/lib/tools-auth";
import {
  getTournamentFull,
  listAudit,
  listTournamentApplications,
  listTournaments,
} from "@/lib/sr-db";
import { isBlobConfigured } from "@/lib/team-logo";
import { SrAdminList } from "@/components/sr/sr-admin-list";
import { SrDesk } from "@/components/sr/sr-desk";

export const metadata: Metadata = {
  title: "Summoner's Rift tournaments",
  description:
    "Admin control for Summoner's Rift tournaments: teams, seeding, bracket generation, live results.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Admin dashboard. Mirrors the ARAM Mayhem tool's shape: the server
 * component owns the auth gate and every read, then hands plain data to a
 * client component that calls the server actions in ./actions.ts.
 *
 * getTournamentFull/listTournaments/listAudit are imported straight from
 * @/lib/sr-db, NOT re-exported through actions.ts — that file is a
 * "use server" boundary where every export becomes an unauthenticated,
 * directly-callable RPC endpoint. Reads belong here, behind the
 * isToolsSession() gate below. actions.ts documents the same reasoning for
 * getTournamentFull; listAudit is exactly the same class of admin-only data.
 */
export default async function SummonersRiftToolPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const signedIn = await isToolsSession();
  if (!signedIn) redirect("/tools/login?next=/tools/summoners-rift");

  const params = await searchParams;

  if (params.t) {
    const [full, audit, applications] = await Promise.all([
      getTournamentFull(params.t),
      listAudit(params.t),
      listTournamentApplications(params.t),
    ]);
    if (full) {
      return (
        <SrDesk
          initial={{ ...full, audit, applications }}
          blobConfigured={isBlobConfigured()}
        />
      );
    }
    // Unknown/deleted id: fall through to the list rather than 404ing the
    // whole tool.
  }

  const tournaments = await listTournaments();
  return <SrAdminList tournaments={tournaments} />;
}
