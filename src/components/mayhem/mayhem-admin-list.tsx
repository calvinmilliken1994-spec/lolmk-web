"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { MayhemEventSummary } from "@/lib/mayhem-db";
import { archiveMayhemEvent, createMayhemEvent, deleteMayhemEvent, setMayhemPublished } from "@/app/tools/mayhem/actions";

export function MayhemAdminList({ tournaments }: { tournaments: MayhemEventSummary[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  function run(fn: () => Promise<{ ok: boolean; reason?: string; eventId?: string }>) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await fn();
        if (!result.ok) { setError(result.reason ?? "Could not update tournament."); return; }
        if (result.eventId) router.push(`/tools/mayhem?t=${encodeURIComponent(result.eventId)}`);
        else router.refresh();
      } catch { setError("Could not update tournament. Refresh and try again."); }
    });
  }
  const visible = tournaments.filter(t => showArchived || !t.archived_at);
  return <div className="min-h-screen bg-base text-ink">
    <header className="border-b border-line-subtle"><div className="container-wide flex items-center justify-between py-4">
      <div className="flex items-center gap-4"><Link href="/tools" className="text-body-sm text-ink-muted hover:text-ink">← Tools</Link><h1 className="font-display text-heading-lg">ARAM Mayhem</h1></div>
      <Button size="sm" onClick={() => setCreating(v => !v)}>{creating ? "Cancel" : "New tournament"}</Button>
    </div></header>
    <main className="container-wide py-8 space-y-6">
      {error && <p role="alert" className="border border-danger/50 bg-danger/10 p-3 text-danger">{error}</p>}
      {creating && <form className="border border-line bg-surface p-6 flex flex-wrap gap-3" onSubmit={e => { e.preventDefault(); run(() => createMayhemEvent(name)); }}>
        <label className="flex flex-1 flex-col gap-2 text-body-sm">Tournament name<input required maxLength={120} value={name} onChange={e => setName(e.target.value)} className="border border-line bg-elevated px-3 py-2" /></label>
        <Button type="submit" disabled={pending || !name.trim()}>Create tournament</Button>
        <p className="w-full text-body-sm text-ink-muted">Saved separately. New tournaments stay private until published.</p>
      </form>}
      <label className="flex items-center gap-2 text-body-sm"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />Show archived tournaments</label>
      {visible.length === 0 ? <p className="border border-dashed border-line-strong bg-surface p-12 text-center text-ink-muted">No tournaments here. Create one or show archived tournaments.</p> : <ul className="divide-y divide-line-subtle border border-line bg-surface">
        {visible.map(t => {
          const selection = { eventId: t.id, generation: t.registration_generation };
          return <li key={t.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
            <div className="min-w-0 flex-1"><Link className="font-heading text-heading-md hover:text-brand-red-bright" href={`/tools/mayhem?t=${encodeURIComponent(t.id)}`}>{t.title}</Link><p className="text-caption text-ink-muted">{t.archived_at ? "Archived, read-only" : `${t.stage.replaceAll("_", " ")} · ${t.published ? "Public" : "Draft"}`}</p></div>
            {!t.archived_at && <><Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => setMayhemPublished(selection, !t.published))}>{t.published ? "Unpublish" : "Publish"}</Button><Button size="sm" variant="ghost" disabled={pending} onClick={() => { if (confirm(`Archive "${t.title}"? Registration closes and all players, teams, matches and audit history are kept read-only.`)) run(() => archiveMayhemEvent(selection)); }}>Archive</Button></>}
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => { if (confirm(`DELETE "${t.title}" permanently?\n\nThis removes every player, team, match, pending application, invite and audit entry. This cannot be undone. Archive instead to keep saved history.`)) run(() => deleteMayhemEvent(selection)); }}>Delete</Button>
            <Link className="border border-line-strong px-3 py-1.5 text-body-sm hover:border-brand-red" href={`/tools/mayhem?t=${encodeURIComponent(t.id)}`}>{t.archived_at ? "View history" : "Manage"} →</Link>
          </li>;
        })}
      </ul>}
    </main>
  </div>;
}
