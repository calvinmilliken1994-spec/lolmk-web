import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isToolsSession } from "@/lib/tools-auth";
import { getMayhemFull, listMayhemAudit } from "@/lib/mayhem-db";
import { MayhemDesk } from "@/components/mayhem/mayhem-desk";

export const metadata: Metadata = {
  title: "ARAM Mayhem",
  description: "Run fun ARAM tournaments: entrants, team randomizer, brackets, live control.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function MayhemToolPage() {
  const signedIn = await isToolsSession();
  if (!signedIn) redirect("/tools/login?next=/tools/mayhem");

  const [full, audit] = await Promise.all([getMayhemFull(), listMayhemAudit()]);
  return <MayhemDesk initial={{ ...full, audit }} />;
}
