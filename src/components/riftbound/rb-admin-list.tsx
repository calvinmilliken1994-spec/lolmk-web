"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArrowLeft, ArrowRight, Loader2, Plus, Trash2, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { archiveEvent, createTournament, deleteEvent } from "@/app/tools/riftbound/actions";
import { ErrorBanner, Field, inputClass } from "@/components/sr/sr-shared";
import type { RbTournament, RbTournamentStatus } from "@/types/riftbound";
import { rbFormatDate } from "./rb-setup-model";

const STATUS_LABEL: Record<RbTournamentStatus, string> = {
  draft: "Setup",
  registration: "Check-in",
  in_progress: "In progress",
  completed: "Completed",
  archived: "Archived",
};

const STATUS_VARIANT: Record<RbTournamentStatus, "outline" | "warning" | "red" | "success" | "default"> = {
  draft: "outline",
  registration: "warning",
  in_progress: "red",
  completed: "success",
  archived: "default",
};

function RbStatusBadge({ status }: { status: RbTournamentStatus }) {
  return (
    <Badge variant={STATUS_VARIANT[status]} pulse={status === "in_progress"}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

/**
 * /tools/riftbound: create, archive for retained history, or explicitly
 * delete a test event and all its records after a permanent-delete warning.
 */
export function RbAdminList({ tournaments }: { tournaments: RbTournament[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const visible = tournaments.filter((t) => showArchived || t.status !== "archived");

  const run = (fn: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>, onDone?: () => void) => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await fn();
        if (!result.ok) setError(result.error);
        else onDone?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
  };

  return (
    <div className="min-h-screen bg-base text-ink">
      <header className="border-b border-line-subtle">
        <div className="container-wide flex items-center justify-between py-4">
          <div className="flex items-center gap-4">
            <Link href="/tools" className="inline-flex items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink">
              <ArrowLeft strokeWidth={1.75} className="h-4 w-4" />
              Tools
            </Link>
            <div className="h-4 w-px bg-line" />
            <h1 className="font-display text-heading-lg leading-none">Riftbound</h1>
          </div>
          <Button size="sm" variant="primary" onClick={() => setCreating((v) => !v)}>
            <Plus strokeWidth={2} className="h-4 w-4" />
            {creating ? "Cancel" : "Create"}
          </Button>
        </div>
      </header>

      <main className="container-wide space-y-6 py-8">
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
        <label className="inline-flex items-center gap-2 text-body-sm text-ink-muted">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived tournaments
        </label>

        {creating && (
          <CreateForm
            pending={pending}
            onCreate={(input) =>
              run(
                async () => {
                  const result = await createTournament({
                    name: input.name,
                    config: { date: input.date || null, venue: input.venue.trim() || null },
                  });
                  if (result.ok) router.push(`/tools/riftbound/${encodeURIComponent(result.data.slug)}`);
                  return result;
                },
                () => setCreating(false),
              )
            }
          />
        )}

        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-3 border border-dashed border-line-strong bg-surface p-12 text-center">
            <Trophy strokeWidth={1} className="h-12 w-12 text-ink-muted opacity-40" />
            <p className="font-heading text-heading-lg text-ink">No {showArchived ? "Riftbound" : "active Riftbound"} events.</p>
            <p className="max-w-md text-body-sm text-ink-secondary">
              Create one to set up the format, add players and open check-in. Nothing is public until check-in opens.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line-subtle border border-line bg-surface">
            {visible.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <Link
                      href={`/tools/riftbound/${encodeURIComponent(t.slug)}`}
                      className="truncate font-heading text-heading-md text-ink hover:text-brand-red-bright"
                    >
                      {t.name}
                    </Link>
                    <RbStatusBadge status={t.status} />
                  </div>
                  <p className="mt-1 font-mono text-caption uppercase tracking-wide text-ink-muted">
                    /{t.slug} · Bo{t.config.bestOf} · {t.config.roundMinutes} min ·{" "}
                    {t.config.date ? rbFormatDate(t.config.date) : "No date"}
                    {t.config.venue ? ` · ${t.config.venue}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      if (!confirm(`DELETE "${t.name}" permanently?\n\nThis removes every player, round, match, audit entry and Hall of Champions record. This cannot be undone. Archive instead to retain the tournament history.`)) return;
                      run(() => deleteEvent(t.id), () => router.refresh());
                    }}
                    className="inline-flex items-center gap-1.5 rounded-sm border border-line px-3 py-1.5 text-body-sm text-ink-muted hover:border-brand-red hover:text-brand-red disabled:opacity-40"
                  >
                    <Trash2 strokeWidth={1.75} className="h-4 w-4" />
                    Delete
                  </button>
                  {(t.status === "completed" || t.status === "draft") && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        if (!confirm(`Archive "${t.name}"? It stays on record but leaves this list.`)) return;
                        run(() => archiveEvent(t.id), () => router.refresh());
                      }}
                      className="inline-flex items-center gap-1.5 rounded-sm border border-line px-3 py-1.5 text-body-sm text-ink-muted hover:border-line-strong hover:text-ink disabled:opacity-40"
                    >
                      <Archive strokeWidth={1.75} className="h-4 w-4" />
                      Archive
                    </button>
                  )}
                  <Link
                    href={`/tools/riftbound/${encodeURIComponent(t.slug)}`}
                    className="inline-flex items-center gap-1.5 rounded-sm border border-line-strong px-3 py-1.5 text-body-sm text-ink hover:border-brand-red"
                  >
                    Manage
                    <ArrowRight strokeWidth={1.75} className="h-4 w-4" />
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function CreateForm({
  pending,
  onCreate,
}: {
  pending: boolean;
  onCreate: (input: { name: string; date: string; venue: string }) => void;
}) {
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [venue, setVenue] = useState("");

  return (
    <form
      className="space-y-5 border border-line bg-surface p-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onCreate({ name, date, venue });
      }}
    >
      <p className="font-heading text-heading-md text-ink">New Riftbound event</p>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-3">
          <Field label="Name" hint="The address is derived from this automatically.">
            <input
              className={inputClass}
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder="Poro Cup"
              required
            />
          </Field>
        </div>
        <Field label="Date" hint="Needed before check-in opens.">
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Venue" hint="Needed before check-in opens.">
          <input className={inputClass} value={venue} maxLength={80} onChange={(e) => setVenue(e.target.value)} />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending || !name.trim()}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Create
        </Button>
        <span className="text-caption text-ink-muted">
          Format defaults to best of 3, 60-minute rounds, Auto rounds and Auto cut. You can change them in Setup.
        </span>
      </div>
    </form>
  );
}
