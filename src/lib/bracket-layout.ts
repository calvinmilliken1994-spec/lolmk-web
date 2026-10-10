/**
 * Bracket layout graph, shared by the venue screen (/srlive) and the public
 * tournament page. Pure: no React, no pixels except what the caller passes.
 *
 * Reads left to right, finals on the far right. Upper-bracket rounds occupy
 * the top band, lower-bracket (and third-place) rounds the band underneath,
 * and the grand final sits one column right of whichever band is longer,
 * centred vertically across both bands.
 *
 * Columns come from a graph walk along advances_to_match_id within each half
 * (stopping at the hop into the grand final), so every shape the bracket
 * engine emits (8/16 teams, byes, third place, grand-final reset) lays out
 * correctly without per-shape maps. Rows start at one per match in each
 * half's first column; every later match is centred on the average row of
 * the matches that feed it, which is what makes later-round matches sit
 * vertically centred between their two feeders.
 *
 * Positions are indices (col, row), never pixels. Callers resolve pixels
 * against their own card size, row height and column width.
 */

export interface LayoutMatch {
  id: string;
  bracket: "upper" | "lower" | "grand_final" | "third_place";
  round_number: number;
  match_number: number;
  status: string;
  advances_to_match_id: string | null;
  drops_to_match_id: string | null;
}

export interface PositionedMatch<M extends LayoutMatch> {
  match: M;
  col: number;
  row: number;
}

export interface BracketHeader {
  key: string;
  col: number;
  band: "upper" | "lower";
  label: string;
}

export interface BracketEdge {
  key: string;
  fromId: string;
  toId: string;
  fromCol: number;
  fromRow: number;
  toCol: number;
  toRow: number;
  /** Loser drop into the lower bracket. */
  dashed: boolean;
  /** The source match is decided. */
  active: boolean;
}

export interface BracketGraph<M extends LayoutMatch> {
  positioned: PositionedMatch<M>[];
  edges: BracketEdge[];
  headers: BracketHeader[];
  columnCount: number;
  /** One past the lowest row (fractional rows allowed). */
  rowCount: number;
  /** Rows taken by the upper band (the lower band starts after the gap). */
  upperBandRows: number;
  /** Rows between the bands (room for the lower band's headers). */
  bandGapRows: number;
  /** Column of the first grand-final match, or -1. */
  grandFinalCol: number;
}

type Half = "upper" | "lower" | "final";

function halfOf(m: LayoutMatch): Half {
  if (m.bracket === "grand_final") return "final";
  return m.bracket === "lower" || m.bracket === "third_place" ? "lower" : "upper";
}

export function computeBracketGraph<M extends LayoutMatch>(
  matches: M[],
  opts: { bandGapRows?: number } = {},
): BracketGraph<M> {
  const bandGapRows = opts.bandGapRows ?? 0.6;
  if (matches.length === 0) {
    return {
      positioned: [],
      edges: [],
      headers: [],
      columnCount: 1,
      rowCount: 1,
      upperBandRows: 0,
      bandGapRows,
      grandFinalCol: -1,
    };
  }
  const byId = new Map(matches.map((m) => [m.id, m]));

  // Per-half depth: distance from this match to its half's terminal match.
  // Walking only advances_to (never drops_to) keeps this within one half.
  const halfDepthCache = new Map<string, number>();
  function halfDepthOf(m: M): number {
    const cached = halfDepthCache.get(m.id);
    if (cached !== undefined) return cached;
    halfDepthCache.set(m.id, 0); // cycle guard
    let depth = 0;
    if (m.advances_to_match_id) {
      const target = byId.get(m.advances_to_match_id);
      if (target && halfOf(target) === halfOf(m)) depth = halfDepthOf(target) + 1;
    }
    halfDepthCache.set(m.id, depth);
    return depth;
  }
  for (const m of matches) halfDepthOf(m);

  const upperMatches = matches.filter((m) => halfOf(m) === "upper");
  const lowerMatches = matches.filter((m) => halfOf(m) === "lower");
  const finalMatches = matches
    .filter((m) => halfOf(m) === "final")
    .sort((a, b) => a.round_number - b.round_number);

  const upperMaxDepth = upperMatches.length > 0 ? Math.max(...upperMatches.map(halfDepthOf)) : -1;
  const lowerMaxDepth = lowerMatches.length > 0 ? Math.max(...lowerMatches.map(halfDepthOf)) : -1;
  const gfCol = Math.max(upperMaxDepth, lowerMaxDepth) + 1;

  const colOf = new Map<string, number>();
  for (const m of upperMatches) colOf.set(m.id, upperMaxDepth - halfDepthOf(m));
  for (const m of lowerMatches) colOf.set(m.id, lowerMaxDepth - halfDepthOf(m));
  finalMatches.forEach((m, i) => colOf.set(m.id, gfCol + i));

  const feedersOf = (m: M) =>
    matches.filter((f) => f.advances_to_match_id === m.id || f.drops_to_match_id === m.id);

  function assignRows(half: Half): Map<string, number> {
    const rowOf = new Map<string, number>();
    const inHalf = matches.filter((m) => halfOf(m) === half);
    if (inHalf.length === 0) return rowOf;
    const maxCol = Math.max(...inHalf.map((m) => colOf.get(m.id) ?? 0));
    for (let col = 0; col <= maxCol; col++) {
      const inCol = inHalf
        .filter((m) => colOf.get(m.id) === col)
        .sort((a, b) => a.match_number - b.match_number);
      if (col === 0) {
        inCol.forEach((m, i) => rowOf.set(m.id, i));
        continue;
      }
      inCol.forEach((m) => {
        const feeders = feedersOf(m).filter((f) => rowOf.has(f.id));
        rowOf.set(
          m.id,
          feeders.length > 0
            ? feeders.reduce((s, f) => s + (rowOf.get(f.id) ?? 0), 0) / feeders.length
            : 0,
        );
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
  for (const [id, r] of lowerRowOf) rowOf.set(id, r + upperBandRows + (upperBandRows > 0 ? bandGapRows : 0));

  // Centre the grand final between the matches that feed it (upper final and
  // lower final; in single elimination the two semis), falling back to the
  // middle of everything else.
  const firstFinal = finalMatches[0];
  const feederRows = firstFinal
    ? matches
        .filter((m) => halfOf(m) !== "final" && m.advances_to_match_id === firstFinal.id)
        .map((m) => rowOf.get(m.id) ?? 0)
    : [];
  const nonFinalRows = matches.filter((m) => halfOf(m) !== "final").map((m) => rowOf.get(m.id) ?? 0);
  const centreOn = feederRows.length > 0 ? feederRows : nonFinalRows;
  const centerRow = centreOn.length > 0 ? (Math.min(...centreOn) + Math.max(...centreOn)) / 2 : 0;
  finalMatches.forEach((m, i) =>
    rowOf.set(m.id, centerRow + (i - (finalMatches.length - 1) / 2) * 1.3),
  );

  // Single elimination: the third-place match is played alongside the final,
  // so it sits in the final's column, just below it.
  const thirdPlace = matches.filter((m) => m.bracket === "third_place");
  const singleElim = !matches.some((m) => m.bracket === "lower");
  if (singleElim && firstFinal && thirdPlace.length > 0) {
    const finalRow = rowOf.get(firstFinal.id) ?? 0;
    thirdPlace.forEach((m, i) => {
      colOf.set(m.id, gfCol);
      rowOf.set(m.id, finalRow + 1.6 + i);
    });
  }

  const positioned: PositionedMatch<M>[] = matches.map((m) => ({
    match: m,
    col: colOf.get(m.id) ?? 0,
    row: rowOf.get(m.id) ?? 0,
  }));

  const columnCount = gfCol + finalMatches.length;
  const rowCount = Math.max(1, ...positioned.map((p) => p.row)) + 1;

  const headers: BracketHeader[] = [];
  const seen = new Set<string>();
  for (const half of ["upper", "lower"] as const) {
    const inHalf = matches
      .filter((m) => halfOf(m) === half)
      .sort((a, b) => (colOf.get(a.id) ?? 0) - (colOf.get(b.id) ?? 0));
    const rounds = Array.from(new Set(inHalf.map((m) => m.round_number))).sort((a, b) => a - b);
    for (const m of inHalf) {
      const key = `${half}:${colOf.get(m.id)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const idx = rounds.indexOf(m.round_number);
      const last = rounds.length - 1;
      let label: string;
      if (m.bracket === "third_place") label = "Third place";
      else if (half === "upper") {
        label =
          idx === last ? "Upper final" : last >= 2 && idx === last - 1 ? "Upper semis" : `Upper R${idx + 1}`;
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
  const edges: BracketEdge[] = [];
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
      edges.push({
        key: `${m.id}-${targetId}-${dashed}`,
        fromId: m.id,
        toId: targetId,
        fromCol: from.col,
        fromRow: from.row,
        toCol: to.col,
        toRow: to.row,
        dashed,
        active: m.status === "completed",
      });
    }
  }

  return {
    positioned,
    edges,
    headers,
    columnCount,
    rowCount,
    upperBandRows,
    bandGapRows,
    grandFinalCol: finalMatches.length > 0 ? gfCol : -1,
  };
}

/**
 * The match that decided the tournament: the latest completed grand final
 * (the reset when one was played); in single elimination, the completed
 * final. Null while undecided.
 */
export function decidingFinalId<M extends LayoutMatch>(matches: M[]): string | null {
  const gf = matches
    .filter((m) => m.bracket === "grand_final" && m.status === "completed")
    .sort((a, b) => b.round_number - a.round_number)[0];
  if (gf) return gf.id;
  if (matches.some((m) => m.bracket === "grand_final" || m.bracket === "lower")) return null;
  const final = matches.find(
    (m) => m.bracket === "upper" && !m.advances_to_match_id && m.status === "completed",
  );
  return final?.id ?? null;
}
