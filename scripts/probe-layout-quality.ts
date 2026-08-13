/**
 * Throwaway probe: what would the *map* look like under the new grouping?
 *
 * Regions reach the map through `computeLayout`'s `groups` argument, so the
 * question "are Louvain's regions better" is not answered by modularity — it is
 * answered by whether the picture still reads. `tests/atlas/atlas.test.ts` pins
 * exactly that, as the ratio of mean intra-region spread to mean inter-region
 * centroid spacing, with a measured ceiling of 0.20 (0.090 with the cohesion
 * force on this repo, 0.356 with it off — the bar sits between the two).
 *
 * This computes the same ratio for both partitions, on the same nodes and the
 * same edges, with the same `DEFAULT_LAYOUT_OPTIONS`. **It writes nothing.**
 * The positions it produces are discarded; no atlas is rewritten, and this file
 * is not reachable from the indexer.
 *
 * NOT part of the suite. `npx tsx scripts/probe-layout-quality.ts <dumpdir>`
 */

import process from 'node:process';

import { DEFAULT_LAYOUT_OPTIONS, computeLayout } from '../src/indexer/layout.js';
import { louvain } from '../src/indexer/louvain.js';
import { loadDumps } from './probe-region-stats.js';

/** The ratio `atlas.test.ts` pins: intra-region spread over inter-region spacing. */
function spreadRatio(
  positions: readonly (readonly [number, number])[],
  groups: readonly number[],
): { within: number; between: number; ratio: number; groups: number } {
  const members = new Map<number, number[]>();
  for (const [index, group] of groups.entries()) {
    const bucket = members.get(group);
    if (bucket === undefined) members.set(group, [index]);
    else bucket.push(index);
  }
  const centroids = new Map<number, [number, number]>();
  for (const [group, list] of members) {
    let x = 0;
    let y = 0;
    for (const index of list) {
      x += positions[index]?.[0] ?? 0;
      y += positions[index]?.[1] ?? 0;
    }
    centroids.set(group, [x / list.length, y / list.length]);
  }

  let withinSum = 0;
  let withinCount = 0;
  for (const [group, list] of members) {
    const centroid = centroids.get(group) ?? [0, 0];
    for (const index of list) {
      const dx = (positions[index]?.[0] ?? 0) - centroid[0];
      const dy = (positions[index]?.[1] ?? 0) - centroid[1];
      withinSum += Math.sqrt(dx * dx + dy * dy);
      withinCount++;
    }
  }

  let betweenSum = 0;
  let betweenCount = 0;
  const keys = [...centroids.keys()].sort((a, b) => a - b);
  for (const [i, a] of keys.entries()) {
    for (const b of keys.slice(i + 1)) {
      const pa = centroids.get(a) ?? [0, 0];
      const pb = centroids.get(b) ?? [0, 0];
      const dx = pa[0] - pb[0];
      const dy = pa[1] - pb[1];
      betweenSum += Math.sqrt(dx * dx + dy * dy);
      betweenCount++;
    }
  }

  const within = withinSum / Math.max(1, withinCount);
  const between = betweenSum / Math.max(1, betweenCount);
  return { within, between, ratio: between === 0 ? 0 : within / between, groups: members.size };
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (dir === undefined) {
    console.error('usage: probe-layout-quality <dumpdir>');
    process.exit(1);
  }
  const dumps = await loadDumps(dir);

  console.log('## Map legibility under each grouping — the ratio atlas.test.ts pins (ceiling 0.20)\n');
  console.log(
    'repo         nodes │ now: groups  within  between  ratio │ lou: groups  within  between  ratio │ layout ms',
  );
  for (const dump of dumps) {
    const edges = dump.edgeList
      .filter(([from, to]) => from !== to)
      .map(([from, to]) => ({ from, to, weight: 1 }));

    // Today's grouping, exactly as `build.ts` builds it: region index per node,
    // terrain included, because terrain regions are groups for the layout too.
    const regionIndexById = new Map(dump.regions.map((region, i) => [region.id, i] as const));
    const nowGroups = dump.nodeRegion.map(([, region]) => regionIndexById.get(region) ?? 0);

    // The counterfactual grouping: Louvain over the linked subgraph, with the
    // **terrain rule held fixed** — edgeless nodes keep exactly the terrain
    // group they have today. Only the linked nodes are reassigned, which is the
    // only thing a clustering change can touch.
    const degree = new Array<number>(dump.nodes).fill(0);
    for (const [from, to] of dump.edgeList) {
      if (from === to) continue;
      degree[from] = (degree[from] ?? 0) + 1;
      degree[to] = (degree[to] ?? 0) + 1;
    }
    const linked = new Array<number>(dump.nodes).fill(-1);
    const backwards: number[] = [];
    for (let i = 0; i < dump.nodes; i++) {
      if ((degree[i] ?? 0) > 0) {
        linked[i] = backwards.length;
        backwards.push(i);
      }
    }
    const linkedEdges: { from: number; to: number }[] = [];
    for (const [from, to] of dump.edgeList) {
      const a = linked[from] ?? -1;
      const b = linked[to] ?? -1;
      if (a < 0 || b < 0 || a === b) continue;
      linkedEdges.push({ from: a, to: b });
    }
    const result = louvain(backwards.length, linkedEdges, {
      resolution: 1,
      maxSweeps: 32,
      maxLevels: 16,
    });
    // Terrain groups keep distinct ids above the Louvain range.
    const communityCount = Math.max(0, ...result.labels) + 1;
    const terrainOffset = new Map<number, number>();
    const louGroups = dump.nodeRegion.map(([, region], node) => {
      const slot = linked[node] ?? -1;
      if (slot >= 0) return result.labels[slot] ?? 0;
      const existing = regionIndexById.get(region) ?? 0;
      let mapped = terrainOffset.get(existing);
      if (mapped === undefined) {
        mapped = communityCount + terrainOffset.size;
        terrainOffset.set(existing, mapped);
      }
      return mapped;
    });

    const started = process.hrtime.bigint();
    const nowPositions = computeLayout(dump.nodes, edges, DEFAULT_LAYOUT_OPTIONS, nowGroups);
    const half = Number(process.hrtime.bigint() - started) / 1e6;
    const louPositions = computeLayout(dump.nodes, edges, DEFAULT_LAYOUT_OPTIONS, louGroups);

    const now = spreadRatio(nowPositions, nowGroups);
    const lou = spreadRatio(louPositions, louGroups);

    console.log(
      [
        dump.repo.padEnd(11),
        String(dump.nodes).padStart(5),
        '│',
        String(now.groups).padStart(10),
        now.within.toFixed(1).padStart(7),
        now.between.toFixed(1).padStart(8),
        now.ratio.toFixed(3).padStart(6),
        '│',
        String(lou.groups).padStart(10),
        lou.within.toFixed(1).padStart(7),
        lou.between.toFixed(1).padStart(8),
        lou.ratio.toFixed(3).padStart(6),
        '│',
        `${half.toFixed(0)}`.padStart(9),
      ].join(' '),
    );
  }
  console.log(`
ratio   mean distance from a node to its own region's centroid, over the mean
        distance between two region centroids. Lower is a map you can point at.
        Pillar 4's regression floor is 0.20 in tests/atlas/atlas.test.ts.
NOTE    positions computed here are discarded. Nothing is written and no atlas
        in the tree moves — NORTH-STAR §7 freezes the layout and this probe
        exists to price the change, not to make it.`);
}

await main();
