import { Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { computeBracketGraph, decidingFinalId, type BracketHeader } from "@/lib/bracket-layout";
import type { SrPublicMatch, SrPublicTeam } from "@/types/sr-tournament";

/**
 * Public bracket for Summoner's Rift tournaments.
 *
 * Built on the same layout graph as the venue screen
 * (computeBracketGraph in @/lib/bracket-layout): columns from a walk along
 * the feeder links, later-round matches centred on the matches that feed
 * them, connectors drawn as SVG elbows from those same coordinates. Every
 * shape the bracket engine emits (8 to 16 teams, byes, third place,
 * grand-final reset) lays out without per-shape maps, and no client JS is
 * needed: positions are computed on the server.
 *
 * Loser drops into the lower bracket aren't drawn as lines (they would cross
 * the whole canvas); an empty slot says where its team comes from instead.
 *
 * On narrow screens the canvas scrolls horizontally inside its own box. The
 * round headers are part of the canvas, so they stay over their columns.
 */

const CARD_W = 248;
const TEAM_ROW_H = 40;
const CARD_H = TEAM_ROW_H * 2 + 1;
const ROW_GAP = 20;
const ROW_H = CARD_H + ROW_GAP;
const COL_GAP = 56;
const COL_W = CARD_W + COL_GAP;
const BAND_TITLE_H = 30;
const HEADER_H = 22;
const HEADER_GAP = 10;
const TOP = BAND_TITLE_H + HEADER_H + HEADER_GAP;
const BAND_GAP_ROWS = 1;

export function SrPublicBracket({
  matches,
  teams,
  championTeamId,
}: {
  matches: SrPublicMatch[];
  teams: SrPublicTeam[];
  championTeamId: string | null;
}) {
  const teamById = new Map(teams.map((t) => [t.id, t]));

  // A fully-dead bye (no team on either side, nothing played) carries no
  // information; the engine emits these for non-power-of-two brackets.
  const visible = matches.filter(
    (m) =>
      !(m.status === "bye" && !m.winner_id && !m.team_a_id && !m.team_b_id),
  );

  if (visible.length === 0) {
    return (
      <p className="border border-ds-line bg-ds-surface p-10 text-ds-body text-ds-text-muted">
        The bracket goes up here the moment it&apos;s drawn.
      </p>
    );
  }

  const graph = computeBracketGraph(visible, { bandGapRows: BAND_GAP_ROWS });
  const hasLower = visible.some((m) => m.bracket === "lower");
  const upperCols = new Set(
    graph.positioned.filter((p) => p.match.bracket === "upper").map((p) => p.col),
  ).size;
  const hasFinal = visible.some((m) => m.bracket === "grand_final");
  const headers = graph.headers.map((h) =>
    hasLower ? h : singleElimLabel(h, upperCols, hasFinal),
  );

  // The trophy marks the champion once: on their row in the deciding final
  // (the grand-final reset when one was played), not in every round won.
  const decidingFinal = decidingFinalId(visible);

  const posById = new Map(graph.positioned.map((p) => [p.match.id, p]));
  const headerFor = (m: SrPublicMatch) => {
    const p = posById.get(m.id);
    if (!p) return null;
    const band = m.bracket === "upper" ? "upper" : "lower";
    return (
      headers.find((h) => h.col === p.col && h.band === band)?.label ?? null
    );
  };

  // Where an empty slot's team will come from: "Winner of Upper R1, match 2".
  const sourceLabel = (
    target: SrPublicMatch,
    slot: "a" | "b",
  ): string | null => {
    const feeder = visible.find(
      (f) =>
        (f.advances_to_match_id === target.id && f.advances_to_slot === slot) ||
        (f.drops_to_match_id === target.id && f.drops_to_slot === slot),
    );
    if (!feeder) return null;
    const verb = feeder.drops_to_match_id === target.id ? "Loser" : "Winner";
    const label = headerFor(feeder);
    const fp = posById.get(feeder.id);
    const sameCol = graph.positioned
      .filter(
        (p) => fp && p.col === fp.col && p.match.bracket === feeder.bracket,
      )
      .sort((a, b) => a.row - b.row);
    const idx = sameCol.findIndex((p) => p.match.id === feeder.id) + 1;
    return label
      ? `${verb} of ${label}${sameCol.length > 1 ? `, match ${idx}` : ""}`
      : null;
  };

  const lowerTop = TOP + (graph.upperBandRows + BAND_GAP_ROWS) * ROW_H;
  const canvasW = (graph.columnCount - 1) * COL_W + CARD_W;
  const canvasH = TOP + graph.rowCount * ROW_H;
  const finals = graph.positioned
    .filter((p) => p.match.bracket === "grand_final")
    .sort((a, b) => a.col - b.col);

  return (
    <div
      className="overflow-x-auto border border-ds-line bg-ds-ground"
      role="region"
      aria-label="Bracket"
      tabIndex={0}
    >
      <div className="w-max p-6">
        <div className="relative" style={{ width: canvasW, height: canvasH }}>
          <BandTitle top={0}>
            {hasLower ? "Upper bracket" : "Bracket"}
          </BandTitle>
          {hasLower && (
            <BandTitle top={lowerTop - HEADER_GAP - HEADER_H - BAND_TITLE_H}>
              Lower bracket
            </BandTitle>
          )}

          {/* Round headers. Grand-final headers sit directly above their card. */}
          {headers
            .filter((h) => h.key !== "final:gf" && (hasLower || h.band === "upper"))
            .map((h) => (
              <RoundHeader
                key={h.key}
                left={h.col * COL_W}
                top={
                  h.band === "upper"
                    ? BAND_TITLE_H
                    : lowerTop - HEADER_GAP - HEADER_H
                }
              >
                {h.label}
              </RoundHeader>
            ))}
          {finals.map((p, i) => (
            <RoundHeader
              key={p.match.id}
              left={p.col * COL_W}
              top={TOP + p.row * ROW_H - HEADER_GAP - HEADER_H}
              strong
            >
              {!hasLower ? "Final" : i === 0 ? "Grand final" : "Grand final reset"}
            </RoundHeader>
          ))}
          {!hasLower &&
            graph.positioned
              .filter((p) => p.match.bracket === "third_place")
              .map((p) => (
                <RoundHeader
                  key={p.match.id}
                  left={p.col * COL_W}
                  top={TOP + p.row * ROW_H - HEADER_GAP - HEADER_H}
                >
                  Third place
                </RoundHeader>
              ))}

          <svg
            aria-hidden
            className="pointer-events-none absolute left-0 top-0"
            width={canvasW}
            height={canvasH}
          >
            {graph.edges
              .filter((e) => !e.dashed)
              .map((e) => {
                const x1 = e.fromCol * COL_W + CARD_W;
                const x2 = e.toCol * COL_W;
                const y1 = TOP + e.fromRow * ROW_H + CARD_H / 2;
                const y2 = TOP + e.toRow * ROW_H + CARD_H / 2;
                const midX = x1 + (x2 - x1) / 2;
                return (
                  <path
                    key={e.key}
                    d={`M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`}
                    fill="none"
                    stroke={e.active ? "#BA263C" : "#3A4C85"}
                    strokeWidth={e.active ? 2 : 1.5}
                  />
                );
              })}
            {/* The reset isn't linked to the first grand final in the data; join them visually. */}
            {finals.slice(1).map((p, i) => {
              const prev = finals[i];
              const x1 = prev.col * COL_W + CARD_W;
              const x2 = p.col * COL_W;
              const y1 = TOP + prev.row * ROW_H + CARD_H / 2;
              const y2 = TOP + p.row * ROW_H + CARD_H / 2;
              const midX = x1 + (x2 - x1) / 2;
              return (
                <path
                  key={`reset-${p.match.id}`}
                  d={`M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`}
                  fill="none"
                  stroke={prev.match.status === "completed" ? "#BA263C" : "#3A4C85"}
                  strokeWidth={prev.match.status === "completed" ? 2 : 1.5}
                />
              );
            })}
          </svg>

          {graph.positioned.map(({ match, col, row }) => (
            <div
              key={match.id}
              className="absolute"
              style={{
                left: col * COL_W,
                top: TOP + row * ROW_H,
                width: CARD_W,
                height: CARD_H,
              }}
            >
              <MatchCard
                match={match}
                teamById={teamById}
                championTeamId={
                  match.id === decidingFinal ? championTeamId : null
                }
                sourceA={match.team_a_id ? null : sourceLabel(match, "a")}
                sourceB={match.team_b_id ? null : sourceLabel(match, "b")}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Single elimination: name rounds by how far they are from the final
 * (Final, Semifinals, Quarterfinals), since "Upper" means nothing without a
 * lower bracket. The engine stores the single-elim final as `grand_final`.
 */
function singleElimLabel(h: BracketHeader, upperCols: number, hasFinal: boolean): BracketHeader {
  if (h.key === "final:gf") return { ...h, label: "Final" };
  if (h.band !== "upper") return h;
  const totalRounds = upperCols + (hasFinal ? 1 : 0);
  const fromEnd = totalRounds - h.col;
  const label =
    fromEnd === 1 ? "Final" : fromEnd === 2 ? "Semifinals" : fromEnd === 3 ? "Quarterfinals" : `Round ${h.col + 1}`;
  return { ...h, label };
}

function BandTitle({
  top,
  children,
}: {
  top: number;
  children: React.ReactNode;
}) {
  return (
    <p
      className="absolute left-0 m-0 flex items-center whitespace-nowrap font-display text-[24px] leading-none text-ds-text"
      style={{ top, height: BAND_TITLE_H }}
    >
      {children}
    </p>
  );
}

function RoundHeader({
  left,
  top,
  strong,
  children,
}: {
  left: number;
  top: number;
  strong?: boolean;
  children: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        "absolute m-0 flex items-center font-heading text-ds-label",
        strong ? "font-semibold text-ds-text" : "text-ds-text-dim",
      )}
      style={{ left, top, width: CARD_W, height: HEADER_H }}
    >
      {children}
    </p>
  );
}

function MatchCard({
  match,
  teamById,
  championTeamId,
  sourceA,
  sourceB,
}: {
  match: SrPublicMatch;
  teamById: Map<string, SrPublicTeam>;
  championTeamId: string | null;
  sourceA: string | null;
  sourceB: string | null;
}) {
  const done = match.status === "completed";
  const bye = match.status === "bye";
  return (
    <article
      className={cn(
        "h-full border bg-ds-surface",
        done ? "border-ds-line-strong" : "border-ds-line",
      )}
    >
      <TeamRow
        team={match.team_a_id ? teamById.get(match.team_a_id) : undefined}
        score={match.team_a_score}
        won={
          (done || bye) &&
          match.winner_id !== null &&
          match.winner_id === match.team_a_id
        }
        showScore={done}
        isChampion={
          Boolean(championTeamId) && match.team_a_id === championTeamId
        }
        emptyLabel={bye ? "Bye" : sourceA}
      />
      <div className="h-px bg-ds-line-soft" />
      <TeamRow
        team={match.team_b_id ? teamById.get(match.team_b_id) : undefined}
        score={match.team_b_score}
        won={
          (done || bye) &&
          match.winner_id !== null &&
          match.winner_id === match.team_b_id
        }
        showScore={done}
        isChampion={
          Boolean(championTeamId) && match.team_b_id === championTeamId
        }
        emptyLabel={bye ? "Bye" : sourceB}
      />
    </article>
  );
}

function TeamRow({
  team,
  score,
  won,
  showScore,
  isChampion,
  emptyLabel,
}: {
  team: SrPublicTeam | undefined;
  score: number;
  won: boolean;
  showScore: boolean;
  isChampion: boolean;
  emptyLabel: string | null;
}) {
  return (
    <div className="flex items-stretch" style={{ height: TEAM_ROW_H }}>
      <div className="flex min-w-0 flex-1 items-center gap-2.5 px-3">
        {team?.logo_url ? (
          // Blob-hosted logos live on a per-store hostname with no next/image remotePatterns entry.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={team.logo_url}
            alt=""
            width={24}
            height={24}
            className="h-6 w-6 shrink-0 object-cover"
          />
        ) : team && team.seed !== null ? (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center bg-ds-line-soft font-heading text-[12px] font-semibold tabular-nums text-ds-text-muted">
            {team.seed}
          </span>
        ) : null}
        {team ? (
          <span
            title={team.name}
            className={cn(
              "min-w-0 flex-1 truncate font-heading text-[15px]",
              won ? "font-bold text-white" : "font-medium text-ds-text-muted",
            )}
          >
            {team.name}
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[13px] text-ds-text-dim">
            {emptyLabel ?? ""}
          </span>
        )}
        {isChampion && (
          <Trophy
            aria-label="Champion"
            strokeWidth={1.75}
            className="h-4 w-4 shrink-0 text-ds-gold"
          />
        )}
      </div>
      {showScore && (
        <span
          className={cn(
            "flex w-10 shrink-0 items-center justify-center font-heading text-[15px] font-semibold tabular-nums",
            won ? "bg-ds-red text-white" : "text-ds-text-dim",
          )}
        >
          {score}
        </span>
      )}
    </div>
  );
}
