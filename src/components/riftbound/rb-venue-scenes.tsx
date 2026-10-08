"use client";

// The venue screen's scenes. Each is drawn at a fixed 1920x1080 (RbVenueFrame
// scales the whole stage), so sizes here are real pixels from the references
// in docs/design/control-deck-v2/screens/venue-*.html. Public data only.

import { useEffect, useState } from "react";
import { clockRemainingMs } from "../../lib/rb-clock";
import {
  PAGE_MS,
  rbAdvances,
  rbCutSize,
  rbExtensionLine,
  rbPageCount,
  rbPairingColumns,
  rbPairingRows,
  rbRail,
  rbSwissTotal,
  rbTimeCalled,
  rbVenueRound,
  rbVenueStandings,
  type RbStandingRow,
  type RbVenueData,
} from "./rb-venue-model";
import { formatClock } from "./rb-round-model";

const BG = "#0A0E1A";
const ROW_A = "#121931";
const ROW_B = "#0E1428";
const MUTED = "#B8BCC8";
const DIM = "#8B8D98";

function Slab({ style }: { style: React.CSSProperties }) {
  return <div aria-hidden className="absolute" style={{ transform: "skewX(-14deg)", ...style }} />;
}

function Logo({ size, className = "" }: { size: number; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/logo.svg" alt="LoLMK" style={{ width: size, height: size }} className={`object-contain ${className}`} />;
}

const eventLabel = (name: string) => `${name.toUpperCase()} · RIFTBOUND`;

function roundClock(data: RbVenueData, now: number): string {
  const round = rbVenueRound(data);
  return round ? formatClock(clockRemainingMs(round, null, now)) : "--:--";
}

/** Page index that advances every 12s, only when there is more than one page. */
function usePage(pages: number): number {
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (pages <= 1) {
      setPage(0);
      return;
    }
    const id = window.setInterval(() => setPage((p) => (p + 1) % pages), PAGE_MS);
    return () => window.clearInterval(id);
  }, [pages]);
  return pages <= 1 ? 0 : page % pages;
}

// ---------------------------------------------------------------------------
// Pairings (and pairings + clock)
// ---------------------------------------------------------------------------

export function VenuePairings({ data, now, withClock }: { data: RbVenueData; now: number; withClock: boolean }) {
  const round = rbVenueRound(data);
  const rows = rbPairingRows(data, round);
  const pages = rbPageCount(rows.length);
  const page = usePage(pages);
  const columns = rbPairingColumns(rows, page);
  const title = round
    ? round.stage === "top_cut"
      ? `TOP CUT ROUND ${round.number} PAIRINGS`
      : `ROUND ${round.number} PAIRINGS`
    : "PAIRINGS";
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden" style={{ background: BG }}>
      <Slab style={{ right: -180, top: -120, width: 760, height: 1320, background: "#10162A" }} />
      <Slab style={{ right: 560, top: -120, width: 18, height: 1320, background: "#BA263C" }} />
      <header className="relative flex items-center" style={{ gap: 28, padding: "44px 72px 28px" }}>
        <Logo size={84} />
        <div className="flex flex-col" style={{ gap: 4 }}>
          <span className="font-heading font-semibold" style={{ fontSize: 22, letterSpacing: "0.12em", color: MUTED }}>
            {eventLabel(data.tournament.name)}
          </span>
          <span className="font-display" style={{ fontSize: 96, lineHeight: 0.85, letterSpacing: "0.02em" }}>
            {title}
          </span>
        </div>
        {withClock && (
          <div className="ml-auto flex flex-col items-end">
            <span className="font-mono" style={{ fontSize: 18, letterSpacing: "0.1em", color: "#E94560" }}>
              TIME REMAINING
            </span>
            <span className="font-display tabular-nums" style={{ fontSize: 120, lineHeight: 0.85 }}>
              {roundClock(data, now)}
            </span>
          </div>
        )}
      </header>
      <div className="relative grid flex-1" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", columnGap: 40, padding: "8px 72px 0" }}>
        {rows.length === 0 ? (
          <p className="font-display col-span-3 self-center text-center" style={{ fontSize: 80, color: DIM }}>
            Pairings coming soon
          </p>
        ) : (
          columns.map((col, c) => (
            <div key={c} className="flex flex-col" style={{ gap: 6 }}>
              {col.map((r, i) => (
                <div key={r.playerId} className="flex items-center" style={{ height: 64, background: i % 2 === 0 ? ROW_A : ROW_B }}>
                  <span className="flex min-w-0 flex-1 flex-col" style={{ paddingLeft: 20 }}>
                    <span className="truncate font-semibold" style={{ fontSize: 30, lineHeight: 1.05 }}>
                      {r.name}
                    </span>
                    <span className="truncate" style={{ fontSize: 17, color: MUTED }}>
                      {r.opponent ? `vs ${r.opponent}` : "Bye"}
                    </span>
                  </span>
                  <span
                    className="font-display flex items-center justify-center tabular-nums"
                    style={{ width: 96, height: 64, fontSize: r.opponent ? 50 : 36, background: "#283D74", color: "#F5F5F7" }}
                  >
                    {r.opponent ? r.table : "BYE"}
                  </span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
      <div className="relative flex items-center justify-end font-mono" style={{ height: 56, padding: "0 72px", fontSize: 18, letterSpacing: "0.1em", color: DIM }}>
        {pages > 1 ? `PAGE ${page + 1} / ${pages}` : ""}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

export function VenueClock({ data, now }: { data: RbVenueData; now: number }) {
  const round = rbVenueRound(data);
  const total = rbSwissTotal(data);
  const rail = rbRail(data, now);
  const label = !round
    ? "ROUND"
    : round.stage === "top_cut"
      ? `TOP CUT ROUND ${round.number}`
      : `ROUND ${round.number} OF ${total}`;
  const bestOf = data.tournament.config.bestOf;
  const stageLabel = round?.stage === "top_cut" ? "TOP CUT" : "SWISS";
  return (
    <div className="relative flex h-full w-full flex-col items-center overflow-hidden" style={{ background: BG }}>
      {/* The existing timer's card-back tile, as in the SR/timer background. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -inset-1/2"
          style={{
            opacity: 0.05,
            backgroundImage: "url(/images/timer/riftboundcardback-tile.png)",
            backgroundRepeat: "repeat",
            backgroundSize: "224px 600px",
            transform: "rotate(-20deg)",
            transformOrigin: "center",
          }}
        />
      </div>
      <header className="relative flex w-full items-center" style={{ gap: 24, padding: "48px 72px 0" }}>
        <Logo size={104} />
        <span className="font-heading font-semibold" style={{ fontSize: 24, letterSpacing: "0.12em", color: MUTED }}>
          {eventLabel(data.tournament.name)}
        </span>
        <span className="ml-auto font-mono" style={{ fontSize: 20, letterSpacing: "0.1em", color: MUTED }}>
          {stageLabel} · BEST OF {bestOf}
        </span>
      </header>
      <div className="relative flex flex-1 flex-col items-center justify-center" style={{ gap: 8 }}>
        <span className="inline-block" style={{ padding: "8px 36px", background: "#BA263C", transform: "skewX(-12deg)" }}>
          <span className="font-display inline-block" style={{ fontSize: 56, letterSpacing: "0.08em", transform: "skewX(12deg)" }}>
            {label}
          </span>
        </span>
        <span className="font-display tabular-nums" style={{ fontSize: 460, lineHeight: 0.85, letterSpacing: "0.01em" }}>
          {roundClock(data, now)}
        </span>
        {round?.paused_at && (
          <span className="font-mono" style={{ fontSize: 28, letterSpacing: "0.2em", color: "#E94560" }}>
            PAUSED
          </span>
        )}
      </div>
      <div
        className="relative grid"
        style={{ width: 1440, gridTemplateColumns: `repeat(${Math.max(1, rail.length)}, minmax(0, 1fr))`, gap: 10, paddingBottom: 72 }}
      >
        {rail.map((r) => (
          <div key={r.label} className="flex flex-col" style={{ gap: 10 }}>
            <div className="relative" style={{ height: 14, background: "#1A2240" }}>
              <div
                className="absolute bottom-0 left-0 top-0"
                style={{ width: `${Math.round(r.progress * 100)}%`, background: r.state === "current" ? "#E94560" : "#4A65A8" }}
              />
            </div>
            <span
              className="font-display"
              style={{ fontSize: 34, letterSpacing: "0.06em", color: r.state === "current" ? "#F5F5F7" : r.state === "done" ? MUTED : DIM }}
            >
              {r.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Time called
// ---------------------------------------------------------------------------

const TIME_STEPS = [
  "Finish the current turn",
  "Play 3 more turns",
  "Ahead by 2+ points wins the game · otherwise it's a draw",
];

export function VenueTimeCalled({ data, now }: { data: RbVenueData; now: number }) {
  const round = rbVenueRound(data);
  const { tables, extensions } = rbTimeCalled(data, round, now);
  const dense = tables.length > 16 ? 2 : tables.length > 8 ? 1 : 0;
  const cols = [2, 4, 6][dense];
  const box = [
    { w: 200, h: 140, f: 110 },
    { w: 110, h: 90, f: 64 },
    { w: 84, h: 64, f: 46 },
  ][dense];
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden" style={{ background: BG }}>
      <Slab style={{ left: -200, top: 0, width: 1400, height: 1080, background: "#8E1C2E" }} />
      <Slab style={{ left: 1180, top: 0, width: 22, height: 1080, background: "#E94560" }} />
      <header className="relative flex items-center" style={{ gap: 24, padding: "48px 72px 0" }}>
        <Logo size={72} />
        <span className="font-heading font-semibold" style={{ fontSize: 24, letterSpacing: "0.12em" }}>
          {data.tournament.name.toUpperCase()}
          {round ? ` · ${round.stage === "top_cut" ? "TOP CUT ROUND" : "ROUND"} ${round.number}` : ""}
        </span>
      </header>
      <div className="relative flex flex-1 items-center" style={{ padding: "0 72px", gap: 120 }}>
        <div className="flex flex-col" style={{ gap: 24, width: 980 }}>
          <span className="font-display" style={{ fontSize: 380, lineHeight: 0.8, letterSpacing: "0.02em" }}>
            TIME
          </span>
          <div className="flex flex-col" style={{ gap: 14 }}>
            {TIME_STEPS.map((t, i) => (
              <span key={t} className="font-heading flex items-baseline font-semibold" style={{ gap: 20, fontSize: 40 }}>
                <span className="font-display font-normal" style={{ fontSize: 56, color: "#FFC2CC" }}>
                  {i + 1}
                </span>
                {t}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-col" style={{ gap: 20 }}>
          <span className="font-mono" style={{ fontSize: 22, letterSpacing: "0.1em", color: MUTED }}>
            {tables.length > 0 ? "TABLES STILL PLAYING" : "ALL RESULTS ARE IN"}
          </span>
          {tables.length > 0 && (
            <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 14 }}>
              {tables.map((t) => (
                <span
                  key={t}
                  className="font-display flex items-center justify-center"
                  style={{ width: box.w, height: box.h, fontSize: box.f, background: "#1A2240" }}
                >
                  {t}
                </span>
              ))}
            </div>
          )}
          {extensions.slice(0, 4).map((e) => (
            <span key={e.table} style={{ fontSize: 22, color: MUTED }}>
              {rbExtensionLine(e)}
            </span>
          ))}
          {extensions.length > 4 && <span style={{ fontSize: 22, color: MUTED }}>+{extensions.length - 4} more with extensions</span>}
        </div>
      </div>
      <div style={{ height: 72 }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

function StandingsColumn({
  header,
  rows,
  headerBg,
  advancing,
}: {
  header: string;
  rows: RbStandingRow[];
  headerBg: string;
  advancing: number;
}) {
  return (
    <div className="flex flex-col" style={{ gap: 6 }}>
      <div className="flex items-center" style={{ padding: "6px 16px", background: headerBg }}>
        <span className="font-display" style={{ fontSize: 40, letterSpacing: "0.06em" }}>
          {header}
        </span>
        <span className="font-mono ml-auto flex" style={{ fontSize: 15, color: MUTED }}>
          <span className="text-right" style={{ width: 90 }}>RECORD</span>
          <span className="text-right" style={{ width: 70 }}>PTS</span>
          <span className="text-right" style={{ width: 90 }}>OMW</span>
          <span className="text-right" style={{ width: 90 }}>GW</span>
        </span>
      </div>
      {rows.map((r, i) => (
        <div key={r.rank} className="flex items-center" style={{ gap: 12, height: 82, paddingRight: 16, background: i % 2 === 0 ? ROW_A : ROW_B }}>
          <span className="font-display text-center" style={{ width: 64, fontSize: 44, color: rbAdvances(r.rank, advancing) ? "#E94560" : DIM }}>
            {r.rank}
          </span>
          <span className="min-w-0 flex-1 truncate font-semibold" style={{ fontSize: 28, lineHeight: 1.1 }}>
            {r.name}
          </span>
          <span className="font-mono flex tabular-nums" style={{ fontSize: 22 }}>
            <span className="text-right" style={{ width: 90 }}>{r.record}</span>
            <span className="text-right font-semibold" style={{ width: 70 }}>{r.points}</span>
            <span className="text-right" style={{ width: 90, color: MUTED }}>{r.omw}</span>
            <span className="text-right" style={{ width: 90, color: MUTED }}>{r.gw}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function VenueStandings({ data }: { data: RbVenueData }) {
  const s = rbVenueStandings(data);
  return (
    <div className="flex h-full w-full flex-col overflow-hidden" style={{ background: BG, padding: "48px 72px", gap: 28 }}>
      <header className="flex items-center" style={{ gap: 24 }}>
        <Logo size={72} />
        <div className="flex flex-col">
          <span className="font-heading font-semibold" style={{ fontSize: 22, letterSpacing: "0.12em", color: MUTED }}>
            {eventLabel(data.tournament.name)}
          </span>
          <span className="font-display" style={{ fontSize: 88, lineHeight: 0.85 }}>
            {s.title}
          </span>
        </div>
        <span className="font-mono ml-auto text-right" style={{ fontSize: 18, color: DIM }}>
          Tiebreakers: OMW% · GW% · OGW%
          <br />
          {s.subtitle}
        </span>
      </header>
      {s.left.length === 0 ? (
        <p className="font-display flex-1 self-center text-center" style={{ fontSize: 80, color: DIM, paddingTop: 200 }}>
          Standings after Round 1
        </p>
      ) : (
        <div className="grid flex-1" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 48, alignContent: "start" }}>
          <StandingsColumn header={s.leftHeader} rows={s.left} headerBg={s.advancing > 0 ? "#BA263C" : "#1A2240"} advancing={s.advancing} />
          {s.right.length > 0 && <StandingsColumn header={s.rightHeader} rows={s.right} headerBg="#1A2240" advancing={s.advancing} />}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Idle, starting soon, announcement, champion
// ---------------------------------------------------------------------------

/** Left-aligned copy over the slabs, logo on the right (as venue-champion.html). */
function Stage({ children, pulse = false }: { children: React.ReactNode; pulse?: boolean }) {
  return (
    <div className="relative flex h-full w-full items-center overflow-hidden" style={{ background: BG }}>
      <Slab style={{ left: 980, top: -100, width: 1300, height: 1300, background: "#10162A" }} />
      <Slab style={{ left: 940, top: -100, width: 26, height: 1300, background: "#BA263C" }} />
      <Slab style={{ left: 900, top: -100, width: 8, height: 1300, background: "#4A65A8" }} />
      <div className="relative flex flex-col" style={{ paddingLeft: 120, gap: 18, width: 780 }}>
        {children}
      </div>
      <div className="relative ml-auto" style={{ marginRight: 200 }}>
        <Logo size={420} className={pulse ? "animate-pulse-dot" : ""} />
      </div>
    </div>
  );
}

const KICKER: React.CSSProperties = { fontSize: 28, letterSpacing: "0.24em", color: "#E94560" };

export function VenueIdle({ data }: { data: RbVenueData }) {
  return (
    <Stage pulse>
      <span className="font-heading font-semibold" style={KICKER}>
        RIFTBOUND
      </span>
      <span className="font-display" style={{ fontSize: 190, lineHeight: 0.88, letterSpacing: "0.02em" }}>
        {data.tournament.name.toUpperCase()}
      </span>
    </Stage>
  );
}

export function VenueStartingSoon({ data, at, now }: { data: RbVenueData; at: number | null; now: number }) {
  const left = at === null ? null : Math.max(0, Math.ceil((at - now) / 1000));
  return (
    <Stage>
      <span className="font-heading font-semibold" style={KICKER}>
        STARTING SOON
      </span>
      <span className="font-display" style={{ fontSize: 120, lineHeight: 0.9, letterSpacing: "0.03em" }}>
        {data.tournament.name.toUpperCase()}
      </span>
      {left !== null && (
        <span className="font-display tabular-nums" style={{ fontSize: 300, lineHeight: 0.85, color: "#E94560" }}>
          {String(Math.floor(left / 60)).padStart(2, "0")}:{String(left % 60).padStart(2, "0")}
        </span>
      )}
    </Stage>
  );
}

export function VenueAnnouncement({ data, text }: { data: RbVenueData; text: string }) {
  return (
    <Stage>
      <span className="font-heading font-semibold" style={{ ...KICKER, letterSpacing: "0.14em", color: MUTED }}>
        {eventLabel(data.tournament.name)}
      </span>
      <span className="font-display" style={{ fontSize: 110, letterSpacing: "0.1em", lineHeight: 0.9, color: "#E94560" }}>
        ANNOUNCEMENT
      </span>
      <span className="font-display" style={{ fontSize: text.length > 40 ? 90 : 130, lineHeight: 0.95, letterSpacing: "0.02em" }}>
        {text || "—"}
      </span>
    </Stage>
  );
}

export function VenueChampion({ data }: { data: RbVenueData }) {
  const champ = data.players.find((p) => p.id === data.tournament.champion_player_id);
  const cut = rbCutSize(data);
  const players = data.players.filter((p) => p.status === "active" || p.status === "dropped").length;
  const swiss = data.rounds.filter((r) => r.stage === "swiss").length;
  return (
    <div className="relative flex h-full w-full items-center overflow-hidden" style={{ background: BG }}>
      <Slab style={{ left: 980, top: -100, width: 1300, height: 1300, background: "#10162A" }} />
      <Slab style={{ left: 940, top: -100, width: 26, height: 1300, background: "#BA263C" }} />
      <Slab style={{ left: 900, top: -100, width: 8, height: 1300, background: "#4A65A8" }} />
      <div className="relative flex flex-col" style={{ paddingLeft: 120, gap: 18, width: 900 }}>
        <span className="font-heading font-semibold" style={{ fontSize: 28, letterSpacing: "0.14em", color: MUTED }}>
          {eventLabel(data.tournament.name)}
        </span>
        <span className="font-display" style={{ fontSize: 72, letterSpacing: "0.1em", lineHeight: 0.9, color: "#E94560" }}>
          CHAMPION
        </span>
        <span className="font-display truncate" style={{ fontSize: 300, lineHeight: 0.8, letterSpacing: "0.01em" }}>
          {(champ?.display_name ?? "TBD").toUpperCase()}
        </span>
      </div>
      <div className="relative ml-auto flex flex-col items-center" style={{ marginRight: 160, gap: 28 }}>
        <Logo size={420} />
        <span className="font-mono" style={{ fontSize: 20, letterSpacing: "0.12em", color: MUTED }}>
          {players} PLAYERS · {swiss} ROUNDS{cut > 0 ? ` · TOP ${cut}` : ""}
        </span>
      </div>
    </div>
  );
}
