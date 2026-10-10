"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityLog, AlertStrip, DeckKicker, type DeckRun } from "@/components/control-deck";
import { cn } from "@/lib/utils";
import type { RbRound } from "@/types/riftbound";
import type { RbActions } from "./rb-actions";
import { rbCutSize, rbPrimarySpec, rbSwissTotal, type RbDeskState } from "./rb-deck-model";
import {
  FLAG_LABEL,
  formatDelta,
  newDeskKey,
  openFlags,
  playerName,
  rbActivity,
  rbDraftRows,
  rbFilterTiles,
  rbResultForKey,
  rbResultKeys,
  rbRoundTiles,
  rbSwissRound,
  rbTileCounts,
  resultPhrase,
  roundMatches,
  type RbDraftRow,
  type RbFilter,
  type RbTile,
  type RbTileKind,
} from "./rb-round-model";
import { RbTableSheet } from "./rb-table-sheet";

export interface RbRoundWorkspaceProps {
  state: RbDeskState;
  run: DeckRun;
  pending: boolean;
  error: string | null;
  /** Ticking wall clock for derived time (null before hydration). */
  now: number | null;
  actions: RbActions;
}

/**
 * The Swiss rounds workspace, one view per round state: the draft pairing
 * editor, the table desk for a published / live / in-time round, and the
 * standings summary once it's closed.
 */
export function RbRoundWorkspace(props: RbRoundWorkspaceProps) {
  const round = rbSwissRound(props.state);
  if (!round) {
    return (
      <section className="flex flex-col gap-2">
        <DeckKicker className="text-brand-red-bright">SWISS ROUNDS</DeckKicker>
        <h2 className="font-heading text-[24px] font-semibold">No round yet</h2>
        <p className="text-[13px] text-ink-secondary">Round 1 is paired when check-in closes.</p>
      </section>
    );
  }
  if (round.status === "draft") return <RbDraftWorkspace {...props} round={round} />;
  if (round.status === "closed") return <RbClosedWorkspace {...props} round={round} />;
  return <RbTablesWorkspace {...props} round={round} />;
}

const kicker = (round: RbRound, tail: string) => `ROUND ${round.number} · SWISS · ${tail}`;

// ---------------------------------------------------------------------------
// Activity (shared by every state)
// ---------------------------------------------------------------------------

function RbActivity({ state, run, pending, actions }: Pick<RbRoundWorkspaceProps, "state" | "run" | "pending" | "actions">) {
  const rows = useMemo(() => rbActivity(state), [state]);
  const onUndo = (entry: { id: string }) => {
    const undo = rows.find((r) => r.id === entry.id)?.undo;
    if (!undo) return;
    void run(async () => {
      if (undo.kind === "unpublish") return actions.unpublishRound(undo.roundId);
      if (undo.kind === "drop") return actions.undoDrop(undo.playerId);
      // A report and the drops recorded with it are undone together.
      const result = await (undo.stage === "top_cut" ? actions.undoTopCutResult(undo.matchId) : actions.undoResult(undo.matchId));
      if (!result.ok) return result;
      for (const playerId of undo.dropPlayerIds) {
        const dropped = await actions.undoDrop(playerId);
        if (!dropped.ok) return dropped;
      }
      return result;
    });
  };
  if (rows.length === 0) return null;
  return <ActivityLog entries={rows} onUndo={onUndo} pending={pending} />;
}

// ---------------------------------------------------------------------------
// Draft: pairings
// ---------------------------------------------------------------------------

function RbDraftWorkspace({ state, round, run, pending, actions }: RbRoundWorkspaceProps & { round: RbRound }) {
  const rows = useMemo(() => rbDraftRows(state, round), [state, round]);
  const warningCount = rows.reduce((n, r) => n + r.warnings.length, 0);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  // Whatever changed the pairings under the selection (a swap, a poll, another admin) clears it.
  const seats = rows.map((r) => `${r.aId}:${r.bId ?? ""}`).join("|");
  useEffect(() => setSelected(null), [seats]);

  const swap = (a: string, b: string) => {
    if (a === b || pending) return;
    setSelected(null);
    setDragging(null);
    void run(() => actions.swapDraftPairing({ roundId: round.id, playerA: a, playerB: b }));
  };
  const pick = (id: string) => {
    if (pending) return;
    if (selected === null) setSelected(id);
    else if (selected === id) setSelected(null);
    else swap(selected, id);
  };

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <DeckKicker className="text-brand-red-bright">{kicker(round, "DRAFT")}</DeckKicker>
          <h2 className="mt-1 font-heading text-[24px] font-semibold">Pairings</h2>
        </div>
        <p className="max-w-[340px] text-right text-[12px] text-ink-muted">
          Select a player, then another to swap their seats, or drag one onto the other. Nothing is public until you publish.
        </p>
      </div>

      <div className="flex justify-between text-[12px] text-ink-secondary">
        <span>
          {rows.length} {rows.length === 1 ? "table" : "tables"}
          {rows.some((r) => r.bId === null) ? " · 1 bye" : ""}
        </span>
        <span className={cn(warningCount > 0 ? "text-warning-ink" : "text-ink-muted")}>
          {warningCount > 0 ? `${warningCount} ${warningCount === 1 ? "warning" : "warnings"}` : "No warnings"}
        </span>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] items-start gap-2.5">
        {rows.map((row) => (
          <DraftRow
            key={row.matchId}
            row={row}
            selected={selected}
            dragging={dragging}
            disabled={pending}
            onPick={pick}
            onDragStart={setDragging}
            onDragEnd={() => setDragging(null)}
            onDropOn={(target) => dragging && swap(dragging, target)}
          />
        ))}
      </div>
      <RbActivity state={state} run={run} pending={pending} actions={actions} />
    </>
  );
}

const WARNING_TAG = { rematch: "REMATCH", point_mismatch: "POINTS", second_bye: "2ND BYE", duplicate_player: "DUPLICATE" } as const;

function DraftRow({
  row,
  selected,
  dragging,
  disabled,
  onPick,
  onDragStart,
  onDragEnd,
  onDropOn,
}: {
  row: RbDraftRow;
  selected: string | null;
  dragging: string | null;
  disabled: boolean;
  onPick: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDropOn: (id: string) => void;
}) {
  const warned = row.warnings.length > 0;
  const chip = (id: string, name: string, points: number) => (
    <button
      type="button"
      draggable={!disabled}
      disabled={disabled}
      aria-pressed={selected === id}
      onClick={() => onPick(id)}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart(id);
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        if (dragging && dragging !== id) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDropOn(id);
      }}
      className={cn(
        "flex h-9 min-w-0 flex-1 cursor-grab items-center justify-between gap-2 rounded-sm border px-2.5 text-left text-[13px] disabled:cursor-wait",
        selected === id
          ? "border-brand-blue-bright bg-brand-blue-muted text-ink"
          : dragging === id
            ? "border-brand-blue-bright bg-transparent text-ink-muted"
            : "border-line-strong bg-elevated text-ink hover:border-brand-blue-bright",
      )}
    >
      <span className="truncate">{name}</span>
      <span className="shrink-0 font-mono text-[11px] text-ink-muted">
        {points} {points === 1 ? "pt" : "pts"}
      </span>
    </button>
  );

  return (
    <div className={cn("flex flex-col gap-2 border p-3", warned ? "border-warning-line bg-warning-tile" : "border-line bg-surface")}>
      <div className="flex items-center gap-2">
        <span className="w-7 shrink-0 font-mono text-[18px] font-semibold">{row.table}</span>
        {chip(row.aId, row.aName, row.aPoints)}
        <span className="text-[12px] text-ink-muted">vs</span>
        {row.bId && row.bName !== null && row.bPoints !== null ? (
          chip(row.bId, row.bName, row.bPoints)
        ) : (
          <span className="flex h-9 min-w-0 flex-1 items-center rounded-sm border border-dashed border-line-strong px-2.5 font-mono text-[11px] text-ink-muted">
            BYE · auto 2–0
          </span>
        )}
      </div>
      {row.warnings.map((w, i) => (
        <p key={i} className="flex gap-2 text-[12px] text-warning-ink">
          <span className="font-mono text-[10px] font-semibold tracking-[0.04em]">{WARNING_TAG[w.code]}</span>
          {w.message}
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Published / live / time: the tables
// ---------------------------------------------------------------------------

const TILE_BOX: Record<RbTileKind, string> = {
  reported: "border-line bg-surface",
  playing: "border-line-strong bg-deck-tile",
  waiting: "border-line-strong bg-deck-tile",
  flagged: "border-warning-line bg-warning-tile",
  over_time: "border-brand-red-muted bg-onair-surface",
  bye: "border-line bg-deck-rail",
};

const TILE_TAG: Record<RbTileKind, string> = {
  reported: "bg-success-surface text-success-ink",
  playing: "bg-elevated text-ink-secondary",
  waiting: "bg-elevated text-ink-secondary",
  flagged: "bg-warning-surface text-warning-ink",
  over_time: "bg-venue-time text-venue-time-ink",
  bye: "bg-line-subtle text-ink-muted",
};

function RbTableTile({ tile, highlighted, onOpen }: { tile: RbTile; highlighted: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      id={`rb-tile-${tile.table}`}
      onClick={onOpen}
      className={cn(
        "block min-h-[92px] rounded-sm border p-3 text-left font-[inherit] text-ink",
        TILE_BOX[tile.kind],
        highlighted && "ring-2 ring-brand-blue-bright",
      )}
    >
      <span className="flex items-center justify-between">
        <span className="font-mono text-[18px] font-semibold">{tile.table}</span>
        <span className={cn("px-1.5 py-[3px] font-mono text-[10px] font-semibold tracking-[0.04em]", TILE_TAG[tile.kind])}>{tile.tag}</span>
      </span>
      <span className="mt-2 block truncate text-[13px]">
        {tile.nameA} <span className="text-ink-muted">vs</span> {tile.nameB ?? "—"}
      </span>
      <span className="mt-1 block truncate text-[12px] text-ink-secondary">{tile.line}</span>
    </button>
  );
}

const chipClass = (active: boolean) =>
  cn(
    "h-8 rounded-sm border px-3 text-[13px]",
    active ? "border-brand-blue-bright bg-elevated text-ink" : "border-line-strong bg-transparent text-ink-secondary hover:text-ink",
  );

function RbTablesWorkspace({ state, round, run, pending, error, now, actions }: RbRoundWorkspaceProps & { round: RbRound }) {
  const bestOf = state.tournament.config.bestOf;
  const [filter, setFilter] = useState<RbFilter>("all");
  const [jump, setJump] = useState("");
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const jumpRef = useRef<HTMLInputElement>(null);

  const matches = roundMatches(state, round);
  const tiles = useMemo(() => rbRoundTiles(state, round, now), [state, round, now]);
  const counts = rbTileCounts(tiles);
  const shown = rbFilterTiles(tiles, filter);
  const jumpTable = jump ? Number(jump) : null;
  const jumpMatch = jumpTable === null ? null : (matches.find((m) => m.table_number === jumpTable) ?? null);
  const openMatch = openId ? matches.find((m) => m.id === openId) : undefined;

  const alerts = matches.flatMap((m) => openFlags(m).map((flag) => ({ match: m, flag })));
  const judges = state.tournament.config.judges.map((j) => j.name).filter(Boolean);

  // A feedback line shows for a few seconds, then goes.
  useEffect(() => {
    if (!feedback) return;
    const id = setTimeout(() => setFeedback(null), 5000);
    return () => clearTimeout(id);
  }, [feedback]);

  const jumpTableNumber = jumpMatch?.table_number ?? null;
  useEffect(() => {
    if (jumpTableNumber !== null) document.getElementById(`rb-tile-${jumpTableNumber}`)?.scrollIntoView({ block: "nearest" });
  }, [jumpTableNumber]);

  // Typing a digit anywhere on the desk (no field focused, no sheet open) goes to the jump field.
  useEffect(() => {
    if (openId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || !/^\d$/.test(e.key)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      jumpRef.current?.focus();
      setJump((j) => (j + e.key).slice(0, 3));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId]);

  const fail = (text: string) => setFeedback({ text, ok: false });

  const onResultKey = async (key: string) => {
    if (jumpTable === null) return fail("Type a table number first.");
    if (!jumpMatch) return fail(`No table ${jumpTable} in this round.`);
    if (jumpMatch.status === "bye") return fail(`Table ${jumpTable} is a bye.`);
    if (jumpMatch.status === "completed") {
      return fail(`Table ${jumpTable} was reported by ${jumpMatch.reported_by_name}. Open it to undo first.`);
    }
    const result = rbResultForKey(bestOf, key);
    if (!result) {
      return fail(`"${key}" isn't a result key. Use ${rbResultKeys(bestOf).map((k) => `${k.key} ${k.label}`).join(", ")}.`);
    }
    setFeedback(null);
    const done = await run(() =>
      actions.reportResult({
        matchId: jumpMatch.id,
        gamesA: result.gamesA,
        gamesB: result.gamesB,
        gamesDrawn: 0,
        decidedOnTime: false,
        idempotencyKey: newDeskKey(),
      }),
    );
    if (done) {
      const phrase = resultPhrase(playerName(state, jumpMatch.player_a_id), playerName(state, jumpMatch.player_b_id), result.gamesA, result.gamesB, false);
      setJump("");
      setFeedback({ text: `Table ${jumpTable} · ${phrase} sent`, ok: true });
    }
  };

  const onJumpKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setJump("");
      setFeedback(null);
      e.currentTarget.blur();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (jumpMatch) setOpenId(jumpMatch.id);
      else if (jumpTable !== null) fail(`No table ${jumpTable} in this round.`);
    } else if (!e.ctrlKey && !e.metaKey && !e.altKey && /^[a-z]$/i.test(e.key)) {
      e.preventDefault();
      if (!pending) void onResultKey(e.key);
    }
  };

  const percent = counts.all === 0 ? 0 : Math.round((counts.reported / counts.all) * 100);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <DeckKicker className="text-brand-red-bright">
            {kicker(round, `BO${bestOf} · ${state.tournament.config.roundMinutes} MIN`)}
          </DeckKicker>
          <h2 className="mt-1 font-heading text-[24px] font-semibold">Tables</h2>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["all", "All", counts.all],
              ["outstanding", "Outstanding", counts.outstanding],
              ["flagged", "Flagged", counts.flagged],
            ] as const
          ).map(([id, label, n]) => (
            <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)} className={chipClass(filter === id)}>
              {label} {n}
            </button>
          ))}
          <label htmlFor="rb-table-jump" className="sr-only">
            Jump to table
          </label>
          <input
            id="rb-table-jump"
            ref={jumpRef}
            value={jump}
            inputMode="numeric"
            autoComplete="off"
            placeholder="Table # then key"
            title={`Type a table number, then ${rbResultKeys(bestOf).map((k) => `${k.key} = ${k.label}`).join(", ")}. Enter opens the table, Esc clears.`}
            onChange={(e) => setJump(e.target.value.replace(/\D/g, "").slice(0, 3))}
            onKeyDown={onJumpKey}
            className="h-[34px] w-[172px] rounded-sm border border-line-strong bg-surface px-2.5 font-mono text-[12px] text-ink placeholder:text-ink-disabled"
          />
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex justify-between gap-3 text-[12px] text-ink-secondary">
          <span aria-live="polite">
            {counts.reported} of {counts.all} reported
            {feedback && <span className={cn("ml-2", feedback.ok ? "text-success-ink" : "text-warning-ink")}>· {feedback.text}</span>}
          </span>
          {judges.length > 0 && <span className="shrink-0">Judges: {judges.join(" · ")}</span>}
        </div>
        <div className="h-1.5 bg-elevated" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Tables reported">
          <div className="h-1.5 bg-success" style={{ width: `${percent}%` }} />
        </div>
      </div>

      {alerts.slice(0, 3).map(({ match, flag }) => (
        <AlertStrip key={flag.id} pending={pending} onAcknowledge={() => void run(() => actions.acknowledgeFlag(match.id, flag.id))}>
          Table {match.table_number} · {FLAG_LABEL[flag.kind].toLowerCase()} ({flag.raised_by_name})
          {flag.note ? ` · ${flag.note}` : ""}
          {match.extension_ms > 0 ? ` · ${formatDelta(match.extension_ms)} extension applied` : ""}
        </AlertStrip>
      ))}
      {alerts.length > 3 && <p className="text-[12px] text-warning-ink">+{alerts.length - 3} more flagged. Use the Flagged filter.</p>}

      {shown.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2.5">
          {shown.map((tile) => (
            <RbTableTile key={tile.matchId} tile={tile} highlighted={jumpTable === tile.table} onOpen={() => setOpenId(tile.matchId)} />
          ))}
        </div>
      ) : (
        <p className="border border-dashed border-line-strong p-4 text-[13px] text-ink-muted">
          {filter === "flagged" ? "No flagged tables." : "No outstanding tables."}
        </p>
      )}

      <RbActivity state={state} run={run} pending={pending} actions={actions} />

      {openMatch && (
        <RbTableSheet
          key={openMatch.id}
          state={state}
          round={round}
          match={openMatch}
          run={run}
          pending={pending}
          error={error}
          actions={actions}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Closed: standings summary
// ---------------------------------------------------------------------------

const pct = (v: number) => `${Math.round(v * 100)}%`;
const SUMMARY_ROWS = 16;

function RbClosedWorkspace({ state, round, run, pending, actions }: RbRoundWorkspaceProps & { round: RbRound }) {
  const standings = [...state.standings].sort((a, b) => a.rank - b.rank);
  const swissCount = state.rounds.filter((r) => r.stage === "swiss").length;
  const isLast = swissCount >= rbSwissTotal(state);
  const cutSize = isLast && !state.tournament.config.topCutSeedIds ? rbCutSize(state) : 0;
  const next = rbPrimarySpec(state);
  const shown = standings.slice(0, SUMMARY_ROWS);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <DeckKicker className="text-brand-red-bright">{kicker(round, "CLOSED")}</DeckKicker>
          <h2 className="mt-1 font-heading text-[24px] font-semibold">Standings after round {round.number}</h2>
        </div>
        {next && <p className="text-[12px] text-ink-muted">Next: {next.label} (top right)</p>}
      </div>

      {standings.length === 0 ? (
        <p className="border border-dashed border-line-strong p-4 text-[13px] text-ink-muted">No standings yet.</p>
      ) : (
        <table className="w-full border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-line-strong font-mono text-[11px] tracking-[0.08em] text-ink-muted">
              <th className="w-10 py-1.5 font-normal">#</th>
              <th className="py-1.5 font-normal">PLAYER</th>
              <th className="py-1.5 font-normal">RECORD</th>
              <th className="py-1.5 text-right font-normal">PTS</th>
              <th className="py-1.5 text-right font-normal">OMW%</th>
              <th className="py-1.5 text-right font-normal">GW%</th>
              <th className="py-1.5 text-right font-normal">OGW%</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <tr
                key={s.playerId}
                className={cn(
                  "border-b border-line",
                  cutSize > 0 && s.rank === cutSize && "border-b-2 border-b-brand-red",
                  s.dropped && "text-ink-muted",
                )}
              >
                <td className="py-1.5 font-mono text-[12px] text-ink-muted">{s.rank}</td>
                <td className="py-1.5">
                  {playerName(state, s.playerId)}
                  {s.dropped && <span className="ml-2 font-mono text-[10px] text-ink-muted">DROPPED</span>}
                </td>
                <td className="py-1.5 font-mono text-[12px]">{s.record}</td>
                <td className="py-1.5 text-right font-mono text-[12px]">{s.matchPoints}</td>
                <td className="py-1.5 text-right font-mono text-[12px] text-ink-secondary">{pct(s.omwp)}</td>
                <td className="py-1.5 text-right font-mono text-[12px] text-ink-secondary">{pct(s.gwp)}</td>
                <td className="py-1.5 text-right font-mono text-[12px] text-ink-secondary">{pct(s.ogwp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-[12px] text-ink-muted">
        {standings.length > SUMMARY_ROWS ? `Top ${SUMMARY_ROWS} of ${standings.length}. ` : ""}
        {cutSize > 0 ? `The red line is the cut: top ${cutSize} advance. ` : ""}
        Tiebreakers: OMW%, GW%, OGW%, then the stored random seed.
      </p>

      <RbActivity state={state} run={run} pending={pending} actions={actions} />
    </>
  );
}
