"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { SrTournamentStatus } from "@/types/sr-tournament";

/**
 * Small pieces shared by the two SR admin screens (list + detail).
 *
 * `useRunner` is the SR equivalent of MayhemAdmin's local `run()` helper:
 * every server action in @/app/tools/summoners-rift/actions.ts validates
 * aggressively and throws a human-readable Error on refusal ("Teams can
 * only be added while the tournament is in draft.", "Can't undo — a
 * downstream match already has both teams or a result.", ...). Those
 * messages are the actual admin-facing UX for this tool, so they are
 * surfaced verbatim rather than swallowed into a generic failure toast.
 */
export function useRunner() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<unknown>, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        onDone?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
  }

  return { pending, error, setError, run };
}

export function ErrorBanner({
  error,
  onDismiss,
}: {
  error: string | null;
  onDismiss: () => void;
}) {
  if (!error) return null;
  return (
    <div
      role="alert"
      className="border border-danger/40 bg-danger/10 text-danger px-4 py-3 rounded-sm flex items-start justify-between gap-4"
    >
      <span className="text-body-sm">{error}</span>
      <button onClick={onDismiss} aria-label="Dismiss error" className="shrink-0 mt-0.5">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

const STATUS_VARIANT: Record<SrTournamentStatus, "default" | "red" | "blue" | "success" | "warning" | "outline"> = {
  draft: "outline",
  seeding: "warning",
  bracket_published: "blue",
  in_progress: "red",
  completed: "success",
  archived: "default",
};

const STATUS_LABEL: Record<SrTournamentStatus, string> = {
  draft: "Draft",
  seeding: "Seeded",
  bracket_published: "Bracket live",
  in_progress: "In progress",
  completed: "Completed",
  archived: "Archived",
};

export function StatusBadge({ status, pulse }: { status: SrTournamentStatus; pulse?: boolean }) {
  return (
    <Badge variant={STATUS_VARIANT[status]} pulse={pulse && status === "in_progress"}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export { STATUS_LABEL };

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-label uppercase tracking-wider text-ink-muted">{label}</span>
      {children}
      {hint && <span className="text-caption text-ink-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full border border-line bg-elevated px-3 py-2 text-body-sm text-ink rounded-sm outline-none focus:border-brand-red disabled:opacity-50";

/** `datetime-local` wants "YYYY-MM-DDTHH:mm"; the DB hands back a full ISO string. */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
