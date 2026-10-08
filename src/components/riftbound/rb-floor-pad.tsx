"use client";

import { useState, type ReactNode } from "react";
import { ScorePad, type DeckRun, type ScorePadScore } from "@/components/control-deck";
import { cn } from "@/lib/utils";
import type { RbDeskFlagKind, RbJudge, RbMatch, RbRound } from "@/types/riftbound";
import type { RbActions } from "./rb-actions";
import type { RbDeskState } from "./rb-deck-model";
import {
  rbDecidedOnTime,
  rbFloorRow,
  rbGoingIn,
  rbReview,
  rbShortId,
  type RbReview,
} from "./rb-floor-model";
import { FLAG_LABEL, formatDelta, playerName } from "./rb-round-model";

/** What the judge has set on the score pad for one table. Lives in the floor so Back from the review keeps it. */
export interface RbPadDraft {
  matchId: string;
  /** Made when the pad opens; the same key covers the submission and every retry of it. */
  key: string;
  decidedOnTime: boolean;
  dropA: boolean;
  dropB: boolean;
}

const FLAG_KINDS: RbDeskFlagKind[] = ["no_show", "judge_call", "deck_check", "head_judge"];
const EXTENSIONS_MS = [60_000, 180_000, 300_000];

const backLink = "flex min-h-11 items-center text-[14px] text-link";

/** Header bar shared by the pad and the review: back link on the left, something on the right. */
function BarHeader({ back, onBack, children }: { back: string; onBack: () => void; children: ReactNode }) {
  return (
    <header className="flex items-center justify-between border-b border-line-strong bg-surface px-4 py-3.5">
      <button type="button" onClick={onBack} className={backLink}>
        ‹ {back}
      </button>
      {children}
    </header>
  );
}

/** A bottom sheet over the floor (extension, flag, other score). Esc and the backdrop close it. */
function FloorSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default bg-base/80" />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex w-full max-w-[480px] flex-col gap-3 border-t border-line-strong bg-deck-rail p-4 pb-6"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-[18px] font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="min-h-11 px-3 text-[14px] text-link">
            Close
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

const sheetButton =
  "flex h-12 items-center justify-center rounded-sm border border-line-strong bg-elevated px-3 text-[15px] text-ink disabled:cursor-not-allowed disabled:opacity-50";

function Toggle({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-3 text-[15px]">
      {label}
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-[22px] w-[22px] shrink-0 accent-brand-blue-bright"
      />
    </label>
  );
}

function Stepper({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 text-[15px]">
      <span>{label}</span>
      <span className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`${label}: one less`}
          disabled={value <= 0}
          onClick={() => onChange(value - 1)}
          className="h-11 w-11 rounded-sm border border-line-strong bg-elevated text-[20px] disabled:opacity-40"
        >
          −
        </button>
        <span className="w-6 text-center font-mono text-[20px]">{value}</span>
        <button
          type="button"
          aria-label={`${label}: one more`}
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
          className="h-11 w-11 rounded-sm border border-line-strong bg-elevated text-[20px] disabled:opacity-40"
        >
          +
        </button>
      </span>
    </div>
  );
}

/**
 * Score pad (judge-score-pad): the two players with their records going in,
 * the Riftbound ScorePad, the on-time and drop toggles, + Extension and Flag
 * to desk. Picking a score goes to the review card; nothing is sent here.
 */
export function RbFloorPad({
  state,
  round,
  match,
  now,
  judge,
  adminName,
  clock,
  draft,
  onDraft,
  onBack,
  onScore,
  run,
  pending,
  error,
  actions,
}: {
  state: RbDeskState;
  round: RbRound;
  match: RbMatch;
  now: number | null;
  judge: RbJudge | null;
  adminName: string;
  clock: string;
  draft: RbPadDraft;
  onDraft: (d: RbPadDraft) => void;
  onBack: () => void;
  onScore: (score: ScorePadScore) => void;
  run: DeckRun;
  pending: boolean;
  error: string | null;
  actions: RbActions;
}) {
  const bestOf = state.tournament.config.bestOf;
  const playerA = state.players.find((p) => p.id === match.player_a_id);
  const playerB = state.players.find((p) => p.id === match.player_b_id);
  const nameA = playerName(state, match.player_a_id);
  const nameB = playerName(state, match.player_b_id);
  const row = rbFloorRow(state, round, match, now, judge, adminName);
  const [sheet, setSheet] = useState<null | "extension" | "flag" | "other">(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [games, setGames] = useState({ a: 0, b: 0, drawn: 0 });
  const need = bestOf === 3 ? 2 : 1;
  const otherInvalid = games.a === need && games.b === need;

  const extend = async (ms: number) => {
    const ok = await run(() => actions.addExtension(match.id, ms, "Judge extension"));
    if (ok) {
      setNotice(`Table ${match.table_number}: ${formatDelta(ms)} added`);
      setSheet(null);
    }
  };
  const flag = async (kind: RbDeskFlagKind) => {
    const ok = await run(() => actions.flagTable(match.id, kind, ""));
    if (ok) {
      setNotice(`Flagged to the desk: ${FLAG_LABEL[kind]}`);
      setSheet(null);
    }
  };

  return (
    <>
      <BarHeader back="Tables" onBack={onBack}>
        <span className="font-display text-[30px] leading-none tabular-nums">{clock}</span>
      </BarHeader>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div>
          <p className="font-mono text-[12px] text-ink-secondary">
            ROUND {round.number} · BO{bestOf}
          </p>
          <p className="mt-0.5 font-heading text-[28px] font-bold">Table {match.table_number}</p>
          {(row.kind === "flagged" || match.extension_ms > 0) && (
            <p className={cn("mt-1 text-[13px]", row.kind === "flagged" ? "text-warning-ink" : "text-ink-secondary")}>{row.line}</p>
          )}
          {notice && (
            <p role="status" className="mt-1 text-[13px] text-success-ink">
              {notice}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["PLAYER A", nameA, playerA],
              ["PLAYER B", nameB, playerB],
            ] as const
          ).map(([kicker, name, player]) => (
            <div key={kicker} className="min-w-0 border border-line-strong bg-surface p-3">
              <span className="font-mono text-[11px] text-ink-muted">{kicker}</span>
              <p className="mt-1 truncate text-[20px] font-semibold">{name}</p>
              <p className="mt-0.5 text-[12px] text-ink-secondary">{rbGoingIn(state, player)}</p>
            </div>
          ))}
        </div>

        <ScorePad
          format={bestOf === 3 ? "bo3" : "bo1"}
          nameA={nameA}
          nameB={nameB}
          riftbound
          layout="pairs"
          onSelect={onScore}
          onOther={() => setSheet("other")}
        />

        <div className="flex flex-col gap-1 border-t border-line pt-3">
          <Toggle label="Decided on time" checked={draft.decidedOnTime} onChange={(v) => onDraft({ ...draft, decidedOnTime: v })} />
          {playerA?.status === "active" && (
            <Toggle label={`${nameA} drops after this round`} checked={draft.dropA} onChange={(v) => onDraft({ ...draft, dropA: v })} />
          )}
          {playerB?.status === "active" && (
            <Toggle label={`${nameB} drops after this round`} checked={draft.dropB} onChange={(v) => onDraft({ ...draft, dropB: v })} />
          )}
        </div>

        <div className="mt-auto grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setSheet("extension")}
            className="h-12 rounded-sm border border-line-strong bg-transparent text-[14px] text-ink"
          >
            + Extension
          </button>
          <button
            type="button"
            onClick={() => setSheet("flag")}
            className="h-12 rounded-sm border border-warning-line bg-warning-surface-strong text-[14px] text-warning-ink"
          >
            Flag to desk
          </button>
        </div>
      </div>

      {sheet === "extension" && (
        <FloorSheet title={`Extension · Table ${match.table_number}`} onClose={() => setSheet(null)}>
          <p className="text-[13px] text-ink-secondary">
            Adds time to this table only{match.extension_ms > 0 ? ` (already ${formatDelta(match.extension_ms)})` : ""}.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {EXTENSIONS_MS.map((ms) => (
              <button key={ms} type="button" disabled={pending} onClick={() => void extend(ms)} className={sheetButton}>
                {formatDelta(ms)}
              </button>
            ))}
          </div>
          {error && <p role="alert" className="text-[13px] text-brand-red-bright">{error}</p>}
        </FloorSheet>
      )}

      {sheet === "flag" && (
        <FloorSheet title={`Flag to desk · Table ${match.table_number}`} onClose={() => setSheet(null)}>
          <div className="grid grid-cols-2 gap-2">
            {FLAG_KINDS.map((kind) => (
              <button key={kind} type="button" disabled={pending} onClick={() => void flag(kind)} className={sheetButton}>
                {FLAG_LABEL[kind]}
              </button>
            ))}
          </div>
          {error && <p role="alert" className="text-[13px] text-brand-red-bright">{error}</p>}
        </FloorSheet>
      )}

      {sheet === "other" && (
        <FloorSheet title="Other result" onClose={() => setSheet(null)}>
          <div className="flex flex-col">
            <Stepper label={`${nameA} games`} value={games.a} max={need} onChange={(a) => setGames({ ...games, a })} />
            <Stepper label={`${nameB} games`} value={games.b} max={need} onChange={(b) => setGames({ ...games, b })} />
            <Stepper label="Drawn games" value={games.drawn} max={5} onChange={(drawn) => setGames({ ...games, drawn })} />
          </div>
          {otherInvalid && <p className="text-[13px] text-brand-red-bright">Only one player can reach {need} win(s).</p>}
          <button
            type="button"
            disabled={otherInvalid}
            onClick={() => {
              setSheet(null);
              onScore({ gamesA: games.a, gamesB: games.b, gamesDrawn: games.drawn });
            }}
            className="h-12 rounded-sm border border-brand-blue-bright bg-brand-blue-muted text-[16px] font-semibold text-ink disabled:opacity-50"
          >
            Review result
          </button>
        </FloorSheet>
      )}
    </>
  );
}

/**
 * Review card (judge-review): the result large enough for both players to
 * read across the table, the one deliberate confirmation, then Submit.
 * Submitting hands the submission to the queue and returns to the list; the
 * queue shows Sending / Sent / Failed from there.
 */
export function RbFloorReview({
  state,
  round,
  match,
  score,
  draft,
  adminName,
  submitted,
  onBack,
  onSubmit,
}: {
  state: RbDeskState;
  round: RbRound;
  match: RbMatch;
  score: ScorePadScore;
  draft: RbPadDraft;
  adminName: string;
  submitted: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const bestOf = state.tournament.config.bestOf;
  const nameA = playerName(state, match.player_a_id);
  const nameB = playerName(state, match.player_b_id);
  const onTime = rbDecidedOnTime(bestOf, score.gamesA, score.gamesB, draft.decidedOnTime);
  const r: RbReview = rbReview(nameA, nameB, score, onTime, draft.dropA, draft.dropB);
  return (
    <>
      <BarHeader back="Change" onBack={onBack}>
        <span className="font-mono text-[12px] text-ink-secondary">SHOW BOTH PLAYERS</span>
      </BarHeader>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-5">
        <div className="flex flex-col items-center gap-3.5 border-2 border-brand-blue-bright bg-surface px-5 py-6 text-center">
          <span className="font-mono text-[13px] tracking-[0.06em] text-ink-secondary">
            ROUND {round.number} · TABLE {match.table_number}
          </span>
          <span className="font-heading text-[34px] font-bold leading-[1.1]">{r.headline}</span>
          <div className="flex items-center gap-[18px]">
            <span className="flex min-w-0 flex-col items-center">
              <span className={cn("font-display text-[96px] leading-[0.9]", r.winner === "b" && "text-ink-secondary")}>{r.gamesA}</span>
              <span className={cn("max-w-[120px] truncate text-[16px]", r.winner === "b" && "text-ink-secondary")}>{r.nameA}</span>
            </span>
            <span className="font-display text-[48px] text-ink-muted">–</span>
            <span className="flex min-w-0 flex-col items-center">
              <span className={cn("font-display text-[96px] leading-[0.9]", r.winner !== "b" && "text-ink-secondary")}>{r.gamesB}</span>
              <span className={cn("max-w-[120px] truncate text-[16px]", r.winner !== "b" && "text-ink-secondary")}>{r.nameB}</span>
            </span>
          </div>
          <div className="flex flex-col gap-1 text-[14px] text-ink-secondary">
            <span>{r.timeLine}</span>
            <span>{r.dropLine}</span>
            {score.gamesDrawn > 0 && (
              <span>
                {score.gamesDrawn} drawn game{score.gamesDrawn === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>

        <p className="text-[14px] leading-[1.5] text-ink-secondary">
          Turn the phone round so both players can read this card, then submit.
        </p>

        <div className="mt-auto flex flex-col gap-2.5">
          <button
            type="button"
            disabled={submitted}
            onClick={onSubmit}
            className="flex h-14 items-center justify-center rounded-sm bg-brand-red font-heading text-[18px] font-bold text-ink disabled:opacity-60"
          >
            Submit result
          </button>
          <div className="flex min-h-6 justify-between gap-3 text-[12px] text-ink-muted">
            <span>Sends as {adminName} · retries if offline</span>
            <span className="font-mono">id {rbShortId(draft.key)}</span>
          </div>
        </div>
      </div>
    </>
  );
}
