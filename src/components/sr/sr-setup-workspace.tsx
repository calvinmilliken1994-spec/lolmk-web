"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ActivityLog, DeckKicker, type DeckRun } from "@/components/control-deck";
import { RbLockLine, RbSegmented } from "@/components/riftbound/rb-ui";
import { isoToLocalInput, localInputToIso } from "@/components/sr/sr-shared";
import { cn } from "@/lib/utils";
import type { SrAdminState } from "@/types/sr-tournament";
import type { SrActions } from "./sr-actions";
import { srActivity, srApproved, srBracketSettingsLock, srDatesLock, srRosterLock } from "./sr-deck-model";

export interface SrWorkspaceProps {
  state: SrAdminState;
  run: DeckRun;
  pending: boolean;
  actions: SrActions;
  /** Re-read the admin state now (after a logo upload, which bypasses `run`). */
  refresh: () => void;
  blobConfigured: boolean;
}

export const srButton =
  "h-9 rounded-sm border border-line-strong bg-elevated px-3 text-[13px] text-ink hover:border-brand-blue-bright disabled:cursor-not-allowed disabled:border-line disabled:bg-transparent disabled:text-ink-disabled disabled:hover:border-line";
export const srQuietButton =
  "h-9 rounded-sm border border-line-strong bg-transparent px-3 text-[13px] text-ink-secondary hover:text-ink disabled:cursor-not-allowed disabled:border-line disabled:text-ink-disabled";
export const srSubmit =
  "h-9 rounded-sm border border-brand-blue-bright bg-brand-blue-muted px-3 text-[13px] font-semibold text-ink hover:bg-brand-blue disabled:cursor-not-allowed disabled:border-line-strong disabled:bg-transparent disabled:text-ink-disabled";
export const srInput =
  "h-9 min-w-0 rounded-sm border border-line-strong bg-base px-3 text-[13px] text-ink placeholder:text-ink-disabled focus:border-brand-blue-bright focus:outline-none disabled:text-ink-muted";

export function SrHeader({ kicker, title, aside }: { kicker: string; title: string; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <DeckKicker className="text-brand-red-bright">{kicker}</DeckKicker>
        <h2 className="mt-1 font-heading text-[24px] font-semibold">{title}</h2>
      </div>
      {aside}
    </div>
  );
}

export function SrPanel({
  kicker,
  title,
  aside,
  children,
  className,
}: {
  kicker: string;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-3 border border-line-strong bg-surface p-4", className)}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[11px] text-ink-muted">{kicker}</p>
          <h3 className="mt-0.5 font-heading text-[18px] font-semibold">{title}</h3>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function SrActivity({ state }: { state: SrAdminState }) {
  const rows = srActivity(state);
  if (rows.length === 0) return null;
  return <ActivityLog entries={rows.slice(0, 12)} />;
}

type Bo = 1 | 3 | 5;
const BO_OPTIONS = [1, 3, 5].map((n) => ({ value: n as Bo, label: `Bo${n}` }));

/** Setup: the settings form (with its lock reasons) and the signups switch. */
export function SrSetupWorkspace({ state, run, pending, actions }: SrWorkspaceProps) {
  const t = state.tournament;
  const isDraft = t.status === "draft";
  return (
    <>
      <SrHeader kicker={`SETUP · ${isDraft ? "DRAFT" : t.status.replace("_", " ").toUpperCase()}`} title="Settings" />
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <SettingsPanel state={state} run={run} pending={pending} actions={actions} />
        <div className="flex min-w-0 flex-col gap-3">
          <SrPanel kicker="CAPTAIN SIGNUPS" title={t.signups_open ? "Signups are open" : "Signups are closed"}>
            <p className="text-[13px] text-ink-secondary">
              Captains apply with a five-player roster; each player confirms from a Discord invite. A fully confirmed
              roster arrives in Signups for review.
            </p>
            <button
              type="button"
              disabled={pending || (!isDraft && !t.signups_open)}
              onClick={() => void run(() => actions.setSignupsOpen(t.id, !t.signups_open))}
              className={cn(t.signups_open ? srQuietButton : srSubmit, "self-start")}
            >
              {t.signups_open ? "Close signups" : "Open signups"}
            </button>
            {!isDraft && !t.signups_open && <RbLockLine reason="Signups can only open while the tournament is in draft." />}
          </SrPanel>
          <SrPanel kicker="EVENT" title={t.slug}>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
              <dt className="text-ink-muted">Teams</dt>
              <dd>
                {srApproved(state).length} approved · {t.min_teams}–{t.max_teams} allowed
              </dd>
              <dt className="text-ink-muted">Seeds</dt>
              <dd>{t.seed_locked ? "Locked" : "Not rolled"}</dd>
              <dt className="text-ink-muted">Matches</dt>
              <dd>{state.matches.length}</dd>
            </dl>
            <div className="flex flex-wrap gap-3 text-[12px]">
              <a href={`/tournaments/summoners-rift/${t.slug}`} target="_blank" rel="noreferrer" className="text-link hover:text-ink">
                Public bracket ↗
              </a>
              <a href={`/srlive/${t.slug}`} target="_blank" rel="noreferrer" className="text-link hover:text-ink">
                Live screen ↗
              </a>
            </div>
          </SrPanel>
        </div>
      </div>
      <SrActivity state={state} />
    </>
  );
}

function SettingsPanel({ state, run, pending, actions }: Omit<SrWorkspaceProps, "refresh" | "blobConfigured">) {
  const t = state.tournament;
  const [name, setName] = useState(t.name);
  const [bestOf, setBestOf] = useState<Bo>(t.best_of);
  // 0 = same as the series length (grand_final_best_of NULL).
  const [gfBestOf, setGfBestOf] = useState<0 | Bo>(t.grand_final_best_of ?? 0);
  const [thirdPlace, setThirdPlace] = useState(t.third_place_match);
  const [gfReset, setGfReset] = useState(t.grand_final_reset);
  const [startAt, setStartAt] = useState(isoToLocalInput(t.start_at));
  const [endAt, setEndAt] = useState(isoToLocalInput(t.end_at));
  // Follow saves made elsewhere (another admin, another tab).
  useEffect(() => {
    setName(t.name);
    setBestOf(t.best_of);
    setGfBestOf(t.grand_final_best_of ?? 0);
    setThirdPlace(t.third_place_match);
    setGfReset(t.grand_final_reset);
    setStartAt(isoToLocalInput(t.start_at));
    setEndAt(isoToLocalInput(t.end_at));
  }, [t.name, t.best_of, t.grand_final_best_of, t.third_place_match, t.grand_final_reset, t.start_at, t.end_at]);

  const bracketLock = srBracketSettingsLock(state);
  const datesLock = srDatesLock(state);
  const de = t.format === "double_elim";

  const save = () =>
    void run(() =>
      actions.updateTournament(t.id, {
        name,
        ...(!bracketLock
          ? { bestOf, thirdPlaceMatch: thirdPlace, grandFinalReset: gfReset, grandFinalBestOf: gfBestOf === 0 ? null : gfBestOf }
          : {}),
        // actions.ts rejects any date change after draft, so dates are only sent in draft.
        ...(!datesLock ? { startAt: localInputToIso(startAt), endAt: localInputToIso(endAt) } : {}),
      }),
    );

  return (
    <SrPanel kicker="FORMAT" title={de ? "Double elimination" : "Single elimination"}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="flex flex-col gap-1.5 text-[12px] text-ink-secondary">
          Name
          <input className={srInput} value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <RbSegmented label="Series length" columns={3} options={BO_OPTIONS} value={bestOf} onChange={setBestOf} disabled={pending || !!bracketLock} />
          <RbSegmented
            label="Grand final length"
            columns={4}
            options={[{ value: 0 as 0 | Bo, label: "Same" }, ...BO_OPTIONS]}
            value={gfBestOf}
            onChange={setGfBestOf}
            disabled={pending || !!bracketLock}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          {!de && (
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={thirdPlace} disabled={pending || !!bracketLock} onChange={(e) => setThirdPlace(e.target.checked)} className="h-4 w-4 accent-brand-blue-bright" />
              Third-place match
            </label>
          )}
          {de && (
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={gfReset} disabled={pending || !!bracketLock} onChange={(e) => setGfReset(e.target.checked)} className="h-4 w-4 accent-brand-blue-bright" />
              Grand final reset (if the lower-bracket team wins the first final)
            </label>
          )}
          {bracketLock && <RbLockLine reason={bracketLock} />}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-[12px] text-ink-secondary">
            Starts (local)
            <input type="datetime-local" className={srInput} value={startAt} disabled={pending || !!datesLock} onChange={(e) => setStartAt(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5 text-[12px] text-ink-secondary">
            Ends (local)
            <input type="datetime-local" className={srInput} value={endAt} disabled={pending || !!datesLock} onChange={(e) => setEndAt(e.target.value)} />
          </label>
        </div>
        {datesLock && <RbLockLine reason={datesLock} />}
        <button type="submit" disabled={pending} className={cn(srSubmit, "self-start")}>
          Save settings
        </button>
      </form>
    </SrPanel>
  );
}

/** Seeding: the rolled order, and Unlock (back to draft) before the bracket exists. */
export function SrSeedingWorkspace({ state, run, pending, actions }: SrWorkspaceProps) {
  const t = state.tournament;
  const seeded = srApproved(state)
    .filter((x) => x.seed !== null)
    .sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0));
  const canUnlock = t.status === "seeding";
  return (
    <>
      <SrHeader
        kicker={`SEEDING · ${t.seed_locked ? "LOCKED" : "NOT ROLLED"}`}
        title={seeded.length ? `${seeded.length} teams seeded` : "Seeds not rolled yet"}
        aside={
          canUnlock ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (window.confirm("Unlock seeds? The tournament goes back to draft so the roster can change, then roll again.")) {
                  void run(() => actions.unlockSeeds(t.id));
                }
              }}
              className={srQuietButton}
            >
              Unlock seeds
            </button>
          ) : undefined
        }
      />
      {seeded.length === 0 ? (
        <p className="border border-dashed border-line-strong p-4 text-[13px] text-ink-secondary">
          Roll seeds from Signups once at least {t.min_teams} teams are approved.
        </p>
      ) : (
        <ol className="grid gap-1.5 sm:grid-cols-2">
          {seeded.map((x) => (
            <li key={x.id} className="flex items-center gap-3 border border-line bg-surface px-3 py-2 text-[14px]">
              <span className="w-8 font-mono text-[12px] text-ink-muted">#{x.seed}</span>
              <span className="min-w-0 flex-1 truncate font-semibold">{x.name}</span>
            </li>
          ))}
        </ol>
      )}
      {!canUnlock && t.status !== "draft" && <RbLockLine reason="Seeds can only be unlocked before the bracket is generated." />}
      {srRosterLock(state) && t.status === "seeding" && <RbLockLine reason={srRosterLock(state) as string} />}
      <SrActivity state={state} />
    </>
  );
}
