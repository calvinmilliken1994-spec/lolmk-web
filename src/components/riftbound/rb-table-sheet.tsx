"use client";

import { useState } from "react";
import { DeckKicker, DeckSheet, ScorePad, type DeckRun, type ScorePadScore } from "@/components/control-deck";
import { cn } from "@/lib/utils";
import type { RbMatch, RbRound } from "@/types/riftbound";
import type { RbActions } from "./rb-actions";
import type { RbDeskState } from "./rb-deck-model";
import { FLAG_LABEL, formatDelta, isDeskFlag, isTimeOutResult, kstTime, newDeskKey, openFlags, playerName, resultPhrase } from "./rb-round-model";
import { rbInputClass } from "./rb-ui";

const EXTENSIONS_MS = [60_000, 180_000, 300_000];

const smallButton =
  "h-9 rounded-sm border border-line-strong bg-elevated px-3 text-[13px] text-ink hover:border-brand-blue-bright disabled:cursor-not-allowed disabled:text-ink-disabled disabled:hover:border-line-strong";

/**
 * The table sheet: opens from a tile. ScorePad (Bo3 or Bo1, Riftbound
 * variant), drop toggles, extension controls and a flag to the desk.
 *
 * Mounted per table (keyed by match id), so the idempotency key made here
 * covers every retry of this sheet's submission; reopening the table makes a
 * new one. Forgetting a key would let a double tap record twice; the server
 * ignores a repeat of the same key.
 */
export function RbTableSheet({
  state,
  round,
  match,
  run,
  pending,
  error,
  actions,
  onClose,
}: {
  state: RbDeskState;
  round: RbRound;
  match: RbMatch;
  run: DeckRun;
  pending: boolean;
  error: string | null;
  actions: RbActions;
  onClose: () => void;
}) {
  const bestOf = state.tournament.config.bestOf;
  const [idempotencyKey] = useState(newDeskKey);
  const [dropA, setDropA] = useState(false);
  const [dropB, setDropB] = useState(false);
  const [other, setOther] = useState(false);
  const [games, setGames] = useState({ a: 0, b: 0, drawn: 0 });
  const [note, setNote] = useState("Judge call");

  const nameA = playerName(state, match.player_a_id);
  const nameB = match.player_b_id ? playerName(state, match.player_b_id) : null;
  const playerA = state.players.find((p) => p.id === match.player_a_id);
  const playerB = state.players.find((p) => p.id === match.player_b_id);
  const closed = round.status === "closed";
  const running = round.status === "published" || round.status === "live";
  const flags = match.flags.filter(isDeskFlag);

  const submit = async (score: ScorePadScore) => {
    const result = await run(() =>
      actions.reportResult({
        matchId: match.id,
        gamesA: score.gamesA,
        gamesB: score.gamesB,
        gamesDrawn: score.gamesDrawn,
        decidedOnTime: isTimeOutResult(bestOf, score.gamesA, score.gamesB),
        dropA: dropA && playerA?.status === "active",
        dropB: dropB && playerB?.status === "active",
        idempotencyKey,
      }),
    );
    if (result) onClose();
  };

  const undo = async () => {
    const result = await run(() => actions.undoResult(match.id));
    if (result) onClose();
  };

  const subtitle =
    match.status === "bye"
      ? "Bye"
      : match.status === "completed"
        ? "Reported"
        : round.status === "live"
          ? "Playing"
          : "Clock not started";

  return (
    <DeckSheet
      kicker={`TABLE ${match.table_number} · ROUND ${round.number} · ${subtitle.toUpperCase()}`}
      title={`${nameA} vs ${nameB ?? "—"}`}
      onClose={onClose}
    >
      {error && (
        <p role="alert" className="border border-warning-line-quiet bg-warning-surface-strong px-3 py-2 text-[13px] text-warning-ink">
          {error}
        </p>
      )}

      {match.status === "bye" && (
        <p className="text-[13px] text-ink-secondary">
          {nameA} has a bye. It&apos;s recorded automatically as {state.tournament.config.scoring.byeGamesWon}–
          {state.tournament.config.scoring.byeGamesLost}; nothing to report.
        </p>
      )}

      {match.status === "completed" && (
        <section className="flex flex-col gap-3 border border-line-strong bg-surface p-4">
          <p className="font-heading text-[20px] font-semibold">
            {resultPhrase(nameA, nameB ?? "—", match.games_a, match.games_b, match.decided_on_time && match.games_a !== match.games_b)}
          </p>
          <p className="text-[13px] text-ink-secondary">
            Reported by {match.reported_by_name} at {match.reported_at ? kstTime(match.reported_at) : "?"}
          </p>
          <button type="button" disabled={pending || closed} onClick={undo} className={cn(smallButton, "self-start")}>
            Undo result
          </button>
          {closed && <p className="text-[12px] text-ink-muted">The round is closed, so results can&apos;t be undone.</p>}
        </section>
      )}

      {match.status === "pending" && (
        <>
          <section className="flex flex-col gap-2">
            <DeckKicker>RESULT · BEST OF {bestOf}</DeckKicker>
            <ScorePad
              format={bestOf === 3 ? "bo3" : "bo1"}
              nameA={nameA}
              nameB={nameB ?? "—"}
              riftbound
              layout="row"
              disabled={pending || !running}
              onSelect={submit}
              onOther={() => setOther((v) => !v)}
            />
            {!running && <p className="text-[12px] text-ink-muted">This round isn&apos;t running, so results can&apos;t be reported.</p>}
            {other && (
              <form
                className="flex flex-col gap-3 border border-line-strong bg-surface p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit({ gamesA: games.a, gamesB: games.b, gamesDrawn: games.drawn });
                }}
              >
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      ["a", `${nameA} games`],
                      ["b", `${nameB ?? "B"} games`],
                      ["drawn", "Drawn games"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="flex flex-col gap-1 text-[12px] text-ink-secondary">
                      <span className="truncate">{label}</span>
                      <input
                        type="number"
                        min={0}
                        max={5}
                        value={games[key]}
                        onChange={(e) => setGames({ ...games, [key]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                        className={cn(rbInputClass, "h-10 text-[14px]")}
                      />
                    </label>
                  ))}
                </div>
                <button type="submit" disabled={pending || !running} className={cn(smallButton, "self-start")}>
                  Submit {games.a}–{games.b}
                  {games.drawn ? ` (${games.drawn} drawn)` : ""}
                </button>
              </form>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <DeckKicker>DROPS · TAKE EFFECT WITH THE RESULT</DeckKicker>
            {(
              [
                [nameA, playerA, dropA, setDropA],
                [nameB, playerB, dropB, setDropB],
              ] as const
            ).map(([name, player, value, set]) =>
              name && player ? (
                <label key={player.id} className="flex items-center gap-2 text-[13px] text-ink-secondary">
                  <input
                    type="checkbox"
                    checked={value && player.status === "active"}
                    disabled={player.status !== "active"}
                    onChange={(e) => set(e.target.checked)}
                    className="h-4 w-4 accent-brand-blue-bright"
                  />
                  {name} drops after this round
                  {player.status !== "active" && <span className="text-ink-muted">· already dropped</span>}
                </label>
              ) : null,
            )}
          </section>

          {running && round.duration_ms !== null && (
            <section className="flex flex-col gap-2">
              <DeckKicker>
                EXTENSION{match.extension_ms > 0 ? ` · ${formatDelta(match.extension_ms)} so far` : ""}
              </DeckKicker>
              <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">
                Reason or note
                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className={cn(rbInputClass, "h-10 text-[14px]")} />
              </label>
              <div className="flex flex-wrap gap-2">
                {EXTENSIONS_MS.map((ms) => (
                  <button
                    key={ms}
                    type="button"
                    disabled={pending || !note.trim()}
                    onClick={() => void run(() => actions.addExtension(match.id, ms, note))}
                    className={smallButton}
                  >
                    {formatDelta(ms)}
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {match.status !== "bye" && !closed && (
        <section className="flex flex-col gap-2">
          <DeckKicker>FLAG TO DESK</DeckKicker>
          <div className="flex flex-wrap gap-2">
            {(["judge_call", "dispute"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                disabled={pending}
                onClick={() => void run(() => actions.flagTable(match.id, kind, match.status === "pending" ? note : ""))}
                className={smallButton}
              >
                {FLAG_LABEL[kind]}
              </button>
            ))}
          </div>
        </section>
      )}

      {flags.length > 0 && (
        <section className="flex flex-col gap-2">
          <DeckKicker>FLAGS</DeckKicker>
          {flags.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center gap-2 border border-line-strong bg-surface px-3 py-2 text-[13px]">
              <span className="font-mono text-[11px] font-semibold text-warning-ink">{FLAG_LABEL[f.kind].toUpperCase()}</span>
              <span className="flex-1 text-ink-secondary">
                {f.note || "No note"} · {f.raised_by_name}
              </span>
              {f.acknowledged_at ? (
                <span className="text-[12px] text-ink-muted">Acknowledged by {f.acknowledged_by_name}</span>
              ) : (
                <button type="button" disabled={pending} onClick={() => void run(() => actions.acknowledgeFlag(match.id, f.id))} className={smallButton}>
                  Acknowledge
                </button>
              )}
            </div>
          ))}
          {openFlags(match).length === 0 && <p className="text-[12px] text-ink-muted">Every flag on this table is acknowledged.</p>}
        </section>
      )}
    </DeckSheet>
  );
}
