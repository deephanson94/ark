/**
 * Throwaway probe: does `absorbSmallRegions` still **fire** once Louvain
 * replaces label propagation?
 *
 * ## The first version of this probe measured the wrong event
 *
 * It counted *communities below `MIN_REGION`* — the pass's **precondition** —
 * and five documents transcribed that count as "it fires on hono (2),
 * graphql-js (2), kysely (1)". It does not. Every one of those communities is a
 * two-node island with **no outward edge**, so `absorbSmallRegions` marks it
 * `stranded` and does nothing; what removes it is the pre-existing terrain fold
 * a few lines down. Measured by instrumenting the merge loop itself:
 * **0 merges on all eight repos.**
 *
 * That is CLAUDE.md's never-fires landmine with a twist worth naming: counting
 * *the condition under which a branch could run* looks exactly like counting the
 * branch, and reads as diligence.
 *
 * So this now counts the **merge**, by re-implementing the pass's own decision
 * rather than its trigger.
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

console.log('repo          communities  belowFloor  ofThose:merged  stranded(no outward edge)');
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
  const neighbours: number[][] = Array.from({ length: next }, () => []);
  for (const [from, to] of dump.edgeList) {
    const a = linked[from] ?? -1;
    const b = linked[to] ?? -1;
    if (a < 0 || b < 0 || a === b) continue;
    edges.push({ from: a, to: b });
    neighbours[a]?.push(b);
    neighbours[b]?.push(a);
  }
  const labels = [...louvain(next, edges, { resolution: 1, maxSweeps: 32, maxLevels: 16 }).labels];

  const sizes = new Map<number, number>();
  for (const label of labels) sizes.set(label, (sizes.get(label) ?? 0) + 1);
  const below = [...sizes.entries()].filter(([, size]) => size < MIN_REGION);

  // The pass's actual decision: a sub-floor community merges only if it has an
  // edge leaving it. With none, it is `stranded` and the terrain fold takes it.
  let merged = 0;
  let stranded = 0;
  for (const [label] of below) {
    let outward = 0;
    for (let slot = 0; slot < next; slot++) {
      if (labels[slot] !== label) continue;
      for (const neighbour of neighbours[slot] ?? []) {
        if (labels[neighbour] !== label) outward++;
      }
    }
    if (outward > 0) merged++;
    else stranded++;
  }

  console.log(
    [
      dump.repo.padEnd(12),
      String(sizes.size).padStart(11),
      String(below.length).padStart(11),
      String(merged).padStart(15),
      String(stranded).padStart(9),
    ].join(' '),
  );
}
console.log(`
belowFloor  the pass's PRECONDITION — what the first version of this probe counted
merged      the pass's EVENT — a sub-floor community with an edge leaving it
stranded    no outward edge: absorption declines, and the terrain fold takes it`);
