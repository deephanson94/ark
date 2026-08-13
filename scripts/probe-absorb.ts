/**
 * Throwaway probe: does `absorbSmallRegions` still fire once Louvain replaces
 * label propagation, or did the replacement make it vestigial?
 *
 * It was written for the old algorithm's side effect (the connector hold-out
 * stranded files), so "it is still needed" is a claim requiring a count rather
 * than an assumption — `CLAUDE.md`'s rule about machinery nobody measured
 * applies to machinery you *keep* as much as to machinery you add.
 *
 * Answer: it fires on hono (2 communities below the floor), graphql-js (2) and
 * kysely (1), and on none of ark, django, flask, hugo, prometheus.
 *
 * NOT part of the suite. `npx tsx scripts/probe-absorb.ts <dumpdir>`
 */

import process from 'node:process';

import { louvain } from '../src/indexer/louvain.js';
import { loadDumps } from './probe-region-stats.js';

/** Mirrors `MIN_REGION` in `src/indexer/regions.ts`. */
const MIN_REGION = 3;

const dir = process.argv[2];
if (dir === undefined) {
  console.error('usage: probe-absorb <dumpdir>');
  process.exit(1);
}

for (const dump of await loadDumps(dir)) {
  const degree = new Array<number>(dump.nodes).fill(0);
  for (const [from, to] of dump.edgeList) {
    if (from === to) continue;
    degree[from] = (degree[from] ?? 0) + 1;
    degree[to] = (degree[to] ?? 0) + 1;
  }
  const linked = new Array<number>(dump.nodes).fill(-1);
  let next = 0;
  for (let i = 0; i < dump.nodes; i++) if ((degree[i] ?? 0) > 0) linked[i] = next++;
  const edges: { from: number; to: number }[] = [];
  for (const [from, to] of dump.edgeList) {
    const a = linked[from] ?? -1;
    const b = linked[to] ?? -1;
    if (a < 0 || b < 0 || a === b) continue;
    edges.push({ from: a, to: b });
  }
  const result = louvain(next, edges, { resolution: 1, maxSweeps: 32, maxLevels: 16 });
  const sizes = new Map<number, number>();
  for (const label of result.labels) sizes.set(label, (sizes.get(label) ?? 0) + 1);
  const small = [...sizes.values()].filter((size) => size < MIN_REGION);
  console.log(
    `${dump.repo.padEnd(12)} communities ${String(sizes.size).padStart(3)}` +
      `  below MIN_REGION=${MIN_REGION}: ${String(small.length).padStart(2)}` +
      `${small.length > 0 ? ` (${small.join(',')})` : ''}`,
  );
}
