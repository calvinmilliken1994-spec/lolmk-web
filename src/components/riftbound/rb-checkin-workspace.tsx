"use client";

import { useMemo, useState } from "react";
import { addPlayer, checkIn, undoCheckIn } from "@/app/tools/riftbound/actions";
import { DeckKicker, type DeckRun } from "@/components/control-deck";
import { cn } from "@/lib/utils";
import type { RbPlayer } from "@/types/riftbound";
import type { RbDeskState } from "./rb-deck-model";
import { rbInputClass, rbSubmitClass } from "./rb-ui";

type Filter = "all" | "waiting" | "in";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "waiting", label: "Not checked in" },
  { id: "in", label: "Checked in" },
];

const isIn = (p: RbPlayer) => p.status === "checked_in" || p.status === "active";

/**
 * Check-in phase workspace: a searchable player list, tap a row to check
 * the player in (tap again to undo), a running count, and a walk-in field
 * (players can still register after check-in opens). The primary action in
 * the top bar closes check-in and pairs Round 1.
 */
export function RbCheckinWorkspace({ state, run, pending }: { state: RbDeskState; run: DeckRun; pending: boolean }) {
  const { tournament: t } = state;
  const open = t.status === "registration";
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [walkIn, setWalkIn] = useState("");

  const entrants = useMemo(
    () =>
      state.players
        .filter((p) => p.status !== "dropped" && p.status !== "dq")
        .sort((a, b) => a.display_name.localeCompare(b.display_name, "en", { sensitivity: "base" })),
    [state.players],
  );
  const checkedIn = entrants.filter(isIn).length;
  const total = entrants.length;

  const q = query.trim().toLowerCase();
  const shown = entrants.filter((p) => {
    if (filter === "waiting" && isIn(p)) return false;
    if (filter === "in" && !isIn(p)) return false;
    return !q || p.display_name.toLowerCase().includes(q);
  });

  const toggle = (p: RbPlayer) => {
    if (!open || pending) return;
    void run(() => (isIn(p) ? undoCheckIn(p.id) : checkIn(p.id)));
  };

  const addWalkIn = async () => {
    const result = await run(() => addPlayer({ tournamentId: t.id, displayName: walkIn }));
    if (result) {
      setWalkIn("");
      setQuery("");
    }
  };

  return (
    <section className="flex w-full max-w-[720px] flex-col gap-3">
      <div className="flex flex-col gap-2">
        <DeckKicker className="text-brand-red-bright">CHECK-IN</DeckKicker>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-heading text-[24px] font-semibold">Check-in</h2>
          <p className="font-mono text-[13px] text-ink-secondary" aria-live="polite">
            <span className="font-display text-[28px] leading-none text-ink">{checkedIn}</span> / {total} checked in
          </p>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={checkedIn}
          aria-label="Players checked in"
          className="h-1.5 bg-elevated"
        >
          <div className="h-full bg-success transition-[width]" style={{ width: total ? `${(checkedIn / total) * 100}%` : "0%" }} />
        </div>
      </div>

      {t.status === "draft" && (
        <p className="border border-line bg-deck-rail px-3 py-2.5 text-[13px] text-ink-secondary">
          Check-in isn&apos;t open yet. Finish Setup, then use Open check-in at the top.
        </p>
      )}
      {t.status === "in_progress" && (
        <p className="border border-line bg-deck-rail px-3 py-2.5 text-[13px] text-ink-secondary">
          Check-in is closed: Round 1 is paired. The list below is read-only.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Search players"
          placeholder="Search players"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && shown.length === 1) {
              toggle(shown[0]);
              setQuery("");
            }
          }}
          className={cn(rbInputClass, "min-w-[200px] flex-[1_1_240px] font-sans text-[14px]")}
        />
        <div role="group" aria-label="Filter" className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "h-[42px] rounded-sm border px-3 text-[13px]",
                filter === f.id
                  ? "border-brand-blue-bright bg-brand-blue-muted text-ink"
                  : "border-line-strong text-ink-secondary hover:text-ink",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {total === 0 ? (
        <p className="border border-dashed border-line-strong px-3 py-6 text-center text-[13px] text-ink-muted">
          No players yet. Add them in Setup, or as walk-ins below.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {shown.map((p) => {
            const done = isIn(p);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={!open || pending}
                  aria-pressed={done}
                  onClick={() => toggle(p)}
                  className={cn(
                    "flex min-h-[52px] w-full items-center gap-3 rounded-sm border px-3 text-left",
                    done ? "border-success bg-success-surface" : "border-line bg-surface",
                    open && !pending && !done && "hover:border-brand-blue-bright",
                    !open && "cursor-default",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex h-7 w-7 flex-none items-center justify-center font-mono text-[13px] font-semibold",
                      done ? "bg-success text-surface" : "border border-line-strong text-transparent",
                    )}
                  >
                    ✓
                  </span>
                  <span className="flex min-w-0 flex-auto flex-col">
                    <span className="truncate text-[15px] font-medium text-ink">{p.display_name}</span>
                    {p.legend && <span className="truncate text-[12px] text-ink-secondary">{p.legend}</span>}
                  </span>
                  <span className="font-mono text-[11px] text-ink-muted">{p.member_discord_id ? "MEMBER" : "GUEST"}</span>
                  <span className={cn("w-[116px] whitespace-nowrap text-right font-mono text-[11px]", done ? "text-success-ink" : "text-ink-muted")}>
                    {done ? "CHECKED IN" : open ? "TAP TO CHECK IN" : "NOT IN"}
                  </span>
                </button>
              </li>
            );
          })}
          {shown.length === 0 && <li className="px-1 py-3 text-[13px] text-ink-muted">No players match.</li>}
        </ul>
      )}

      {open && (
        <div className="flex flex-col gap-1.5 border-t border-line pt-3">
          <label htmlFor="rb-walkin" className="text-[12px] text-ink-secondary">
            Walk-in (not on the list)
          </label>
          <div className="flex gap-2">
            <input
              id="rb-walkin"
              value={walkIn}
              maxLength={60}
              placeholder="Display name"
              disabled={pending}
              onChange={(e) => setWalkIn(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && walkIn.trim()) void addWalkIn();
              }}
              className={rbInputClass}
            />
            <button
              type="button"
              disabled={pending || !walkIn.trim()}
              onClick={() => void addWalkIn()}
              className={`${rbSubmitClass} h-[42px] whitespace-nowrap`}
            >
              Add guest
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
