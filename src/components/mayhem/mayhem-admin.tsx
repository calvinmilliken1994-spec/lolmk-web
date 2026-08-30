"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
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
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  MayhemFormatConfig,
  MayhemFull,
  MayhemMatch,
  MayhemScene,
  SeriesLength,
} from "@/types/mayhem";
import {
  addPlayer,
  advanceReveal,
  clearAllPlayers,
  generateGroups,
  generateKnockoutFromAllTeams,
  generateKnockoutFromGroups,
  recordMatchResult,
  refreshTeamIdentities,
  removePlayer,
  randomizeTeams,
  setActiveMatch,
  setScene,
  startCountdown,
  undoMatchResult,
  updateFormat,
} from "@/app/tools/mayhem/actions";

const TABS = ["Players", "Presentation", "Format", "Groups", "Bracket", "Live"] as const;
type Tab = (typeof TABS)[number];

export function MayhemAdmin({ initial }: { initial: MayhemFull }) {
  const [data, setData] = useState(initial);
  const [tab, setTab] = useState<Tab>("Players");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Poll our own state too, so this tab stays correct if acted on elsewhere.
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/mayhem/state", { cache: "no-store" });
        if (res.ok) setData(await res.json());
      } catch {
        /* ignore transient network errors */
      }
    }, 2000);
    return () => clearInterval(id);
  }, []);

  function run(fn: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
  }

  const playerCount = data.players.length;
  const teamCountIfRandomized = playerCount / 5;
  const canRandomize = playerCount >= 20 && playerCount % 5 === 0;

  return (
    <div className="min-h-screen bg-base text-ink">
      <header className="sticky top-0 z-10 border-b border-line-subtle bg-base/90 backdrop-blur-md">
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
            <h1 className="font-display text-heading-lg leading-none">ARAM Mayhem</h1>
          </div>
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
        <nav className="container-wide flex gap-1 overflow-x-auto pb-2">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "shrink-0 rounded-sm px-3.5 py-2 text-label uppercase tracking-wider transition-colors",
                tab === t
                  ? "bg-brand-red text-ink"
                  : "text-ink-secondary hover:bg-elevated hover:text-ink",
              )}
            >
              {t}
            </button>
          ))}
        </nav>
      </header>

      <main className="container-wide py-8 space-y-6">
        {error && (
          <div className="border border-danger/40 bg-danger/10 text-danger px-4 py-3 rounded-sm flex items-center justify-between">
            <span className="text-body-sm">{error}</span>
            <button onClick={() => setError(null)} aria-label="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {tab === "Players" && (
          <PlayersPanel
            data={data}
            pending={pending}
            run={run}
            canRandomize={canRandomize}
            teamCountIfRandomized={teamCountIfRandomized}
          />
        )}
        {tab === "Presentation" && <PresentationPanel data={data} pending={pending} run={run} />}
        {tab === "Format" && <FormatPanel data={data} pending={pending} run={run} />}
        {tab === "Groups" && <GroupsPanel data={data} pending={pending} run={run} />}
        {tab === "Bracket" && <BracketPanel data={data} pending={pending} run={run} />}
        {tab === "Live" && <LivePanel data={data} pending={pending} run={run} />}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

function PlayersPanel({
  data,
  pending,
  run,
  canRandomize,
  teamCountIfRandomized,
}: {
  data: MayhemFull;
  pending: boolean;
  run: (fn: () => Promise<void>) => void;
  canRandomize: boolean;
  teamCountIfRandomized: number;
}) {
  const [name, setName] = useState("");
  const [confirmReroll, setConfirmReroll] = useState(false);
  const alreadyRandomized = data.event.stage !== "collecting";

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    run(() => addPlayer(trimmed));
    setName("");
  }

  return (
    <div className="grid lg:grid-cols-[1fr,340px] gap-6">
      <div className="bg-surface border border-line p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-heading text-heading-md">Entrants</h2>
          <span className="text-body-sm text-ink-muted">{data.players.length} players</span>
        </div>

        <div className="flex gap-2 mb-5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Player name or IGN"
            className="flex-1 bg-elevated border border-line rounded-sm px-3 py-2.5 text-body-md text-ink placeholder:text-ink-muted focus:outline-none focus:border-brand-red"
          />
          <Button onClick={submit} disabled={pending || !name.trim()}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>

        {data.players.length === 0 ? (
          <p className="text-body-sm text-ink-muted italic py-8 text-center">
            No players yet. Add at least 20 (multiples of 5) to randomize teams.
          </p>
        ) : (
          <ul className="divide-y divide-line-subtle max-h-[480px] overflow-y-auto">
            {data.players.map((p, i) => (
              <li key={p.id} className="flex items-center justify-between py-2.5">
                <span className="text-body-md">
                  <span className="text-ink-muted font-mono text-caption mr-2">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {p.display_name}
                </span>
                <button
                  onClick={() => run(() => removePlayer(p.id))}
                  disabled={pending}
                  className="text-ink-muted hover:text-danger"
                  aria-label={`Remove ${p.display_name}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-surface border border-line p-6 space-y-4 h-fit">
        <h2 className="font-heading text-heading-md">Randomize teams</h2>
        <p className="text-body-sm text-ink-secondary">
          Requires a multiple of 5 players, minimum 20 (4 teams). Teams are named and iconed from{" "}
          <span className="font-mono text-caption">public/images/aramteamicons</span>.
        </p>
        <div className="text-body-sm">
          <p>
            Players: <span className="font-semibold">{data.players.length}</span>
          </p>
          {canRandomize ? (
            <p className="text-success">→ {teamCountIfRandomized} teams of 5</p>
          ) : (
            <p className="text-warning">
              Need a multiple of 5, at least 20. Add {5 - (data.players.length % 5 || 5) + (data.players.length < 20 ? 20 - data.players.length : 0)} more (roughly).
            </p>
          )}
        </div>

        {alreadyRandomized && !confirmReroll ? (
          <div className="space-y-2">
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => setConfirmReroll(true)}
              disabled={pending}
            >
              <RotateCcw className="h-4 w-4" /> Reroll teams
            </Button>
            <button
              onClick={() => run(() => refreshTeamIdentities())}
              disabled={pending}
              className="w-full text-caption uppercase tracking-wider text-ink-muted hover:text-ink py-1"
            >
              Refresh team names/icons (keeps rosters)
            </button>
          </div>
        ) : alreadyRandomized && confirmReroll ? (
          <div className="space-y-2">
            <p className="text-body-sm text-danger">
              This erases the current teams, groups, and bracket. Are you sure?
            </p>
            <div className="flex gap-2">
              <Button
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
              <Button variant="secondary" className="flex-1" onClick={() => setConfirmReroll(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="primary"
            className="w-full"
            disabled={pending || !canRandomize}
            onClick={() => run(() => randomizeTeams())}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Dices className="h-4 w-4" />}
            Randomize teams
          </Button>
        )}

        <button
          onClick={() => {
            if (confirm("Clear all players, teams, groups, and matches? This can't be undone.")) {
              run(() => clearAllPlayers());
            }
          }}
          disabled={pending}
          className="w-full text-caption uppercase tracking-wider text-ink-muted hover:text-danger pt-2"
        >
          <Trash2 className="h-3.5 w-3.5 inline mr-1.5" />
          Reset everything
        </button>
      </div>

      {data.teams.length > 0 && (
        <div className="lg:col-span-2 bg-surface border border-line p-6">
          <h2 className="font-heading text-heading-md mb-4">Teams ({data.teams.length})</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.teams.map((t) => (
              <div key={t.id} className="border border-line-subtle bg-elevated/40 p-4">
                <div className="flex items-center gap-3 mb-3">
                  {t.icon_url ? (
                    <Image src={t.icon_url} alt="" width={40} height={40} className="h-10 w-10 object-contain" />
                  ) : (
                    <div className="h-10 w-10 bg-elevated border border-line-subtle" />
                  )}
                  <p className="font-heading font-semibold">{t.name}</p>
                </div>
                <ul className="text-body-sm text-ink-secondary space-y-1">
                  {t.players.map((p) => (
                    <li key={p.id}>{p.display_name}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

const SCENES: { id: MayhemScene; label: string }[] = [
  { id: "idle", label: "Idle (logo)" },
  { id: "starting_soon", label: "Starting soon" },
  { id: "reveal", label: "Team reveal" },
  { id: "teams", label: "Team list" },
  { id: "groups", label: "Groups" },
  { id: "bracket", label: "Bracket" },
  { id: "match", label: "Current match" },
  { id: "champion", label: "Champion" },
];

function PresentationPanel({
  data,
  pending,
  run,
}: {
  data: MayhemFull;
  pending: boolean;
  run: (fn: () => Promise<void>) => void;
}) {
  const [seconds, setSeconds] = useState(60);
  const revealed = data.event.reveal_index;
  const totalTeams = data.teams.length;

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="bg-surface border border-line p-6 space-y-4">
        <h2 className="font-heading text-heading-md">Venue screen (/mayhemlive)</h2>
        <p className="text-body-sm text-ink-secondary">
          Manually set the scene shown on the big screen, independent of tournament progress.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {SCENES.map((s) => (
            <button
              key={s.id}
              onClick={() => run(() => setScene(s.id))}
              disabled={pending}
              className={cn(
                "px-3 py-2.5 text-body-sm border rounded-sm transition-colors text-left",
                data.event.scene === s.id
                  ? "border-brand-red bg-brand-red/10 text-ink"
                  : "border-line text-ink-secondary hover:border-line-strong",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-6">
        <div className="bg-surface border border-line p-6 space-y-3">
          <h2 className="font-heading text-heading-md">Starting soon countdown</h2>
          <div className="flex gap-2 items-center">
            <input
              type="number"
              min={10}
              value={seconds}
              onChange={(e) => setSeconds(Number(e.target.value))}
              className="w-28 bg-elevated border border-line rounded-sm px-3 py-2.5 text-body-md"
            />
            <span className="text-body-sm text-ink-muted">seconds</span>
            <Button onClick={() => run(() => startCountdown(seconds))} disabled={pending}>
              <TimerIcon className="h-4 w-4" /> Start
            </Button>
          </div>
        </div>

        <div className="bg-surface border border-line p-6 space-y-3">
          <h2 className="font-heading text-heading-md">Team reveal</h2>
          <p className="text-body-sm text-ink-secondary">
            {revealed} / {totalTeams} teams revealed on screen.
          </p>
          <Button
            onClick={() => run(() => advanceReveal())}
            disabled={pending || totalTeams === 0 || revealed >= totalTeams}
            className="w-full"
          >
            <Play className="h-4 w-4" /> Reveal next team
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

const BO_OPTIONS: SeriesLength[] = [1, 3, 5];

function FormatPanel({
  data,
  pending,
  run,
}: {
  data: MayhemFull;
  pending: boolean;
  run: (fn: () => Promise<void>) => void;
}) {
  const [local, setLocal] = useState<MayhemFormatConfig>(data.event.format);

  function save(next: MayhemFormatConfig) {
    setLocal(next);
    run(() => updateFormat(next));
  }

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="bg-surface border border-line p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-heading-md">Group stage</h2>
          <label className="inline-flex items-center gap-2 text-body-sm cursor-pointer">
            <input
              type="checkbox"
              checked={local.groupStage.enabled}
              onChange={(e) =>
                save({ ...local, groupStage: { ...local.groupStage, enabled: e.target.checked } })
              }
            />
            Enabled
          </label>
        </div>

        <Field label="Number of groups">
          <NumberStepper
            value={local.groupStage.groupCount}
            min={2}
            max={8}
            onChange={(v) => save({ ...local, groupStage: { ...local.groupStage, groupCount: v } })}
          />
        </Field>

        <Field label="Group-stage series">
          <BoSelector
            value={local.groupStage.seriesLength}
            onChange={(v) => save({ ...local, groupStage: { ...local.groupStage, seriesLength: v } })}
          />
        </Field>

        <Field label="Advance per group">
          <NumberStepper
            value={local.groupStage.advancePerGroup}
            min={1}
            max={4}
            onChange={(v) =>
              save({ ...local, groupStage: { ...local.groupStage, advancePerGroup: v } })
            }
          />
        </Field>

        <Field label="Seeding">
          <div className="flex gap-2">
            {(["random", "manual"] as const).map((s) => (
              <button
                key={s}
                onClick={() => save({ ...local, groupStage: { ...local.groupStage, seeding: s } })}
                className={cn(
                  "px-3 py-2 text-body-sm border rounded-sm capitalize",
                  local.groupStage.seeding === s
                    ? "border-brand-red bg-brand-red/10"
                    : "border-line text-ink-secondary",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </Field>
      </div>

      <div className="bg-surface border border-line p-6 space-y-5">
        <h2 className="font-heading text-heading-md">Knockout</h2>

        <Field label="Series per round">
          <BoSelector
            value={local.knockout.seriesLength}
            onChange={(v) => save({ ...local, knockout: { ...local.knockout, seriesLength: v } })}
          />
        </Field>

        <Toggle
          label="Double elimination (losers bracket)"
          checked={local.knockout.doubleElimination}
          onChange={(v) => save({ ...local, knockout: { ...local.knockout, doubleElimination: v } })}
        />
        <Toggle
          label="Third-place match"
          checked={local.knockout.thirdPlaceMatch}
          onChange={(v) => save({ ...local, knockout: { ...local.knockout, thirdPlaceMatch: v } })}
        />
        <Toggle
          label="Grand final reset (if lower bracket wins first)"
          checked={local.knockout.grandFinalReset}
          onChange={(v) => save({ ...local, knockout: { ...local.knockout, grandFinalReset: v } })}
        />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-label uppercase text-ink-muted">{label}</p>
      {children}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer">
      <span className="text-body-sm text-ink-secondary">{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function NumberStepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="inline-flex items-center border border-line rounded-sm">
      <button
        className="px-3 py-2 hover:bg-elevated"
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </button>
      <span className="px-4 py-2 font-mono tabular">{value}</span>
      <button
        className="px-3 py-2 hover:bg-elevated"
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        +
      </button>
    </div>
  );
}

function BoSelector({
  value,
  onChange,
}: {
  value: SeriesLength;
  onChange: (v: SeriesLength) => void;
}) {
  return (
    <div className="flex gap-2">
      {BO_OPTIONS.map((bo) => (
        <button
          key={bo}
          onClick={() => onChange(bo)}
          className={cn(
            "px-3.5 py-2 text-body-sm border rounded-sm",
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
// Groups
// ---------------------------------------------------------------------------

function GroupsPanel({
  data,
  pending,
  run,
}: {
  data: MayhemFull;
  pending: boolean;
  run: (fn: () => Promise<void>) => void;
}) {
  if (!data.event.format.groupStage.enabled) {
    return (
      <div className="bg-surface border border-line p-8 text-center">
        <p className="text-body-md text-ink-secondary">
          Group stage is disabled. Enable it under the Format tab first.
        </p>
      </div>
    );
  }
  if (data.teams.length === 0) {
    return (
      <div className="bg-surface border border-line p-8 text-center">
        <p className="text-body-md text-ink-secondary">Randomize teams first.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-surface border border-line p-6 flex items-center justify-between">
        <div>
          <h2 className="font-heading text-heading-md">Groups</h2>
          <p className="text-body-sm text-ink-secondary mt-1">
            {data.event.format.groupStage.groupCount} groups · Bo{data.event.format.groupStage.seriesLength} ·
            top {data.event.format.groupStage.advancePerGroup} advance
          </p>
        </div>
        <Button onClick={() => run(() => generateGroups())} disabled={pending}>
          <Dices className="h-4 w-4" /> {data.groups.length > 0 ? "Regenerate groups" : "Generate groups"}
        </Button>
      </div>

      {data.groups.length > 0 && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.groups.map((g) => {
            const teams = data.teams.filter((t) => t.group_id === g.id);
            const matches = data.matches.filter((m) => m.group_id === g.id);
            return (
              <div key={g.id} className="bg-surface border border-line p-5">
                <p className="font-heading text-heading-sm mb-3">{g.label}</p>
                <ul className="space-y-1.5 mb-4">
                  {teams.map((t) => (
                    <li key={t.id} className="text-body-sm flex items-center gap-2">
                      {t.icon_url && (
                        <Image src={t.icon_url} alt="" width={20} height={20} className="h-5 w-5" />
                      )}
                      {t.name}
                    </li>
                  ))}
                </ul>
                <MatchList matches={matches} teams={data.teams} pending={pending} run={run} compact />
              </div>
            );
          })}

          <div className="md:col-span-2 lg:col-span-3 flex justify-end">
            <Button onClick={() => run(() => generateKnockoutFromGroups())} disabled={pending}>
              <Swords className="h-4 w-4" /> Seed knockout from group standings
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bracket
// ---------------------------------------------------------------------------

function BracketPanel({
  data,
  pending,
  run,
}: {
  data: MayhemFull;
  pending: boolean;
  run: (fn: () => Promise<void>) => void;
}) {
  const knockoutMatches = data.matches.filter((m) => m.bracket !== "group");
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
    <div className="space-y-6">
      {knockoutMatches.length === 0 && (
        <div className="bg-surface border border-line p-8 text-center space-y-4">
          <p className="text-body-md text-ink-secondary">
            No knockout bracket yet.{" "}
            {data.event.format.groupStage.enabled
              ? "Finish the group stage and seed from standings, or seed directly from all teams."
              : "Seed directly from all teams (sorted by seed)."}
          </p>
          <Button onClick={() => run(() => generateKnockoutFromAllTeams())} disabled={pending || data.teams.length === 0}>
            <Swords className="h-4 w-4" /> Generate knockout bracket
          </Button>
        </div>
      )}

      {Array.from(byRound.entries()).map(([key, matches]) => (
        <div key={key} className="bg-surface border border-line p-5">
          <p className="text-label uppercase text-ink-muted mb-3">
            {matches[0].bracket.replace("_", " ")} · Round {matches[0].round_number}
          </p>
          <MatchList matches={matches} teams={data.teams} pending={pending} run={run} />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared match list + live control
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
  compact,
}: {
  matches: MayhemMatch[];
  teams: MayhemFull["teams"];
  pending: boolean;
  run: (fn: () => Promise<void>) => void;
  compact?: boolean;
}) {
  return (
    <ul className="space-y-2">
      {matches.map((m) => (
        <li key={m.id}>
          <MatchRow match={m} teams={teams} pending={pending} run={run} compact={compact} />
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
  compact,
}: {
  match: MayhemMatch;
  teams: MayhemFull["teams"];
  pending: boolean;
  run: (fn: () => Promise<void>) => void;
  compact?: boolean;
}) {
  const [scoreA, setScoreA] = useState(match.team_a_score);
  const [scoreB, setScoreB] = useState(match.team_b_score);
  const ready = Boolean(match.team_a_id && match.team_b_id);
  const done = match.status === "completed";

  if (!ready && !done) {
    return (
      <div className="flex items-center justify-between text-body-sm text-ink-muted border border-line-subtle rounded-sm px-3 py-2">
        <span>
          M{match.match_number} · {teamName(teams, match.team_a_id)} vs {teamName(teams, match.team_b_id)}
        </span>
        <span className="text-caption uppercase">
          {match.status === "bye" ? "Bye" : "Waiting"}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 border rounded-sm px-3 py-2.5",
        done ? "border-line-subtle bg-elevated/30" : "border-brand-red/50 bg-brand-red/5",
      )}
    >
      <span className="text-caption font-mono uppercase text-ink-muted shrink-0">Bo{match.best_of}</span>
      <span className={cn("text-body-sm flex-1 min-w-[10rem]", done && match.winner_id === match.team_a_id && "font-semibold text-ink")}>
        {teamName(teams, match.team_a_id)}
      </span>
      {!done ? (
        <input
          type="number"
          value={scoreA}
          onChange={(e) => setScoreA(Number(e.target.value))}
          className="w-14 bg-elevated border border-line rounded-sm px-2 py-1 text-center"
        />
      ) : (
        <span className="w-14 text-center font-mono">{match.team_a_score}</span>
      )}
      <span className="text-ink-muted">vs</span>
      {!done ? (
        <input
          type="number"
          value={scoreB}
          onChange={(e) => setScoreB(Number(e.target.value))}
          className="w-14 bg-elevated border border-line rounded-sm px-2 py-1 text-center"
        />
      ) : (
        <span className="w-14 text-center font-mono">{match.team_b_score}</span>
      )}
      <span className={cn("text-body-sm flex-1 min-w-[10rem] text-right", done && match.winner_id === match.team_b_id && "font-semibold text-ink")}>
        {teamName(teams, match.team_b_id)}
      </span>

      {!compact &&
        (!done ? (
          <Button
            size="sm"
            onClick={() => run(() => recordMatchResult(match.id, scoreA, scoreB))}
            disabled={pending || scoreA === scoreB}
          >
            <Trophy className="h-3.5 w-3.5" /> Report
          </Button>
        ) : (
          <button
            onClick={() => run(() => undoMatchResult(match.id))}
            disabled={pending}
            className="text-caption uppercase text-ink-muted hover:text-danger"
          >
            Undo
          </button>
        ))}
      {compact &&
        !done && (
          <Button size="sm" onClick={() => run(() => recordMatchResult(match.id, scoreA, scoreB))} disabled={pending || scoreA === scoreB}>
            Report
          </Button>
        )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live
// ---------------------------------------------------------------------------

function LivePanel({
  data,
  pending,
  run,
}: {
  data: MayhemFull;
  pending: boolean;
  run: (fn: () => Promise<void>) => void;
}) {
  const active = data.matches.find((m) => m.id === data.event.active_match_id);
  const playable = data.matches.filter(
    (m) => m.team_a_id && m.team_b_id && m.status !== "completed",
  );

  return (
    <div className="space-y-6">
      {data.event.champion_team_id && (
        <div className="bg-brand-red/10 border border-brand-red p-6 flex items-center gap-4">
          <Trophy className="h-8 w-8 text-warning" />
          <div>
            <p className="text-label uppercase text-ink-muted">Champion</p>
            <p className="font-display text-display-sm">
              {teamName(data.teams, data.event.champion_team_id)}
            </p>
          </div>
        </div>
      )}

      <div className="bg-surface border border-line p-6">
        <h2 className="font-heading text-heading-md mb-4">Set active match (shown on /mayhemlive)</h2>
        {playable.length === 0 ? (
          <p className="text-body-sm text-ink-muted italic">No playable matches right now.</p>
        ) : (
          <div className="space-y-2">
            {playable.map((m) => (
              <button
                key={m.id}
                onClick={() => run(() => setActiveMatch(active?.id === m.id ? null : m.id))}
                className={cn(
                  "w-full text-left px-3 py-2.5 border rounded-sm text-body-sm",
                  active?.id === m.id
                    ? "border-brand-red bg-brand-red/10"
                    : "border-line hover:border-line-strong",
                )}
              >
                M{m.match_number} · {teamName(data.teams, m.team_a_id)} vs {teamName(data.teams, m.team_b_id)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="bg-surface border border-line p-6">
        <h2 className="font-heading text-heading-md mb-4">All matches</h2>
        <MatchList matches={data.matches} teams={data.teams} pending={pending} run={run} />
      </div>
    </div>
  );
}
