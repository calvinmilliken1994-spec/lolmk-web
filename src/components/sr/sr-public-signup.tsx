"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, ShieldCheck } from "lucide-react";
import { createPremadeApplication } from "@/app/captain/actions";
import { ErrorBanner, Field, inputClass, useRunner } from "@/components/sr/sr-shared";
import type { SrTournament } from "@/types/sr-tournament";

/**
 * Public-page counterpart of the CaptainDashboard's SignupPanel (same
 * createPremadeApplication action, same "one thing: a team name" flow). It
 * never decides eligibility itself — the server page hands it only the
 * tournaments this captain is actually allowed to enter, and the action
 * re-verifies the captain session and the signup gate on submit.
 */
export function SrPublicSignupPanel({
  tournament,
  onDone,
}: {
  tournament: SrTournament;
  onDone: () => void;
}) {
  const { pending, error, setError, run } = useRunner();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  return (
    <div className="border border-line bg-surface p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-caption font-mono uppercase tracking-wider text-ink-muted">Signups open</p>
          <p className="font-heading text-heading-lg text-ink">{tournament.name}</p>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1.5 border border-brand-red bg-brand-red/10 px-4 py-2 text-body-sm text-ink rounded-sm hover:bg-brand-red/20"
          >
            <Plus strokeWidth={2} className="h-4 w-4" />
            Register a team
          </button>
        )}
      </div>

      {open && (
        <form
          className="space-y-4 max-w-lg"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              async () => {
                const result = await createPremadeApplication(tournament.id, name);
                if (!result.ok) throw new Error(result.reason);
              },
              () => {
                setOpen(false);
                setName("");
                onDone();
              },
            );
          }}
        >
          <ErrorBanner error={error} onDismiss={() => setError(null)} />
          <Field label="Team name">
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              required
            />
          </Field>
          <p className="text-caption text-ink-muted">
            Creating the application claims the name and your captain slot — you
            pick the other four players next, and each confirms for themselves
            via the Discord invite. Finish the roster on your captain dashboard.
          </p>
          <button
            type="submit"
            disabled={pending}
            className="border border-brand-red bg-brand-red px-4 py-2 text-body-sm text-white rounded-sm hover:bg-brand-red-bright disabled:opacity-40"
          >
            Create application
          </button>
        </form>
      )}
    </div>
  );
}

/** Public-page signup section: panel per open tournament, refreshes on done. */
export function SrSignupSection({ tournament }: { tournament: SrTournament }) {
  const router = useRouter();
  return <SrPublicSignupPanel tournament={tournament} onDone={() => router.refresh()} />;
}

/** Signed-out state: point visitors at the captain gate rather than faking a form. */
export function SrPublicSignupGate() {
  return (
    <div className="border border-line bg-surface p-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <p className="text-caption font-mono uppercase tracking-wider text-ink-muted">Signups open</p>
        <p className="font-heading text-heading-lg text-ink">Captain signups are live</p>
        <p className="text-body-sm text-ink-secondary max-w-xl mt-1">
          Team registration happens through a captain&apos;s Discord login —
          one application per team, five players per roster, each confirming
          their own slot.
        </p>
      </div>
      <Link
        href="/captain/login?next=/captain"
        className="inline-flex items-center gap-1.5 border border-brand-red bg-brand-red px-4 py-2 text-body-sm text-white rounded-sm hover:bg-brand-red-bright"
      >
        <ShieldCheck strokeWidth={1.75} className="h-4 w-4" />
        Sign in as captain
      </Link>
    </div>
  );
}
