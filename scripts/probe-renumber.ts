/**
 * Throwaway probe: does *renaming* a region move any node?
 *
 * It decides whether fixing the naming rule is free or is a second layout
 * epoch. Region labels set region **ids**; `atlas.regions` is sorted by id; and
 * `build.ts` derives `groupByRef` from that sorted order — so a rename permutes
 * the group numbers even when the partition is identical.
 *
 * `computeLayout` accumulates each group's centroid in **node-index order**
 * with the group number used only as a `Map` key, so the arithmetic should be
 * invariant to a permutation. "Should be" is the part worth checking, since the
 * whole freeze rests on it.
 *
 * NOT part of the suite. `npx tsx scripts/probe-renumber.ts`
 */

import { DEFAULT_LAYOUT_OPTIONS, computeLayout } from '../src/indexer/layout.js';

/** A deterministic pseudo-graph big enough to exercise the cohesion loop. */
const COUNT = 400;
const edges: { from: number; to: number; weight: number }[] = [];
for (let i = 0; i < COUNT; i++) {
  edges.push({ from: i, to: (i * 7 + 3) % COUNT, weight: 1 });
  if (i % 3 === 0) edges.push({ from: i, to: (i * 13 + 11) % COUNT, weight: 2 });
}
const groups = Array.from({ length: COUNT }, (_, i) => i % 11);

const base = computeLayout(COUNT, edges, DEFAULT_LAYOUT_OPTIONS, groups);

// Every permutation of group *numbers* leaves the partition alone. If the
// layout is invariant, renaming regions is free; if not, it is an epoch.
const permutations: Record<string, (g: number) => number> = {
  reversed: (g) => 10 - g,
  shifted: (g) => (g + 5) % 11,
  sparse: (g) => g * 1000,
};

for (const [name, map] of Object.entries(permutations)) {
  const moved = computeLayout(COUNT, edges, DEFAULT_LAYOUT_OPTIONS, groups.map(map));
  let worst = 0;
  for (let i = 0; i < COUNT; i++) {
    worst = Math.max(
      worst,
      Math.abs((base[i]?.[0] ?? 0) - (moved[i]?.[0] ?? 0)),
      Math.abs((base[i]?.[1] ?? 0) - (moved[i]?.[1] ?? 0)),
    );
  }
  console.log(
    `${name.padEnd(9)} largest coordinate change: ${worst}` +
      `${worst === 0 ? '   (identical — renaming is free)' : '   (MOVES NODES — renaming is a layout epoch)'}`,
  );
}
