/**
 * Throwaway probe: current label propagation vs the deterministic Louvain
 * prototype, on the same graph, on every reference repo.
 *
 * **What the counterfactual holds fixed**: the node set, the edge set, the
 * terrain rule and the naming rule are all unchanged. Only the community
 * assignment for *linked* nodes differs. Edgeless nodes are terrain under both,
 * because topology says nothing about them and that is not a clustering
 * decision — so a repo whose regions are mostly terrain (hugo) barely moves,
 * and saying so is the point of holding it fixed.
 *
 * NOT part of the suite. `npx tsx scripts/probe-louvain.ts <dumpdir> [gamma]`
 */

import process from 'node:process';

import { louvain, modularityOf } from '../src/indexer/louvain.js';
import type { Dump } from './probe-region-stats.js';
import { loadDumps } from './probe-region-stats.js';

const LEGEND_ROWS = 17;

interface Prepared {
  readonly dump: Dump;
  /** Index of each node among *linked* nodes, or -1 for an edgeless one. */
  readonly linked: readonly number[];
  readonly linkedCount: number;
  readonly linkedEdges: readonly { from: number; to: number }[];
  readonly paths: readonly string[];
}

function prepare(dump: Dump): Prepared {
  const degree = new Array<number>(dump.nodes).fill(0);
  for (const [from, to] of dump.edgeList) {
    if (from === to) continue;
    degree[from] = (degree[from] ?? 0) + 1;
    degree[to] = (degree[to] ?? 0) + 1;
  }
  const linked = new Array<number>(dump.nodes).fill(-1);
  let next = 0;
  for (let i = 0; i < dump.nodes; i++) if ((degree[i] ?? 0) > 0) linked[i] = next++;
  const linkedEdges: { from: number; to: number }[] = [];
  for (const [from, to] of dump.edgeList) {
    if (from === to) continue;
    const a = linked[from];
    const b = linked[to];
    if (a === undefined || b === undefined || a < 0 || b < 0) continue;
    linkedEdges.push({ from: a, to: b });
  }
  return {
    dump,
    linked,
    linkedCount: next,
    linkedEdges,
    paths: dump.nodeRegion.map(([path]) => path),
  };
}

/** Region sizes for a partition of the linked subgraph. */
function sizes(labels: readonly number[]): number[] {
  const counts = new Map<number, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([, size]) => size);
}

/**
 * The name this region would get, under the *existing* rule: the deepest
 * directory every member shares, else the directory of its busiest file. Held
 * fixed on purpose — a naming change is a separate, cheaper decision, and
 * mixing it in would make the clustering look better than it is.
 */
function nameFor(members: readonly number[], paths: readonly string[]): string {
  const dirs = members.map((index) => {
    const path = paths[index] ?? '';
    const slash = path.lastIndexOf('/');
    return slash === -1 ? '' : path.slice(0, slash);
  });
  let prefix = (dirs[0] ?? '').split('/').filter((part) => part.length > 0);
  for (const dir of dirs.slice(1)) {
    const parts = dir.split('/').filter((part) => part.length > 0);
    let shared = 0;
    while (shared < prefix.length && shared < parts.length && prefix[shared] === parts[shared]) shared++;
    prefix = prefix.slice(0, shared);
    if (prefix.length === 0) break;
  }
  return prefix.length > 0 ? prefix.join('/') : 'root';
}

/**
 * Nameability, as a property rather than a vibe: the share of a region's
 * members that live under the deepest directory all of them share.
 *
 * A region whose members share `src/` and nothing else scores 1.00 against a
 * name — `src` — that says nothing, so this is reported *beside* the depth of
 * that shared directory rather than instead of it. Both are needed: a nameable
 * region is one whose shared directory is deep enough to mean something and
 * holds enough of the region to be true.
 */
function nameability(members: readonly number[], paths: readonly string[]): {
  name: string;
  depth: number;
  purity: number;
} {
  const name = nameFor(members, paths);
  const prefix = name === 'root' ? '' : `${name}/`;
  const under = members.filter((index) => (paths[index] ?? '').startsWith(prefix)).length;
  return {
    name,
    depth: name === 'root' ? 0 : name.split('/').length,
    purity: under / Math.max(1, members.length),
  };
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  const gamma = Number.parseFloat(process.argv[3] ?? '1');
  if (dir === undefined) {
    console.error('usage: probe-louvain <dumpdir> [gamma]');
    process.exit(1);
  }
  const dumps = await loadDumps(dir);

  console.log(`## Label propagation vs deterministic Louvain (γ = ${gamma})\n`);
  console.log(
    'repo         linked │  now  Qnow  maxNow │  lvl  lou  Qlou  maxLou  split │ lvl0  lvlTop  depth  purity  time',
  );
  for (const dump of dumps) {
    const prep = prepare(dump);
    if (prep.linkedCount === 0) continue;

    const started = process.hrtime.bigint();
    const result = louvain(prep.linkedCount, prep.linkedEdges, {
      resolution: gamma,
      maxSweeps: 32,
      maxLevels: 16,
    });
    const ms = Number(process.hrtime.bigint() - started) / 1e6;

    // Current partition, restricted to the linked subgraph, so both are scored
    // on exactly the same graph.
    const regionIndexById = new Map(dump.regions.map((region, i) => [region.id, i] as const));
    const nowLabels: number[] = new Array<number>(prep.linkedCount).fill(0);
    for (let node = 0; node < dump.nodes; node++) {
      const slot = prep.linked[node];
      if (slot === undefined || slot < 0) continue;
      nowLabels[slot] = regionIndexById.get(dump.nodeRegion[node]?.[1] ?? '') ?? 0;
    }
    const nowSizes = sizes(nowLabels);
    const louSizes = sizes(result.labels);

    const qNow = modularityOf(nowLabels, prep.linkedCount, prep.linkedEdges, 1);
    const qLou = modularityOf(result.labels, prep.linkedCount, prep.linkedEdges, 1);

    // Nameability of the Louvain partition, over region instances.
    const membersByLabel = new Map<number, number[]>();
    for (let slot = 0; slot < prep.linkedCount; slot++) {
      const label = result.labels[slot] ?? 0;
      const node = prep.linked.indexOf(slot);
      const bucket = membersByLabel.get(label);
      if (bucket === undefined) membersByLabel.set(label, [node]);
      else bucket.push(node);
    }
    const named = [...membersByLabel.values()].map((members) => nameability(members, prep.paths));
    const meanDepth = named.reduce((sum, n) => sum + n.depth, 0) / Math.max(1, named.length);
    const meanPurity = named.reduce((sum, n) => sum + n.purity, 0) / Math.max(1, named.length);

    const levelCounts = result.levels.map((level) => new Set(level).size);

    console.log(
      [
        dump.repo.padEnd(11),
        String(prep.linkedCount).padStart(6),
        '│',
        String(nowSizes.length).padStart(4),
        qNow.toFixed(3).padStart(5),
        String(nowSizes[0] ?? 0).padStart(6),
        '│',
        String(result.levels.length).padStart(4),
        String(louSizes.length).padStart(4),
        qLou.toFixed(3).padStart(5),
        String(louSizes[0] ?? 0).padStart(7),
        String(result.splits).padStart(6),
        '│',
        String(levelCounts[0] ?? 0).padStart(4),
        String(levelCounts[levelCounts.length - 1] ?? 0).padStart(6),
        meanDepth.toFixed(2).padStart(6),
        meanPurity.toFixed(2).padStart(7),
        `${ms.toFixed(0)}ms`.padStart(6),
      ].join(' '),
    );
  }
  console.log(`
linked  nodes with at least one import edge; everything else is terrain under BOTH
now/Qnow  today's regions restricted to that subgraph, and their modularity at γ=1
lou/Qlou  the Louvain partition and its modularity at γ=1
maxNow/maxLou  the largest region, in nodes — the lopsidedness the mean hides
split   communities Leiden's connectivity guarantee had to break up
lvl0    communities at the FINEST Louvain level; lvlTop at the coarsest
depth   mean depth of the deepest directory a region's members all share
purity  mean share of a region's members under that directory (1.00 by construction
        for the shared-prefix rule; it is the depth that carries the meaning)
legend headroom: ${LEGEND_ROWS} rows`);
}

await main();
