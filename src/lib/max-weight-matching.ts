// Maximum-weight matching in a general (non-bipartite) graph: Edmonds'
// blossom algorithm with dual variables, O(n^3).
//
// A TypeScript port of Joris van Rantwijk's public-domain reference
// implementation (mwmatching.py), which is also what NetworkX's
// max_weight_matching is derived from. The structure, variable names and
// comments follow that implementation so it can be checked line by line
// against the original. Python's negative list indexing is replaced by the
// `at()` helper below.
//
// Pure TypeScript — no imports. Used by the Swiss pairing engine
// (src/lib/swiss-engine.ts). Tested against brute force in
// scripts/test-swiss-engine.ts.
//
// Integer weights keep every computation integral (dual variables only ever
// move by integers or by half of an even slack), so results are exact as
// long as weights stay well below Number.MAX_SAFE_INTEGER / 4.

/** [vertexI, vertexJ, weight]. Vertices are non-negative integers, i !== j. */
export type WeightedEdge = [number, number, number];

/** Python-style index: negative values count from the end. */
function at<T>(arr: T[], j: number): T {
  return arr[j < 0 ? j + arr.length : j];
}

/**
 * Compute a maximum-weight matching.
 *
 * With `maxCardinality = true`, only maximum-cardinality matchings are
 * considered, and the heaviest of those is returned (this is what the Swiss
 * pairer uses: a perfect matching whenever one exists).
 *
 * Returns `mate`, where `mate[v]` is the vertex matched to `v`, or -1 when `v`
 * is unmatched. The array has length (largest vertex index + 1); pass
 * `vertexCount` to force a longer array (isolated vertices stay -1).
 */
export function maxWeightMatching(
  edges: WeightedEdge[],
  maxCardinality = false,
  vertexCount = 0,
): number[] {
  const nedge = edges.length;
  let nvertex = vertexCount;
  for (const [i, j] of edges) {
    if (i < 0 || j < 0 || i === j || !Number.isInteger(i) || !Number.isInteger(j)) {
      throw new Error(`maxWeightMatching: invalid edge (${i}, ${j})`);
    }
    if (i >= nvertex) nvertex = i + 1;
    if (j >= nvertex) nvertex = j + 1;
  }
  if (nedge === 0) return new Array<number>(nvertex).fill(-1);

  const allInteger = edges.every(([, , w]) => Number.isInteger(w));
  let maxweight = 0;
  for (const [, , w] of edges) if (w > maxweight) maxweight = w;

  // endpoint[p] is the vertex at endpoint p; edge k has endpoints 2k and 2k+1.
  const endpoint: number[] = [];
  for (let p = 0; p < 2 * nedge; p++) endpoint.push(edges[p >> 1][p % 2]);

  // neighbend[v] lists the remote endpoints of the edges attached to v.
  const neighbend: number[][] = Array.from({ length: nvertex }, () => []);
  for (let k = 0; k < nedge; k++) {
    const [i, j] = edges[k];
    neighbend[i].push(2 * k + 1);
    neighbend[j].push(2 * k);
  }

  // mate[v] is the remote endpoint of v's matched edge, or -1.
  const mate: number[] = new Array<number>(nvertex).fill(-1);
  // label: 0 = free, 1 = S, 2 = T (bit 4 marks breadcrumbs in scanBlossom).
  const label: number[] = new Array<number>(2 * nvertex).fill(0);
  const labelend: number[] = new Array<number>(2 * nvertex).fill(-1);
  const inblossom: number[] = Array.from({ length: nvertex }, (_, i) => i);
  const blossomparent: number[] = new Array<number>(2 * nvertex).fill(-1);
  const blossomchilds: (number[] | null)[] = new Array<number[] | null>(2 * nvertex).fill(null);
  const blossombase: number[] = [
    ...Array.from({ length: nvertex }, (_, i) => i),
    ...new Array<number>(nvertex).fill(-1),
  ];
  const blossomendps: (number[] | null)[] = new Array<number[] | null>(2 * nvertex).fill(null);
  const bestedge: number[] = new Array<number>(2 * nvertex).fill(-1);
  const blossombestedges: (number[] | null)[] = new Array<number[] | null>(2 * nvertex).fill(null);
  const unusedblossoms: number[] = Array.from({ length: nvertex }, (_, i) => nvertex + i);
  const dualvar: number[] = [
    ...new Array<number>(nvertex).fill(maxweight),
    ...new Array<number>(nvertex).fill(0),
  ];
  const allowedge: boolean[] = new Array<boolean>(nedge).fill(false);
  let queue: number[] = [];

  const slack = (k: number): number => {
    const [i, j, wt] = edges[k];
    return dualvar[i] + dualvar[j] - 2 * wt;
  };

  const blossomLeaves = (b: number): number[] => {
    if (b < nvertex) return [b];
    const out: number[] = [];
    const stack = [...(blossomchilds[b] as number[])].reverse();
    while (stack.length) {
      const t = stack.pop() as number;
      if (t < nvertex) out.push(t);
      else {
        const ch = blossomchilds[t] as number[];
        for (let x = ch.length - 1; x >= 0; x--) stack.push(ch[x]);
      }
    }
    return out;
  };

  // Assign label t to the top-level blossom containing vertex w, reached via
  // endpoint p. A T-label forces its mate to be labelled S.
  const assignLabel = (w0: number, t0: number, p0: number): void => {
    let w = w0;
    let t = t0;
    let p = p0;
    for (;;) {
      const b = inblossom[w];
      label[w] = label[b] = t;
      labelend[w] = labelend[b] = p;
      bestedge[w] = bestedge[b] = -1;
      if (t === 1) {
        queue.push(...blossomLeaves(b));
        return;
      }
      // t === 2
      const base = blossombase[b];
      w = endpoint[mate[base]];
      p = mate[base] ^ 1;
      t = 1;
    }
  };

  // Trace back from v and w to find a new blossom or an augmenting path.
  // Returns the base vertex of the new blossom, or -1.
  const scanBlossom = (v0: number, w0: number): number => {
    let v = v0;
    let w = w0;
    const path: number[] = [];
    let base = -1;
    while (v !== -1 || w !== -1) {
      let b = inblossom[v];
      if (label[b] & 4) {
        base = blossombase[b];
        break;
      }
      path.push(b);
      label[b] = 5;
      if (labelend[b] === -1) {
        v = -1;
      } else {
        v = endpoint[labelend[b]];
        b = inblossom[v];
        v = endpoint[labelend[b]];
      }
      if (w !== -1) {
        const tmp = v;
        v = w;
        w = tmp;
      }
    }
    for (const b of path) label[b] = 1;
    return base;
  };

  // Construct a new blossom with the given base, containing edge k.
  const addBlossom = (base: number, k: number): void => {
    let [v, w] = edges[k];
    const bb = inblossom[base];
    let bv = inblossom[v];
    let bw = inblossom[w];
    const b = unusedblossoms.pop() as number;
    blossombase[b] = base;
    blossomparent[b] = -1;
    blossomparent[bb] = b;
    const path: number[] = [];
    const endps: number[] = [];
    blossomchilds[b] = path;
    blossomendps[b] = endps;
    while (bv !== bb) {
      blossomparent[bv] = b;
      path.push(bv);
      endps.push(labelend[bv]);
      v = endpoint[labelend[bv]];
      bv = inblossom[v];
    }
    path.push(bb);
    path.reverse();
    endps.reverse();
    endps.push(2 * k);
    while (bw !== bb) {
      blossomparent[bw] = b;
      path.push(bw);
      endps.push(labelend[bw] ^ 1);
      w = endpoint[labelend[bw]];
      bw = inblossom[w];
    }
    label[b] = 1;
    labelend[b] = labelend[bb];
    dualvar[b] = 0;
    for (const leaf of blossomLeaves(b)) {
      if (label[inblossom[leaf]] === 2) queue.push(leaf);
      inblossom[leaf] = b;
    }
    // Compute blossombestedges[b].
    const bestedgeto: number[] = new Array<number>(2 * nvertex).fill(-1);
    for (const sub of path) {
      let nblists: number[][];
      if (blossombestedges[sub] === null) {
        nblists = blossomLeaves(sub).map((leaf) => neighbend[leaf].map((p) => p >> 1));
      } else {
        nblists = [blossombestedges[sub] as number[]];
      }
      for (const nblist of nblists) {
        for (const kk of nblist) {
          // Orient the edge so that ej is the endpoint outside blossom b.
          const [ei, ej] = edges[kk];
          const bj = inblossom[inblossom[ej] === b ? ei : ej];
          if (
            bj !== b &&
            label[bj] === 1 &&
            (bestedgeto[bj] === -1 || slack(kk) < slack(bestedgeto[bj]))
          ) {
            bestedgeto[bj] = kk;
          }
        }
      }
      blossombestedges[sub] = null;
      bestedge[sub] = -1;
    }
    const best = bestedgeto.filter((kk) => kk !== -1);
    blossombestedges[b] = best;
    bestedge[b] = -1;
    for (const kk of best) {
      if (bestedge[b] === -1 || slack(kk) < slack(bestedge[b])) bestedge[b] = kk;
    }
  };

  // Expand the given top-level blossom.
  const expandBlossom = (b: number, endstage: boolean): void => {
    const childs = blossomchilds[b] as number[];
    for (const s of childs) {
      blossomparent[s] = -1;
      if (s < nvertex) {
        inblossom[s] = s;
      } else if (endstage && dualvar[s] === 0) {
        expandBlossom(s, endstage);
      } else {
        for (const leaf of blossomLeaves(s)) inblossom[leaf] = s;
      }
    }
    if (!endstage && label[b] === 2) {
      const endps = blossomendps[b] as number[];
      const entrychild = inblossom[endpoint[labelend[b] ^ 1]];
      let j = childs.indexOf(entrychild);
      let jstep: number;
      let endptrick: number;
      if (j & 1) {
        j -= childs.length;
        jstep = 1;
        endptrick = 0;
      } else {
        jstep = -1;
        endptrick = 1;
      }
      let p = labelend[b];
      while (j !== 0) {
        label[endpoint[p ^ 1]] = 0;
        label[endpoint[at(endps, j - endptrick) ^ endptrick ^ 1]] = 0;
        assignLabel(endpoint[p ^ 1], 2, p);
        allowedge[at(endps, j - endptrick) >> 1] = true;
        j += jstep;
        p = at(endps, j - endptrick) ^ endptrick;
        allowedge[p >> 1] = true;
        j += jstep;
      }
      let bv = at(childs, j);
      label[endpoint[p ^ 1]] = label[bv] = 2;
      labelend[endpoint[p ^ 1]] = labelend[bv] = p;
      bestedge[bv] = -1;
      j += jstep;
      while (at(childs, j) !== entrychild) {
        bv = at(childs, j);
        if (label[bv] === 1) {
          j += jstep;
          continue;
        }
        let found = -1;
        for (const leaf of blossomLeaves(bv)) {
          if (label[leaf] !== 0) {
            found = leaf;
            break;
          }
        }
        if (found !== -1) {
          label[found] = 0;
          label[endpoint[mate[blossombase[bv]]]] = 0;
          assignLabel(found, 2, labelend[found]);
        }
        j += jstep;
      }
    }
    label[b] = labelend[b] = -1;
    blossomchilds[b] = blossomendps[b] = null;
    blossombase[b] = -1;
    blossombestedges[b] = null;
    bestedge[b] = -1;
    unusedblossoms.push(b);
  };

  // Swap matched/unmatched edges along an alternating path through blossom
  // b, between vertex v and the base vertex.
  const augmentBlossom = (b: number, v: number): void => {
    let t = v;
    while (blossomparent[t] !== b) t = blossomparent[t];
    if (t >= nvertex) augmentBlossom(t, v);
    let childs = blossomchilds[b] as number[];
    let endps = blossomendps[b] as number[];
    const i = childs.indexOf(t);
    let j = i;
    let jstep: number;
    let endptrick: number;
    if (i & 1) {
      j -= childs.length;
      jstep = 1;
      endptrick = 0;
    } else {
      jstep = -1;
      endptrick = 1;
    }
    while (j !== 0) {
      j += jstep;
      t = at(childs, j);
      const p = at(endps, j - endptrick) ^ endptrick;
      if (t >= nvertex) augmentBlossom(t, endpoint[p]);
      j += jstep;
      t = at(childs, j);
      if (t >= nvertex) augmentBlossom(t, endpoint[p ^ 1]);
      mate[endpoint[p]] = p ^ 1;
      mate[endpoint[p ^ 1]] = p;
    }
    childs = [...childs.slice(i), ...childs.slice(0, i)];
    endps = [...endps.slice(i), ...endps.slice(0, i)];
    blossomchilds[b] = childs;
    blossomendps[b] = endps;
    blossombase[b] = blossombase[childs[0]];
  };

  // Swap matched/unmatched edges along the augmenting path through edge k.
  const augmentMatching = (k: number): void => {
    const [v, w] = edges[k];
    const starts: [number, number][] = [
      [v, 2 * k + 1],
      [w, 2 * k],
    ];
    for (const [s0, p0] of starts) {
      let s = s0;
      let p = p0;
      for (;;) {
        const bs = inblossom[s];
        if (bs >= nvertex) augmentBlossom(bs, s);
        mate[s] = p;
        if (labelend[bs] === -1) break;
        const t = endpoint[labelend[bs]];
        const bt = inblossom[t];
        s = endpoint[labelend[bt]];
        const jj = endpoint[labelend[bt] ^ 1];
        if (bt >= nvertex) augmentBlossom(bt, jj);
        mate[jj] = labelend[bt];
        p = labelend[bt] ^ 1;
      }
    }
  };

  // Main loop: one stage per augmentation.
  for (let stage = 0; stage < nvertex; stage++) {
    label.fill(0);
    bestedge.fill(-1);
    for (let b = nvertex; b < 2 * nvertex; b++) blossombestedges[b] = null;
    allowedge.fill(false);
    queue = [];

    for (let v = 0; v < nvertex; v++) {
      if (mate[v] === -1 && label[inblossom[v]] === 0) assignLabel(v, 1, -1);
    }

    let augmented = false;
    for (;;) {
      while (queue.length && !augmented) {
        const v = queue.pop() as number;
        for (const p of neighbend[v]) {
          const k = p >> 1;
          const w = endpoint[p];
          if (inblossom[v] === inblossom[w]) continue;
          let kslack = 0;
          if (!allowedge[k]) {
            kslack = slack(k);
            if (kslack <= 0) allowedge[k] = true;
          }
          if (allowedge[k]) {
            if (label[inblossom[w]] === 0) {
              assignLabel(w, 2, p ^ 1);
            } else if (label[inblossom[w]] === 1) {
              const base = scanBlossom(v, w);
              if (base >= 0) {
                addBlossom(base, k);
              } else {
                augmentMatching(k);
                augmented = true;
                break;
              }
            } else if (label[w] === 0) {
              label[w] = 2;
              labelend[w] = p ^ 1;
            }
          } else if (label[inblossom[w]] === 1) {
            const b = inblossom[v];
            if (bestedge[b] === -1 || kslack < slack(bestedge[b])) bestedge[b] = k;
          } else if (label[w] === 0) {
            if (bestedge[w] === -1 || kslack < slack(bestedge[w])) bestedge[w] = k;
          }
        }
      }
      if (augmented) break;

      // No augmenting path with tight edges: adjust the dual variables.
      let deltatype = -1;
      let delta = 0;
      let deltaedge = -1;
      let deltablossom = -1;

      if (!maxCardinality) {
        deltatype = 1;
        delta = Math.min(...dualvar.slice(0, nvertex));
      }
      for (let v = 0; v < nvertex; v++) {
        if (label[inblossom[v]] === 0 && bestedge[v] !== -1) {
          const d = slack(bestedge[v]);
          if (deltatype === -1 || d < delta) {
            delta = d;
            deltatype = 2;
            deltaedge = bestedge[v];
          }
        }
      }
      for (let b = 0; b < 2 * nvertex; b++) {
        if (blossomparent[b] === -1 && label[b] === 1 && bestedge[b] !== -1) {
          const ks = slack(bestedge[b]);
          if (allInteger && ks % 2 !== 0) {
            throw new Error("maxWeightMatching: odd slack with integer weights (internal error)");
          }
          const d = ks / 2;
          if (deltatype === -1 || d < delta) {
            delta = d;
            deltatype = 3;
            deltaedge = bestedge[b];
          }
        }
      }
      for (let b = nvertex; b < 2 * nvertex; b++) {
        if (
          blossombase[b] >= 0 &&
          blossomparent[b] === -1 &&
          label[b] === 2 &&
          (deltatype === -1 || dualvar[b] < delta)
        ) {
          delta = dualvar[b];
          deltatype = 4;
          deltablossom = b;
        }
      }
      if (deltatype === -1) {
        // No further improvement possible; max-cardinality optimum reached.
        deltatype = 1;
        delta = Math.max(0, Math.min(...dualvar.slice(0, nvertex)));
      }

      for (let v = 0; v < nvertex; v++) {
        if (label[inblossom[v]] === 1) dualvar[v] -= delta;
        else if (label[inblossom[v]] === 2) dualvar[v] += delta;
      }
      for (let b = nvertex; b < 2 * nvertex; b++) {
        if (blossombase[b] >= 0 && blossomparent[b] === -1) {
          if (label[b] === 1) dualvar[b] += delta;
          else if (label[b] === 2) dualvar[b] -= delta;
        }
      }

      if (deltatype === 1) {
        break;
      } else if (deltatype === 2) {
        allowedge[deltaedge] = true;
        const [ei, ej] = edges[deltaedge];
        queue.push(label[inblossom[ei]] === 0 ? ej : ei);
      } else if (deltatype === 3) {
        allowedge[deltaedge] = true;
        const [i] = edges[deltaedge];
        queue.push(i);
      } else if (deltatype === 4) {
        expandBlossom(deltablossom, false);
      }
    }

    if (!augmented) break;

    // End of stage: expand S-blossoms with zero dual.
    for (let b = nvertex; b < 2 * nvertex; b++) {
      if (blossomparent[b] === -1 && blossombase[b] >= 0 && label[b] === 1 && dualvar[b] === 0) {
        expandBlossom(b, true);
      }
    }
  }

  // Convert remote endpoints to vertices.
  for (let v = 0; v < nvertex; v++) {
    if (mate[v] >= 0) mate[v] = endpoint[mate[v]];
  }
  return mate;
}
