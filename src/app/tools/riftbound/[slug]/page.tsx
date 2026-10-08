import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isToolsSession } from "@/lib/tools-auth";
import { getTournamentFull, listAudit } from "@/lib/rb-db";
import { computeRbStandings } from "@/lib/rb-service";
import { RbDesk } from "@/components/riftbound/rb-desk";

export const metadata: Metadata = {
  title: "Riftbound desk",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** How many audit entries the desk starts with; /api/rb/admin-state keeps it current. */
const AUDIT_LIMIT = 50;

export default async function RiftboundDeskPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const signedIn = await isToolsSession();
  if (!signedIn) redirect(`/tools/login?next=/tools/riftbound/${encodeURIComponent(slug)}`);

  const full = await getTournamentFull(slug);
  if (!full) notFound();

  const audit = await listAudit(full.tournament.id, AUDIT_LIMIT);
  return <RbDesk initial={{ ...full, standings: computeRbStandings(full), audit }} />;
}
