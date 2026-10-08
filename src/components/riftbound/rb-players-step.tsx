"use client";

import { useEffect, useState } from "react";
import { addPlayer, bulkAddPlayers, removePlayer, updatePlayer } from "@/app/tools/riftbound/actions";
import type { RbPlayer } from "@/types/riftbound";
import type { RbDeskState } from "./rb-deck-model";
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
import { isEntrant, rbLocks } from "./rb-setup-model";

interface MemberResult {
  discordUserId: string;
  displayName: string;
  avatarUrl: string | null;
}

/**
 * Discord member search, debounced, from two characters up. Uses the existing
 * /api/mayhem/member-search route (tools admins or verified members): the
 * same guild search the ARAM Mayhem desk uses. Only the Discord id travels to
 * the server action; the display name is shown for the operator's benefit.
 */
function MemberSearch({ onPick, disabled }: { onPick: (m: MemberResult) => void; disabled: boolean }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setError(null);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/mayhem/member-search?q=${encodeURIComponent(q)}`);
        const json = (await res.json()) as { results?: MemberResult[]; error?: string };
        if (!res.ok) {
          setError(json.error ?? "Search unavailable right now.");
          setResults([]);
        } else {
          setError(null);
          setResults(json.results ?? []);
        }
      } catch {
        setError("Search unavailable right now.");
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="flex flex-col gap-1.5">
      <RbLabel htmlFor="rb-member-search">Add a member</RbLabel>
      <input
        id="rb-member-search"
        value={query}
        disabled={disabled}
        placeholder="Search Discord members"
        autoComplete="off"
        onChange={(e) => setQuery(e.target.value)}
        className={rbInputClass}
      />
      {error && <p className="text-[12px] text-warning-ink">{error}</p>}
      {!error && searching && <RbHint>Searching…</RbHint>}
      {!error && !searching && query.trim().length >= 2 && results.length === 0 && <RbHint>No members found.</RbHint>}
      {results.length > 0 && (
        <ul className="flex flex-col border border-line-strong">
          {results.map((m) => (
            <li key={m.discordUserId} className="border-b border-line last:border-b-0">
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  onPick(m);
                  setQuery("");
                  setResults([]);
                }}
                className="flex min-h-10 w-full items-center justify-between gap-3 px-3 text-left text-[13px] hover:bg-elevated disabled:text-ink-disabled"
              >
                <span className="truncate">{m.displayName}</span>
                <span className="font-mono text-[11px] text-ink-muted">ADD</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PlayerRow({
  player,
  disabled,
  run,
}: {
  player: RbPlayer;
  disabled: boolean;
  run: RbPanelProps<RbDeskState>["run"];
}) {
  const [legend, setLegend] = useState<string | null>(null);
  const shown = legend ?? player.legend ?? "";
  const commit = () => {
    if (legend === null) return;
    const next = legend.trim();
    setLegend(null);
    if (next !== (player.legend ?? "")) void run(() => updatePlayer({ playerId: player.id, legend: next || null }));
  };
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto_140px_auto] items-center gap-2 border-b border-line px-3 py-1.5 last:border-b-0">
      <span className="truncate text-[13px]">{player.display_name}</span>
      <span className="font-mono text-[11px] text-ink-muted">{player.member_discord_id ? "MEMBER" : "GUEST"}</span>
      <input
        aria-label={`${player.display_name} Legend`}
        placeholder="Legend"
        value={shown}
        maxLength={60}
        disabled={disabled}
        onChange={(e) => setLegend(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="h-8 rounded-sm border border-line-strong bg-base px-2 text-[12px] text-ink placeholder:text-ink-disabled disabled:text-ink-muted"
      />
      <button
        type="button"
        aria-label={`Remove ${player.display_name}`}
        disabled={disabled}
        onClick={() => void run(() => removePlayer(player.id))}
        className="h-8 rounded-sm border border-line-strong px-2 text-[12px] text-ink-secondary hover:border-brand-blue-bright disabled:text-ink-disabled"
      >
        Remove
      </button>
    </li>
  );
}

/**
 * Step 3, Players: add a member (guild search) or a guest, optional Legend,
 * bulk paste (one name per line), and the registered list.
 */
export function RbPlayersStep({ state, run, pending }: RbPanelProps<RbDeskState>) {
  const { tournament: t } = state;
  const locks = rbLocks(state);
  const readOnly = Boolean(locks.players);
  const disabled = pending || readOnly;
  const entrants = state.players.filter(isEntrant);

  const [legend, setLegend] = useState("");
  const [guest, setGuest] = useState("");
  const [bulk, setBulk] = useState("");
  const [bulkNote, setBulkNote] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const bulkNames = bulk
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const addGuest = async () => {
    const result = await run(() => addPlayer({ tournamentId: t.id, displayName: guest, legend: legend || null }));
    if (result) setGuest("");
  };
  const addMember = async (m: MemberResult) => {
    await run(() =>
      addPlayer({ tournamentId: t.id, displayName: m.displayName, memberDiscordId: m.discordUserId, legend: legend || null }),
    );
  };
  const addBulk = async () => {
    const result = await run(() => bulkAddPlayers({ tournamentId: t.id, names: bulkNames }));
    if (result && result.ok) {
      const { added, skipped } = result.data;
      setBulk("");
      setBulkNote(
        `Added ${added.length}${skipped.length ? ` · skipped ${skipped.length} already on the list: ${skipped.join(", ")}` : ""}.`,
      );
    }
  };

  const shown = filter.trim()
    ? entrants.filter((p) => p.display_name.toLowerCase().includes(filter.trim().toLowerCase()))
    : entrants;

  return (
    <RbPanel kicker="STEP 3" title="Players">
      {readOnly && <RbLockLine reason={`Registration is closed. ${locks.players}`} />}

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <RbLabel htmlFor="rb-legend">Legend for the next player (optional)</RbLabel>
          <input
            id="rb-legend"
            value={legend}
            maxLength={60}
            disabled={disabled}
            placeholder="e.g. Jinx"
            onChange={(e) => setLegend(e.target.value)}
            className={rbInputClass}
          />
          <RbHint>Legend name only. You can also set it per player in the list below.</RbHint>
        </div>

        <MemberSearch disabled={disabled} onPick={(m) => void addMember(m)} />

        <div className="flex flex-col gap-1.5">
          <RbLabel htmlFor="rb-guest">Add a guest</RbLabel>
          <div className="flex gap-2">
            <input
              id="rb-guest"
              value={guest}
              maxLength={60}
              disabled={disabled}
              placeholder="Display name"
              onChange={(e) => setGuest(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && guest.trim()) void addGuest();
              }}
              className={rbInputClass}
            />
            <button
              type="button"
              disabled={disabled || !guest.trim()}
              onClick={() => void addGuest()}
              className={`${rbSubmitClass} h-[42px] whitespace-nowrap`}
            >
              Add guest
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <RbLabel htmlFor="rb-bulk">Bulk paste, one name per line</RbLabel>
          <textarea
            id="rb-bulk"
            value={bulk}
            rows={4}
            disabled={disabled}
            placeholder={"Ray\nJoe\nJin"}
            onChange={(e) => {
              setBulk(e.target.value);
              setBulkNote(null);
            }}
            className="w-full rounded-sm border border-line-strong bg-base p-3 font-mono text-[14px] text-ink placeholder:text-ink-disabled disabled:text-ink-muted"
          />
          <div className="flex items-center gap-3">
            <button type="button" disabled={disabled || bulkNames.length === 0} onClick={() => void addBulk()} className={rbButtonClass}>
              {bulkNames.length > 0 ? `Add ${bulkNames.length} ${bulkNames.length === 1 ? "player" : "players"}` : "Add players"}
            </button>
            {bulkNote && <RbHint>{bulkNote}</RbHint>}
          </div>
          <RbHint>Bulk-added players are guests. Names already on the list are skipped.</RbHint>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[11px] text-ink-muted">REGISTERED · {entrants.length}</p>
          {entrants.length > 8 && (
            <input
              aria-label="Filter players"
              placeholder="Filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-8 w-40 rounded-sm border border-line-strong bg-base px-2 text-[12px] text-ink placeholder:text-ink-disabled"
            />
          )}
        </div>
        {entrants.length === 0 ? (
          <RbHint>No players yet.</RbHint>
        ) : (
          <ul className="max-h-[360px] overflow-y-auto border border-line-strong">
            {shown.map((p) => (
              <PlayerRow key={p.id} player={p} disabled={disabled} run={run} />
            ))}
            {shown.length === 0 && <li className="px-3 py-2 text-[12px] text-ink-muted">No match.</li>}
          </ul>
        )}
      </div>
    </RbPanel>
  );
}
