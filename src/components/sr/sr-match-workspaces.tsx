"use client";

import { useMemo, useState } from "react";
import { DeckKicker, DeckSheet, ScorePad, useNow, type ScorePadScore } from "@/components/control-deck";
import { cn } from "@/lib/utils";
import type { SrMatch } from "@/types/sr-tournament";
import { srMatchLabel, srQueue, srScorePadFormat, srTeamName, srUbr1Reveal, type SrQueueRow } from "./sr-deck-model";
import { SrActivity, SrHeader, srButton, srQuietButton, type SrWorkspaceProps } from "./sr-setup-workspace";

/** Report a final series score. The pad only offers scores that can end the match's own best_of. */
function useReport({ run, actions }: Pick<SrWorkspaceProps, "run" | "actions">) {
  return async (m: SrMatch, score: ScorePadScore) => {
    const done = await run(async () => {
      await actions.reportMatchResult(m.id, score.gamesA, score.gamesB);
      return true;
    });
    return done === true;
  };
}

const seedTag = (seed: number | null) =>
  seed === null ? null : <span className="font-mono text-[14px] font-normal text-ink-muted">#{seed}</span>;

const scoreText = (m: SrMatch) => `${Math.max(m.team_a_score, m.team_b_score)}–${Math.min(m.team_a_score, m.team_b_score)}`;

function padNote(m: SrMatch): string {
  return m.best_of === 1 ? "Pick the winner." : `Only scores that can end a Bo${m.best_of} are offered.`;
}

/**
 * Bracket and Live: the match queue (sr-desk-live.html).
 *
 * - Now playing: the featured match (active_match_id) with a ScorePad for its
 *   own best_of. There is no per-game score, start time or room in SR (a
 *   correction to the reference; see RIFTBOUND-LOG Task 12).
 * - Up next: both teams known, in bracket order, with readiness and Start
 *   (which features the match on the live screen).
 * - Waiting on results: a team still depends on another result.
 * - Open full bracket: the old bracket panel in a sheet (report any ready
 *   match, Undo, not-yet-playable and byes).
 */
export function SrMatchQueueWorkspace(props: SrWorkspaceProps) {
  const { state, run, pending, actions } = props;
  const t = state.tournament;
  const q = useMemo(() => srQueue(state), [state]);
  const report = useReport({ run, actions });
  const [bracketOpen, setBracketOpen] = useState(false);
  const np = q.nowPlaying;
  const isBracketPhase = t.status === "bracket_published";
  const reveal = srUbr1Reveal(state, useNow(1000) ?? 0);

  return (
    <>
      <SrHeader
        kicker={isBracketPhase ? "MATCH QUEUE · BRACKET PUBLISHED" : "MATCH QUEUE"}
        title="What's happening now"
        aside={
          <button type="button" onClick={() => setBracketOpen(true)} className="text-[13px] text-link hover:text-ink">
            Open full bracket →
          </button>
        }
      />
      {isBracketPhase && (
        <p className="text-[13px] text-ink-secondary">
          {reveal.total > 0 && !reveal.started ? "Run the UBR1 reveal on the live screen, then start the first match. " : ""}
          Live starts with the first reported result.
        </p>
      )}

      {np ? (
        <section aria-label="Now playing" className="flex flex-col gap-3.5 border border-brand-blue-bright bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-[12px] uppercase text-link">
              NOW PLAYING · {srMatchLabel(state, np.match, true)} · BO{np.match.best_of}
            </span>
            <button type="button" disabled={pending} onClick={() => void run(() => actions.setActiveMatch(t.id, null))} className={cn(srQuietButton, "h-8")}>
              Take off screen
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <span className="flex-[1_1_200px] text-right font-heading text-[22px] font-semibold">
              {np.nameA} {seedTag(np.seedA)}
            </span>
            <span className="font-display text-[40px] leading-none text-ink-muted">VS</span>
            <span className="flex-[1_1_200px] font-heading text-[22px] font-semibold">
              {seedTag(np.seedB)} {np.nameB}
            </span>
          </div>
          <ScorePad
            format={srScorePadFormat(np.match)}
            nameA={np.nameA}
            nameB={np.nameB}
            layout="row"
            disabled={pending}
            onSelect={(score) => void report(np.match, score)}
          />
          <span className="text-[12px] text-ink-muted">{padNote(np.match)}</span>
        </section>
      ) : (
        <p className="border border-dashed border-line-strong p-4 text-[13px] text-ink-secondary">
          Nothing on screen.{" "}
          {q.upNext.length > 0 ? "Start the next match from the queue below." : "No match is ready to start."}
        </p>
      )}

      <section aria-label="Up next" className="flex flex-col gap-2">
        <DeckKicker>UP NEXT</DeckKicker>
        {q.upNext.length === 0 ? (
          <p className="text-[13px] text-ink-muted">Nothing else is ready.</p>
        ) : (
          q.upNext.map((row) => (
            <div key={row.match.id} data-match={row.match.id} className="flex flex-wrap items-center gap-3.5 border border-line bg-surface px-3.5 py-3">
              <span className="w-[120px] font-mono text-[12px] uppercase text-ink-secondary">{row.label}</span>
              <span className="min-w-0 flex-[1_1_260px] text-[15px]">
                {row.nameA} <span className="text-ink-muted">vs</span> {row.nameB}
              </span>
              <span className={cn("text-[12px]", row.ready ? "text-success-ink" : "text-ink-secondary")}>{row.readiness}</span>
              <button
                type="button"
                disabled={pending}
                onClick={() => void run(() => actions.setActiveMatch(t.id, row.match.id))}
                className={srQuietButton}
              >
                Start
              </button>
            </div>
          ))
        )}
      </section>

      {q.waiting.length > 0 && (
        <section aria-label="Waiting on results" className="flex flex-col gap-2">
          <DeckKicker>WAITING ON RESULTS</DeckKicker>
          {q.waiting.map((row) => (
            <div key={row.match.id} className="flex flex-wrap gap-3.5 border border-dashed border-line-strong px-3.5 py-2.5 text-ink-secondary">
              <span className="w-[120px] font-mono text-[12px] uppercase">{row.label}</span>
              <span className="text-[14px]">
                {row.nameA} vs {row.nameB}
              </span>
            </div>
          ))}
        </section>
      )}

      {q.done.length > 0 && (
        <section aria-label="Latest results" className="flex flex-col gap-2">
          <DeckKicker>LATEST RESULTS · {q.done.length} REPORTED</DeckKicker>
          <ul className="flex flex-col gap-1.5">
            {q.done.slice(0, 3).map((row) => (
              <DoneRow key={row.match.id} row={row} pending={pending} onUndo={() => void run(() => actions.undoMatchResult(row.match.id))} />
            ))}
          </ul>
          {q.done.length > 3 && (
            <button type="button" onClick={() => setBracketOpen(true)} className="self-start text-[12px] text-link hover:text-ink">
              All {q.done.length} results in the full bracket →
            </button>
          )}
        </section>
      )}

      <SrActivity state={state} />
      {bracketOpen && <BracketSheet {...props} onClose={() => setBracketOpen(false)} />}
    </>
  );
}

function DoneRow({ row, pending, onUndo }: { row: SrQueueRow; pending: boolean; onUndo: () => void }) {
  const m = row.match;
  const aWon = m.winner_id === m.team_a_id;
  return (
    <li data-match={m.id} className="flex flex-wrap items-center gap-3 border border-line bg-surface px-3.5 py-2 text-[14px]">
      <span className="w-[120px] font-mono text-[12px] uppercase text-ink-muted">{row.label}</span>
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

/** The existing bracket panel, in a sheet: every ready match with its pad, reported results with Undo, the rest. */
function BracketSheet({ state, run, pending, actions, onClose }: SrWorkspaceProps & { onClose: () => void }) {
  const q = useMemo(() => srQueue(state), [state]);
  const report = useReport({ run, actions });
  const champion = state.teams.find((x) => x.id === state.tournament.champion_team_id) ?? null;
  const ready = [q.nowPlaying, ...q.upNext].filter(Boolean) as SrQueueRow[];
  const byes = state.matches.filter((m) => m.status === "bye");

  return (
    <DeckSheet kicker={`FULL BRACKET · ${state.matches.length} MATCHES`} title={state.tournament.name} onClose={onClose}>
      {champion && (
        <section className="flex flex-col gap-1 border border-brand-red bg-onair-surface p-3">
          <DeckKicker>CHAMPION</DeckKicker>
          <p className="font-display text-[32px] leading-none">{champion.name}</p>
        </section>
      )}

      <section className="flex flex-col gap-2" aria-label="Ready to report">
        <DeckKicker>READY TO REPORT · {ready.length}</DeckKicker>
        {ready.length === 0 && <p className="text-[13px] text-ink-muted">Nothing is playable right now.</p>}
        {ready.map((row) => (
          <div key={row.match.id} className="flex flex-col gap-2 border border-line-strong bg-surface p-3">
            <span className="font-mono text-[12px] uppercase text-ink-muted">
              {row.label} · Bo{row.match.best_of}
              {row.match.id === state.tournament.active_match_id ? " · ON SCREEN" : ""}
            </span>
            <p className="font-heading text-[16px] font-semibold">
              {row.nameA} <span className="font-normal text-ink-muted">vs</span> {row.nameB}
            </p>
            <ScorePad
              format={srScorePadFormat(row.match)}
              nameA={row.nameA}
              nameB={row.nameB}
              layout="pairs"
              disabled={pending}
              onSelect={(score) => void report(row.match, score)}
            />
          </div>
        ))}
      </section>

      {q.done.length > 0 && (
        <section className="flex flex-col gap-2" aria-label="Reported">
          <DeckKicker>REPORTED · {q.done.length}</DeckKicker>
          <ul className="flex flex-col gap-1.5">
            {q.done.map((row) => (
              <DoneRow key={row.match.id} row={row} pending={pending} onUndo={() => void run(() => actions.undoMatchResult(row.match.id))} />
            ))}
          </ul>
          <p className="text-[12px] text-ink-muted">
            The server refuses an Undo once a later match already has both teams or a result; the reason shows at the top of the desk.
          </p>
        </section>
      )}

      {(q.waiting.length > 0 || byes.length > 0) && (
        <section className="flex flex-col gap-2" aria-label="Not yet playable">
          <DeckKicker>NOT YET PLAYABLE · {q.waiting.length + byes.length}</DeckKicker>
          <ul className="flex flex-col divide-y divide-line-subtle border border-line bg-surface text-[13px]">
            {q.waiting.map((row) => (
              <li key={row.match.id} className="flex gap-3 px-3 py-2 text-ink-secondary">
                <span className="w-[120px] shrink-0 font-mono text-[12px] uppercase text-ink-muted">{row.label}</span>
                <span className="truncate">
                  {row.nameA} vs {row.nameB}
                </span>
              </li>
            ))}
            {byes.map((m) => (
              <li key={m.id} className="flex gap-3 px-3 py-2 text-ink-secondary">
                <span className="w-[120px] shrink-0 font-mono text-[12px] uppercase text-ink-muted">{srMatchLabel(state, m)}</span>
                <span className="truncate">{srTeamName(state, m.team_a_id ?? m.team_b_id)}</span>
                <span className="ml-auto font-mono text-[11px] uppercase text-ink-muted">bye</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </DeckSheet>
  );
}

/** Complete: the champion, every result (still undoable, as before), and Archive. */
export function SrCompleteWorkspace(props: SrWorkspaceProps) {
  const { state, run, pending, actions } = props;
  const t = state.tournament;
  const q = useMemo(() => srQueue(state), [state]);
  const champion = state.teams.find((x) => x.id === t.champion_team_id) ?? null;
  const players = champion ? state.players.filter((p) => p.team_id === champion.id).map((p) => p.ign) : [];

  return (
    <>
      <SrHeader
        kicker={t.status === "archived" ? "COMPLETE · ARCHIVED" : "COMPLETE"}
        title={champion ? `Champion: ${champion.name}` : "Tournament complete"}
        aside={
          t.status === "completed" ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (window.confirm("Archive this tournament?")) {
                  void run(() => actions.archiveTournament(t.id));
                }
              }}
              className={srButton}
            >
              Archive
            </button>
          ) : undefined
        }
      />
      {champion && (
        <section className="flex flex-col gap-1.5 border border-brand-red bg-onair-surface p-4">
          <DeckKicker>CHAMPION</DeckKicker>
          <p className="font-display text-[40px] leading-none tracking-[0.02em]">{champion.name}</p>
          {players.length > 0 && <p className="text-[13px] text-ink-secondary">{players.join(" · ")}</p>}
        </section>
      )}
      {q.done.length > 0 && (
        <section className="flex flex-col gap-2" aria-label="Results">
          <DeckKicker>RESULTS · {q.done.length}</DeckKicker>
          <ul className="flex flex-col gap-1.5">
            {q.done.map((row) => (
              <DoneRow key={row.match.id} row={row} pending={pending} onUndo={() => void run(() => actions.undoMatchResult(row.match.id))} />
            ))}
          </ul>
        </section>
      )}
      <SrActivity state={state} />
    </>
  );
}
