import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentAdmin, isToolsSession } from "@/lib/tools-auth";
import { getTournamentFull, listAudit } from "@/lib/rb-db";
import { computeRbStandings } from "@/lib/rb-service";
import { RbFloor } from "@/components/riftbound/rb-floor";

export const metadata: Metadata = {
  title: "Riftbound floor",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** The floor view polls /api/rb/admin-state, which is the same payload as the desk's; it needs the players, standings and flags, not the audit log, but sharing one route keeps the two in step. */
const AUDIT_LIMIT = 50;

export default async function RiftboundFloorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const signedIn = await isToolsSession();
  if (!signedIn) redirect(`/tools/login?next=/tools/riftbound/${encodeURIComponent(slug)}/floor`);
  const admin = await getCurrentAdmin();
  if (!admin) redirect(`/tools/login?next=/tools/riftbound/${encodeURIComponent(slug)}/floor`);

  const full = await getTournamentFull(slug);
  if (!full) notFound();

  const audit = await listAudit(full.tournament.id, AUDIT_LIMIT);
  return (
    <RbFloor
      initial={{ ...full, standings: computeRbStandings(full), audit, serverNow: Date.now() }}
      adminName={admin.username}
    />
  );
}
