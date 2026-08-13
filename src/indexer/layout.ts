/**
 * Deterministic force-directed layout.
 *
 * Layout runs in the indexer, not the player, because spatial memory of a
 * codebase is the mechanic the whole product rests on (NORTH-STAR §7). Same
 * repo must mean the same map — this session, next session, and on a
 * colleague's laptop.
 *
 * Two things are done deliberately here, both for determinism:
 *
 *  - No `Math.random()`. Initial positions come from a lattice, and the jitter
 *    that breaks its symmetry comes from a seeded integer generator.
 *  - No transcendental functions. `Math.sin`, `Math.cos`, `Math.pow` and
 *    `Math.exp` are implementation-defined to within an ulp, so a layout built
 *    on them can differ between engines. Only `+ - * /` and `Math.sqrt` appear
 *    below, and IEEE-754 specifies all five exactly. See ADR-0003.
 */

import { round2 } from '../atlas/index.js';

export interface LayoutEdge {
  readonly from: number;
  readonly to: number;
  readonly weight: number;
}

export interface LayoutOptions {
  readonly iterations: number;
  /** Ideal edge length, in atlas units, before density scaling. */
  readonly spacing: number;
  /** Pull toward the origin, so disconnected components stay on the map. */
  readonly gravity: number;
  /** Repulsion is ignored beyond this multiple of the ideal distance. */
  readonly cutoff: number;
  /**
   * Pull toward the centroid of the node's own region.
   *
   * Not decoration. Pillar 4 says geography is topology, and a region *is*
   * topology — a derived cluster of the import graph. Without this the members
   * of a cluster scatter across the map and the colours become confetti: you
   * can see that two files share a region only by comparing two hues on
   * opposite sides of the screen. With it, a region is somewhere you can point
   * at, which is the whole basis of remembering where anything is.
   *
   * **Read the arithmetic before tuning this.** The force applied is
   * `(centroid − position) · cohesion · spacing`, which at 0.32 and spacing 60
   * is 19× the distance to the centroid — it overshoots enormously, and the
   * only thing keeping the layout stable is the per-step temperature clamp
   * further down. Cohesion therefore *saturates* for any node more than a
   * pixel or two from its centroid, and what this constant really controls is
   * late-iteration behaviour once the temperature has cooled, not the force
   * balance the formula suggests. The layout is in effect "regions first,
   * edges second", which suits the territory zoom level — but it is a regime
   * that was arrived at, not chosen, and A/B-ing values here changes less than
   * it appears to. `tests/atlas/atlas.test.ts` pins the resulting clustering
   * quality so the eyeball judgement is at least a regression floor.
   */
  readonly cohesion: number;
}

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  iterations: 300,
  spacing: 60,
  gravity: 0.015,
  cutoff: 2.5,
  cohesion: 0.32,
};

/** A 32-bit LCG. Deterministic, seeded, and exact — no floating point state. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

/**
 * Positions for `count` nodes, one `[x, y]` per index, rounded to 2dp.
 * Empty input gives empty output; a single node sits at the origin.
 */
export function computeLayout(
  count: number,
  edges: readonly LayoutEdge[],
  options: LayoutOptions = DEFAULT_LAYOUT_OPTIONS,
  /** Region index per node, if regions have been detected. */
  groups: readonly number[] = [],
): [number, number][] {
  if (count === 0) return [];
  if (count === 1) return [[0, 0]];

  const ideal = options.spacing;
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);

  // Lattice start, jittered by a quarter cell so that coincident forces have
  // something to push apart.
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const random = lcg(0x9e3779b9);
  for (let i = 0; i < count; i++) {
    const column = i % columns;
    const row = Math.floor(i / columns);
    const jitterX = (random() / 4294967296 - 0.5) * (ideal / 2);
    const jitterY = (random() / 4294967296 - 0.5) * (ideal / 2);
    xs[i] = (column - columns / 2) * ideal + jitterX;
    ys[i] = (row - columns / 2) * ideal + jitterY;
  }

  const dx = new Float64Array(count);
  const dy = new Float64Array(count);
  const cutoff = ideal * options.cutoff;
  const cellSize = cutoff;
  /**
   * A squared distance above which `Math.sqrt(squared) > cutoff` is certain.
   *
   * Padded above `cutoff²` on purpose. `sqrt` is correctly rounded, so
   * `squared > cutoff * cutoff` is *almost* equivalent to the real test and can
   * disagree on the last bit at the boundary — which would move a node, which
   * is the one thing this function may not do. A pair rejected here is one the
   * exact test below would have rejected too; a pair near the boundary simply
   * pays the `sqrt` it always paid.
   */
  const beyondCutoff = cutoff * cutoff * (1 + 2 ** -20);

  for (let iteration = 0; iteration < options.iterations; iteration++) {
    dx.fill(0);
    dy.fill(0);

    // Repulsion, restricted to a neighbourhood. The cells are walked in index
    // order so the sum is accumulated in a fixed sequence and floating-point
    // addition stays reproducible.
    //
    // **This comment used to say a uniform grid "keeps this linear in
    // practice", and measurement refutes it.** At django's shape — 3,035 nodes,
    // 175 regions — the 3×3 neighbourhood holds **937 nodes on average**, so
    // this loop runs 853M pair tests and takes **98%** of the whole layout.
    // Cohesion is why: it collapses each region toward its centroid (see
    // `LayoutOptions.cohesion`, which saturates), so cells become dense and the
    // grid stops separating anything. The growth is superlinear — 0.41 ms/node
    // at 190 nodes against 2.78 at 3,035.
    //
    // What is done about it below is **constant-factor only, and deliberately
    // so**: every coordinate this function returns must stay byte-identical,
    // because NORTH-STAR §7 freezes the layout and a re-layout scrambles every
    // map anyone has learned. A finer grid would cut the tests enormously and
    // change the *order* contributions are summed in, which changes the last
    // bits, which moves nodes. ADR-0038 has the measurement and the option that
    // is left.
    const grid = new Map<number, number[]>();
    const key = (x: number, y: number): number =>
      Math.floor(x / cellSize) * 73856093 + Math.floor(y / cellSize) * 19349663;
    for (let i = 0; i < count; i++) {
      const cell = key(xs[i] ?? 0, ys[i] ?? 0);
      const bucket = grid.get(cell);
      if (bucket === undefined) grid.set(cell, [i]);
      else bucket.push(i);
    }

    for (let i = 0; i < count; i++) {
      const xi = xs[i] ?? 0;
      const yi = ys[i] ?? 0;
      const cellX = Math.floor(xi / cellSize);
      const cellY = Math.floor(yi / cellSize);
      // Accumulated in locals and stored once. `dx[i] = dx[i] + term` repeated
      // 346M times is the same *sequence* of additions as `dxi = dxi + term`
      // followed by one store — identical bits, two fewer typed-array accesses
      // per contributing pair.
      let dxi = 0;
      let dyi = 0;
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const bucket = grid.get((cellX + ox) * 73856093 + (cellY + oy) * 19349663);
          if (bucket === undefined) continue;
          // Indexed rather than `for…of`: same order, no iterator allocated per
          // cell per node per iteration.
          for (let b = 0; b < bucket.length; b++) {
            const j = bucket[b] ?? 0;
            if (j === i) continue;
            let vx = xi - (xs[j] ?? 0);
            let vy = yi - (ys[j] ?? 0);
            const squared = vx * vx + vy * vy;
            // **A conservative pre-filter, not a replacement for the test.**
            // 59.4% of the pairs reached here are beyond the cutoff and
            // contribute nothing, and the original paid a `Math.sqrt` for every
            // one. `beyondCutoff` is strictly above `cutoff²`, so anything it
            // rejects would certainly have failed `distance > cutoff` below —
            // the exact test still runs on everything that survives, and the
            // set of contributing pairs is unchanged. Comparing `squared >
            // cutoff * cutoff` directly would be the tempting version and is
            // the one that can differ in the last bit.
            if (squared > beyondCutoff) continue;
            let distance = Math.sqrt(squared);
            if (distance === 0) {
              // Coincident. Separate along a fixed axis derived from the index
              // difference rather than a random direction.
              vx = i < j ? -0.5 : 0.5;
              vy = ((i + j) % 3) - 1;
              distance = Math.sqrt(vx * vx + vy * vy);
            }
            if (distance > cutoff) continue;
            const force = (ideal * ideal) / distance;
            dxi += (vx / distance) * force;
            dyi += (vy / distance) * force;
          }
        }
      }
      dx[i] = dxi;
      dy[i] = dyi;
    }

    // Attraction along edges.
    for (const edge of edges) {
      const a = edge.from;
      const b = edge.to;
      if (a === b || a >= count || b >= count) continue;
      const vx = (xs[a] ?? 0) - (xs[b] ?? 0);
      const vy = (ys[a] ?? 0) - (ys[b] ?? 0);
      const distance = Math.sqrt(vx * vx + vy * vy);
      if (distance === 0) continue;
      const force = ((distance * distance) / ideal) * edge.weight;
      const fx = (vx / distance) * force;
      const fy = (vy / distance) * force;
      dx[a] = (dx[a] ?? 0) - fx;
      dy[a] = (dy[a] ?? 0) - fy;
      dx[b] = (dx[b] ?? 0) + fx;
      dy[b] = (dy[b] ?? 0) + fy;
    }

    // Region cohesion. Centroids are accumulated in index order so the sums are
    // formed in a fixed sequence and stay reproducible.
    if (groups.length === count && options.cohesion > 0) {
      const sumX = new Map<number, number>();
      const sumY = new Map<number, number>();
      const tally = new Map<number, number>();
      for (let i = 0; i < count; i++) {
        const group = groups[i] ?? 0;
        sumX.set(group, (sumX.get(group) ?? 0) + (xs[i] ?? 0));
        sumY.set(group, (sumY.get(group) ?? 0) + (ys[i] ?? 0));
        tally.set(group, (tally.get(group) ?? 0) + 1);
      }
      for (let i = 0; i < count; i++) {
        const group = groups[i] ?? 0;
        const size = tally.get(group) ?? 1;
        if (size < 2) continue;
        const centreX = (sumX.get(group) ?? 0) / size;
        const centreY = (sumY.get(group) ?? 0) / size;
        dx[i] = (dx[i] ?? 0) + (centreX - (xs[i] ?? 0)) * options.cohesion * ideal;
        dy[i] = (dy[i] ?? 0) + (centreY - (ys[i] ?? 0)) * options.cohesion * ideal;
      }
    }

    // Gravity.
    for (let i = 0; i < count; i++) {
      dx[i] = (dx[i] ?? 0) - (xs[i] ?? 0) * options.gravity * ideal;
      dy[i] = (dy[i] ?? 0) - (ys[i] ?? 0) * options.gravity * ideal;
    }

    // Cool linearly, and clamp each step to the current temperature so a large
    // force cannot fling a node across the map.
    const temperature = ideal * (1 - iteration / options.iterations);
    for (let i = 0; i < count; i++) {
      const stepX = dx[i] ?? 0;
      const stepY = dy[i] ?? 0;
      const magnitude = Math.sqrt(stepX * stepX + stepY * stepY);
      if (magnitude === 0) continue;
      const scale = magnitude > temperature ? temperature / magnitude : 1;
      xs[i] = (xs[i] ?? 0) + stepX * scale;
      ys[i] = (ys[i] ?? 0) + stepY * scale;
    }
  }

  // Centre the result so the map does not drift with node count.
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < count; i++) {
    sumX += xs[i] ?? 0;
    sumY += ys[i] ?? 0;
  }
  const centreX = sumX / count;
  const centreY = sumY / count;

  const positions: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    positions.push([round2((xs[i] ?? 0) - centreX), round2((ys[i] ?? 0) - centreY)]);
  }
  return positions;
}
