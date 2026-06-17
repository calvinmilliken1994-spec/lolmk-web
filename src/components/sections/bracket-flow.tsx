import { Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Match, Team } from "@/types/tournament";

// Two layouts: 8-team is fully integrated (5 cols incl. GF in the grid);
// 16-team has 6 cols in the grid + a separate "Final" section below for the
// lower final and grand final, because cramming both into the grid forces
// same-column connectors that read poorly.

interface SizeConfig {
  CARD_WIDTH: number;
  CARD_HEIGHT: number;
  COL_GAP: number;
  COL_WIDTH: number;
  ROW_HEIGHT: number;
  HEADER_HEIGHT: number;
  COLUMNS: number;
}

// Cards are 100px tall so each team row is ~42px (32px logo + 5px breathing
// room top/bottom). 32×32 is the slot reserved for real team icons when
// `team.logo_url` is populated — fit without re-layout.
const SIZE_8: SizeConfig = {
  CARD_WIDTH: 260,
  CARD_HEIGHT: 100,
  COL_GAP: 28,
  COL_WIDTH: 260 + 28,
  ROW_HEIGHT: 128,
  HEADER_HEIGHT: 56,
  COLUMNS: 5,
};

const SIZE_16: SizeConfig = {
  CARD_WIDTH: 240,
  CARD_HEIGHT: 100,
  COL_GAP: 20,
  COL_WIDTH: 240 + 20,
  ROW_HEIGHT: 120,
  HEADER_HEIGHT: 56,
  COLUMNS: 8,
};

interface Position {
  col: number;
  row: number;
}

// Placements key on match_number (sequential 1..N per tournament) rather
// than match ID. The bot generates nanoid match IDs which differ from the
// "m1, m2, ..." used in placeholder JSON files, but match_number is always
// 1-indexed and deterministic.

const PLACEMENT_8: Record<number, Position> = {
  1: { col: 0, row: 0 },
  2: { col: 0, row: 1.5 },
  3: { col: 0, row: 3 },
  4: { col: 0, row: 4.5 },
  5: { col: 1, row: 0.75 },
  6: { col: 1, row: 3.75 },
  7: { col: 2, row: 2.25 },
  8: { col: 1, row: 6 },
  9: { col: 1, row: 7.5 },
  10: { col: 2, row: 6 },
  11: { col: 2, row: 7.5 },
  12: { col: 3, row: 6 },
  13: { col: 3, row: 7.5 },
  14: { col: 4, row: 4.875 },
};

// PLACEMENT_12 — 12-team double elim (23 matches), 8 columns.
//
// All matches (including Grand Final) live in the main grid — no separate
// FinalSection — so the column header above each card describes the round
// that's actually in that column. Same architecture as PLACEMENT_8.
//
// Layout summary (cols 0-7):
//   Col 0 — UR1 (m1-m4): 4 first-round matches, bottom 8 seeds
//   Col 1 — UR2 + LR1 (m5-m8, m12-m13): top 4 seeds enter UR2 here
//   Col 2 — UR3 + LR2 + LR3 (m9-m10, m14-m16)
//   Col 3 — UR4 (Upper Final, m11) + LR4 consolidation (m17)
//   Col 4 — LR5 (m18)
//   Col 5 — LR6 (m19): drop UR3-A loser in
//   Col 6 — LR7 (m20) + LR8 / Lower Final (m21)
//   Col 7 — Grand Final (m22). m23 (reset) hidden when forfeit.
const PLACEMENT_12: Record<number, Position> = {
  // Upper bracket
  1: { col: 0, row: 0 },
  2: { col: 0, row: 1.5 },
  3: { col: 0, row: 3 },
  4: { col: 0, row: 4.5 },
  5: { col: 1, row: 0 },
  6: { col: 1, row: 1.5 },
  7: { col: 1, row: 3 },
  8: { col: 1, row: 4.5 },
  9: { col: 2, row: 0.75 },
  10: { col: 2, row: 3.75 },
  11: { col: 3, row: 2.25 },

  // Lower bracket
  12: { col: 1, row: 7 },
  13: { col: 1, row: 8.5 },
  14: { col: 2, row: 7 },
  15: { col: 2, row: 8.5 },
  16: { col: 2, row: 10.25 },
  17: { col: 3, row: 7.75 },
  18: { col: 4, row: 9 },
  19: { col: 5, row: 8 },
  20: { col: 6, row: 7.5 },
  21: { col: 6, row: 9.5 },

  // Grand Final + Reset
  22: { col: 7, row: 5.875 },
  // 23 (reset) hidden when forfeit
};

// PLACEMENT_16 — 16-team double elim (31 matches), 8 columns. All matches
// (including Lower Final m29 and Grand Final m30) live in the main grid —
// no separate FinalSection. Reset m31 hidden when forfeit.
const PLACEMENT_16: Record<number, Position> = {
  // Upper bracket — clean 2^N tree (cols 0-3)
  1: { col: 0, row: 0 },
  2: { col: 0, row: 1.5 },
  3: { col: 0, row: 3 },
  4: { col: 0, row: 4.5 },
  5: { col: 0, row: 6 },
  6: { col: 0, row: 7.5 },
  7: { col: 0, row: 9 },
  8: { col: 0, row: 10.5 },
  9: { col: 1, row: 0.75 },
  10: { col: 1, row: 3.75 },
  11: { col: 1, row: 6.75 },
  12: { col: 1, row: 9.75 },
  13: { col: 2, row: 2.25 },
  14: { col: 2, row: 8.25 },
  15: { col: 3, row: 5.25 },

  // Lower bracket (cols 1-6)
  16: { col: 1, row: 13 },
  17: { col: 1, row: 14.5 },
  18: { col: 1, row: 16 },
  19: { col: 1, row: 17.5 },
  20: { col: 2, row: 13 },
  21: { col: 2, row: 14.5 },
  22: { col: 2, row: 16 },
  23: { col: 2, row: 17.5 },
  24: { col: 3, row: 13.75 },
  25: { col: 3, row: 16.75 },
  26: { col: 4, row: 13.75 },
  27: { col: 4, row: 16.75 },
  28: { col: 5, row: 15.25 },
  29: { col: 6, row: 15.25 },

  // Grand Final
  30: { col: 7, row: 10.25 },
  // 31 (reset) hidden when forfeit
};

const DEFAULT_WEEKS_8 = ["Week 1", "Week 2", "Week 3", "Week 4", "Grand Final"];
const DEFAULT_WEEKS_12 = [
  "Week 1",
  "Week 2",
  "Week 3",
  "Week 4",
  "Week 5",
  "Week 6",
  "Week 7",
  "Grand Final",
];
const DEFAULT_WEEKS_16 = [
  "Week 1",
  "Week 2",
  "Week 3",
  "Week 4",
  "Week 5",
  "Week 6",
  "Week 7",
  "Grand Final",
];

type LayoutSize = 8 | 12 | 16;

interface BracketFlowProps {
  matches: Match[];
  teams: Team[];
  /**
   * Optional explicit override. Defaults to auto-detecting from the count of
   * approved teams: ≤8 → 8-layout · 9–12 → 12-layout · 13–16 → 16-layout.
   * Odd counts use the next-up even layout with one random bye (handled
   * upstream by the bot — the page just renders whatever match data arrives).
   */
  teamCount?: LayoutSize;
  weekLabels?: string[];
}

function pickLayout(teams: Team[], explicit?: LayoutSize): LayoutSize {
  if (explicit) return explicit;
  const approved = teams.filter((t) => t.status === "approved").length;
  if (approved <= 8) return 8;
  if (approved <= 12) return 12;
  return 16;
}

function placementFor(layout: LayoutSize): Record<number, Position> {
  switch (layout) {
    case 8:
      return PLACEMENT_8;
    case 12:
      return PLACEMENT_12;
    case 16:
      return PLACEMENT_16;
  }
}

function sizeFor(layout: LayoutSize): SizeConfig {
  // 12-team uses the 6-column SIZE_16 footprint, just with PLACEMENT_12.
  return layout === 8 ? SIZE_8 : SIZE_16;
}

function defaultLabelsFor(layout: LayoutSize): string[] {
  switch (layout) {
    case 8:
      return DEFAULT_WEEKS_8;
    case 12:
      return DEFAULT_WEEKS_12;
    case 16:
      return DEFAULT_WEEKS_16;
  }
}

export function BracketFlow({
  matches,
  teams,
  teamCount,
  weekLabels,
}: BracketFlowProps) {
  const layout = pickLayout(teams, teamCount);
  const placement = placementFor(layout);
  const size = sizeFor(layout);
  const labels = weekLabels ?? defaultLabelsFor(layout);
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const inGrid = matches.filter(
    (m) => placement[m.match_number] !== undefined,
  );
  const positioned = inGrid.map((m) => {
    const p = placement[m.match_number]!;
    return {
      match: m,
      x: p.col * size.COL_WIDTH,
      y: p.row * size.ROW_HEIGHT + size.HEADER_HEIGHT,
    };
  });
  const positionById = new Map(positioned.map((p) => [p.match.id, p]));

  const canvasWidth = size.COLUMNS * size.COL_WIDTH - size.COL_GAP;
  const canvasHeight =
    positioned.length > 0
      ? Math.max(...positioned.map((p) => p.y + size.CARD_HEIGHT)) + 32
      : 400;

  const connectors = [
    ...positioned
      .filter(({ match }) => match.drops_to_match_id)
      .map(({ match, x, y }) => {
        const target = positionById.get(match.drops_to_match_id ?? "");
        if (!target) return null;
        return buildConnector({
          fromX: x + size.CARD_WIDTH,
          fromY: y + size.CARD_HEIGHT / 2,
          toX: target.x,
          toY: target.y + size.CARD_HEIGHT / 2,
          key: `drop-${match.id}`,
          completed: match.status === "completed",
          kind: "drop",
        });
      })
      .filter(Boolean),
    ...positioned
      .filter(({ match }) => match.advances_to_match_id)
      .map(({ match, x, y }) => {
        const target = positionById.get(match.advances_to_match_id ?? "");
        if (!target) return null;
        return buildConnector({
          fromX: x + size.CARD_WIDTH,
          fromY: y + size.CARD_HEIGHT / 2,
          toX: target.x,
          toY: target.y + size.CARD_HEIGHT / 2,
          key: `adv-${match.id}`,
          completed: match.status === "completed",
          kind: match.bracket === "lower" ? "lower" : "upper",
        });
      })
      .filter(Boolean),
  ];

  // All layouts now keep Grand Final + Lower Final inside the main grid (no
  // separate FinalSection). The column header above each match describes the
  // round in that column, matching the 8-team layout style.

  return (
    <div>
      <div className="overflow-x-auto pb-4">
        {/* Inner canvas: width: 100% fills the parent container; min-width
            keeps it readable on narrow screens (parent's overflow-x-auto
            kicks in). On wide screens the canvas stretches and the SVG +
            cards scale horizontally via percentages / viewBox. */}
        <div
          className="relative"
          style={{
            width: "100%",
            minWidth: `${canvasWidth}px`,
            height: `${canvasHeight}px`,
          }}
        >
          <svg
            className="absolute inset-0 pointer-events-none"
            width="100%"
            height={canvasHeight}
            viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
            preserveAspectRatio="none"
            aria-hidden
          >
            {connectors}
          </svg>

          <div
            className="absolute inset-x-0 top-0 grid"
            style={{
              gridTemplateColumns: `repeat(${size.COLUMNS}, 1fr)`,
              height: `${size.HEADER_HEIGHT}px`,
            }}
          >
            {labels.map((label, i) => (
              <div key={i} className="flex items-center gap-3 pl-1 min-w-0">
                <div className="h-3 w-0.5 bg-brand-red shrink-0" aria-hidden />
                <p className="text-label uppercase text-ink-secondary tracking-wider truncate">
                  {label}
                </p>
              </div>
            ))}
          </div>

          <div
            aria-hidden
            className="absolute left-0 right-0 h-px bg-line-subtle"
            style={{ top: `${size.HEADER_HEIGHT - 1}px` }}
          />

          {positioned.map(({ match, x, y }) => (
            <div
              key={match.id}
              className="absolute"
              style={{
                left: `${(x / canvasWidth) * 100}%`,
                top: `${y}px`,
                width: `${(size.CARD_WIDTH / canvasWidth) * 100}%`,
                height: `${size.CARD_HEIGHT}px`,
              }}
            >
              <MatchCard match={match} teamById={teamById} />
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

// ---------------------------------------------------------------------------
// Connector builder (sharp step path)
// ---------------------------------------------------------------------------

interface ConnectorArgs {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  key: string;
  completed: boolean;
  kind: "upper" | "lower" | "drop";
}

function buildConnector({
  fromX,
  fromY,
  toX,
  toY,
  key,
  completed,
  kind,
}: ConnectorArgs) {
  const elbowX = fromX + (toX - fromX) / 2;
  const path = `M ${fromX} ${fromY} L ${elbowX} ${fromY} L ${elbowX} ${toY} L ${toX} ${toY}`;

  const color =
    kind === "upper"
      ? completed
        ? "#BA263C"
        : "#2D3A52"
      : kind === "lower"
        ? completed
          ? "#4A65A8"
          : "#2D3A52"
        : completed
          ? "#283D74"
          : "#1F2937";

  const opacity = completed ? 0.85 : 0.35;
  const dasharray = kind === "drop" ? "4 4" : undefined;

  return (
    <path
      key={key}
      d={path}
      stroke={color}
      strokeWidth={2}
      fill="none"
      opacity={opacity}
      strokeDasharray={dasharray}
      strokeLinecap="square"
      strokeLinejoin="miter"
      vectorEffect="non-scaling-stroke"
    />
  );
}

// ---------------------------------------------------------------------------
// Match card
// ---------------------------------------------------------------------------

interface MatchCardProps {
  match: Match;
  teamById: Map<string, Team>;
}

function MatchCard({ match, teamById }: MatchCardProps) {
  const teamA = match.team_a_id ? teamById.get(match.team_a_id) ?? null : null;
  const teamB = match.team_b_id ? teamById.get(match.team_b_id) ?? null : null;
  const isCompleted = match.status === "completed";
  const aWon = isCompleted && match.winner_id === match.team_a_id;
  const bWon = isCompleted && match.winner_id === match.team_b_id;
  const isGrandFinal = match.bracket === "grand_final";

  return (
    <div
      className={cn(
        "h-full bg-surface border flex flex-col",
        // Champion celebration glow: layered brand-red box-shadow. The tight
        // 32px halo + wider 96px bloom reads as victory without leaking into
        // the rest of the bracket.
        isGrandFinal
          ? "border-brand-red shadow-[0_0_32px_rgba(186,38,60,0.55),0_0_96px_rgba(186,38,60,0.25)]"
          : "border-line",
      )}
    >
      <div
        className={cn(
          "px-2 py-1 border-b flex items-center justify-between leading-none",
          isGrandFinal
            ? "border-brand-red/40 bg-brand-red/10"
            : "border-line-subtle",
        )}
      >
        <span className="text-[11px] font-mono uppercase tracking-wider text-ink-muted">
          M{match.match_number}
        </span>
        {isGrandFinal && (
          <span className="text-[11px] uppercase tracking-wider text-brand-red-bright font-semibold">
            Grand Final
          </span>
        )}
      </div>
      <TeamRow
        team={teamA}
        score={match.team_a_score}
        won={aWon}
        dim={isCompleted && !aWon}
        isBye={isCompleted && teamA === null && teamB !== null}
      />
      <div className="h-px bg-line-subtle" />
      <TeamRow
        team={teamB}
        score={match.team_b_score}
        won={bWon}
        dim={isCompleted && !bWon}
        isBye={isCompleted && teamB === null && teamA !== null}
      />
    </div>
  );
}

interface TeamRowProps {
  team: Team | null;
  score: number | null;
  won: boolean;
  dim: boolean;
  isBye?: boolean;
}

function TeamRow({ team, score, won, dim, isBye }: TeamRowProps) {
  return (
    <div
      className={cn(
        "flex-1 flex items-center gap-3 pl-1 pr-2",
        won && "bg-elevated",
      )}
    >
      <div
        className={cn(
          "w-1 self-stretch",
          won ? "bg-brand-red" : "bg-transparent",
        )}
        aria-hidden
      />
      {team ? (
        // Team logo placeholder. When `team.logo_url` is wired up, swap this
        // for an <Image> at the same 32×32 footprint.
        <div
          className="h-8 w-8 shrink-0 border"
          style={{
            backgroundColor: team.color ?? "#1A2240",
            borderColor: team.color ?? "#2D3A52",
          }}
          aria-hidden
        />
      ) : (
        <div
          className="h-8 w-8 bg-elevated border border-line-subtle shrink-0"
          aria-hidden
        />
      )}
      <div className="flex-1 min-w-0">
        {team ? (
          <p
            className={cn(
              "font-heading text-[14px] font-semibold leading-tight truncate",
              won ? "text-ink" : dim ? "text-ink-muted" : "text-ink-secondary",
            )}
          >
            {team.name}
          </p>
        ) : isBye ? (
          <p className="text-[11px] font-mono uppercase tracking-widest text-ink-muted">
            Bye
          </p>
        ) : (
          <p className="text-[14px] text-ink-disabled italic">TBD</p>
        )}
      </div>
      {won && (
        <Trophy
          strokeWidth={1.5}
          className="h-5 w-5 text-warning shrink-0"
          aria-label="Winner"
        />
      )}
      <div
        className={cn(
          "shrink-0 w-8 h-7 flex items-center justify-center font-display text-[16px] tabular leading-none",
          won
            ? "bg-brand-red text-ink"
            : "bg-elevated text-ink-muted border border-line-subtle",
        )}
      >
        {score ?? "—"}
      </div>
    </div>
  );
}
