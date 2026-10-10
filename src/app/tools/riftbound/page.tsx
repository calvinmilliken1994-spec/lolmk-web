import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isToolsSession } from "@/lib/tools-auth";
import { listTournaments } from "@/lib/rb-db";
import { RbAdminList } from "@/components/riftbound/rb-admin-list";

export const metadata: Metadata = {
  title: "Riftbound tournaments",
  description: "Admin control for Riftbound Swiss events: setup, check-in, rounds, top cut and the venue screen.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Riftbound event list. Same shape as /tools/summoners-rift: the server
 * component owns the auth gate and the read, then hands plain data to a
 * client component that calls the server actions in ./actions.ts. Reads are
 * imported from @/lib/rb-db here, never re-exported through the "use server"
 * file, where every export would become a callable endpoint.
 */
export default async function RiftboundToolPage() {
  const signedIn = await isToolsSession();
  if (!signedIn) redirect("/tools/login?next=/tools/riftbound");

  const tournaments = await listTournaments(true);
  return <RbAdminList tournaments={tournaments} />;
}
