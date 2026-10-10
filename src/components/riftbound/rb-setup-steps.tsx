"use client";

import { useState } from "react";
import { markVenueTested, updateConfig } from "@/app/tools/riftbound/actions";
import type { RbJudge } from "@/types/riftbound";
import type { RbDeskState } from "./rb-deck-model";
import { RbLinkQr } from "./rb-qr";
import {
  RbHint,
  RbLabel,
  RbLockLine,
  RbPanel,
  rbButtonClass,
  rbInputClass,
  rbSubmitClass,
  type RbPanelProps,
} from "./rb-ui";
import { isEntrant, rbFormatDate, rbJudgeOverlaps, rbLocks } from "./rb-setup-model";

// ---------------------------------------------------------------------------
// Step 1: Event basics
// ---------------------------------------------------------------------------

export function RbBasicsStep({ state, run, pending }: RbPanelProps<RbDeskState>) {
  const { tournament: t } = state;
  const locks = rbLocks(state);
  const [name, setName] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [venue, setVenue] = useState<string | null>(null);

  const shownName = name ?? t.name;
  const shownDate = date ?? t.config.date ?? "";
  const shownVenue = venue ?? t.config.venue ?? "";
  const dirty =
    shownName.trim() !== t.name || shownDate !== (t.config.date ?? "") || shownVenue.trim() !== (t.config.venue ?? "");

  const save = async () => {
    const result = await run(() =>
      updateConfig({
        tournamentId: t.id,
        name: shownName,
        config: { date: shownDate || null, venue: shownVenue.trim() || null },
      }),
    );
    if (result) {
      setName(null);
      setDate(null);
      setVenue(null);
    }
  };

  return (
    <RbPanel kicker="STEP 1" title="Event basics">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 flex flex-col gap-1.5">
          <RbLabel htmlFor="rb-name">Event name</RbLabel>
          <input
            id="rb-name"
            value={shownName}
            maxLength={60}
            disabled={pending || Boolean(locks.event)}
            onChange={(e) => setName(e.target.value)}
            className={rbInputClass}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <RbLabel htmlFor="rb-date">Date</RbLabel>
          <input
            id="rb-date"
            type="date"
            value={shownDate}
            disabled={pending || Boolean(locks.event)}
            onChange={(e) => setDate(e.target.value)}
            className={rbInputClass}
          />
          <RbHint>{shownDate ? rbFormatDate(shownDate) : "Needed before check-in opens."}</RbHint>
        </div>
        <div className="flex flex-col gap-1.5">
          <RbLabel htmlFor="rb-venue">Venue</RbLabel>
          <input
            id="rb-venue"
            value={shownVenue}
            maxLength={80}
            disabled={pending || Boolean(locks.event)}
            onChange={(e) => setVenue(e.target.value)}
            className={rbInputClass}
          />
          <RbHint>Needed before check-in opens.</RbHint>
        </div>
      </div>
      <div className="flex flex-col gap-1 border-t border-line pt-3 text-[13px] text-ink-secondary">
        <p>
          Desk: <span className="font-mono text-ink">/tools/riftbound/{t.slug}</span>
        </p>
        <p>
          Public page: <span className="font-mono text-ink">/tournaments/riftbound/{t.slug}</span>
        </p>
        <RbHint>The address is fixed when the event is created.</RbHint>
      </div>
      {locks.event && <RbLockLine reason={`The basics are locked. ${locks.event}`} />}
      <div>
        <button
          type="button"
          disabled={pending || !dirty || !shownName.trim() || Boolean(locks.event)}
          onClick={() => void save()}
          className={rbSubmitClass}
        >
          Save basics
        </button>
      </div>
    </RbPanel>
  );
}

// ---------------------------------------------------------------------------
// Step 4: Check-in
// ---------------------------------------------------------------------------

export function RbCheckInStep({ state }: RbPanelProps<RbDeskState>) {
  const { tournament: t } = state;
  const entrants = state.players.filter(isEntrant);
  const checkedIn = entrants.filter((p) => p.status === "checked_in" || p.status === "active").length;
  return (
    <RbPanel kicker="STEP 4" title="Check-in">
      <div className="flex flex-col gap-3 text-[13px] leading-[1.6] text-ink-secondary">
        <p>
          Check-in opens from the red button at the top once the basics and format are set. Players can still be
          added after it opens.
        </p>
        <p>
          Only players who check in are paired. Anyone who doesn&apos;t is left out of Round 1 and stays on the list
          as registered.
        </p>
      </div>
      <div className="flex items-center gap-2.5 border border-line bg-deck-rail px-3 py-2.5 text-[13px] text-ink-secondary">
        <span className="font-mono text-[11px] text-ink-muted">STATUS</span>
        {t.status === "draft"
          ? `Not open yet · ${entrants.length} registered`
          : t.status === "registration"
            ? `Open · ${checkedIn} of ${entrants.length} checked in`
            : "Closed · Round 1 is paired"}
      </div>
    </RbPanel>
  );
}

// ---------------------------------------------------------------------------
// Step 5: Judges
// ---------------------------------------------------------------------------

const newJudgeId = () => `j_${Math.random().toString(36).slice(2, 10)}`;
const tableNumber = (raw: string): number | null => {
  const n = Number(raw.replace(/[^\d]/g, ""));
  return raw.trim() === "" || !Number.isInteger(n) || n < 1 ? null : Math.min(n, 999);
};

export function RbJudgesStep({ state, run, pending }: RbPanelProps<RbDeskState>) {
  const { tournament: t } = state;
  const saved = t.config.judges;
  const [draft, setDraft] = useState<RbJudge[] | null>(null);
  const judges = draft ?? saved;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(saved);
  const overlaps = rbJudgeOverlaps(judges.filter((j) => j.from !== null));
  const locked = Boolean(rbLocks(state).event);

  const edit = (next: RbJudge[]) => setDraft(next);
  const patch = (id: string, change: Partial<RbJudge>) => edit(judges.map((j) => (j.id === id ? { ...j, ...change } : j)));

  const save = async () => {
    const cleaned = judges.filter((j) => j.name.trim()).map((j) => ({ ...j, name: j.name.trim() }));
    const result = await run(() => updateConfig({ tournamentId: t.id, config: { judges: cleaned } }));
    if (result) setDraft(null);
  };

  return (
    <RbPanel kicker="STEP 5" title="Judges">
      <div className="flex flex-col gap-3">
        <p className="text-[13px] leading-[1.6] text-ink-secondary">
          Judges are normal tools admins, so there is nothing to invite: they open the floor link below and sign in. List
          them here to split the tables. A table range is optional; leave it empty for all tables.
        </p>

        {judges.length === 0 && <RbHint>No judges added yet.</RbHint>}
        <ul className="flex flex-col gap-2">
          {judges.map((j) => (
            <li key={j.id} className="grid grid-cols-[minmax(0,1fr)_72px_72px_auto] items-center gap-2">
              <input
                aria-label="Judge name"
                placeholder="Judge name"
                value={j.name}
                maxLength={40}
                disabled={pending || locked}
                onChange={(e) => patch(j.id, { name: e.target.value })}
                className={rbInputClass}
              />
              <input
                aria-label={`${j.name || "Judge"} first table`}
                placeholder="From"
                inputMode="numeric"
                value={j.from ?? ""}
                disabled={pending || locked}
                onChange={(e) => {
                  const from = tableNumber(e.target.value);
                  patch(j.id, from === null ? { from: null, to: null } : { from });
                }}
                className={rbInputClass}
              />
              <input
                aria-label={`${j.name || "Judge"} last table`}
                placeholder="To"
                inputMode="numeric"
                value={j.to ?? ""}
                disabled={pending || locked || j.from === null}
                onChange={(e) => patch(j.id, { to: tableNumber(e.target.value) })}
                className={rbInputClass}
              />
              <button
                type="button"
                aria-label={`Remove ${j.name || "judge"}`}
                disabled={pending || locked}
                onClick={() => edit(judges.filter((x) => x.id !== j.id))}
                className={`${rbButtonClass} h-[42px] px-3`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        {judges.some((j) => j.from !== null) && (
          <RbHint>Leave &ldquo;To&rdquo; empty for &ldquo;from that table up&rdquo; (12+).</RbHint>
        )}
        {overlaps.length > 0 && (
          <p className="text-[12px] text-warning-ink">Table ranges overlap: {overlaps.join("; ")}.</p>
        )}
        {locked && <RbLockLine reason={`Judges are locked. ${rbLocks(state).event}`} />}
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pending || locked || judges.length >= 30}
            onClick={() => edit([...judges, { id: newJudgeId(), name: "", from: null, to: null }])}
            className={rbButtonClass}
          >
            Add judge
          </button>
          <button
            type="button"
            disabled={pending || locked || !dirty}
            onClick={() => void save()}
            className={rbSubmitClass}
          >
            Save judges
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-line pt-4">
        <p className="font-mono text-[11px] text-ink-muted">FLOOR VIEW</p>
        <RbLinkQr
          path={`/tools/riftbound/${t.slug}/floor`}
          label="the judges' floor view"
          description="Judges scan this on their phones. It is a phone layout, not a permission boundary: they still sign in as tools admins."
        />
      </div>
    </RbPanel>
  );
}

// ---------------------------------------------------------------------------
// Step 6: Venue screen
// ---------------------------------------------------------------------------

export function RbVenueStep({ state, run, pending }: RbPanelProps<RbDeskState>) {
  const { tournament: t } = state;
  const tested = t.config.venueTestedAt;
  const locked = Boolean(rbLocks(state).event);
  return (
    <RbPanel kicker="STEP 6" title="Venue screen">
      <RbLinkQr
        path={`/rblive/${t.slug}`}
        label="the venue screen"
        description="Open this on the house screen. It shows the program scene and needs no sign-in."
      />
      <div className="flex flex-col gap-3 border-t border-line pt-4">
        <p className="text-[13px] leading-[1.6] text-ink-secondary">
          Open it on the actual screen, check it fills the display and the text is readable from the back of the room,
          then mark it tested.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={pending || locked}
            onClick={() => void run(() => markVenueTested(t.id))}
            className={rbSubmitClass}
          >
            {tested ? "Mark tested again" : "Mark tested"}
          </button>
          <span className={tested ? "text-[13px] text-success-ink" : "text-[13px] text-warning-ink"}>
            {tested
              ? `Tested ${new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(tested))} KST`
              : "Not tested yet"}
          </span>
        </div>
        {locked && <RbLockLine reason={`Locked. ${rbLocks(state).event}`} />}
      </div>
    </RbPanel>
  );
}
