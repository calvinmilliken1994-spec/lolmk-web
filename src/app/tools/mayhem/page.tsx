import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isToolsSession } from "@/lib/tools-auth";
import { getMayhemFull, listMayhemAudit, listMayhemEvents } from "@/lib/mayhem-db";
import { MayhemAdminList } from "@/components/mayhem/mayhem-admin-list";
import { MayhemDesk } from "@/components/mayhem/mayhem-desk";

export const metadata: Metadata = {
  title: "ARAM Mayhem",
  description: "Run fun ARAM tournaments: entrants, team randomizer, brackets, live control.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function MayhemToolPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const signedIn = await isToolsSession();
  if (!signedIn) redirect("/tools/login?next=/tools/mayhem");

  const { t } = await searchParams;
  if (!t) return <MayhemAdminList tournaments={await listMayhemEvents()} />;
  const full = await getMayhemFull(t).catch(() => null);
  if (!full) notFound();
  const audit = await listMayhemAudit(t);
  if (full.event.archived_at) return <main className="container-wide py-8 space-y-6">
    <Link href="/tools/mayhem" className="text-link">← Tournament list</Link>
    <h1 className="font-heading text-heading-lg">{full.event.title}</h1>
    <p className="text-ink-muted">Archived, read-only. Players, teams, results and audit history are preserved. Permanent deletion is available from the tournament list.</p>
    <h2 className="font-heading text-heading-md">Teams and players</h2>
    <ul className="space-y-2">{full.teams.map(team => <li key={team.id}>{team.name}{team.id === full.event.champion_team_id ? " (Champion)" : ""}: {team.players.map(player => player.display_name).join(", ")}</li>)}</ul>
    <p>{full.players.filter(player => !player.team_id).map(player => player.display_name).join(", ")}</p>
    <h2 className="font-heading text-heading-md">Match history</h2>
    <ul>{full.matches.map(match => <li key={match.id}>Match {match.match_number}: {full.teams.find(team => team.id === match.team_a_id)?.name ?? "TBD"} {match.team_a_score} : {match.team_b_score} {full.teams.find(team => team.id === match.team_b_id)?.name ?? "TBD"} ({match.status})</li>)}</ul>
    <h2 className="font-heading text-heading-md">Activity</h2>
    <ul>{audit.map(entry => <li key={entry.id}>{entry.at} · {entry.actor_name} · {entry.action}</li>)}</ul>
  </main>;
  return <MayhemDesk key={t} initial={{ ...full, audit }} />;
}
