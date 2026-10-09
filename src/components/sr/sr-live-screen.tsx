"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLockInCue } from "@/components/sr/use-lock-in-cue";
import { ubr1RevealDurationMs, ubr1VisibleCount } from "@/lib/sr-reveal";
import type {
  SrMatchScene,
  SrPublicMatch,
  SrPublicTeam,
  SrPublicTournamentFull,
} from "@/types/sr-tournament";

const BRACKET_LABEL: Record<SrPublicMatch["bracket"], string> = {
  upper: "Upper bracket",
  lower: "Lower bracket",
  grand_final: "Grand final",
  third_place: "Third place",
};

// Round 1 reveal timing — server only stamps a start timestamp + run id
// (see startUbr1Reveal in actions.ts); every connected client (including
// one that reconnects mid-sequence) derives the exact same animation frame
// from elapsed wall-clock time against that timestamp, never from a
// manually-clicked step count and never from polling cadence. Timing lives in
// src/lib/sr-reveal.ts so the desk shows the same progress.

export function SrLiveScreen({
  initial,
  slug,
  muted = false,
  sceneOverride = null,
}: {
  initial: SrPublicTournamentFull | null;
  slug: string;
  muted?: boolean;
  /** The desk's Preview monitor (`?scene=<id>&preview=1`): render this scene instead of the one on air. */
  sceneOverride?: SrMatchScene | null;
}) {
  const [data, setData] = useState(initial);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const { play: playLockIn, unlock } = useLockInCue();
  // Audio must never fire in the admin's muted preview embed (see
  // the desk's Program and Preview monitors, `?muted=1` or `preview=1`), regardless of soundEnabled — the
  // "Enable sound" gesture button is hidden entirely below when muted, so
  // this is belt-and-braces against soundEnabled somehow flipping true.
  const audioEnabled = soundEnabled && !muted;

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number;

    async function poll() {
      try {
        const res = await fetch(`/api/sr/state?slug=${encodeURIComponent(slug)}`, {
          cache: "no-store",
        });
        if (res.ok) {
          const json = await res.json();
          if (cancelled) return;
          setData(json);
        } else if (res.status === 404) {
          if (cancelled) return;
          // Authoritative "not live" — a draft tournament or a deleted
          // slug. Clear immediately rather than freezing a stale scene.
          setData(null);
        }
        // Any other status (5xx, etc.) is transient — keep the last good scene.
      } catch {
        // Network hiccup — keep the last good scene.
      } finally {
        if (!cancelled) timer = window.setTimeout(poll, 2000);
      }
    }
    timer = window.setTimeout(poll, 2000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [slug]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!data) {
    return (
      <main className="fixed inset-0 z-[60] flex items-center justify-center overflow-hidden bg-base text-ink">
        <div className="flex flex-col items-center gap-[3vh] text-center opacity-80">
          <Image src="/logo.svg" alt="LoLMK" width={180} height={200} className="h-[18vh] w-auto" priority />
          <p className="font-display text-[clamp(2.5rem,6vw,7rem)] uppercase tracking-[0.04em]">Not live yet</p>
        </div>
      </main>
    );
  }

  const { tournament } = data;
  return (
    <main className="fixed inset-0 z-[60] overflow-hidden bg-base text-ink">
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-[18%] h-[55vh] w-[80vw] -translate-x-1/2 rounded-full bg-brand-red/10 blur-[130px]" />
      <div aria-hidden className="pointer-events-none absolute -right-24 bottom-0 h-[55vh] w-[45vw] rounded-full bg-brand-blue/15 blur-[130px]" />
      {!muted && !soundEnabled && (
        <button
          type="button"
          onClick={() => {
            setSoundEnabled(true);
            // The gesture that satisfies the autoplay policy — resume the
            // AudioContext here, inside the click handler, or the synthesized
            // cue stays suspended forever even with soundEnabled true.
            unlock();
          }}
          className="absolute right-4 top-4 z-20 border border-line-strong bg-surface/90 px-3 py-1.5 text-caption uppercase tracking-wider text-ink-secondary hover:text-ink"
        >
          Enable sound
        </button>
      )}
      <div className="relative z-10 flex h-full w-full items-center justify-center p-[3vw]">
        <LiveScene
          data={data}
          scene={sceneOverride ?? tournament.scene}
          reducedMotion={reducedMotion}
          audioEnabled={audioEnabled}
          playLockIn={playLockIn}
        />
      </div>
    </main>
  );
}

function LiveScene({
  data,
  scene,
  reducedMotion,
  audioEnabled,
  playLockIn,
}: {
  data: SrPublicTournamentFull;
  scene: SrMatchScene;
  reducedMotion: boolean;
  audioEnabled: boolean;
  playLockIn: () => void;
}) {
  const [displayedScene, setDisplayedScene] = useState(scene);
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (scene === displayedScene) {
      // Guards against a race where scene flips back to the currently
      // displayed value WHILE a fade-out timer is still pending (see the
      // cleanup branch below): that stale timer's cleanup fires here, but
      // `visible` could already have been left false by the in-flight fade.
      // Without this, the scene can get stuck invisible forever.
      setVisible(true);
      return;
    }
    if (reducedMotion) {
      setDisplayedScene(scene);
      setVisible(true);
      return;
    }
    // Fade the outgoing scene out, swap content, then fade back in. A
    // rapid re-change (including flipping straight back to the currently
    // displayed scene) cancels whatever transition was in flight and
    // starts fresh — the LATEST requested scene always wins.
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    setVisible(false);
    timerRef.current = window.setTimeout(() => {
      setDisplayedScene(scene);
      setVisible(true);
      timerRef.current = null;
    }, 200);
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [scene, displayedScene, reducedMotion]);

  const tournament = data.tournament;
  return (
    <div
      className={reducedMotion ? "flex h-full w-full min-h-0 items-center justify-center" : "flex h-full w-full min-h-0 items-center justify-center transition-opacity duration-200 ease-out"}
      style={{ opacity: reducedMotion ? 1 : visible ? 1 : 0 }}
    >
      {displayedScene === "idle" && <IdleScene name={tournament.name} />}
      {displayedScene === "starting_soon" && (
        <CountdownScene name={tournament.name} endsAt={tournament.countdown_ends_at} />
      )}
      {displayedScene === "teams" && <TeamsScene data={data} />}
      {displayedScene === "bracket" && (
        <BracketOrReveal data={data} reducedMotion={reducedMotion} audioEnabled={audioEnabled} playLockIn={playLockIn} />
      )}
      {displayedScene === "match" && (
        <MatchScene data={data} reducedMotion={reducedMotion} audioEnabled={audioEnabled} playLockIn={playLockIn} />
      )}
      {displayedScene === "champion" && <ChampionScene data={data} />}
    </div>
  );
}

function StageTitle({ kicker, children }: { kicker: string; children: React.ReactNode }) {
  return (
    <div className="text-center">
      <p className="text-[clamp(0.8rem,1.1vw,1.5rem)] font-medium uppercase tracking-[0.24em] text-brand-red-bright">{kicker}</p>
      <h1 className="mt-[1vh] font-display text-[clamp(3rem,7vw,8rem)] uppercase leading-[0.9] tracking-[0.03em]">{children}</h1>
    </div>
  );
}

function IdleScene({ name }: { name: string }) {
  return (
    <div className="flex flex-col items-center gap-[3vh] text-center">
      <Image src="/logo.svg" alt="LoLMK" width={180} height={200} className="h-[20vh] w-auto animate-pulse-dot" priority />
      <StageTitle kicker="Summoner's Rift">{name}</StageTitle>
    </div>
  );
}

function CountdownScene({ name, endsAt }: { name: string; endsAt: string | null }) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const update = () => setRemaining(Math.max(0, Math.ceil(((endsAt ? Date.parse(endsAt) : Date.now()) - Date.now()) / 1000)));
    update();
    const id = window.setInterval(update, 250);
    return () => window.clearInterval(id);
  }, [endsAt]);
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return (
    <div className="text-center">
      <StageTitle kicker="Starting soon">{name}</StageTitle>
      <p className="mt-[6vh] font-display text-[clamp(5rem,18vw,19rem)] tabular-nums leading-none text-brand-red-bright">
        {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
      </p>
    </div>
  );
}

function TeamsScene({ data }: { data: SrPublicTournamentFull }) {
  return (
    <div className="w-full max-w-[1500px]">
      <StageTitle kicker="Registered teams">{data.tournament.name}</StageTitle>
      <div className="mt-[5vh] grid grid-cols-2 gap-[1.2vw] lg:grid-cols-4">
        {data.teams.map((team) => (
          <div key={team.id} className="flex min-h-[10vh] items-center gap-[1vw] border border-line bg-surface/90 p-[1.2vw]">
            {team.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- tournament logos use configurable remote storage.
              <img src={team.logo_url} alt="" className="h-[5vw] w-[5vw] max-h-20 max-w-20 object-cover" />
            ) : (
              <span className="flex h-[5vw] w-[5vw] max-h-20 max-w-20 items-center justify-center border border-line-strong bg-elevated font-display text-[2vw] text-ink-muted">{team.seed ?? "–"}</span>
            )}
            <div className="min-w-0">
              <p className="truncate font-heading text-[clamp(1rem,1.5vw,1.75rem)]">{team.name}</p>
              <p className="mt-1 text-[clamp(0.65rem,0.8vw,1rem)] uppercase tracking-wider text-ink-muted">{team.players.length} players</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bracket layout
// ---------------------------------------------------------------------------
//
// Reads left to right, finals on the far right — the conventional bracket
// reading order. Upper-bracket rounds occupy the top band, lower-bracket
// rounds occupy the bottom band directly underneath, and the grand final
// sits one column to the right of whichever band has more rounds, centered
// vertically between the two bands.
//
// Column assignment is computed separately per half (upper vs lower/third
// place) by walking forward along advances_to_match_id WITHIN that half
// (stopping at the hop into grand_final) to find each match's distance from
// its half's final. That per-half depth is then flipped so round 1 sits at
// column 0 and the half's final sits at the half's max column — a real
// graph walk, not a hardcoded per-shape map, so any bracket size the engine
// produces (8/16 teams, byes, third-place, GF reset) lays out correctly.
//
// Row assignment starts from each half's earliest round (most matches, one
// row per match) and centers every later-round match on the average row of
// the matches that feed into it, so connector lines read as a clean
// binary-tree merge instead of a ragged list. The lower band is then
// shifted below the upper band's row range.
//
// Column/row positions below are INDICES, not pixels — computeBracketLayout
// never bakes in a fixed column width. Pixel x is resolved at render time
// against a column width that itself flexes with the viewport (see
// useBracketFit), so widening the bracket to fill the screen never touches
// this graph. Row pixel y IS baked in here because row height (ROW_H) is
// fixed by card height and never needs to flex.

const CARD_W = 425;
const CARD_H = 164;
const COL_GAP = 72;
const COL_W = CARD_W + COL_GAP;
const ROW_GAP = 14;
const ROW_H = CARD_H + ROW_GAP;
const HEADER_H = 32;
const HEADER_GAP = 14;
// Rows (not raw px) so it still reads correctly against ROW_H — kept small
// since it only needs to fit the header row between the two bands, not a
// proportional share of the (now much taller) card height.
const BAND_GAP_ROWS = 0.6;

interface PositionedMatch {
  match: SrPublicMatch;
  col: number;
  row: number;
}

interface HeaderSpec {
  key: string;
  col: number;
  band: "upper" | "lower";
  label: string;
}

interface ConnectorSpec {
  key: string;
  fromCol: number;
  y1: number;
  toCol: number;
  y2: number;
  dashed: boolean;
  active: boolean;
}

interface BracketLayout {
  positioned: PositionedMatch[];
  connectors: ConnectorSpec[];
  headers: HeaderSpec[];
  columnCount: number;
  rowCount: number;
  upperBandRows: number;
}

type Half = "upper" | "lower" | "final";

function halfOf(m: SrPublicMatch): Half {
  if (m.bracket === "grand_final") return "final";
  return m.bracket === "lower" || m.bracket === "third_place" ? "lower" : "upper";
}

function computeBracketLayout(matches: SrPublicMatch[]): BracketLayout {
  if (matches.length === 0) {
    return { positioned: [], connectors: [], headers: [], columnCount: 1, rowCount: 1, upperBandRows: 0 };
  }
  const byId = new Map(matches.map((m) => [m.id, m]));

  // Per-half depth: distance from THIS match to its half's terminal match
  // (the one whose advances_to target is grand_final, or has no target).
  // Walking only advances_to_match_id (never drops_to) keeps this strictly
  // within one half's progression chain.
  const halfDepthCache = new Map<string, number>();
  function halfDepthOf(m: SrPublicMatch): number {
    const cached = halfDepthCache.get(m.id);
    if (cached !== undefined) return cached;
    halfDepthCache.set(m.id, 0); // cycle guard
    let depth = 0;
    if (m.advances_to_match_id) {
      const target = byId.get(m.advances_to_match_id);
      if (target && halfOf(target) === halfOf(m)) {
        depth = halfDepthOf(target) + 1;
      }
    }
    halfDepthCache.set(m.id, depth);
    return depth;
  }
  for (const m of matches) halfDepthOf(m);

  const upperMatches = matches.filter((m) => halfOf(m) === "upper");
  const lowerMatches = matches.filter((m) => halfOf(m) === "lower");
  const finalMatches = matches.filter((m) => halfOf(m) === "final").sort((a, b) => a.round_number - b.round_number);

  const upperMaxDepth = upperMatches.length > 0 ? Math.max(...upperMatches.map(halfDepthOf)) : -1;
  const lowerMaxDepth = lowerMatches.length > 0 ? Math.max(...lowerMatches.map(halfDepthOf)) : -1;
  const gfCol = Math.max(upperMaxDepth, lowerMaxDepth) + 1;

  const colOf = new Map<string, number>();
  for (const m of upperMatches) colOf.set(m.id, upperMaxDepth - halfDepthOf(m));
  for (const m of lowerMatches) colOf.set(m.id, lowerMaxDepth - halfDepthOf(m));
  finalMatches.forEach((m, i) => colOf.set(m.id, gfCol + i));

  // Row assignment per half: earliest round gets one row per match in
  // match_number order; each later round centers on the average row of its
  // feeders (matches whose advances_to/drops_to targets it).
  const feedersOf = (m: SrPublicMatch) => matches.filter((f) => f.advances_to_match_id === m.id || f.drops_to_match_id === m.id);
  function assignRows(half: Half): Map<string, number> {
    const rowOf = new Map<string, number>();
    const inHalf = matches.filter((m) => halfOf(m) === half);
    if (inHalf.length === 0) return rowOf;
    const maxCol = Math.max(...inHalf.map((m) => colOf.get(m.id) ?? 0));
    for (let col = 0; col <= maxCol; col++) {
      const inCol = inHalf.filter((m) => colOf.get(m.id) === col).sort((a, b) => a.match_number - b.match_number);
      if (col === 0) {
        inCol.forEach((m, i) => rowOf.set(m.id, i));
        continue;
      }
      inCol.forEach((m) => {
        const feeders = feedersOf(m).filter((f) => rowOf.has(f.id));
        rowOf.set(m.id, feeders.length > 0 ? feeders.reduce((s, f) => s + (rowOf.get(f.id) ?? 0), 0) / feeders.length : 0);
      });
      const sorted = inCol.slice().sort((a, b) => (rowOf.get(a.id) ?? 0) - (rowOf.get(b.id) ?? 0));
      for (let i = 1; i < sorted.length; i++) {
        const prev = rowOf.get(sorted[i - 1].id) ?? 0;
        const cur = rowOf.get(sorted[i].id) ?? 0;
        if (cur - prev < 1) rowOf.set(sorted[i].id, prev + 1);
      }
    }
    return rowOf;
  }

  const upperRowOf = assignRows("upper");
  const lowerRowOf = assignRows("lower");

  const upperBandRows = upperRowOf.size > 0 ? Math.max(...Array.from(upperRowOf.values())) + 1 : 0;
  const rowOf = new Map<string, number>();
  for (const [id, r] of upperRowOf) rowOf.set(id, r);
  for (const [id, r] of lowerRowOf) rowOf.set(id, r + upperBandRows + BAND_GAP_ROWS);

  // Grand final: centered vertically across the combined upper+lower span.
  const nonFinalRows = matches.filter((m) => halfOf(m) !== "final").map((m) => rowOf.get(m.id) ?? 0);
  const centerRow = nonFinalRows.length > 0 ? (Math.min(...nonFinalRows) + Math.max(...nonFinalRows)) / 2 : 0;
  finalMatches.forEach((m, i) => rowOf.set(m.id, centerRow + (i - (finalMatches.length - 1) / 2) * 1.3));

  const positioned: PositionedMatch[] = matches.map((m) => ({
    match: m,
    col: colOf.get(m.id) ?? 0,
    row: rowOf.get(m.id) ?? 0,
  }));

  const columnCount = gfCol + finalMatches.length;
  // +1 row of margin below the lowest card — generous given rows can land on
  // a fractional value (grand final centering) but never more than ~0.65
  // past the last integer row.
  const rowCount = Math.max(1, ...positioned.map((p) => p.row)) + 1;

  // Headers: one label per (band, column) pair, taken from the first match
  // seen in that band/column, using round_number to keep upper vs lower
  // headers independent even when they land on the same column index.
  const headers: HeaderSpec[] = [];
  const seen = new Set<string>();
  for (const half of ["upper", "lower"] as const) {
    const inHalf = matches.filter((m) => halfOf(m) === half).sort((a, b) => (colOf.get(a.id) ?? 0) - (colOf.get(b.id) ?? 0));
    const rounds = Array.from(new Set(inHalf.map((m) => m.round_number))).sort((a, b) => a - b);
    for (const m of inHalf) {
      const key = `${half}:${colOf.get(m.id)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const idx = rounds.indexOf(m.round_number);
      const last = rounds.length - 1;
      let label: string;
      if (half === "upper") {
        label = idx === last ? "Upper final" : last >= 2 && idx === last - 1 ? "Upper semis" : `Upper R${idx + 1}`;
      } else {
        label = idx === last ? "Lower final" : `Lower R${idx + 1}`;
      }
      headers.push({ key, col: colOf.get(m.id) ?? 0, band: half, label });
    }
  }
  if (finalMatches.length > 0) {
    headers.push({ key: "final:gf", col: gfCol, band: "upper", label: "Grand final" });
  }

  const posById = new Map(positioned.map((p) => [p.match.id, p]));
  const connectors: ConnectorSpec[] = [];
  for (const m of matches) {
    const from = posById.get(m.id);
    if (!from) continue;
    for (const [targetId, dashed] of [
      [m.advances_to_match_id, false],
      [m.drops_to_match_id, true],
    ] as const) {
      if (!targetId) continue;
      const to = posById.get(targetId);
      if (!to) continue;
      // `from` is the earlier round (smaller col); `to` is the later round
      // it feeds (larger col) — draw strictly left to right. Column index
      // only; pixel x is resolved at render time against the fluid column
      // width (see useBracketFit) so widening the bracket to fill the
      // viewport never requires recomputing this graph.
      connectors.push({
        key: `${m.id}-${targetId}-${dashed}`,
        fromCol: from.col,
        y1: from.row * ROW_H + CARD_H / 2,
        toCol: to.col,
        y2: to.row * ROW_H + CARD_H / 2,
        dashed,
        active: m.status === "completed",
      });
    }
  }

  return { positioned, connectors, headers, columnCount, rowCount, upperBandRows };
}

function BracketConnector({ conn, colW }: { conn: ConnectorSpec; colW: number }) {
  const x1 = conn.fromCol * colW + CARD_W;
  const x2 = conn.toCol * colW;
  const midX = x1 + (x2 - x1) / 2;
  const d = `M ${x1} ${conn.y1} L ${midX} ${conn.y1} L ${midX} ${conn.y2} L ${x2} ${conn.y2}`;
  return (
    <path
      d={d}
      fill="none"
      stroke={conn.active ? "#BA263C" : "#2D3A52"}
      strokeWidth={conn.active ? 2.5 : 1.5}
      strokeDasharray={conn.dashed ? "4 4" : undefined}
      opacity={conn.active ? 0.9 : 0.5}
    />
  );
}

function BracketScene({ data, reducedMotion }: { data: SrPublicTournamentFull; reducedMotion: boolean }) {
  const layout = useMemo(() => computeBracketLayout(data.matches), [data.matches]);
  const teams = new Map(data.teams.map((team) => [team.id, team]));
  const { containerRef, scale, colW } = useBracketFit(layout.columnCount, layout.rowCount);
  // Right edge of the rightmost card, not columnCount*colW — those only
  // coincide when colW === CARD_W + COL_GAP, which stops holding once
  // useBracketFit stretches colW to fill spare width.
  const canvasW = (layout.columnCount - 1) * colW + CARD_W;
  const canvasH = HEADER_H + HEADER_GAP + layout.rowCount * ROW_H;

  return (
    <div className="flex h-full w-full flex-col self-stretch">
      <StageTitle kicker="Live bracket">{data.tournament.name}</StageTitle>
      <div ref={containerRef} className="relative mt-[2vh] min-h-0 w-full flex-1 overflow-hidden">
        <div
          className="absolute left-1/2 top-1/2"
          style={{
            width: canvasW,
            height: canvasH,
            transform: `translate(-50%, -50%) scale(${scale})`,
            transformOrigin: "center",
          }}
        >
          {layout.headers.map((h) => (
            <div
              key={h.key}
              className="absolute flex items-center justify-center font-medium uppercase tracking-[0.14em] text-ink-muted"
              style={{
                left: h.col * colW,
                top: h.band === "upper" ? 0 : HEADER_H + HEADER_GAP + layout.upperBandRows * ROW_H + HEADER_GAP,
                width: CARD_W,
                height: HEADER_H,
                fontSize: clampFont(15, scale, 9, 20),
              }}
            >
              {h.label}
            </div>
          ))}
          <svg
            className="pointer-events-none absolute inset-0"
            width={canvasW}
            height={layout.rowCount * ROW_H}
            style={{ top: HEADER_H + HEADER_GAP }}
            aria-hidden
          >
            {layout.connectors.map((c) => (
              <BracketConnector key={c.key} conn={c} colW={colW} />
            ))}
          </svg>
          {layout.positioned.map(({ match, col, row }) => (
            <div
              key={match.id}
              className={reducedMotion ? "absolute" : "absolute animate-[reveal-fade-in_0.4s_ease-out]"}
              style={{ left: col * colW, top: HEADER_H + HEADER_GAP + row * ROW_H, width: CARD_W, height: CARD_H }}
            >
              <LiveMatchCard match={match} teams={teams} scale={scale} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scale-to-fit — the bracket renders on a fixed logical row/column grid and
// this hook resolves BOTH the uniform scale and the column width so the
// whole tree fills its container on every axis, not just whichever one
// happens to be tightest. Row height (ROW_H) is fixed by card height, so
// canvas height only depends on rowCount; if fitting that height leaves
// spare width (columnCount * minColW < available width), the extra width
// is distributed into the column GAPS — never into the cards themselves,
// which stay a fixed size so team icons/logos never stretch or distort —
// so a wide/short viewport uses its full width instead of sitting inside
// unscaled side gutters. On a narrow/tall viewport, width becomes the
// binding dimension instead: the column gap falls back to its minimum and
// the whole canvas scales down uniformly, exactly like a standard "fit"
// transform. The canvas div is `position: absolute` inside a
// `position: relative; overflow: hidden` container so the CSS transform
// never leaves an unscaled layout footprint that could overflow or scroll.
// ---------------------------------------------------------------------------

function useBracketFit(columnCount: number, rowCount: number) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState({ scale: 1, colW: COL_W });

  useEffect(() => {
    const el = containerRef.current;
    if (!el || columnCount <= 0 || rowCount <= 0) return;
    const compute = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const canvasH = HEADER_H + HEADER_GAP + rowCount * ROW_H;
      // Right edge of the rightmost card at the minimum pitch — same
      // formula as canvasW in BracketScene, not columnCount*COL_W, which
      // over-counts one gap past the last card.
      const baseCanvasW = (columnCount - 1) * COL_W + CARD_W;
      const heightScale = rect.height / canvasH;
      const widthAtHeightScale = baseCanvasW * heightScale;
      if (widthAtHeightScale <= rect.width) {
        // Height is the binding dimension at minimum column gaps — stretch
        // the gaps (not the cards) to consume the rest of the width.
        // Single-column brackets have no gap to stretch; just center.
        if (columnCount <= 1) {
          setState({ scale: heightScale, colW: COL_W });
        } else {
          const neededCanvasW = rect.width / heightScale;
          setState({ scale: heightScale, colW: (neededCanvasW - CARD_W) / (columnCount - 1) });
        }
      } else {
        // Width is the binding dimension — uniform fit at minimum gaps.
        setState({ scale: rect.width / baseCanvasW, colW: COL_W });
      }
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [columnCount, rowCount]);

  return { containerRef, ...state };
}

// Text readability: the whole canvas (cards, icons, connectors, AND their
// font sizes) sits inside a single CSS `scale()` transform, so a raw 13px
// class would render at 13px * scale on screen — for a big bracket on a
// normal window `scale` lands well under 1, which is exactly the "too
// small to read" bug. Font sizes are computed here as `desiredScreenPx /
// scale` so the transform's own multiplication cancels back out to a
// stable on-screen size regardless of how zoomed-out the canvas is,
// clamped so text never outgrows the fixed card at very small scale
// (unavoidable on extremely small/short windows — desktop fullscreen,
// this skill's actual target, keeps them at their intended larger clamp).
function clampFont(desiredScreenPx: number, scale: number, min: number, max: number): number {
  if (scale <= 0) return max;
  return Math.min(max, Math.max(min, desiredScreenPx / scale));
}

function LiveMatchCard({ match, teams, scale }: { match: SrPublicMatch; teams: Map<string, SrPublicTeam>; scale: number }) {
  const isGrandFinal = match.bracket === "grand_final";
  return (
    <div
      className={
        isGrandFinal
          ? "relative h-full w-full border-2 border-brand-red-bright bg-gradient-to-b from-brand-red-bright/10 to-surface/95 px-2.5 py-1.5 flex flex-col justify-center gap-1 shadow-[0_0_24px_rgba(186,38,60,0.35)]"
          : "h-full w-full border border-line-subtle bg-surface/95 px-2.5 py-1.5 flex flex-col justify-center gap-1 shadow-sm"
      }
    >
      {isGrandFinal && (
        <p
          className="absolute -top-[1.6em] left-0 right-0 text-center font-medium uppercase tracking-[0.18em] text-brand-red-bright"
          style={{ fontSize: clampFont(14, scale, 9, 18) }}
        >
          {match.round_number > 1 ? "Grand final — reset" : "Grand final"}
        </p>
      )}
      <TeamScore team={teams.get(match.team_a_id ?? "")} score={match.team_a_score} winner={match.winner_id === match.team_a_id} scale={scale} />
      <div className="h-px bg-line-subtle" />
      <TeamScore team={teams.get(match.team_b_id ?? "")} score={match.team_b_score} winner={match.winner_id === match.team_b_id} scale={scale} />
    </div>
  );
}

function TeamIcon({ team }: { team?: SrPublicTeam }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [team?.logo_url]);
  return (
    <span className="h-[70px] w-[70px] shrink-0 overflow-hidden border border-line-subtle bg-elevated">
      {team?.logo_url && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- tournament logos use configurable remote storage.
        <img src={team.logo_url} alt="" className="h-full w-full object-contain" onError={() => setFailed(true)} />
      ) : null}
    </span>
  );
}

function TeamScore({ team, score, winner, scale }: { team?: SrPublicTeam; score: number; winner: boolean; scale: number }) {
  return (
    <div className={`flex items-center justify-between gap-2 ${winner ? "text-ink" : "text-ink-secondary"}`}>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <TeamIcon team={team} />
        <span className="truncate" style={{ fontSize: clampFont(18, scale, 11, 26) }}>{team?.name ?? "TBD"}</span>
      </span>
      <strong className="shrink-0 font-mono tabular-nums" style={{ fontSize: clampFont(18, scale, 11, 26) }}>{score}</strong>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Round 1 automatic reveal
// ---------------------------------------------------------------------------
//
// Purely server-timestamp driven: startUbr1Reveal stamps `ubr1_reveal_
// started_at` (now()) and a fresh `ubr1_reveal_run_id`, and every row's
// visibility here is `elapsed / REVEAL_ROW_INTERVAL_MS` against that
// timestamp — never a manually-clicked "Advance" step and never tied to
// this component's 2s poll cadence, so every viewer (and a client that
// reconnects mid-sequence) computes the identical animation frame.
//
// All rows are always mounted (never conditionally rendered) so the list's
// total height — and therefore its centered position — never shifts as
// rows reveal; only each row's opacity/entrance-transform toggles.

const REVEAL_ROW_W = 1150;
const REVEAL_ROW_H = 118;
const REVEAL_ROW_GAP = 18;

function BracketOrReveal({
  data,
  reducedMotion,
  audioEnabled,
  playLockIn,
}: {
  data: SrPublicTournamentFull;
  reducedMotion: boolean;
  audioEnabled: boolean;
  playLockIn: () => void;
}) {
  const { tournament } = data;
  const ubr1Matches = useMemo(
    () =>
      data.matches
        .filter((m) => m.bracket === "upper" && m.round_number === 1)
        .sort((a, b) => a.match_number - b.match_number),
    [data.matches],
  );
  const total = ubr1Matches.length;
  const startedAt = tournament.ubr1_reveal_started_at;
  const runId = tournament.ubr1_reveal_run_id;
  const revealDurationMs = ubr1RevealDurationMs(total);

  // Self-terminating ticker: only runs while a reveal is actually in
  // progress, and stops itself once elapsed time passes the sequence's
  // total duration — a finished/never-started reveal never re-renders on
  // a timer.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const startMs = Date.parse(startedAt);
    let id: number;
    const tick = () => {
      setNow(Date.now());
      if (Date.now() - startMs >= revealDurationMs) window.clearInterval(id);
    };
    id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [startedAt, runId, revealDurationMs]);

  const elapsed = startedAt ? Math.max(0, now - Date.parse(startedAt)) : 0;
  const visibleCount = ubr1VisibleCount(total, elapsed);
  const revealActive = total > 0 && startedAt !== null && elapsed < revealDurationMs;

  // Play the lock-in cue once per newly revealed row, keyed to this run. The
  // baseline is set on the FIRST observation of an active run WITHOUT
  // playing — a client that connects mid-sequence (or reconnects) renders
  // however many rows are already due silently, never firing a catch-up
  // burst for rows it missed.
  const lastRef = useRef<{ runId: string | null; count: number } | null>(null);
  useEffect(() => {
    if (!revealActive) {
      lastRef.current = null;
      return;
    }
    const last = lastRef.current;
    if (last && last.runId === runId && visibleCount > last.count && audioEnabled) {
      playLockIn();
    }
    lastRef.current = { runId, count: visibleCount };
  }, [revealActive, runId, visibleCount, audioEnabled, playLockIn]);

  // Small local crossfade between the reveal list and the full bracket —
  // same 200ms pattern as LiveScene's top-level scene transition — so the
  // sequence's finish reads as "fade to full bracket" rather than a cut.
  const [phase, setPhase] = useState<"reveal" | "bracket">(revealActive ? "reveal" : "bracket");
  const [fading, setFading] = useState(false);
  useEffect(() => {
    const target: "reveal" | "bracket" = revealActive ? "reveal" : "bracket";
    if (target === phase) return;
    if (reducedMotion) {
      setPhase(target);
      return;
    }
    setFading(true);
    const t = window.setTimeout(() => {
      setPhase(target);
      setFading(false);
    }, 200);
    return () => window.clearTimeout(t);
  }, [revealActive, phase, reducedMotion]);

  const teams = useMemo(() => new Map(data.teams.map((t) => [t.id, t])), [data.teams]);

  return (
    <div
      className={reducedMotion ? "flex h-full w-full min-h-0 items-center justify-center" : "flex h-full w-full min-h-0 items-center justify-center transition-opacity duration-200 ease-out"}
      style={{ opacity: reducedMotion ? 1 : fading ? 0 : 1 }}
    >
      {phase === "reveal" ? (
        <Ubr1RevealScene
          name={tournament.name}
          matches={ubr1Matches}
          teams={teams}
          visibleCount={visibleCount}
          reducedMotion={reducedMotion}
        />
      ) : (
        <BracketScene data={data} reducedMotion={reducedMotion} />
      )}
    </div>
  );
}

function useRevealFit(rowCount: number) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || rowCount <= 0) return;
    const compute = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const neededH = rowCount * REVEAL_ROW_H + Math.max(0, rowCount - 1) * REVEAL_ROW_GAP;
      setScale(Math.min(1, rect.width / REVEAL_ROW_W, rect.height / neededH));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rowCount]);
  return { containerRef, scale };
}

function Ubr1RevealScene({
  name,
  matches,
  teams,
  visibleCount,
  reducedMotion,
}: {
  name: string;
  matches: SrPublicMatch[];
  teams: Map<string, SrPublicTeam>;
  visibleCount: number;
  reducedMotion: boolean;
}) {
  const { containerRef, scale } = useRevealFit(matches.length);

  return (
    <div className="flex h-full w-full flex-col items-center">
      <StageTitle kicker="Round 1 · Upper bracket">{name}</StageTitle>
      <div ref={containerRef} className="relative mt-[3vh] min-h-0 w-full flex-1 overflow-hidden">
        <div
          className="absolute left-1/2 top-1/2 flex flex-col"
          style={{
            width: REVEAL_ROW_W,
            gap: REVEAL_ROW_GAP,
            transform: `translate(-50%, -50%) scale(${scale})`,
            transformOrigin: "center",
          }}
        >
          {matches.map((m, i) => (
            <RevealRow
              key={m.id}
              match={m}
              teams={teams}
              fromLeft={i % 2 === 0}
              revealed={i < visibleCount}
              reducedMotion={reducedMotion}
              scale={scale}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function RevealRow({
  match,
  teams,
  fromLeft,
  revealed,
  reducedMotion,
  scale,
}: {
  match: SrPublicMatch;
  teams: Map<string, SrPublicTeam>;
  fromLeft: boolean;
  revealed: boolean;
  reducedMotion: boolean;
  scale: number;
}) {
  const teamA = teams.get(match.team_a_id ?? "");
  // Round 1 always has both slots filled OR one permanent bye (never a
  // TBD-pending-a-feeder slot, since round 1 is seeded directly) — a bye
  // is labeled distinctly rather than falling through to "TBD".
  const isBye = match.status === "bye" && !match.team_b_id;
  const teamB = match.team_b_id ? teams.get(match.team_b_id) : undefined;

  const enterClass = reducedMotion
    ? "transition-opacity duration-500 ease-out"
    : fromLeft
      ? "animate-[reveal-from-left_0.5s_ease-out_forwards]"
      : "animate-[reveal-from-right_0.5s_ease-out_forwards]";

  return (
    <div
      className={`flex items-center justify-center gap-[1.2vw] border border-line-subtle bg-surface/90 px-[1.6vw] shadow-sm ${revealed ? `opacity-100 ${enterClass}` : "opacity-0"}`}
      style={{ height: REVEAL_ROW_H }}
    >
      <TeamIcon team={teamA} />
      <span className="min-w-0 flex-1 truncate text-right font-heading" style={{ fontSize: clampFont(24, scale, 13, 32) }}>
        {teamA?.name ?? "TBD"}
      </span>
      <span className="shrink-0 font-medium uppercase tracking-[0.2em] text-brand-red-bright" style={{ fontSize: clampFont(14, scale, 9, 18) }}>
        VS
      </span>
      <span className="min-w-0 flex-1 truncate text-left font-heading" style={{ fontSize: clampFont(24, scale, 13, 32) }}>
        {isBye ? "BYE" : teamB?.name ?? "TBD"}
      </span>
      {isBye ? <span className="h-[70px] w-[70px] shrink-0" aria-hidden /> : <TeamIcon team={teamB} />}
    </div>
  );
}

function MatchScene({
  data,
  reducedMotion,
  audioEnabled,
  playLockIn,
}: {
  data: SrPublicTournamentFull;
  reducedMotion: boolean;
  audioEnabled: boolean;
  playLockIn: () => void;
}) {
  const match = data.matches.find((candidate) => candidate.id === data.tournament.active_match_id);
  const teams = new Map(data.teams.map((team) => [team.id, team]));
  if (!match) {
    return (
      <BracketOrReveal data={data} reducedMotion={reducedMotion} audioEnabled={audioEnabled} playLockIn={playLockIn} />
    );
  }
  const teamA = teams.get(match.team_a_id ?? "");
  const teamB = teams.get(match.team_b_id ?? "");
  return (
    <div className="w-full max-w-[1500px] text-center">
      <StageTitle kicker={`${BRACKET_LABEL[match.bracket]} · Round ${match.round_number}`}>Current match</StageTitle>
      <div className="mt-[7vh] grid grid-cols-[1fr_auto_1fr] items-center gap-[4vw]">
        <TeamHero team={teamA} />
        <div>
          <p className="font-display text-[clamp(5rem,13vw,14rem)] tabular-nums leading-none">{match.team_a_score}<span className="px-[2vw] text-ink-muted">–</span>{match.team_b_score}</p>
          <p className="mt-[2vh] text-[clamp(0.8rem,1.2vw,1.35rem)] uppercase tracking-[0.2em] text-ink-muted">Best of {match.best_of}</p>
        </div>
        <TeamHero team={teamB} />
      </div>
    </div>
  );
}

function TeamHero({ team }: { team?: SrPublicTeam }) {
  return <div className="min-w-0"><p className="font-display text-[clamp(2rem,5vw,6rem)] uppercase leading-none">{team?.name ?? "TBD"}</p>{team?.seed && <p className="mt-[2vh] text-[clamp(0.8rem,1vw,1.2rem)] uppercase tracking-wider text-ink-muted">Seed {team.seed}</p>}</div>;
}

function ChampionScene({ data }: { data: SrPublicTournamentFull }) {
  const champion = data.teams.find((team) => team.id === data.tournament.champion_team_id);
  return (
    <div className="text-center">
      <p className="text-[clamp(1rem,1.5vw,2rem)] font-medium uppercase tracking-[0.3em] text-warning">Tournament champion</p>
      <h1 className="mt-[3vh] font-display text-[clamp(5rem,14vw,16rem)] uppercase leading-[0.85]">{champion?.name ?? "Champion"}</h1>
      <p className="mt-[4vh] font-heading text-[clamp(1.5rem,3vw,3.5rem)] text-ink-secondary">{data.tournament.name}</p>
    </div>
  );
}
