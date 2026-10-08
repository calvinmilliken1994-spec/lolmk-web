"use client";

import { useMemo, useState } from "react";
import { ActivityLog, DeckKicker, DeckSheet, ScorePad, type ScorePadScore } from "@/components/control-deck";
import { cn } from "@/lib/utils";
import type { MayhemMatch } from "@/types/mayhem";
import { mhButton, mhSubmit, type MayhemWorkspaceProps } from "./mayhem-entrants-workspace";
import {
  mayhemActivity,
  mayhemGroupRows,
  mayhemQueue,
  mayhemTeamName,
  scorePadFormat,
  type MayhemQueueRow,
} from "./mayhem-deck-model";

/**
 * Report a result from a ScorePad. Bo1 goes through reportBo1Winner (the
 * one-click winner action), Bo3/Bo5 through recordMatchResult. The pad only
 * offers winning final scores for the match's own best_of, so a draw or an
 * impossible score can't be sent.
 */
function useReport({ run, actions }: Pick<MayhemWorkspaceProps, "run" | "actions">) {
  return (m: MayhemMatch, score: ScorePadScore) =>
    run(async () => {
      if (m.best_of === 1) {
        const winner = score.gamesA > score.gamesB ? m.team_a_id : m.team_b_id;
        await actions.reportBo1Winner(m.id, winner as string);
      } else {
        await actions.recordMatchResult(m.id, score.gamesA, score.gamesB);
      }
      return true;
    });
}

const chip = (status: MayhemQueueRow["status"]) => {
  const tone =
    status === "on_screen"
      ? "border-brand-red bg-onair-surface text-ink"
      : status === "ready"
        ? "border-brand-blue-bright text-ink-secondary"
        : "border-line-strong text-ink-muted";
  const label = { on_screen: "ON SCREEN", ready: "READY", waiting: "WAITING", done: "DONE", bye: "BYE" }[status];
  return (
    <span className={cn("shrink-0 rounded-sm border px-2 py-0.5 font-mono text-[11px] tracking-[0.08em]", tone)}>{label}</span>
  );
};

const scoreText = (m: MayhemMatch) =>
  m.best_of === 1 ? "W" : `${Math.max(m.team_a_score, m.team_b_score)}–${Math.min(m.team_a_score, m.team_b_score)}`;

/** One reported match: winner beat loser, score, Undo. */
function DoneRow({
  row,
  pending,
  onUndo,
}: {
  row: MayhemQueueRow;
  pending: boolean;
  onUndo: () => void;
}) {
  const m = row.match;
  const aWon = m.winner_id === m.team_a_id;
  return (
    <li data-match={m.match_number} className="flex flex-wrap items-center gap-3 border border-line bg-surface px-4 py-2 text-[14px]">
      <span className="w-12 font-mono text-[12px] text-ink-muted">M{m.match_number}</span>
      <span className="w-28 truncate font-mono text-[11px] text-ink-muted">{row.where}</span>
      <span className="min-w-0 flex-1">
        <span className="font-semibold">{aWon ? row.nameA : row.nameB}</span>
        <span className="text-ink-muted"> beat </span>
        <span className="text-ink-secondary">{aWon ? row.nameB : row.nameA}</span>
      </span>
      <span className="font-mono text-[13px]">{scoreText(m)}</span>
      <button type="button" disabled={pending} onClick={onUndo} className="text-[12px] text-ink-secondary underline disabled:opacity-50">
        Undo
      </button>
    </li>
  );
}

function QueueRow({
  row,
  pending,
  onToggleScreen,
  onReport,
}: {
  row: MayhemQueueRow;
  pending: boolean;
  onToggleScreen?: () => void;
  onReport?: () => void;
}) {
  const m = row.match;
  return (
    <li
      data-match={m.match_number}
      className={cn(
        "flex flex-wrap items-center gap-3 border bg-surface px-4 py-3",
        row.status === "on_screen" ? "border-brand-red" : row.status === "waiting" ? "border-dashed border-line-strong" : "border-line-strong",
      )}
    >
      <span className="w-12 font-mono text-[12px] text-ink-muted">M{m.match_number}</span>
      <span className="w-28 truncate font-mono text-[11px] text-ink-muted">
        {row.where} · Bo{m.best_of}
      </span>
      <span className={cn("min-w-0 flex-1 font-heading text-[17px] font-semibold", row.status === "waiting" && "text-ink-muted")}>
        {row.nameA}
        <span className="px-2 font-normal text-ink-muted">vs</span>
        {row.nameB}
      </span>
      {chip(row.status)}
      {onToggleScreen && (
        <button type="button" disabled={pending} onClick={onToggleScreen} className={mhButton}>
          {row.status === "on_screen" ? "Take off screen" : "Put on screen"}
        </button>
      )}
      {onReport && (
        <button type="button" disabled={pending} onClick={onReport} className={mhSubmit}>
          Report result
        </button>
      )}
    </li>
  );
}

function ReportSheet({
  row,
  state,
  run,
  pending,
  actions,
  onClose,
}: MayhemWorkspaceProps & { row: MayhemQueueRow; onClose: () => void }) {
  const report = useReport({ run, actions });
  const m = row.match;
  return (
    <DeckSheet kicker={`M${m.match_number} · ${row.where.toUpperCase()} · BEST OF ${m.best_of}`} title={`${row.nameA} vs ${row.nameB}`} onClose={onClose}>
      <section className="flex flex-col gap-2">
        <DeckKicker>RESULT · {m.best_of === 1 ? "WHO WON" : "FINAL SCORE"} · NO DRAWS</DeckKicker>
        <ScorePad
          format={scorePadFormat(m)}
          nameA={mayhemTeamName(state, m.team_a_id)}
          nameB={mayhemTeamName(state, m.team_b_id)}
          layout="pairs"
          disabled={pending}
          onSelect={async (score) => {
            if (await report(m, score)) onClose();
          }}
        />
      </section>
    </DeckSheet>
  );
}

function Activity({ state }: Pick<MayhemWorkspaceProps, "state">) {
  const rows = useMemo(() => mayhemActivity(state), [state]);
  if (rows.length === 0) return null;
  return <ActivityLog entries={rows.slice(0, 12)} />;
}

/**
 * Knockout phase: the match queue. The match on the venue screen first, with
 * its ScorePad inline; then the playable matches (put one on screen, or
 * report straight from the sheet); then the ones waiting on earlier results,
 * then reported results with Undo.
 */
export function MayhemKnockoutWorkspace(props: MayhemWorkspaceProps) {
  const { state, run, pending, actions } = props;
  const queue = useMemo(() => mayhemQueue(state, "knockout"), [state]);
  const [openId, setOpenId] = useState<string | null>(null);
  const report = useReport({ run, actions });
  const all = [queue.onScreen, ...queue.ready].filter(Boolean) as MayhemQueueRow[];
  const open = all.find((r) => r.match.id === openId) ?? null;
  const total = queue.ready.length + queue.waiting.length + queue.done.length + (queue.onScreen ? 1 : 0);
  const k = state.event.format.knockout;

  if (total === 0) {
    return (
      <>
        <Header kicker="KNOCKOUT · NOT SEEDED" title="Knockout" />
        <div className="flex flex-col items-start gap-3 border border-dashed border-line-strong p-4 text-[13px] text-ink-secondary">
          <p>
            No knockout bracket yet.{" "}
            {state.event.format.groupStage.enabled
              ? "Finish the group stage and seed from standings, or seed directly from all teams."
              : "Seed directly from all teams (sorted by seed)."}
          </p>
          <button
            type="button"
            disabled={pending || state.teams.length === 0}
            onClick={() => void run(() => actions.generateKnockoutFromAllTeams())}
            className={mhSubmit}
          >
            Generate knockout bracket
          </button>
        </div>
        <Activity state={state} />
      </>
    );
  }

  const os = queue.onScreen;
  return (
    <>
      <Header
        kicker={`KNOCKOUT · ${k.doubleElimination ? "DOUBLE ELIMINATION" : "SINGLE ELIMINATION"} · BEST OF ${k.seriesLength}`}
        title={`${queue.done.length} of ${total} matches played`}
      />

      <section className="flex flex-col gap-2" aria-label="On screen">
        <DeckKicker>ON SCREEN</DeckKicker>
        {os ? (
          <div className="flex flex-col gap-3 border border-brand-red bg-surface p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-[12px] text-ink-muted">
                M{os.match.match_number} · {os.where} · Bo{os.match.best_of}
              </span>
              <span className="min-w-0 flex-1 font-heading text-[20px] font-semibold">
                {os.nameA}
                <span className="px-2 font-normal text-ink-muted">vs</span>
                {os.nameB}
              </span>
              <button type="button" disabled={pending} onClick={() => void run(() => actions.setActiveMatch(null))} className={mhButton}>
                Take off screen
              </button>
            </div>
            <ScorePad
              format={scorePadFormat(os.match)}
              nameA={os.nameA}
              nameB={os.nameB}
              layout="row"
              disabled={pending}
              onSelect={(score) => void report(os.match, score)}
            />
          </div>
        ) : (
          <p className="border border-dashed border-line-strong p-3 text-[13px] text-ink-muted">
            No match on screen. Put the next one up from the queue.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-label="Match queue">
        <DeckKicker>
          UP NEXT · {queue.ready.length} READY{queue.waiting.length > 0 ? ` · ${queue.waiting.length} WAITING` : ""}
        </DeckKicker>
        {queue.ready.length === 0 && queue.waiting.length === 0 ? (
          <p className="text-[13px] text-ink-muted">Nothing else to play.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {queue.ready.map((row) => (
              <QueueRow
                key={row.match.id}
                row={row}
                pending={pending}
                onToggleScreen={() => void run(() => actions.setActiveMatch(row.match.id))}
                onReport={() => setOpenId(row.match.id)}
              />
            ))}
            {queue.waiting.map((row) => (
              <QueueRow key={row.match.id} row={row} pending={pending} />
            ))}
          </ul>
        )}
      </section>

      {queue.done.length > 0 && (
        <section className="flex flex-col gap-2" aria-label="Reported">
          <DeckKicker>REPORTED · {queue.done.length}</DeckKicker>
          <ul className="flex flex-col gap-1.5">
            {queue.done.map((row) => (
              <DoneRow key={row.match.id} row={row} pending={pending} onUndo={() => void run(() => actions.undoMatchResult(row.match.id))} />
            ))}
          </ul>
        </section>
      )}

      <Activity state={state} />
      {open && <ReportSheet {...props} row={open} onClose={() => setOpenId(null)} />}
    </>
  );
}

function Header({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div>
      <DeckKicker className="text-brand-red-bright">{kicker}</DeckKicker>
      <h2 className="mt-1 font-heading text-[24px] font-semibold">{title}</h2>
    </div>
  );
}

/** Groups phase: each group's teams and round-robin matches, reported with the ScorePad. */
export function MayhemGroupsWorkspace(props: MayhemWorkspaceProps) {
  const { state, run, pending, actions } = props;
  const [openId, setOpenId] = useState<string | null>(null);
  const g = state.event.format.groupStage;
  const rowsByGroup = useMemo(() => state.groups.map((gr) => ({ group: gr, rows: mayhemGroupRows(state, gr.id) })), [state]);
  const open = rowsByGroup.flatMap((x) => x.rows).find((r) => r.match.id === openId) ?? null;

  if (!g.enabled) {
    return (
      <>
        <Header kicker="GROUPS · OFF" title="Groups are off" />
        <p className="text-[13px] text-ink-secondary">The group stage is disabled for this event. Turn it on under Entrants → Format.</p>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <Header
          kicker={`GROUPS · ${g.groupCount} GROUPS · BO${g.seriesLength} · TOP ${g.advancePerGroup} ADVANCE`}
          title={state.groups.length === 0 ? "No groups yet" : `${state.groups.length} groups`}
        />
        {state.teams.length > 0 && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (state.groups.length === 0 || window.confirm("Regenerate groups? Group results so far are erased.")) {
                void run(() => actions.generateGroups());
              }
            }}
            className={mhButton}
          >
            {state.groups.length > 0 ? "Regenerate groups" : "Generate groups"}
          </button>
        )}
      </div>

      {state.teams.length === 0 ? (
        <p className="text-[13px] text-ink-secondary">Randomize teams first.</p>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {rowsByGroup.map(({ group, rows }) => (
            <section key={group.id} className="flex min-w-0 flex-col gap-2 border border-line-strong bg-surface p-3">
              <p className="font-heading text-[16px] font-semibold">{group.label}</p>
              <p className="text-[12px] text-ink-muted">
                {state.teams.filter((t) => t.group_id === group.id).map((t) => t.name).join(" · ")}
              </p>
              <ul className="flex flex-col gap-1.5">
                {rows.map((row) =>
                  row.status === "done" ? (
                    <DoneRow key={row.match.id} row={row} pending={pending} onUndo={() => void run(() => actions.undoMatchResult(row.match.id))} />
                  ) : (
                    <QueueRow
                      key={row.match.id}
                      row={row}
                      pending={pending}
                      onToggleScreen={
                        row.status === "waiting" || row.status === "bye"
                          ? undefined
                          : () => void run(() => actions.setActiveMatch(row.status === "on_screen" ? null : row.match.id))
                      }
                      onReport={row.status === "waiting" || row.status === "bye" ? undefined : () => setOpenId(row.match.id)}
                    />
                  ),
                )}
              </ul>
            </section>
          ))}
        </div>
      )}

      <Activity state={state} />
      {open && <ReportSheet {...props} row={open} onClose={() => setOpenId(null)} />}
    </>
  );
}

/** Complete: the champion and every knockout result (still undoable, as before). */
export function MayhemCompleteWorkspace({ state, run, pending, actions }: MayhemWorkspaceProps) {
  const queue = useMemo(() => mayhemQueue(state, "knockout"), [state]);
  const champion = state.teams.find((t) => t.id === state.event.champion_team_id) ?? null;
  return (
    <>
      <Header kicker="COMPLETE" title={champion ? `Champion: ${champion.name}` : "Event complete"} />
      {champion && (
        <section className="flex flex-col gap-1.5 border border-brand-red bg-onair-surface p-4">
          <DeckKicker>CHAMPION</DeckKicker>
          <p className="font-display text-[40px] leading-none tracking-[0.02em]">{champion.name}</p>
          <p className="text-[13px] text-ink-secondary">{champion.players.map((p) => p.display_name).join(" · ")}</p>
        </section>
      )}
      {queue.done.length > 0 && (
        <section className="flex flex-col gap-2" aria-label="Results">
          <DeckKicker>RESULTS · {queue.done.length}</DeckKicker>
          <ul className="flex flex-col gap-1.5">
            {queue.done.map((row) => (
              <DoneRow key={row.match.id} row={row} pending={pending} onUndo={() => void run(() => actions.undoMatchResult(row.match.id))} />
            ))}
          </ul>
        </section>
      )}
      <Activity state={state} />
    </>
  );
}
