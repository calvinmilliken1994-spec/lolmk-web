"use client";

import { useMemo, useState } from "react";
import { ActivityLog, DeckKicker, DeckSheet, ScorePad, type DeckRun, type ScorePadScore } from "@/components/control-deck";
import { cn } from "@/lib/utils";
import type { RbActions } from "./rb-actions";
import { RbBracket } from "./rb-bracket";
import { rbCutDesk, rbCutProgress, type RbCutDesk, type RbCutRow } from "./rb-cut-model";
import type { RbDeskState } from "./rb-deck-model";
import { newDeskKey, rbActivity } from "./rb-round-model";

export interface RbCutWorkspaceProps {
  state: RbDeskState;
  run: DeckRun;
  pending: boolean;
  error: string | null;
  actions: RbActions;
}

const smallButton =
  "h-9 rounded-sm border border-line-strong bg-elevated px-3 text-[13px] text-ink hover:border-brand-blue-bright disabled:cursor-not-allowed disabled:text-ink-disabled disabled:hover:border-line-strong";

const seat = (s: { name: string; seed: number }) => `${s.seed > 0 ? `#${s.seed} ` : ""}${s.name}`;

/**
 * The Top cut workspace: the single-elimination matches of the current cut
 * round as a queue, each with the ScorePad. Top cut is untimed, so there is no
 * clock and no extension. The primary action (top right) pairs, publishes and
 * closes the rounds and finally says "Complete event" once the final is
 * reported.
 */
export function RbCutWorkspace({ state, run, pending, error, actions }: RbCutWorkspaceProps) {
  const desk = useMemo(() => rbCutDesk(state), [state]);
  const [openId, setOpenId] = useState<string | null>(null);
  const size = desk.view?.size ?? desk.seeds.length;
  const openRow = [...desk.queue, ...desk.finished].find((r) => r.matchId === openId) ?? null;

  const undoLatest = () => {
    if (desk.undo) void run(() => actions.undoTopCutResult(desk.undo!.matchId));
  };
  const toggleLive = (row: RbCutRow) => void run(() => actions.setMatchStarted(row.matchId, row.status !== "live"));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <DeckKicker className="text-brand-red-bright">
            TOP CUT{desk.round ? ` · ${desk.roundName.toUpperCase()} · ${desk.round.status.toUpperCase()}` : ""}
          </DeckKicker>
          <h2 className="mt-1 font-heading text-[24px] font-semibold">
            Top {size || "cut"}
            {desk.roundName ? ` · ${desk.roundName}` : ""}
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-secondary">{rbCutProgress(desk)}</p>
        </div>
        <div className="flex items-center gap-2">
          {desk.undo && (
            <button type="button" disabled={pending} onClick={undoLatest} className={smallButton}>
              Undo latest result
            </button>
          )}
        </div>
      </div>
      {desk.undo && (
        <p className="-mt-2 text-[12px] text-ink-muted">
          Latest result: table {desk.undo.table} · {desk.undo.text}
        </p>
      )}

      <section className="flex flex-col gap-2" aria-label="Match queue">
        <DeckKicker>
          MATCH QUEUE · {desk.queue.length} TO PLAY · BEST OF {state.tournament.config.bestOf} · NO CLOCK
        </DeckKicker>
        {desk.queue.length === 0 ? (
          <p className="border border-dashed border-line-strong p-4 text-[13px] text-ink-muted">
            {desk.round === null
              ? "Nothing is paired yet."
              : desk.round.status === "closed"
                ? "This round is closed. Use the top-right action to pair the next one."
                : desk.finished.length > 0
                  ? "Every match in this round has a result."
                  : "No matches."}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {desk.queue.map((row) => (
              <QueueRow
                key={row.matchId}
                row={row}
                reportable={desk.reportable}
                pending={pending}
                onReport={() => setOpenId(row.matchId)}
                onToggleLive={() => toggleLive(row)}
              />
            ))}
          </ul>
        )}
        {desk.round?.status === "draft" && (
          <p className="text-[12px] text-ink-muted">Draft: publish the round (top right) before results can be reported.</p>
        )}
      </section>

      {desk.finished.length > 0 && (
        <section className="flex flex-col gap-2" aria-label="Reported">
          <DeckKicker>REPORTED · {desk.finished.length}</DeckKicker>
          <ul className="flex flex-col gap-1.5">
            {desk.finished.map((row) => (
              <DoneRow key={row.matchId} row={row} onOpen={desk.reportable ? () => setOpenId(row.matchId) : undefined} />
            ))}
          </ul>
        </section>
      )}

      {desk.view && (
        <section className="flex flex-col gap-2" aria-label="Bracket">
          <DeckKicker>BRACKET</DeckKicker>
          <div className="overflow-x-auto border border-line-strong bg-base p-3">
            <RbBracket view={desk.view} scale={0.42} />
          </div>
        </section>
      )}

      {desk.earlier.length > 0 && (
        <section className="flex flex-col gap-2" aria-label="Earlier rounds">
          <DeckKicker>EARLIER ROUNDS</DeckKicker>
          <ul className="flex flex-col gap-1.5">
            {desk.earlier.map((row) => (
              <DoneRow key={row.matchId} row={row} />
            ))}
          </ul>
        </section>
      )}

      <CutActivity state={state} run={run} pending={pending} actions={actions} />

      {openRow && (
        <RbCutSheet
          key={openRow.matchId}
          state={state}
          desk={desk}
          row={openRow}
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

function StatusChip({ status }: { status: RbCutRow["status"] }) {
  const tone =
    status === "live"
      ? "border-brand-red bg-brand-red text-ink"
      : status === "done" || status === "bye"
        ? "border-line-strong text-ink-muted"
        : "border-line-strong text-ink-secondary";
  return (
    <span className={cn("rounded-sm border px-2 py-0.5 font-mono text-[11px] tracking-[0.08em]", tone)}>
      {status === "live" ? "LIVE" : status === "waiting" ? "WAITING" : status === "bye" ? "BYE" : "DONE"}
    </span>
  );
}

function QueueRow({
  row,
  reportable,
  pending,
  onReport,
  onToggleLive,
}: {
  row: RbCutRow;
  reportable: boolean;
  pending: boolean;
  onReport: () => void;
  onToggleLive: () => void;
}) {
  return (
    <li
      data-cut-row={row.table}
      className={cn(
        "flex flex-wrap items-center gap-3 border bg-surface px-4 py-3",
        row.status === "live" ? "border-brand-red" : "border-line-strong",
      )}
    >
      <span className="w-14 font-mono text-[12px] text-ink-muted">TABLE {row.table}</span>
      <span className="min-w-0 flex-1 font-heading text-[17px] font-semibold">
        {seat(row.a)}
        <span className="px-2 font-normal text-ink-muted">vs</span>
        {row.b ? seat(row.b) : "—"}
      </span>
      <StatusChip status={row.status} />
      <button type="button" disabled={pending || !reportable} onClick={onToggleLive} className={smallButton}>
        {row.status === "live" ? "Not started" : "Start match"}
      </button>
      <button
        type="button"
        disabled={pending || !reportable}
        onClick={onReport}
        className="h-9 rounded-sm border border-brand-blue-bright bg-brand-blue-muted px-3 text-[13px] font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50"
      >
        Report result
      </button>
    </li>
  );
}

function DoneRow({ row, onOpen }: { row: RbCutRow; onOpen?: () => void }) {
  const winner = row.winner === "a" ? row.a : row.b;
  const loser = row.winner === "a" ? row.b : row.a;
  return (
    <li className="flex flex-wrap items-center gap-3 border border-line bg-surface px-4 py-2 text-[14px]">
      <span className="w-14 font-mono text-[12px] text-ink-muted">TABLE {row.table}</span>
      <span className="min-w-0 flex-1">
        <span className="font-semibold">{winner ? seat(winner) : "—"}</span>
        {row.status === "bye" ? (
          <span className="text-ink-muted"> advances (opponent dropped)</span>
        ) : (
          <>
            <span className="text-ink-muted"> beat </span>
            <span className="text-ink-secondary">{loser ? seat(loser) : "—"}</span>
          </>
        )}
      </span>
      {row.score && <span className="font-mono text-[13px]">{row.score}</span>}
      {row.reportedBy && <span className="font-mono text-[11px] text-ink-muted">{row.reportedBy}</span>}
      {onOpen && row.status === "done" && (
        <button type="button" onClick={onOpen} className="text-[12px] text-ink-secondary underline">
          Open
        </button>
      )}
    </li>
  );
}

function CutActivity({ state, run, pending, actions }: Pick<RbCutWorkspaceProps, "state" | "run" | "pending" | "actions">) {
  const rows = useMemo(() => rbActivity(state), [state]);
  const onUndo = (entry: { id: string }) => {
    const undo = rows.find((r) => r.id === entry.id)?.undo;
    if (!undo) return;
    void run(async () => {
      if (undo.kind === "unpublish") return actions.unpublishRound(undo.roundId);
      if (undo.kind === "drop") return actions.undoDrop(undo.playerId);
      return undo.stage === "top_cut" ? actions.undoTopCutResult(undo.matchId) : actions.undoResult(undo.matchId);
    });
  };
  if (rows.length === 0) return null;
  return <ActivityLog entries={rows} onUndo={onUndo} pending={pending} />;
}

/**
 * Report a top-cut result. The ScorePad here is the plain one: only winning
 * scores (2–0, 2–1; or a Bo1 win), because top cut is untimed and can't be
 * drawn. Mounted per match, so the idempotency key made here covers every retry
 * of this sheet's submission.
 */
function RbCutSheet({
  state,
  desk,
  row,
  run,
  pending,
  error,
  actions,
  onClose,
}: {
  state: RbDeskState;
  desk: RbCutDesk;
  row: RbCutRow;
  run: DeckRun;
  pending: boolean;
  error: string | null;
  actions: RbActions;
  onClose: () => void;
}) {
  const bestOf = state.tournament.config.bestOf;
  const [idempotencyKey] = useState(() => newDeskKey("cut"));
  const done = row.status === "done";
  const isLatest = desk.undo?.matchId === row.matchId;

  const submit = async (score: ScorePadScore) => {
    const result = await run(() =>
      actions.reportTopCutResult({
        matchId: row.matchId,
        gamesA: score.gamesA,
        gamesB: score.gamesB,
        gamesDrawn: 0,
        idempotencyKey,
      }),
    );
    if (result) onClose();
  };
  const undo = async () => {
    const result = await run(() => actions.undoTopCutResult(row.matchId));
    if (result) onClose();
  };

  return (
    <DeckSheet
      kicker={`TABLE ${row.table} · ${desk.roundName.toUpperCase()} · ${done ? "REPORTED" : row.status === "live" ? "LIVE" : "WAITING"}`}
      title={`${seat(row.a)} vs ${row.b ? seat(row.b) : "—"}`}
      onClose={onClose}
    >
      {error && (
        <p role="alert" className="border border-warning-line-quiet bg-warning-surface-strong px-3 py-2 text-[13px] text-warning-ink">
          {error}
        </p>
      )}
      {done ? (
        <section className="flex flex-col gap-3 border border-line-strong bg-surface p-4">
          <p className="font-heading text-[20px] font-semibold">
            {(row.winner === "a" ? row.a : row.b)?.name} won {row.score}
          </p>
          <p className="text-[13px] text-ink-secondary">Reported by {row.reportedBy ?? "?"}</p>
          <button type="button" disabled={pending || !desk.reportable} onClick={undo} className={cn(smallButton, "self-start")}>
            Undo result
          </button>
          {!isLatest && <p className="text-[12px] text-ink-muted">Undo works on any result while the round is open.</p>}
        </section>
      ) : (
        <section className="flex flex-col gap-2">
          <DeckKicker>RESULT · BEST OF {bestOf} · SOMEONE MUST WIN</DeckKicker>
          <ScorePad
            format={bestOf === 3 ? "bo3" : "bo1"}
            nameA={row.a.name}
            nameB={row.b?.name ?? "—"}
            layout="row"
            disabled={pending || !desk.reportable}
            onSelect={submit}
          />
          {!desk.reportable && <p className="text-[12px] text-ink-muted">This round isn&apos;t published, so results can&apos;t be reported.</p>}
        </section>
      )}
    </DeckSheet>
  );
}
