"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArrowLeft, ArrowRight, Loader2, Plus, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ErrorBanner,
  Field,
  inputClass,

  localInputToIso,
  StatusBadge,
  useRunner,
} from "@/components/sr/sr-shared";
import type { SrBracketFormat, SrTournament } from "@/types/sr-tournament";
import { SR_MAX_TEAMS, SR_MIN_TEAMS } from "@/types/sr-tournament";
import { archiveTournament, createTournament } from "@/app/tools/summoners-rift/actions";

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  month: "short",
  day: "numeric",
  year: "numeric",
});

function fmtWindow(t: SrTournament): string {
  if (!t.start_at && !t.end_at) return "No dates set";
  const start = t.start_at ? DATE_FMT.format(new Date(t.start_at)) : "?";
  const end = t.end_at ? DATE_FMT.format(new Date(t.end_at)) : "?";
  return `${start} → ${end} KST`;
}

export function SrAdminList({ tournaments }: { tournaments: SrTournament[] }) {
  const router = useRouter();
  const { pending, error, setError, run } = useRunner();
  const [creating, setCreating] = useState(false);

  return (
    <div className="min-h-screen bg-base text-ink">
      <header className="border-b border-line-subtle">
        <div className="container-wide flex items-center justify-between py-4">
          <div className="flex items-center gap-4">
            <Link
              href="/tools"
              className="inline-flex items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink"
            >
              <ArrowLeft strokeWidth={1.75} className="h-4 w-4" />
              Tools
            </Link>
            <div className="h-4 w-px bg-line" />
            <h1 className="font-display text-heading-lg leading-none">Summoner&apos;s Rift</h1>
          </div>
          <Button size="sm" variant="primary" onClick={() => setCreating((v) => !v)}>
            <Plus strokeWidth={2} className="h-4 w-4" />
            {creating ? "Cancel" : "New tournament"}
          </Button>
        </div>
      </header>

      <main className="container-wide py-8 space-y-6">
        <ErrorBanner error={error} onDismiss={() => setError(null)} />

        {creating && (
          <CreateForm
            pending={pending}
            onCreate={(input) =>
              run(
                async () => {
                  const id = await createTournament(input);
                  router.push(`/tools/summoners-rift?t=${encodeURIComponent(id)}`);
                },
                () => setCreating(false),
              )
            }
          />
        )}

        {tournaments.length === 0 ? (
          <div className="border border-dashed border-line-strong bg-surface p-12 text-center flex flex-col items-center gap-3">
            <Trophy strokeWidth={1} className="h-12 w-12 text-ink-muted opacity-40" />
            <p className="font-heading text-heading-lg text-ink">No tournaments yet.</p>
            <p className="text-body-sm text-ink-secondary max-w-md">
              Create one to start adding teams. Nothing is public until seeds are
              rolled — draft tournaments stay hidden from /tournaments.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line-subtle border border-line bg-surface">
            {tournaments.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <Link
                      href={`/tools/summoners-rift?t=${encodeURIComponent(t.id)}`}
                      className="font-heading text-heading-md text-ink hover:text-brand-red-bright truncate"
                    >
                      {t.name}
                    </Link>
                    <StatusBadge status={t.status} pulse />
                  </div>
                  <p className="mt-1 text-caption font-mono uppercase tracking-wide text-ink-muted">
                    /{t.slug} · {t.format === "double_elim" ? "Double elim" : "Single elim"} · Bo
                    {t.best_of} · {fmtWindow(t)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      if (!confirm(`Archive "${t.name}"? It stays in Hall of Fame history but leaves this list.`)) return;
                      run(() => archiveTournament(t.id), () => router.refresh());
                    }}
                    className="inline-flex items-center gap-1.5 border border-line px-3 py-1.5 text-body-sm text-ink-muted rounded-sm hover:border-line-strong hover:text-ink disabled:opacity-40"
                  >
                    <Archive strokeWidth={1.75} className="h-4 w-4" />
                    Archive
                  </button>
                  <Link
                    href={`/tools/summoners-rift?t=${encodeURIComponent(t.id)}`}
                    className="inline-flex items-center gap-1.5 border border-line-strong px-3 py-1.5 text-body-sm text-ink rounded-sm hover:border-brand-red"
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

interface CreateInput {
  name: string;
  format: SrBracketFormat;
  bestOf: 1 | 3 | 5;
  thirdPlaceMatch: boolean;
  grandFinalReset: boolean;
  minTeams: number;
  maxTeams: number;
  startAt: string | null;
  endAt: string | null;
}

function CreateForm({
  pending,
  onCreate,
}: {
  pending: boolean;
  onCreate: (input: CreateInput) => void;
}) {
  const [name, setName] = useState("");
  const [format, setFormat] = useState<SrBracketFormat>("double_elim");
  const [bestOf, setBestOf] = useState<1 | 3 | 5>(1);
  const [thirdPlaceMatch, setThirdPlaceMatch] = useState(false);
  const [grandFinalReset, setGrandFinalReset] = useState(true);
  const [minTeams, setMinTeams] = useState(SR_MIN_TEAMS);
  const [maxTeams, setMaxTeams] = useState(SR_MAX_TEAMS);
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");

  return (
    <form
      className="border border-line bg-surface p-6 space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onCreate({
          name,
          format,
          bestOf,
          thirdPlaceMatch,
          grandFinalReset,
          minTeams,
          maxTeams,
          startAt: localInputToIso(startAt),
          endAt: localInputToIso(endAt),
        });
      }}
    >
      <p className="font-heading text-heading-md text-ink">New tournament</p>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div className="md:col-span-2 lg:col-span-3">
          <Field label="Name" hint="The slug is derived from this automatically.">
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Winter Split 2026"
              required
            />
          </Field>
        </div>
        <Field label="Format">
          <select
            className={inputClass}
            value={format}
            onChange={(e) => setFormat(e.target.value as SrBracketFormat)}
          >
            <option value="single_elim">Single elimination</option>
            <option value="double_elim">Double elimination</option>
          </select>
        </Field>
        <Field label="Series length">
          <select
            className={inputClass}
            value={bestOf}
            onChange={(e) => setBestOf(Number(e.target.value) as 1 | 3 | 5)}
          >
            <option value={1}>Best of 1</option>
            <option value={3}>Best of 3</option>
            <option value={5}>Best of 5</option>
          </select>
        </Field>
        <Field label="Team bounds" hint={`Hard limits: ${SR_MIN_TEAMS}–${SR_MAX_TEAMS}.`}>
          <div className="flex items-center gap-2">
            <input
              type="number"
              className={inputClass}
              min={SR_MIN_TEAMS}
              max={SR_MAX_TEAMS}
              value={minTeams}
              onChange={(e) => setMinTeams(Number(e.target.value))}
            />
            <span className="text-ink-muted">–</span>
            <input
              type="number"
              className={inputClass}
              min={SR_MIN_TEAMS}
              max={SR_MAX_TEAMS}
              value={maxTeams}
              onChange={(e) => setMaxTeams(Number(e.target.value))}
            />
          </div>
        </Field>
        <Field label="Starts (local)">
          <input
            type="datetime-local"
            className={inputClass}
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
          />
        </Field>
        <Field label="Ends (local)">
          <input
            type="datetime-local"
            className={inputClass}
            value={endAt}
            onChange={(e) => setEndAt(e.target.value)}
          />
        </Field>
        <div className="flex flex-col gap-2 justify-end pb-1">
          <label className="inline-flex items-center gap-2 text-body-sm text-ink-secondary">
            <input
              type="checkbox"
              checked={thirdPlaceMatch}
              onChange={(e) => setThirdPlaceMatch(e.target.checked)}
            />
            Third-place match
          </label>
          <label className="inline-flex items-center gap-2 text-body-sm text-ink-secondary">
            <input
              type="checkbox"
              checked={grandFinalReset}
              disabled={format !== "double_elim"}
              onChange={(e) => setGrandFinalReset(e.target.checked)}
            />
            Grand final reset (double elim only)
          </label>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending || !name.trim()}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Create
        </Button>
        <span className="text-caption text-ink-muted">
          Starts in draft. Dates can only be edited while in draft.
        </span>
      </div>
    </form>
  );
}
