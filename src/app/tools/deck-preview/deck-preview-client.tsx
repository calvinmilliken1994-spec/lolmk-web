"use client";

// TODO(control-deck): delete with ./page.tsx. Mock data reproducing
// docs/design/control-deck-v2/screens/desk-round-live.html; every name and
// number below is the reference's placeholder data, not real state.

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  ActivityLog,
  AlertStrip,
  BroadcastColumn,
  BroadcastNote,
  DeckShell,
  ScenePreview,
  SceneProgram,
  type ActivityEntry,
  type DeckDefinition,
  type DeckPhase,
  type DeckWorkspaceProps,
} from "@/components/control-deck";

type TileState = "reported" | "playing" | "flagged" | "bye";

interface MockTable {
  table: number;
  a: string;
  b: string | null;
  state: TileState;
  detail: string;
}

interface MockState {
  round: number;
  rounds: number;
  tables: MockTable[];
}

const TABLES: MockTable[] = [
  { table: 1, a: "Aria", b: "Bok", state: "reported", detail: "Aria 2–0 · Ray" },
  { table: 2, a: "Calder", b: "Dami", state: "reported", detail: "Dami 2–1 · Joe" },
  { table: 3, a: "Eun", b: "Finn", state: "playing", detail: "Game 3 · started 41m" },
  { table: 4, a: "Gyu", b: "Hana", state: "reported", detail: "Draw 1–1 · Ray" },
  { table: 5, a: "Iris", b: "Jun", state: "reported", detail: "Iris 2–0 · Jin" },
  { table: 6, a: "Kai", b: "Lumi", state: "flagged", detail: "Judge call · +3:00" },
  { table: 7, a: "Mina", b: "Jae", state: "playing", detail: "Game 2" },
  { table: 8, a: "Nox", b: "Oli", state: "reported", detail: "Nox 2–1 · Desk" },
  { table: 9, a: "Pip", b: "Quinn", state: "reported", detail: "Quinn 2–0 · Joe" },
  { table: 10, a: "Rho", b: "Sol", state: "playing", detail: "Game 3" },
  { table: 11, a: "Tae", b: "Uma", state: "reported", detail: "Tae 2–1 · Jin" },
  { table: 12, a: "Vex", b: "Won", state: "reported", detail: "Vex 2–0 · Ray" },
  { table: 13, a: "Xia", b: "Yuri", state: "reported", detail: "Yuri 2–1 · Joe" },
  { table: 14, a: "Zed", b: "Ahn", state: "playing", detail: "Game 2" },
  { table: 15, a: "Bea", b: "Cho", state: "reported", detail: "Bea 2–0 · Jin" },
  { table: 16, a: "Dov", b: null, state: "bye", detail: "Bye · auto 2–0" },
];

const MOCK_STATE: MockState = { round: 3, rounds: 5, tables: TABLES };

const ACTIVITY: ActivityEntry[] = [
  { id: "a4", at: "2026-10-10T14:52:00+09:00", actor: "Jin", text: "Table 15 · Bea wins 2–0", reversible: true },
  { id: "a3", at: "2026-10-10T14:50:00+09:00", actor: "Joe", text: "Table 6 · judge call, +3:00 extension" },
  { id: "a2", at: "2026-10-10T14:47:00+09:00", actor: "Ray", text: "Table 12 · Vex wins 2–0 · Won drops after round", reversible: true },
  { id: "a1", at: "2026-10-10T14:41:00+09:00", actor: "Joe", text: "Table 13 · Yuri wins 2–1", reversible: true },
];

const SCENES = [
  { id: "pairings", label: "Pairings" },
  { id: "pairings_clock", label: "Pairings + clock" },
  { id: "clock", label: "Clock" },
  { id: "standings", label: "Standings" },
  { id: "top_cut", label: "Top-cut bracket" },
  { id: "announcement", label: "Announcement" },
  { id: "idle", label: "Idle / brand" },
];

const sceneLabel = (id: string) => SCENES.find((s) => s.id === id)?.label ?? id;

const outstanding = (s: MockState) => s.tables.filter((t) => t.state === "playing" || t.state === "flagged").length;

const MOCK_DEFINITION: DeckDefinition<MockState> = {
  tool: "riftbound",
  phases: (s) => {
    const rounds: DeckPhase[] = Array.from({ length: s.rounds }, (_, i) => {
      const n = i + 1;
      return {
        id: `round-${n}`,
        label: `Round ${n}`,
        status: n < s.round ? "done" : n === s.round ? "live" : "next",
        meta: n === s.round ? "LIVE" : undefined,
      };
    });
    return [
      { id: "setup", label: "Setup", status: "done" },
      { id: "check-in", label: "Check-in", status: "done", meta: "32" },
      ...rounds,
      { id: "top-cut", label: "Top 8", status: "next" },
      { id: "complete", label: "Complete", status: "next" },
    ];
  },
  primaryAction: (s) => {
    const left = outstanding(s);
    return {
      label: `Close round ${s.round}`,
      enabled: left === 0,
      reason: left ? `${left} tables outstanding` : undefined,
      run: async () => undefined,
    };
  },
  scenes: SCENES.map((scene) => ({ ...scene, available: () => true })),
  autoFollow: () => null,
  workspace: () => MockRoundWorkspace,
};

export function DeckPreviewClient() {
  const [program, setProgram] = useState("pairings_clock");
  const [preview, setPreview] = useState("standings");
  const [autoFollow, setAutoFollow] = useState(true);
  const [syncedAt] = useState(() => Date.now() - 1000);

  return (
    // Covers the site header (z-50) like the live screens do, so the deck
    // can be compared against the 1440x1000 reference frame.
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-base">
      <DeckShell
        definition={MOCK_DEFINITION}
        state={MOCK_STATE}
        topBar={{
          backHref: "/tools",
          backLabel: "Riftbound",
          title: "Poro Cup · Riftbound",
          status: "ROUND 3 / 5 · LIVE",
          clock: { display: "04:12", onTogglePause: () => undefined, onAdjust: () => undefined },
          onAirScene: sceneLabel(program),
          lastSyncedAt: syncedAt,
        }}
        broadcast={
          <BroadcastColumn
            autoFollow={autoFollow}
            onAutoFollowChange={setAutoFollow}
            preview={
              <ScenePreview sceneLabel={sceneLabel(preview)} src={null}>
                <MockStandingsScene />
              </ScenePreview>
            }
            program={
              <SceneProgram sceneLabel={sceneLabel(program)} src={null}>
                <MockPairingsScene />
              </SceneProgram>
            }
            scenes={SCENES.map((s) => ({ ...s, available: true }))}
            programId={program}
            previewId={preview}
            onPreview={setPreview}
            onTake={() => setProgram(preview)}
            toolSlot={
              <BroadcastNote
                title="AUTO-FOLLOW NEXT"
                lines={["Time called → Clock with TIME banner", "Round closed → Standings"]}
              />
            }
          />
        }
      />
    </div>
  );
}

// --- Mock workspace (the real one is RbRoundWorkspace, not built yet) ------

const FILTERS = ["All 16", "Outstanding 5", "Flagged 1"];

function MockRoundWorkspace({ state }: DeckWorkspaceProps<MockState>) {
  const [filter, setFilter] = useState(0);
  const reported = state.tables.filter((t) => t.state === "reported" || t.state === "bye").length;
  const total = state.tables.length;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] tracking-[0.08em] text-brand-red-bright">ROUND 3 · SWISS · BO3 · 60 MIN</p>
          <h2 className="mt-1 font-heading text-[24px] font-semibold">Tables</h2>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((label, i) => (
            <button
              key={label}
              type="button"
              aria-pressed={filter === i}
              onClick={() => setFilter(i)}
              className={cn(
                "h-8 rounded-sm border px-3 text-[13px]",
                filter === i
                  ? "border-brand-blue-bright bg-elevated text-ink"
                  : "border-line-strong bg-transparent text-ink-secondary",
              )}
            >
              {label}
            </button>
          ))}
          <label htmlFor="tablejump" className="sr-only">
            Jump to table
          </label>
          <input
            id="tablejump"
            placeholder="Table # then key"
            // The reference input is content-box (150 + padding + border).
            className="h-[34px] w-[172px] rounded-sm border border-line-strong bg-surface px-2.5 font-mono text-[12px] text-ink placeholder:text-ink-muted"
          />
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex justify-between text-[12px] text-ink-secondary">
          <span>
            {reported} of {total} reported
          </span>
          <span>Judges: Ray · Joe · Jin</span>
        </div>
        <div className="h-1.5 bg-elevated">
          <div className="h-1.5 bg-success" style={{ width: `${Math.round((reported / total) * 100)}%` }} />
        </div>
      </div>

      <AlertStrip onAcknowledge={() => undefined}>Table 6 · judge call (Joe) · +3:00 extension applied</AlertStrip>

      <div className="grid grid-cols-4 gap-2.5">
        {state.tables.map((t) => (
          <MockTableTile key={t.table} table={t} />
        ))}
      </div>

      <ActivityLog entries={ACTIVITY} onUndo={() => undefined} />
    </>
  );
}

const TILE: Record<TileState, { tile: string; pill: string; label: string }> = {
  reported: { tile: "border-line bg-surface", pill: "bg-success-surface text-success-ink", label: "REPORTED" },
  playing: { tile: "border-line-strong bg-deck-tile", pill: "bg-elevated text-ink-secondary", label: "PLAYING" },
  flagged: { tile: "border-warning-line bg-warning-tile", pill: "bg-warning-surface text-warning-ink", label: "JUDGE CALL" },
  bye: { tile: "border-line bg-deck-rail", pill: "bg-line-subtle text-ink-muted", label: "BYE" },
};

function MockTableTile({ table }: { table: MockTable }) {
  const look = TILE[table.state];
  return (
    <button type="button" className={cn("block min-h-[92px] rounded-sm border p-3 text-left text-ink", look.tile)}>
      <span className="flex items-center justify-between">
        <span className="font-mono text-[18px] font-semibold">{table.table}</span>
        <span className={cn("px-1.5 py-[3px] font-mono text-[10px] font-semibold tracking-[0.04em]", look.pill)}>
          {look.label}
        </span>
      </span>
      <span className="mt-2 block truncate text-[13px] text-ink">
        {table.a} <span className="text-ink-muted">vs</span> {table.b ?? "—"}
      </span>
      <span className="mt-1 block truncate text-[12px] text-ink-secondary">{table.detail}</span>
    </button>
  );
}

// --- Mock venue scenes for the monitors (no /rblive screen exists yet) -----

const STANDINGS = [
  ["1", "Iris", "2-0", "75%"],
  ["2", "Tae", "2-0", "62%"],
  ["3", "Aria", "2-0", "58%"],
  ["4", "Mina", "2-0", "50%"],
  ["5", "Nox", "1-0-1", "67%"],
];

function MockStandingsScene() {
  return (
    <div className="flex h-full flex-col gap-1 p-2.5">
      <span className="font-display text-[16px] tracking-[0.04em]">STANDINGS AFTER ROUND 2</span>
      {STANDINGS.map(([rank, name, record, pct]) => (
        <span key={rank} className="flex gap-2 font-mono text-[9px] text-ink-secondary">
          <span className="w-3">{rank}</span>
          <span className="flex-auto text-ink">{name}</span>
          <span>{record}</span>
          <span>{pct}</span>
        </span>
      ))}
    </div>
  );
}

const PAIRINGS = [
  ["Ahn", "T14"],
  ["Aria", "T1"],
  ["Bea", "T15"],
  ["Bok", "T1"],
  ["Calder", "T2"],
  ["Cho", "T15"],
  ["Dami", "T2"],
  ["Dov", "TBYE"],
  ["Eun", "T3"],
  ["Finn", "T3"],
  ["Gyu", "T4"],
  ["Hana", "T4"],
];

function MockPairingsScene() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between bg-surface px-2.5 py-1.5">
        <span className="font-display text-[14px] tracking-[0.04em]">ROUND 3 PAIRINGS</span>
        <span className="font-display text-[18px]">04:12</span>
      </div>
      <div className="grid grid-cols-2 gap-x-2.5 gap-y-0.5 px-2.5 py-1.5">
        {PAIRINGS.map(([name, table]) => (
          <span key={name} className="flex gap-1.5 font-mono text-[8px] text-ink-secondary">
            <span className="flex-auto text-ink">{name}</span>
            <span>{table}</span>
          </span>
        ))}
      </div>
      <span className="mt-auto px-2.5 py-1 text-[8px] text-ink-muted">A–H · page 1 of 4 · auto-paging</span>
    </div>
  );
}
