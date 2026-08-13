/**
 * Throwaway probe: check the headline figures quoted in ADR-0041, README and
 * CHANGELOG against the **shipped** indexer's dumps.
 *
 * Written because this repo's most-repeated defect is a sentence that
 * contradicts a number, and because most of ADR-0041's figures were taken
 * against a scratch copy before the change landed.
 *
 * NOT part of the suite. `npx tsx scripts/probe-verify.ts <dumpdir>`
 */

import process from 'node:process';

import { loadDumps } from './probe-region-stats.js';

const dir = process.argv[2];
if (dir === undefined) {
  console.error('usage: probe-verify <dumpdir>');
  process.exit(1);
}

console.log('repo          regions  topo  linked  largestTopo  share of linked');
for (const dump of await loadDumps(dir)) {
  const degree = new Array<number>(dump.nodes).fill(0);
  for (const [from, to] of dump.edgeList) {
    if (from === to) continue;
    degree[from] = (degree[from] ?? 0) + 1;
    degree[to] = (degree[to] ?? 0) + 1;
  }
  const linked = degree.filter((d) => d > 0).length;
  const topology = dump.regions.filter((region) => region.kind === 'topology');
  const largest = Math.max(0, ...topology.map((region) => region.nodeCount));
  console.log(
    [
      dump.repo.padEnd(12),
      String(dump.regions.length).padStart(7),
      String(topology.length).padStart(5),
      String(linked).padStart(7),
      String(largest).padStart(12),
      `${((largest / Math.max(1, linked)) * 100).toFixed(1)}%`.padStart(16),
    ].join(' '),
  );
}
