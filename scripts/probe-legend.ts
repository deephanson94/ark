/**
 * Throwaway probe: what do the *rendering-only* fixes buy?
 *
 * Three candidates, none of which moves a node:
 *   A  order the legend by size instead of by id, and let it scroll
 *   B  collapse terrain into one row (they already share one grey)
 *   C  show the k largest and one "+N more" row
 *
 * The question each answers is the same: how much of the map can a reader
 * account for from the legend? Reported as **share of nodes reachable from a
 * legend row**, because a row naming 3 of 425 nodes and a row naming 49 are not
 * the same amount of map.
 *
 * NOT part of the suite. `npx tsx scripts/probe-legend.ts <dumpdir>`
 */

import process from 'node:process';

import { loadDumps, statsFor } from './probe-region-stats.js';

const LEGEND_ROWS = 17;

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (dir === undefined) {
    console.error('usage: probe-legend <dumpdir>');
    process.exit(1);
  }
  const dumps = await loadDumps(dir);

  console.log('## What the legend can account for, in nodes\n');
  console.log(
    'repo         nodes  reg   byId%  bySize%   +terr%   need90  need99  terrRows  biggestTerr',
  );
  for (const dump of dumps) {
    const s = statsFor(dump);
    const byId = [...dump.regions].sort((a, b) => a.index - b.index);
    const bySize = [...dump.regions].sort((a, b) => b.nodeCount - a.nodeCount || a.index - b.index);
    const share = (list: readonly { nodeCount: number }[], k: number): number =>
      list.slice(0, k).reduce((sum, region) => sum + region.nodeCount, 0) / Math.max(1, dump.nodes);

    // B: terrain becomes one row, freeing rows for topology.
    const terrainNodes = dump.regions
      .filter((region) => region.kind === 'terrain')
      .reduce((sum, region) => sum + region.nodeCount, 0);
    const topologyBySize = bySize.filter((region) => region.kind === 'topology');
    const collapsed =
      (terrainNodes + topologyBySize.slice(0, LEGEND_ROWS - 1).reduce((sum, r) => sum + r.nodeCount, 0)) /
      Math.max(1, dump.nodes);

    const rowsFor = (target: number): number => {
      let sum = 0;
      for (const [i, region] of bySize.entries()) {
        sum += region.nodeCount;
        if (sum / Math.max(1, dump.nodes) >= target) return i + 1;
      }
      return bySize.length;
    };

    const biggestTerrain = Math.max(
      0,
      ...dump.regions.filter((region) => region.kind === 'terrain').map((region) => region.nodeCount),
    );

    console.log(
      [
        dump.repo.padEnd(11),
        String(dump.nodes).padStart(5),
        String(s.regions).padStart(4),
        `${(share(byId, LEGEND_ROWS) * 100).toFixed(0)}%`.padStart(7),
        `${(share(bySize, LEGEND_ROWS) * 100).toFixed(0)}%`.padStart(8),
        `${(collapsed * 100).toFixed(0)}%`.padStart(8),
        String(rowsFor(0.9)).padStart(8),
        String(rowsFor(0.99)).padStart(7),
        String(s.terrain).padStart(9),
        String(biggestTerrain).padStart(12),
      ].join(' '),
    );
  }
  console.log(`
byId%    share of nodes the legend accounts for today — first ${LEGEND_ROWS} rows in id order
bySize%  the same legend, ordered by size (one comparator; no node moves)
+terr%   size order *and* terrain collapsed to a single row (they share one grey already)
need90   legend rows required to account for 90% of nodes, size-ordered
terrRows legend rows drawn in the identical grey today (scene.ts TERRAIN_INDEX = -1)`);
}

await main();
