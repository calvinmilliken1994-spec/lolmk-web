"use client";

import { useEffect, useState, type ReactNode } from "react";
import { DeckKicker, type DeckRun } from "@/components/control-deck";
import { RbLockLine, RbSegmented } from "@/components/riftbound/rb-ui";
import { cn } from "@/lib/utils";
import type { MayhemAdminState, MayhemFormatConfig, MayhemTeamFormat, SeriesLength } from "@/types/mayhem";
import type { MayhemActions } from "./mayhem-actions";
import { mayhemKnockoutSettingsLock, mayhemReadiness, mayhemTeamFormatLock } from "./mayhem-deck-model";

export interface MayhemWorkspaceProps {
  state: MayhemAdminState;
  run: DeckRun;
  pending: boolean;
  actions: MayhemActions;
}

export const mhButton =
  "h-9 rounded-sm border border-line-strong bg-elevated px-3 text-[13px] text-ink hover:border-brand-blue-bright disabled:cursor-not-allowed disabled:border-line disabled:bg-transparent disabled:text-ink-disabled disabled:hover:border-line";
export const mhQuietButton =
  "h-9 rounded-sm border border-line-strong bg-transparent px-3 text-[13px] text-ink-secondary hover:text-ink disabled:cursor-not-allowed disabled:border-line disabled:text-ink-disabled";
export const mhSubmit =
  "h-9 rounded-sm border border-brand-blue-bright bg-brand-blue-muted px-3 text-[13px] font-semibold text-ink hover:bg-brand-blue disabled:cursor-not-allowed disabled:border-line-strong disabled:bg-transparent disabled:text-ink-disabled";
const inputClass =
  "h-9 min-w-0 rounded-sm border border-line-strong bg-base px-3 text-[13px] text-ink placeholder:text-ink-disabled focus:border-brand-blue-bright focus:outline-none";

export function MhPanel({
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

/** Entrants phase: registration, the entrant list and the event format. */
export function MayhemEntrantsWorkspace({ state, run, pending, actions }: MayhemWorkspaceProps) {
  const collecting = state.event.stage === "collecting";
  return (
    <>
      <div>
        <DeckKicker className="text-brand-red-bright">
          ENTRANTS · {collecting ? (state.event.registration_open ? "SIGNUPS OPEN" : "COLLECTING") : "CLOSED"}
        </DeckKicker>
        <h2 className="mt-1 font-heading text-[24px] font-semibold">
          {state.players.length} player{state.players.length === 1 ? "" : "s"}
        </h2>
      </div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <EntrantsPanel state={state} run={run} pending={pending} actions={actions} />
        <div className="flex min-w-0 flex-col gap-3">
          <RegistrationPanel state={state} run={run} pending={pending} actions={actions} />
          <FormatPanel state={state} run={run} pending={pending} actions={actions} />
        </div>
      </div>
    </>
  );
}

function EntrantsPanel({ state, run, pending, actions }: MayhemWorkspaceProps) {
  const [name, setName] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteResult, setPasteResult] = useState<string | null>(null);
  const isPremade = state.event.team_format === "premade";
  const readiness = mayhemReadiness(state);

  // The input clears only once the add lands, so a failed request keeps what was typed.
  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    void run(async () => {
      await actions.addPlayer(trimmed);
      setName("");
    });
  };

  const submitPaste = () => {
    if (!pasteText.trim()) return;
    setPasteResult(null);
    void run(async () => {
      const result = await actions.bulkAddPlayers(pasteText);
      setPasteText("");
      const parts = [`${result.added} added`];
      if (result.skippedDuplicate) parts.push(`${result.skippedDuplicate} duplicate`);
      if (result.skippedTooLong) parts.push(`${result.skippedTooLong} too long`);
      setPasteResult(parts.join(" · "));
    });
  };

  return (
    <MhPanel
      kicker="ENTRANTS"
      title="Players"
      aside={<span className="font-mono text-[12px] text-ink-muted">{state.players.length}</span>}
    >
      {isPremade ? (
        <p className="text-[13px] text-ink-secondary">Premade signups: players join through team creation, not here.</p>
      ) : (
        <>
          <div className="flex gap-2">
            <label htmlFor="entrant-name" className="sr-only">
              Player name or IGN
            </label>
            <input
              id="entrant-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="Player name or IGN"
              className={cn(inputClass, "flex-1")}
            />
            <button type="button" onClick={submit} disabled={pending || !name.trim()} className={mhSubmit}>
              Add
            </button>
          </div>
          <button
            type="button"
            onClick={() => setShowPaste((v) => !v)}
            className="self-start text-[12px] text-link hover:text-ink"
          >
            {showPaste ? "Hide paste import" : "Paste a full list instead"}
          </button>
          {showPaste && (
            <div className="flex flex-col gap-2">
              <textarea
                aria-label="Player list, one name per line"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={"One name per line\nFaker\nShowMaker\nCaps"}
                rows={5}
                className="resize-y rounded-sm border border-line-strong bg-base px-3 py-2 text-[13px] text-ink placeholder:text-ink-disabled focus:border-brand-blue-bright focus:outline-none"
              />
              <div className="flex items-center gap-2">
                <button type="button" onClick={submitPaste} disabled={pending || !pasteText.trim()} className={mhSubmit}>
                  Import list
                </button>
                {pasteResult && <span className="text-[12px] text-ink-muted">{pasteResult}</span>}
              </div>
            </div>
          )}
        </>
      )}

      {state.players.length === 0 ? (
        !isPremade && (
          <p className="border border-dashed border-line-strong p-4 text-[13px] text-ink-muted">
            Add at least 20 players (multiples of 5) to randomize teams.
          </p>
        )
      ) : (
        <ul className="grid max-h-[360px] grid-cols-1 gap-x-4 overflow-y-auto sm:grid-cols-2" aria-label="Entrants">
          {state.players.map((p, i) => (
            <li key={p.id} className="flex min-h-[30px] min-w-0 items-center justify-between gap-2 border-b border-line text-[13px]">
              <span className="min-w-0 truncate">
                <span className="mr-2 font-mono text-[11px] text-ink-muted">{String(i + 1).padStart(2, "0")}</span>
                {p.display_name}
                <span className="ml-2 text-[12px] text-ink-muted">{p.member_discord_id ? "member" : "guest"}</span>
              </span>
              <button
                type="button"
                onClick={() => void run(() => actions.removePlayer(p.id))}
                disabled={pending}
                className="shrink-0 px-1 text-[13px] text-ink-muted hover:text-danger disabled:cursor-not-allowed"
                aria-label={`Remove ${p.display_name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {!isPremade && (
        <p className={cn("text-[12px]", readiness.canRandomize ? "text-success" : "text-warning-ink")}>
          {readiness.canRandomize
            ? `Ready: ${readiness.teamCount} teams of 5.`
            : `Need ${readiness.playersNeeded} more player${readiness.playersNeeded === 1 ? "" : "s"} (multiples of 5, min 20).`}
        </p>
      )}

      <div className="mt-1 border-t border-line pt-3">
        <button
          type="button"
          onClick={() => {
            if (window.confirm("Clear all players, teams, groups, and matches? This can't be undone.")) {
              void run(() => actions.clearAllPlayers());
            }
          }}
          disabled={pending}
          className="text-[12px] text-ink-muted hover:text-danger disabled:cursor-not-allowed"
        >
          Reset everything
        </button>
        <span className="ml-2 text-[12px] text-ink-disabled">Deletes every player, team, group and match.</span>
      </div>
    </MhPanel>
  );
}

const TEAM_FORMATS: { value: MayhemTeamFormat; label: string }[] = [
  { value: "randomized", label: "Randomized" },
  { value: "premade", label: "Premade teams" },
];

function RegistrationPanel({ state, run, pending, actions }: MayhemWorkspaceProps) {
  const lock = mayhemTeamFormatLock(state);
  const collecting = state.event.stage === "collecting";
  const open = state.event.registration_open;
  const isPremade = state.event.team_format === "premade";
  const ready = state.teams.filter((t) => t.is_ready).length;

  return (
    <MhPanel kicker="REGISTRATION" title="Signups">
      <RbSegmented
        label="Team format"
        columns={2}
        options={TEAM_FORMATS}
        value={state.event.team_format === "premade" ? "premade" : "randomized"}
        disabled={pending || lock !== null}
        onChange={(format) => void run(() => actions.setTeamFormat(format))}
      />
      {lock && <RbLockLine reason={lock} />}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending || (!open && !collecting)}
          onClick={() => void run(() => actions.setRegistrationOpen(!open))}
          className={open ? mhButton : mhSubmit}
        >
          {open ? "Close signups" : "Open signups"}
        </button>
        <span className="text-[12px] text-ink-muted">
          {!collecting
            ? "Only while collecting entrants."
            : open
              ? "Verified members can sign themselves up. Randomizing closes it."
              : "Lets verified Discord members sign themselves up."}
        </span>
      </div>
      {isPremade && (
        <p className="text-[12px] text-ink-secondary">
          {ready} / {state.teams.length} premade teams full. Finalize them with the action at the top.
        </p>
      )}
    </MhPanel>
  );
}

const BO_OPTIONS: { value: SeriesLength; label: string }[] = [
  { value: 1, label: "Bo1" },
  { value: 3, label: "Bo3" },
  { value: 5, label: "Bo5" },
];

function Stepper({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  const btn =
    "h-9 w-9 text-[15px] text-ink-secondary hover:text-ink disabled:cursor-not-allowed disabled:text-ink-disabled";
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] text-ink-secondary">{label}</span>
      <div className="inline-flex w-fit items-center rounded-sm border border-line-strong">
        <button type="button" aria-label={`${label}: fewer`} disabled={disabled || value <= min} className={btn} onClick={() => onChange(value - 1)}>
          −
        </button>
        <span className="w-8 text-center font-mono text-[13px] tabular-nums">{value}</span>
        <button type="button" aria-label={`${label}: more`} disabled={disabled || value >= max} className={btn} onClick={() => onChange(value + 1)}>
          +
        </button>
      </div>
    </div>
  );
}

function Check({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={cn("flex min-h-9 items-center justify-between gap-3 text-[13px]", disabled ? "text-ink-disabled" : "text-ink-secondary")}>
      {label}
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-brand-blue-bright"
      />
    </label>
  );
}

function FormatPanel({ state, run, pending, actions }: MayhemWorkspaceProps) {
  const [local, setLocal] = useState<MayhemFormatConfig>(state.event.format);
  const [saving, setSaving] = useState(false);
  const knockoutLock = mayhemKnockoutSettingsLock(state);

  // The desk stays mounted all event, so resync from the server whenever its
  // format changes (reset, another admin), but not while a save is in flight.
  useEffect(() => {
    if (!saving) setLocal(state.event.format);
  }, [state.event.format, saving]);

  const save = (next: MayhemFormatConfig) => {
    setLocal(next);
    setSaving(true);
    void run(async () => {
      try {
        await actions.updateFormat(next);
      } finally {
        setSaving(false);
      }
    });
  };
  const g = local.groupStage;
  const k = local.knockout;
  const setG = (patch: Partial<MayhemFormatConfig["groupStage"]>) => save({ ...local, groupStage: { ...g, ...patch } });
  const setK = (patch: Partial<MayhemFormatConfig["knockout"]>) => save({ ...local, knockout: { ...k, ...patch } });

  return (
    <MhPanel kicker="FORMAT" title="Groups and knockout">
      <Check label="Group stage" checked={g.enabled} disabled={pending} onChange={(v) => setG({ enabled: v })} />
      {g.enabled && (
        <div className="grid grid-cols-2 gap-3">
          <Stepper label="Groups" value={g.groupCount} min={2} max={8} disabled={pending} onChange={(v) => setG({ groupCount: v })} />
          <Stepper label="Advance per group" value={g.advancePerGroup} min={1} max={4} disabled={pending} onChange={(v) => setG({ advancePerGroup: v })} />
          <RbSegmented label="Group series" columns={3} options={BO_OPTIONS} value={g.seriesLength} disabled={pending} onChange={(v) => setG({ seriesLength: v })} />
          <RbSegmented
            label="Seeding"
            columns={2}
            options={[
              { value: "random" as const, label: "Random" },
              { value: "manual" as const, label: "Manual" },
            ]}
            value={g.seeding}
            disabled={pending}
            onChange={(v) => setG({ seeding: v })}
          />
        </div>
      )}
      <div className="flex flex-col gap-1 border-t border-line pt-3">
        <RbSegmented
          label="Knockout series"
          columns={3}
          options={BO_OPTIONS}
          value={k.seriesLength}
          disabled={pending || knockoutLock !== null}
          onChange={(v) => setK({ seriesLength: v })}
        />
        <Check label="Double elimination" checked={k.doubleElimination} disabled={pending || knockoutLock !== null} onChange={(v) => setK({ doubleElimination: v })} />
        <Check label="Third-place match" checked={k.thirdPlaceMatch} disabled={pending || knockoutLock !== null} onChange={(v) => setK({ thirdPlaceMatch: v })} />
        <Check label="Grand final reset" checked={k.grandFinalReset} disabled={pending || knockoutLock !== null} onChange={(v) => setK({ grandFinalReset: v })} />
        {knockoutLock && <RbLockLine reason={knockoutLock} />}
      </div>
    </MhPanel>
  );
}
