"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  ClipboardPaste,
  Dices,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  Swords,
  Timer as TimerIcon,
  Trash2,
  Trophy,
  Tv,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { MayhemLivePreview } from "@/components/mayhem/mayhem-live-preview";
import { cn } from "@/lib/utils";
import type {
  MayhemFormatConfig,
  MayhemFull,
  MayhemMatch,
  MayhemScene,
  MayhemTeamFormat,
  SeriesLength,
} from "@/types/mayhem";
import {
  addPlayer,
  advanceReveal,
  bulkAddPlayers,
  clearAllPlayers,
  finalizePremadeTeams,
  generateGroups,
  generateKnockoutFromAllTeams,
  generateKnockoutFromGroups,
  recordMatchResult,
  refreshTeamIdentities,
  removePlayer,
  randomizeTeams,
  reportBo1Winner,
  setActiveMatch,
  setRegistrationOpen,
  setScene,
  setTeamFormat,
  startAutoReveal,
  pauseAutoReveal,
  startCountdown,
  undoMatchResult,
  updateFormat,
} from "@/app/tools/mayhem/actions";

const STAGE_LABELS: Record<MayhemFull["event"]["stage"], string> = {
  collecting: "Collecting entrants",
  randomized: "Teams set",
  group_stage: "Group stage",
  knockout: "Knockout",
  completed: "Completed",
};

/** Shared draft edit for a match's scores — see `useMatchDrafts` for why this can't be local `useState` per row. */
type ScoreDraft = { a: number; b: number };

export function MayhemAdmin({ initial }: { initial: MayhemFull }) {
  const [data, setData] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number>(() => Date.now());

  // Every fetch (poll or post-action) is stamped with an incrementing
  // sequence number; only the latest one is ever applied. Without this, an
  // action's own immediate refresh can be overwritten a moment later by a
  // slower in-flight poll response that was already stale when it started.
  const fetchSeq = useRef(0);
  const refreshNow = useCallback(async () => {
    const seq = ++fetchSeq.current;
    try {
      const res = await fetch("/api/mayhem/admin-state", { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as MayhemFull;
        if (seq === fetchSeq.current) {
          setData(json);
          setLastSyncedAt(Date.now());
        }
      }
    } catch {
      /* transient network hiccup — next poll tick recovers */
    }
  }, []);

  useEffect(() => {
    const id = setInterval(refreshNow, 2000);
    return () => clearInterval(id);
  }, [refreshNow]);

  // Runs a server action, then refreshes immediately rather than waiting on
  // the next poll tick — actions feel instant instead of up to 2s stale.
  function run(fn: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        await refreshNow();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
  }

  // One shared draft-score map for every match row on the page. Two panels
  // legitimately show the same match at once (e.g. the active match in
  // "Match operations" and its round in the Bracket panel below) — without
  // a shared source, each mounted <MatchRow> held its own local useState
  // and could silently diverge before either side reported a result.
  const [drafts, setDrafts] = useState<Map<string, ScoreDraft>>(new Map());
  const getDraft = useCallback(
    (m: MayhemMatch): ScoreDraft => drafts.get(m.id) ?? { a: m.team_a_score, b: m.team_b_score },
    [drafts],
  );
  const setDraft = useCallback((matchId: string, next: ScoreDraft) => {
    setDrafts((prev) => {
      const copy = new Map(prev);
      copy.set(matchId, next);
      return copy;
    });
  }, []);

  const playerCount = data.players.length;
  // Exact "how many more do you need", not an approximation: round up to
  // the next multiple of 5 (minimum 20), then subtract what's already in.
  const targetPlayerCount = Math.max(20, Math.ceil(playerCount / 5) * 5);
  const playersNeeded = targetPlayerCount - playerCount;
  const teamCountIfRandomized = playerCount / 5;
  const canRandomize = playerCount >= 20 && playerCount % 5 === 0;

  const knockoutMatches = data.matches.filter((m) => m.bracket !== "group");
  const active = data.matches.find((m) => m.id === data.event.active_match_id);
  const playable = data.matches.filter(
    (m) => m.team_a_id && m.team_b_id && m.status !== "completed",
  );

  const matchProps = { pending, run, getDraft, setDraft };

  return (
    <div className="min-h-screen bg-base text-ink">
      <header className="sticky top-0 z-10 border-b border-line-subtle bg-base/90 backdrop-blur-md">
        <div className="w-full px-4 xl:px-6 2xl:px-8 flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/tools"
              className="inline-flex items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink"
            >
              <ArrowLeft strokeWidth={1.75} className="h-4 w-4" />
              Tools
            </Link>
            <div className="h-4 w-px bg-line" />
            <h1 className="font-display text-heading-lg leading-none">ARAM Mayhem</h1>
            <span className="rounded-sm border border-line-strong px-2 py-0.5 text-caption uppercase tracking-wider text-ink-secondary">
              {STAGE_LABELS[data.event.stage]}
            </span>
            <span className="text-caption text-ink-muted">
              {playerCount} players · {data.teams.length} teams
            </span>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="/mayhemlive"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-body-sm text-brand-blue-bright hover:text-ink"
            >
              <Tv strokeWidth={1.75} className="h-4 w-4" />
              Open /mayhemlive
            </a>
          </div>
        </div>
      </header>

      <div className="w-full px-4 xl:px-6 2xl:px-8 py-6 space-y-6">
        {error && (
          <div className="border border-danger/40 bg-danger/10 text-danger px-4 py-3 rounded-sm flex items-center justify-between">
            <span className="text-body-sm">{error}</span>
            <button onClick={() => setError(null)} aria-label="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Three columns, each stacking its own content independently —
            no column waits for a taller neighbor to finish before its
            next panel starts. Left: prep. Center (widest): live desk.
            Right: match ops down through bracket. */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.8fr)_minmax(320px,1.1fr)] xl:items-start">
          <div className="min-w-0 space-y-4">
            <EntrantsPanel
              data={data}
              pending={pending}
              run={run}
              canRandomize={canRandomize}
              playersNeeded={playersNeeded}
              teamCountIfRandomized={teamCountIfRandomized}
            />
            <RegistrationPanel data={data} pending={pending} run={run} />
            <FormatPanel data={data} run={run} />
          </div>

          <div className="min-w-0">
            <PresentationDesk data={data} pending={pending} run={run} lastSyncedAt={lastSyncedAt} />
          </div>

          <div className="min-w-0 space-y-4">
            <MatchOpsPanel data={data} active={active} playable={playable} {...matchProps} />
            <TeamsPanel data={data} />
            <GroupsPanel data={data} {...matchProps} />
            <BracketPanel data={data} knockoutMatches={knockoutMatches} {...matchProps} />
          </div>
        </div>
      </div>
    </div>
  );
}

function PanelHeading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <h2 className="font-heading text-heading-sm">{children}</h2>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entrants (left column, top)
// ---------------------------------------------------------------------------

function EntrantsPanel({
  data,
  pending,
  run,
  canRandomize,
  playersNeeded,
  teamCountIfRandomized,
}: {
  data: MayhemFull;
  pending: boolean;
  run: (fn: () => Promise<void>) => void;
  canRandomize: boolean;
  playersNeeded: number;
  teamCountIfRandomized: number;
}) {
  const [name, setName] = useState("");
  const [confirmReroll, setConfirmReroll] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteResult, setPasteResult] = useState<string | null>(null);
  const alreadyRandomized = data.event.stage !== "collecting";
  const isPremade = data.event.team_format === "premade";

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Only clear the input once the add actually lands — a failed request
    // (e.g. a dropped connection) leaves what the admin typed intact
    // instead of silently discarding it.
    run(async () => {
      await addPlayer(trimmed);
      setName("");
    });
  }

  function submitPaste() {
    if (!pasteText.trim()) return;
    setPasteResult(null);
    run(async () => {
      const result = await bulkAddPlayers(pasteText);
      // Text is only cleared on success — a failed paste (e.g. a stale
      // premade-mode rejection) leaves the admin's input intact rather
      // than silently discarding what they typed.
      setPasteText("");
      const parts = [`${result.added} added`];
      if (result.skippedDuplicate) parts.push(`${result.skippedDuplicate} duplicate`);
      if (result.skippedTooLong) parts.push(`${result.skippedTooLong} too long`);
      setPasteResult(parts.join(" · "));
    });
  }

  return (
    <div className="bg-surface border border-line p-4">
      <PanelHeading action={<span className="text-caption text-ink-muted">{data.players.length} players</span>}>
        Entrants
      </PanelHeading>

      {isPremade ? (
        <p className="text-body-sm text-ink-secondary italic py-4 text-center">
          Premade signups — players join through team creation, not here.
        </p>
      ) : (
        <>
          <label htmlFor="entrant-name" className="sr-only">
            Player name or IGN
          </label>
          <div className="flex gap-2 mb-2">
            <input
              id="entrant-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="Player name or IGN"
              className="flex-1 min-w-0 bg-elevated border border-line rounded-sm px-3 py-2 text-body-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-brand-red"
            />
            <Button size="sm" onClick={submit} disabled={pending || !name.trim()}>
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>

          <button
            onClick={() => setShowPaste((v) => !v)}
            className="w-full mb-3 inline-flex items-center gap-1.5 text-caption uppercase tracking-wider text-ink-muted hover:text-ink py-1"
          >
            <ClipboardPaste className="h-3.5 w-3.5" />
            {showPaste ? "Hide paste import" : "Paste a full list instead"}
          </button>

          {showPaste && (
            <div className="mb-3 space-y-2">
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={"One name per line\nFaker\nShowMaker\nCaps"}
                rows={5}
                className="w-full bg-elevated border border-line rounded-sm px-3 py-2 text-body-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-brand-red resize-y"
              />
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={submitPaste} disabled={pending || !pasteText.trim()}>
                  <ClipboardPaste className="h-3.5 w-3.5" /> Import list
                </Button>
                {pasteResult && <span className="text-caption text-ink-muted">{pasteResult}</span>}
              </div>
            </div>
          )}
        </>
      )}

      {data.players.length === 0 ? (
        !isPremade && (
          <p className="text-caption text-ink-muted italic py-4 text-center">
            Add at least 20 players (multiples of 5) to randomize teams.
          </p>
        )
      ) : (
        <ul className="divide-y divide-line-subtle max-h-64 overflow-y-auto mb-3">
          {data.players.map((p, i) => (
            <li key={p.id} className="flex items-center justify-between py-1.5 min-w-0">
              <span className="text-body-sm truncate min-w-0">
                <span className="text-ink-muted font-mono text-caption mr-1.5">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {p.display_name}
                {p.member_discord_id && (
                  <span className="ml-1.5 text-caption text-brand-blue-bright" title="Verified member">
                    ✓
                  </span>
                )}
              </span>
              <button
                onClick={() => run(() => removePlayer(p.id))}
                disabled={pending}
                className="shrink-0 text-ink-muted hover:text-danger"
                aria-label={`Remove ${p.display_name}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!isPremade && (
        <div className="text-caption mb-3">
          {canRandomize ? (
            <p className="text-success">Ready — {teamCountIfRandomized} teams of 5.</p>
          ) : (
            <p className="text-warning">
              Need {playersNeeded} more player{playersNeeded === 1 ? "" : "s"} (multiples of 5, min 20).
            </p>
          )}
        </div>
      )}

      {!isPremade && (alreadyRandomized && !confirmReroll ? (
        <div className="space-y-1.5">
          <Tooltip content="Reshuffles rosters and team identities from scratch. Erases current groups and bracket." className="w-full">
            <Button variant="secondary" size="sm" className="w-full" onClick={() => setConfirmReroll(true)} disabled={pending}>
              <RotateCcw className="h-3.5 w-3.5" /> Reroll teams
            </Button>
          </Tooltip>
          <Tooltip content="Gives existing teams new names/icons without touching rosters, groups, or match results." className="w-full">
            <button
              onClick={() => run(() => refreshTeamIdentities())}
              disabled={pending}
              className="w-full text-caption uppercase tracking-wider text-ink-muted hover:text-ink py-1"
            >
              Refresh names/icons
            </button>
          </Tooltip>
        </div>
      ) : alreadyRandomized && confirmReroll ? (
        <div className="space-y-1.5">
          <p className="text-caption text-danger">Erases teams, groups, and bracket. Sure?</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="primary"
              className="flex-1"
              disabled={pending || !canRandomize}
              onClick={() => {
                run(() => randomizeTeams());
                setConfirmReroll(false);
              }}
            >
              Yes, reroll
            </Button>
            <Button size="sm" variant="secondary" className="flex-1" onClick={() => setConfirmReroll(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="primary" className="w-full" disabled={pending || !canRandomize} onClick={() => run(() => randomizeTeams())}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Dices className="h-4 w-4" />}
          Randomize teams
        </Button>
      ))}

      <div className="mt-3 pt-3 border-t border-line-subtle">
        <Tooltip content="Deletes every player, team, group, and match. Cannot be undone." className="w-full">
          <button
            onClick={() => {
              if (confirm("Clear all players, teams, groups, and matches? This can't be undone.")) {
                run(() => clearAllPlayers());
              }
            }}
            disabled={pending}
            className="w-full text-caption uppercase tracking-wider text-ink-disabled hover:text-danger"
          >
            <Trash2 className="h-3 w-3 inline mr-1" />
            Reset everything
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Registration & format (left column, between Entrants and Format)
// ---------------------------------------------------------------------------

function RegistrationPanel({ data, pending, run }: { data: MayhemFull; pending: boolean; run: (fn: () => Promise<void>) => void }) {
  const locked = data.players.length > 0 || data.teams.length > 0;
  const isPremade = data.event.team_format === "premade";
  const collecting = data.event.stage === "collecting";

  return (
    <div className="bg-surface border border-line p-4 space-y-3">
      <PanelHeading>Signups</PanelHeading>

      <Field label="Team format">
        <div className="flex gap-2">
          {([
            { id: "randomized" as MayhemTeamFormat, label: "Randomized" },
            { id: "premade" as MayhemTeamFormat, label: "Premade teams" },
          ]).map((opt) => (
            <Tooltip
              key={opt.id}
              content={locked ? "Locked — reset everything to change the format." : opt.label}
              className="flex-1"
            >
              <button
                onClick={() => run(() => setTeamFormat(opt.id))}
                disabled={pending || locked}
                className={cn(
                  "w-full px-3 py-2 text-body-sm border rounded-sm disabled:cursor-not-allowed disabled:opacity-50",
                  data.event.team_format === opt.id ? "border-brand-red bg-brand-red/10 text-ink" : "border-line text-ink-secondary",
                )}
              >
                {opt.label}
              </button>
            </Tooltip>
          ))}
        </div>
      </Field>

      <Field label="Public self-service signup">
        <Tooltip
          content={
            !collecting
              ? "Only available while still collecting entrants."
              : data.event.registration_open
                ? "Close it before randomizing/finalizing."
                : "Lets verified Discord members sign themselves up."
          }
          className="w-full"
        >
          <Button
            size="sm"
            variant={data.event.registration_open ? "secondary" : "primary"}
            className="w-full"
            disabled={pending || (!data.event.registration_open && !collecting)}
            onClick={() => run(() => setRegistrationOpen(!data.event.registration_open))}
          >
            {data.event.registration_open ? "Close signups" : "Open signups"}
          </Button>
        </Tooltip>
      </Field>

      {isPremade && (
        <div className="pt-2 border-t border-line-subtle">
          <p className="text-caption text-ink-secondary mb-2">
            {data.teams.filter((t) => t.is_ready).length} / {data.teams.length} teams full
          </p>
          <Tooltip content="Locks in every full team and moves to reveal. Incomplete teams block this." className="w-full">
            <Button
              size="sm"
              className="w-full"
              disabled={pending || !collecting || data.teams.length === 0 || data.teams.some((t) => !t.is_ready)}
              onClick={() => run(() => finalizePremadeTeams())}
            >
              Finalize premade teams
            </Button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Format (left column, below entrants)
// ---------------------------------------------------------------------------

const BO_OPTIONS: SeriesLength[] = [1, 3, 5];

function FormatPanel({ data, run }: { data: MayhemFull; run: (fn: () => Promise<void>) => void }) {
  const [local, setLocal] = useState<MayhemFormatConfig>(data.event.format);
  const [saving, setSaving] = useState(false);

  // The dashboard now stays mounted for the whole event rather than being
  // remounted per tab, so a `useState(data.event.format)` initializer alone
  // goes stale the moment the server format changes from elsewhere (a
  // reset, a reroll, another admin tab). Resync whenever the server value
  // changes — but only while this panel isn't mid-save, so a save in
  // flight doesn't get its own optimistic value clobbered by a poll that
  // hasn't caught up yet.
  useEffect(() => {
    if (!saving) setLocal(data.event.format);
  }, [data.event.format, saving]);

  function save(next: MayhemFormatConfig) {
    setLocal(next);
    setSaving(true);
    run(async () => {
      try {
        await updateFormat(next);
      } finally {
        setSaving(false);
      }
    });
  }

  return (
    <div className="bg-surface border border-line p-4 space-y-4">
      <PanelHeading
        action={
          <label className="inline-flex items-center gap-1.5 text-caption cursor-pointer">
            <input
              type="checkbox"
              checked={local.groupStage.enabled}
              onChange={(e) => save({ ...local, groupStage: { ...local.groupStage, enabled: e.target.checked } })}
            />
            Groups
          </label>
        }
      >
        Format
      </PanelHeading>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Groups">
          <NumberStepper
            value={local.groupStage.groupCount}
            min={2}
            max={8}
            onChange={(v) => save({ ...local, groupStage: { ...local.groupStage, groupCount: v } })}
          />
        </Field>
        <Field label="Advance">
          <NumberStepper
            value={local.groupStage.advancePerGroup}
            min={1}
            max={4}
            onChange={(v) => save({ ...local, groupStage: { ...local.groupStage, advancePerGroup: v } })}
          />
        </Field>
        <Field label="Group series">
          <BoSelector value={local.groupStage.seriesLength} onChange={(v) => save({ ...local, groupStage: { ...local.groupStage, seriesLength: v } })} />
        </Field>
        <Field label="Knockout series">
          <BoSelector value={local.knockout.seriesLength} onChange={(v) => save({ ...local, knockout: { ...local.knockout, seriesLength: v } })} />
        </Field>
      </div>

      <Field label="Seeding">
        <div className="flex gap-2">
          {(["random", "manual"] as const).map((s) => (
            <button
              key={s}
              onClick={() => save({ ...local, groupStage: { ...local.groupStage, seeding: s } })}
              className={cn(
                "px-3 py-1.5 text-caption border rounded-sm capitalize",
                local.groupStage.seeding === s ? "border-brand-red bg-brand-red/10" : "border-line text-ink-secondary",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </Field>

      <div className="pt-3 border-t border-line-subtle space-y-2">
        <p className="text-label uppercase text-ink-muted">Knockout</p>
        <Toggle
          label="Double elimination"
          checked={local.knockout.doubleElimination}
          onChange={(v) => save({ ...local, knockout: { ...local.knockout, doubleElimination: v } })}
        />
        <Toggle
          label="Third-place match"
          checked={local.knockout.thirdPlaceMatch}
          onChange={(v) => save({ ...local, knockout: { ...local.knockout, thirdPlaceMatch: v } })}
        />
        <Toggle
          label="Grand final reset"
          checked={local.knockout.grandFinalReset}
          onChange={(v) => save({ ...local, knockout: { ...local.knockout, grandFinalReset: v } })}
        />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-caption uppercase text-ink-muted">{label}</p>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer">
      <span className="text-body-sm text-ink-secondary">{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function NumberStepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="inline-flex items-center border border-line rounded-sm">
      <button className="px-2.5 py-1.5 hover:bg-elevated" onClick={() => onChange(Math.max(min, value - 1))}>
        −
      </button>
      <span className="px-3 py-1.5 font-mono tabular text-body-sm">{value}</span>
      <button className="px-2.5 py-1.5 hover:bg-elevated" onClick={() => onChange(Math.min(max, value + 1))}>
        +
      </button>
    </div>
  );
}

function BoSelector({ value, onChange }: { value: SeriesLength; onChange: (v: SeriesLength) => void }) {
  return (
    <div className="flex gap-1.5">
      {BO_OPTIONS.map((bo) => (
        <button
          key={bo}
          onClick={() => onChange(bo)}
          className={cn(
            "px-2.5 py-1.5 text-caption border rounded-sm",
            value === bo ? "border-brand-red bg-brand-red/10" : "border-line text-ink-secondary",
          )}
        >
          Bo{bo}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presentation desk (center column)
// ---------------------------------------------------------------------------

type SceneGroup = { label: string; scenes: MayhemScene[] };
const SCENE_GROUPS: SceneGroup[] = [
  { label: "Waiting", scenes: ["idle", "starting_soon"] },
  { label: "Reveal", scenes: ["reveal", "teams"] },
  { label: "Groups / bracket", scenes: ["groups", "bracket"] },
  { label: "Match / champion", scenes: ["match", "champion"] },
];
const SCENE_META: Record<MayhemScene, { label: string; hint: string }> = {
  idle: { label: "Idle (logo)", hint: "Default screen before/between segments — just the LoLMK logo." },
  starting_soon: { label: "Starting soon", hint: "Countdown clock. Set the timer below, then Start." },
  reveal: { label: "Team reveal", hint: "Reveals teams one at a time. Use \"Reveal next team\" to advance." },
  teams: { label: "Team list", hint: "Shows every team and roster at once, for after the reveal finishes." },
  groups: { label: "Groups", hint: "Shows group-stage membership. Requires groups to be generated." },
  bracket: { label: "Bracket", hint: "Shows the knockout bracket. Requires a bracket to be generated." },
  match: { label: "Current match", hint: "Shows the active match set in Match operations." },
  champion: { label: "Champion", hint: "Victory screen — set automatically once a champion is decided." },
};

/** Null when the scene is available now; a short reason string when it isn't. */
function sceneUnavailableReason(scene: MayhemScene, data: MayhemFull): string | null {
  switch (scene) {
    case "reveal":
    case "teams":
      return data.teams.length === 0 ? "Randomize teams first" : null;
    case "groups":
      if (!data.event.format.groupStage.enabled) return "Enable group stage first";
      return data.groups.length === 0 ? "Generate groups first" : null;
    case "bracket":
      return data.matches.filter((m) => m.bracket !== "group").length === 0 ? "Generate a bracket first" : null;
    case "match":
      return data.event.active_match_id ? null : "Set an active match first";
    case "champion":
      return data.event.champion_team_id ? null : "Awarded automatically once decided";
    default:
      return null;
  }
}

function timeAgoLabel(ms: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 2) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

function PresentationDesk({
  data,
  pending,
  run,
  lastSyncedAt,
}: {
  data: MayhemFull;
  pending: boolean;
  run: (fn: () => Promise<void>) => void;
  lastSyncedAt: number;
}) {
  const [seconds, setSeconds] = useState(60);
  const [revealInterval, setRevealInterval] = useState(10);
  const [startOnCountdown, setStartOnCountdown] = useState(false);
  const [, forceTick] = useState(0);
  // Re-render every few seconds purely so the "synced Xs ago" label stays
  // current without needing its own polling loop.
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 3000);
    return () => clearInterval(id);
  }, []);

  const revealed = data.event.reveal_index;
  const totalTeams = data.teams.length;

  return (
    <div className="bg-surface border border-line p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-heading text-heading-sm">Presentation desk</h2>
          <p className="text-caption text-ink-muted">Synced {timeAgoLabel(lastSyncedAt)}</p>
        </div>
        <a
          href="/mayhemlive"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-body-sm text-brand-blue-bright hover:text-ink shrink-0"
        >
          <Tv strokeWidth={1.75} className="h-4 w-4" />
          Open full screen
        </a>
      </div>

      <MayhemLivePreview />

      <div className="flex items-center gap-2 text-caption">
        <span className="uppercase text-ink-muted">Scene:</span>
        <span className="font-semibold text-ink">{SCENE_META[data.event.scene].label}</span>
      </div>

      <div className="space-y-3">
        {SCENE_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="text-label uppercase text-ink-muted mb-1.5">{group.label}</p>
            <div className="grid grid-cols-2 gap-2">
              {group.scenes.map((id) => {
                const meta = SCENE_META[id];
                const reason = sceneUnavailableReason(id, data);
                const isActive = data.event.scene === id;
                return (
                  <Tooltip key={id} content={reason ?? meta.hint} className="w-full">
                    <div>
                      <button
                        onClick={() => run(() => setScene(id))}
                        disabled={pending || Boolean(reason)}
                        aria-pressed={isActive}
                        className={cn(
                          "w-full px-3 py-2.5 text-body-sm border-2 rounded-sm transition-colors text-left disabled:cursor-not-allowed disabled:opacity-50 font-medium",
                          isActive
                            ? "border-brand-red bg-brand-red text-ink shadow-[0_0_0_3px_rgba(var(--brand-red-rgb,220,38,38),0.25)]"
                            : "border-line text-ink-secondary hover:border-brand-red/60 hover:text-ink",
                        )}
                      >
                        {meta.label}
                      </button>
                      {/* Unavailable reason shown inline, not only on hover — matters for
                          touch/keyboard operators who won't see the tooltip. */}
                      {reason && <p className="mt-0.5 text-[0.65rem] text-ink-disabled">{reason}</p>}
                    </div>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-3 pt-2 border-t border-line-subtle">
        <div className="space-y-1.5">
          <Tooltip content="Runs a countdown clock on the venue screen, then switches to Starting soon.">
            <p className="text-label uppercase text-ink-muted w-fit">Starting-soon countdown</p>
          </Tooltip>
          <div className="flex gap-2 items-center flex-wrap">
            <input
              type="number"
              min={10}
              value={seconds}
              onChange={(e) => setSeconds(Number(e.target.value))}
              aria-label="Countdown seconds"
              className="w-20 bg-elevated border border-line rounded-sm px-2 py-1.5 text-body-sm"
            />
            <span className="text-caption text-ink-muted">sec</span>
            <Button size="sm" onClick={() => run(() => startCountdown(seconds))} disabled={pending}>
              <TimerIcon className="h-3.5 w-3.5" /> Start
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Tooltip content="Manually reveal one team at a time on the venue screen. Turns off auto-reveal if it's running.">
            <p className="text-label uppercase text-ink-muted w-fit">Team reveal (manual)</p>
          </Tooltip>
          <p className="text-caption text-ink-secondary">{revealed} / {totalTeams} revealed</p>
          <Button
            size="sm"
            onClick={() => run(() => advanceReveal())}
            disabled={pending || totalTeams === 0 || revealed >= totalTeams}
            className="w-full"
          >
            <Play className="h-3.5 w-3.5" /> Reveal next team
          </Button>
        </div>
      </div>

      <div className="space-y-2 pt-2 border-t border-line-subtle">
        <Tooltip content="Teams appear one by one automatically, with a gap between each — no manual clicking needed once armed.">
          <p className="text-label uppercase text-ink-muted w-fit">Auto-reveal</p>
        </Tooltip>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            min={2}
            max={60}
            value={revealInterval}
            onChange={(e) => setRevealInterval(Number(e.target.value))}
            aria-label="Seconds between each team reveal"
            className="w-16 bg-elevated border border-line rounded-sm px-2 py-1.5 text-body-sm"
          />
          <span className="text-caption text-ink-muted">sec between teams</span>
          <label className="inline-flex items-center gap-1.5 text-caption text-ink-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={startOnCountdown}
              onChange={(e) => setStartOnCountdown(e.target.checked)}
              className="accent-brand-red"
            />
            Start when countdown ends
          </label>
        </div>
        <div className="flex gap-2">
          <Tooltip content={data.event.auto_reveal ? "Auto-reveal is currently running." : "Starts revealing teams automatically at the interval above."}>
            <Button
              size="sm"
              onClick={() => run(() => startAutoReveal(revealInterval, startOnCountdown))}
              disabled={pending || totalTeams === 0 || data.event.auto_reveal}
              className="flex-1"
            >
              <Play className="h-3.5 w-3.5" /> Start auto-reveal
            </Button>
          </Tooltip>
          <Tooltip content="Freezes the reveal where it currently is and hands control back to the manual button above.">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => run(() => pauseAutoReveal())}
              disabled={pending || !data.event.auto_reveal}
            >
              Pause
            </Button>
          </Tooltip>
        </div>
        {data.event.auto_reveal && (
          <p className="text-caption text-brand-blue-bright">
            Running — {revealed} / {totalTeams} revealed, advancing every {Math.round(data.event.reveal_interval_ms / 1000)}s
            {data.event.reveal_start_on_countdown && !data.event.reveal_started_at ? " (waiting for countdown to end)" : ""}.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Match operations (right column)
// ---------------------------------------------------------------------------

interface MatchSharedProps {
  pending: boolean;
  run: (fn: () => Promise<void>) => void;
  getDraft: (m: MayhemMatch) => ScoreDraft;
  setDraft: (matchId: string, next: ScoreDraft) => void;
}

function MatchOpsPanel({
  data,
  active,
  playable,
  pending,
  run,
  getDraft,
  setDraft,
}: MatchSharedProps & { data: MayhemFull; active: MayhemMatch | undefined; playable: MayhemMatch[] }) {
  return (
    <div className="bg-surface border border-line p-4 space-y-4">
      <PanelHeading>Match operations</PanelHeading>

      {data.event.champion_team_id && (
        <div className="bg-brand-red/10 border border-brand-red p-3 flex items-center gap-3">
          <Trophy className="h-6 w-6 text-warning shrink-0" />
          <div className="min-w-0">
            <p className="text-caption uppercase text-ink-muted">Champion</p>
            <p className="font-display text-heading-md truncate">{teamName(data.teams, data.event.champion_team_id)}</p>
          </div>
        </div>
      )}

      <div>
        <p className="text-label uppercase text-ink-muted mb-2">Active match (shown on /mayhemlive)</p>
        {active ? (
          <MatchRow
            match={active}
            teams={data.teams}
            pending={pending}
            run={run}
            draft={getDraft(active)}
            setDraft={(d) => setDraft(active.id, d)}
            onClear={() => run(() => setActiveMatch(null))}
          />
        ) : (
          <p className="text-body-sm text-ink-muted italic">No active match set.</p>
        )}
      </div>

      <div>
        <p className="text-label uppercase text-ink-muted mb-2">Set active match</p>
        {playable.length === 0 ? (
          <p className="text-body-sm text-ink-muted italic">No playable matches right now.</p>
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {playable.map((m) => (
              <button
                key={m.id}
                onClick={() => run(() => setActiveMatch(active?.id === m.id ? null : m.id))}
                className={cn(
                  "w-full text-left px-3 py-2 border rounded-sm text-body-sm min-w-0 truncate",
                  active?.id === m.id ? "border-brand-red bg-brand-red/10" : "border-line hover:border-line-strong",
                )}
                title={`M${m.match_number} · ${teamName(data.teams, m.team_a_id)} vs ${teamName(data.teams, m.team_b_id)}`}
              >
                M{m.match_number} · {teamName(data.teams, m.team_a_id)} vs {teamName(data.teams, m.team_b_id)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Teams & groups (bottom-left)
// ---------------------------------------------------------------------------

function TeamsPanel({ data }: { data: MayhemFull }) {
  return (
    <div className="bg-surface border border-line p-4">
      <PanelHeading>Teams ({data.teams.length})</PanelHeading>
      {data.teams.length === 0 ? (
        <p className="text-body-sm text-ink-muted italic py-3 text-center">Randomize teams to see rosters here.</p>
      ) : (
        <ul className="space-y-1.5 max-h-64 overflow-y-auto">
          {data.teams.map((t) => (
            <li key={t.id} className="flex items-center gap-2 min-w-0 border border-line-subtle bg-elevated/40 px-2.5 py-1.5">
              {t.icon_url ? (
                <Image src={t.icon_url} alt="" width={24} height={24} className="h-6 w-6 object-contain shrink-0" />
              ) : (
                <div className="h-6 w-6 bg-elevated border border-line-subtle shrink-0" />
              )}
              <span className="text-body-sm truncate" title={t.name}>{t.name}</span>
              <span className="ml-auto text-caption text-ink-muted shrink-0">{t.players.length}p</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Groups (right column, below Teams)
// ---------------------------------------------------------------------------

function GroupsPanel({ data, pending, run, getDraft, setDraft }: MatchSharedProps & { data: MayhemFull }) {
  const groupsEnabled = data.event.format.groupStage.enabled;

  return (
    <div className="bg-surface border border-line p-4">
      <PanelHeading
        action={
          groupsEnabled && data.teams.length > 0 ? (
            <Button size="sm" onClick={() => run(() => generateGroups())} disabled={pending}>
              <Dices className="h-3.5 w-3.5" /> {data.groups.length > 0 ? "Regenerate" : "Generate"}
            </Button>
          ) : undefined
        }
      >
        Groups
      </PanelHeading>

      {!groupsEnabled ? (
        <p className="text-body-sm text-ink-secondary">Group stage disabled — enable it under Format.</p>
      ) : data.teams.length === 0 ? (
        <p className="text-body-sm text-ink-secondary">Randomize teams first.</p>
      ) : data.groups.length === 0 ? (
        <p className="text-body-sm text-ink-secondary">No groups yet — generate them.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-caption text-ink-secondary">
            {data.event.format.groupStage.groupCount} groups · Bo{data.event.format.groupStage.seriesLength} · top{" "}
            {data.event.format.groupStage.advancePerGroup} advance
          </p>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {data.groups.map((g) => {
              const teams = data.teams.filter((t) => t.group_id === g.id);
              const matches = data.matches.filter((m) => m.group_id === g.id);
              return (
                <div key={g.id} className="border border-line-subtle p-3 min-w-0">
                  <p className="font-heading text-body-sm font-semibold mb-2">{g.label}</p>
                  <ul className="space-y-1 mb-3">
                    {teams.map((t) => (
                      <li key={t.id} className="text-caption flex items-center gap-1.5 min-w-0">
                        {t.icon_url && <Image src={t.icon_url} alt="" width={16} height={16} className="h-4 w-4 shrink-0" />}
                        <span className="truncate" title={t.name}>{t.name}</span>
                      </li>
                    ))}
                  </ul>
                  <MatchList matches={matches} teams={data.teams} pending={pending} run={run} getDraft={getDraft} setDraft={setDraft} compact />
                </div>
              );
            })}
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => run(() => generateKnockoutFromGroups())} disabled={pending}>
              <Swords className="h-3.5 w-3.5" /> Seed knockout from standings
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bracket (bottom-right)
// ---------------------------------------------------------------------------

function BracketPanel({
  data,
  knockoutMatches,
  pending,
  run,
  getDraft,
  setDraft,
}: MatchSharedProps & { data: MayhemFull; knockoutMatches: MayhemMatch[] }) {
  const byRound = useMemo(() => {
    const map = new Map<string, MayhemMatch[]>();
    for (const m of knockoutMatches) {
      const key = `${m.bracket}-${m.round_number}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    return map;
  }, [knockoutMatches]);

  return (
    <div className="bg-surface border border-line p-4 h-full">
      <PanelHeading>Bracket</PanelHeading>

      {knockoutMatches.length === 0 ? (
        <div className="text-center space-y-3 py-6">
          <p className="text-body-sm text-ink-secondary">
            No knockout bracket yet.{" "}
            {data.event.format.groupStage.enabled
              ? "Finish the group stage and seed from standings, or seed directly from all teams."
              : "Seed directly from all teams (sorted by seed)."}
          </p>
          <Button size="sm" onClick={() => run(() => generateKnockoutFromAllTeams())} disabled={pending || data.teams.length === 0}>
            <Swords className="h-3.5 w-3.5" /> Generate knockout bracket
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="flex gap-5 min-w-max pb-1">
            {Array.from(byRound.entries()).map(([key, matches]) => (
              <div key={key} className="flex flex-col gap-2.5 w-64 shrink-0">
                <p className="text-label uppercase text-ink-muted">
                  {matches[0].bracket.replace("_", " ")} · Round {matches[0].round_number}
                </p>
                <MatchList matches={matches} teams={data.teams} pending={pending} run={run} getDraft={getDraft} setDraft={setDraft} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared match rendering
// ---------------------------------------------------------------------------

function teamName(teams: MayhemFull["teams"], id: string | null): string {
  if (!id) return "TBD";
  return teams.find((t) => t.id === id)?.name ?? "TBD";
}

function MatchList({
  matches,
  teams,
  pending,
  run,
  getDraft,
  setDraft,
  compact,
}: {
  matches: MayhemMatch[];
  teams: MayhemFull["teams"];
  pending: boolean;
  run: (fn: () => Promise<void>) => void;
  getDraft: (m: MayhemMatch) => ScoreDraft;
  setDraft: (matchId: string, next: ScoreDraft) => void;
  compact?: boolean;
}) {
  return (
    <ul className="space-y-1.5">
      {matches.map((m) => (
        <li key={m.id}>
          <MatchRow
            match={m}
            teams={teams}
            pending={pending}
            run={run}
            draft={getDraft(m)}
            setDraft={(d) => setDraft(m.id, d)}
            compact={compact}
          />
        </li>
      ))}
    </ul>
  );
}

function MatchRow({
  match,
  teams,
  pending,
  run,
  draft,
  setDraft,
  compact,
  onClear,
}: {
  match: MayhemMatch;
  teams: MayhemFull["teams"];
  pending: boolean;
  run: (fn: () => Promise<void>) => void;
  draft: ScoreDraft;
  setDraft: (next: ScoreDraft) => void;
  compact?: boolean;
  /** Only passed for the "active match" slot — clears active_match_id without touching the result. */
  onClear?: () => void;
}) {
  const ready = Boolean(match.team_a_id && match.team_b_id);
  const done = match.status === "completed";
  const isBo1 = match.best_of === 1;

  if (!ready && !done) {
    return (
      <div className="flex items-center justify-between gap-2 text-body-sm text-ink-muted border border-line-subtle rounded-sm px-2.5 py-1.5 min-w-0">
        <span className="truncate min-w-0">
          M{match.match_number} · {teamName(teams, match.team_a_id)} vs {teamName(teams, match.team_b_id)}
        </span>
        <span className="text-caption uppercase shrink-0">{match.status === "bye" ? "Bye" : "Waiting"}</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 border rounded-sm px-2.5 py-2 min-w-0",
        done ? "border-line-subtle bg-elevated/30" : "border-brand-red/50 bg-brand-red/5",
      )}
    >
      <span className="text-caption font-mono uppercase text-ink-muted shrink-0">Bo{match.best_of}</span>
      <span
        className={cn(
          "text-body-sm flex-1 min-w-[6rem] truncate",
          done && match.winner_id === match.team_a_id && "font-semibold text-ink",
        )}
        title={teamName(teams, match.team_a_id)}
      >
        {teamName(teams, match.team_a_id)}
      </span>
      {!done && isBo1 ? (
        <Tooltip content={`One click reports ${teamName(teams, match.team_a_id)} as the winner — no score to enter for a single-game match.`}>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => run(() => reportBo1Winner(match.id, match.team_a_id!))}
            disabled={pending}
          >
            {teamName(teams, match.team_a_id)} wins
          </Button>
        </Tooltip>
      ) : !done ? (
        <input
          type="number"
          aria-label={`${teamName(teams, match.team_a_id)} score`}
          value={draft.a}
          onChange={(e) => setDraft({ ...draft, a: Number(e.target.value) })}
          className="w-12 bg-elevated border border-line rounded-sm px-1.5 py-1 text-center text-body-sm"
        />
      ) : (
        <span className="w-12 text-center font-mono text-body-sm">{match.team_a_score}</span>
      )}
      <span className="text-caption text-ink-muted shrink-0">vs</span>
      {!done && isBo1 ? (
        <Tooltip content={`One click reports ${teamName(teams, match.team_b_id)} as the winner — no score to enter for a single-game match.`}>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => run(() => reportBo1Winner(match.id, match.team_b_id!))}
            disabled={pending}
          >
            {teamName(teams, match.team_b_id)} wins
          </Button>
        </Tooltip>
      ) : !done ? (
        <input
          type="number"
          aria-label={`${teamName(teams, match.team_b_id)} score`}
          value={draft.b}
          onChange={(e) => setDraft({ ...draft, b: Number(e.target.value) })}
          className="w-12 bg-elevated border border-line rounded-sm px-1.5 py-1 text-center text-body-sm"
        />
      ) : (
        <span className="w-12 text-center font-mono text-body-sm">{match.team_b_score}</span>
      )}
      <span
        className={cn(
          "text-body-sm flex-1 min-w-[6rem] text-right truncate",
          done && match.winner_id === match.team_b_id && "font-semibold text-ink",
        )}
        title={teamName(teams, match.team_b_id)}
      >
        {teamName(teams, match.team_b_id)}
      </span>

      {!done && !isBo1 ? (
        <Button size="sm" onClick={() => run(() => recordMatchResult(match.id, draft.a, draft.b))} disabled={pending || draft.a === draft.b}>
          {compact ? "Report" : (
            <>
              <Trophy className="h-3.5 w-3.5" /> Report
            </>
          )}
        </Button>
      ) : done ? (
        <button
          onClick={() => run(() => undoMatchResult(match.id))}
          disabled={pending}
          className="text-caption uppercase text-ink-muted hover:text-danger"
        >
          Undo
        </button>
      ) : null}
      {onClear && (
        <button
          onClick={onClear}
          disabled={pending}
          className="text-caption uppercase text-ink-muted hover:text-ink"
        >
          Clear
        </button>
      )}
    </div>
  );
}
