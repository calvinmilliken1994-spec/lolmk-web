"use client";

import { useId, useState } from "react";
import { updateConfig } from "@/app/tools/riftbound/actions";
import type { RbConfigPatch } from "@/lib/rb-service";
import type { RbEnforcementLevel } from "@/types/riftbound";
import type { RbDeskState } from "./rb-deck-model";
import { RbHint, RbLabel, RbLockLine, RbPanel, RbSegmented, rbInputClass, type RbPanelProps } from "./rb-ui";
import {
  SWISS_ROUNDS_MAX,
  rbAdvancedSummary,
  rbCutHint,
  rbLocks,
  rbRoundOptions,
  rbRoundsHint,
} from "./rb-setup-model";

const ENFORCEMENT_LABEL: Record<RbEnforcementLevel, string> = {
  casual: "Casual",
  competitive: "Competitive",
  professional: "Professional",
};

/**
 * Step 2, Format. Matches docs/design/control-deck-v2/screens/desk-setup.html:
 * segmented Match / Swiss rounds / Top cut, round length, power pairing,
 * enforcement level, the Advanced summary and the Locks note. A setting that
 * the server has locked (see rbLocks) is disabled with its reason shown.
 */
export function RbFormatStep({ state, run, pending }: RbPanelProps<RbDeskState>) {
  const { tournament: t } = state;
  const { config } = t;
  const locks = rbLocks(state);
  const tid = t.id;
  const lengthId = useId();

  const save = (patch: RbConfigPatch) => run(() => updateConfig({ tournamentId: tid, config: patch }));

  // The round-length draft lives here so a poll can't overwrite what is being typed.
  const [lengthDraft, setLengthDraft] = useState<string | null>(null);
  const commitLength = () => {
    if (lengthDraft === null) return;
    const minutes = Number(lengthDraft);
    setLengthDraft(null);
    if (lengthDraft.trim() !== "" && Number.isInteger(minutes) && minutes !== config.roundMinutes) {
      void save({ roundMinutes: minutes });
    }
  };

  const formatLocked = Boolean(locks.format);
  const roundOptions = rbRoundOptions(state);
  const roundsValue = config.swissRounds;
  const roundsDisabled = pending || Boolean(locks.swissRounds);

  return (
    <RbPanel kicker="STEP 2" title="Format">
      <div className="grid grid-cols-2 gap-4">
        <RbSegmented
          label="Match"
          columns={2}
          value={config.bestOf}
          disabled={pending || formatLocked}
          onChange={(bestOf) => void save({ bestOf })}
          options={[
            { value: 3, label: "Best of 3" },
            { value: 1, label: "Best of 1" },
          ]}
        />

        <div className="flex flex-col gap-1.5">
          <RbLabel htmlFor={lengthId}>Round length (minutes)</RbLabel>
          <input
            id={lengthId}
            inputMode="numeric"
            value={lengthDraft ?? String(config.roundMinutes)}
            disabled={pending || formatLocked}
            onChange={(e) => setLengthDraft(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
            onBlur={commitLength}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setLengthDraft(null);
            }}
            className={rbInputClass}
          />
        </div>

        {formatLocked && <RbLockLine reason={`Match format, round length and scoring are locked. ${locks.format}`} className="col-span-2 -mt-2" />}

        <div className="flex flex-col gap-1.5">
          <RbSegmented
            label="Swiss rounds"
            columns={4}
            value={roundsValue === "auto" ? "auto" : roundsValue}
            disabled={roundsDisabled}
            onChange={(v) => void save({ swissRounds: v === "auto" ? "auto" : Number(v) })}
            options={[
              { value: "auto" as string | number, label: "Auto", disabled: locks.round1Paired },
              ...roundOptions.map((n) => ({
                value: n as string | number,
                label: String(n),
                disabled: n < locks.swissPaired || n > SWISS_ROUNDS_MAX,
              })),
            ]}
          />
          {locks.swissRounds ? (
            <RbLockLine reason={`The round count is locked. ${locks.swissRounds}`} />
          ) : (
            <RbHint>{rbRoundsHint(state)}</RbHint>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <RbSegmented
            label="Top cut"
            columns={4}
            value={config.topCut as string | number}
            disabled={pending || Boolean(locks.topCut)}
            onChange={(v) => void save({ topCut: v as "auto" | 0 | 4 | 8 })}
            options={[
              { value: "auto", label: "Auto" },
              { value: 0, label: "None" },
              { value: 4, label: "Top 4" },
              { value: 8, label: "Top 8" },
            ]}
          />
          {locks.topCut ? (
            <RbLockLine reason={`The cut size is locked. ${locks.topCut}`} />
          ) : (
            <RbHint>{rbCutHint(state)}</RbHint>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-0.5 border-t border-line pt-3">
        <label className="flex min-h-10 items-center justify-between">
          Power-pair the final Swiss round
          <input
            type="checkbox"
            checked={config.powerPairFinalRound}
            disabled={pending || Boolean(locks.powerPair)}
            onChange={(e) => void save({ powerPairFinalRound: e.target.checked })}
            className="h-[18px] w-[18px] accent-brand-blue-bright"
          />
        </label>
        {locks.powerPair && <RbLockLine reason={`Power pairing is locked. ${locks.powerPair}`} />}
        <label className="flex min-h-10 items-center justify-between">
          Competitive rules enforcement level
          <select
            value={config.enforcementLevel}
            disabled={pending || Boolean(locks.event)}
            onChange={(e) => void save({ enforcementLevel: e.target.value as RbEnforcementLevel })}
            className="h-[34px] rounded-sm border border-line-strong bg-base px-2 text-[13.33px] text-ink"
          >
            <option value="casual">{ENFORCEMENT_LABEL.casual}</option>
            <option value="competitive">{ENFORCEMENT_LABEL.competitive}</option>
            {config.enforcementLevel === "professional" && (
              <option value="professional">{ENFORCEMENT_LABEL.professional}</option>
            )}
          </select>
        </label>
        {locks.event && <RbLockLine reason={`The enforcement level is locked. ${locks.event}`} />}
      </div>

      <details className="border-t border-line pt-3">
        <summary className="min-h-8 cursor-pointer text-ink-secondary">{rbAdvancedSummary(state)}</summary>
        <p className="mt-2 text-[13px] leading-[1.6] text-ink-muted">
          Tiebreak order: opponents&apos; match win %, game win %, opponents&apos; game win %, then random (seed stored
          in the log).
        </p>
      </details>

      <div className="flex items-center gap-2.5 border border-line bg-deck-rail px-3 py-2.5 text-[13px] text-ink-secondary">
        <span className="font-mono text-[11px] text-ink-muted">LOCKS</span>
        Match format and round length lock when Round 1 is paired. Remaining round count stays editable until the final
        round is paired.
      </div>
    </RbPanel>
  );
}
