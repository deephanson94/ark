/**
 * Throwaway probe: are regions stable **across** commits?
 *
 * CLAUDE.md's landmine says determinism guarantees same-commit-same-regions and
 * guarantees nothing about a small graph change — label propagation can
 * reshuffle wholesale. That is unaddressed in the spec and it is exactly what a
 * layout epoch is supposed to buy, so a replacement that is *worse* at it costs
 * more than its region counts suggest.
 *
 * Measured with the **Rand index** over node pairs, which needs no label
 * matching: for every pair of nodes present at both commits, do the two
 * partitions agree on whether they share a region? A relabelling that moves no
 * node scores 1.000; a wholesale reshuffle scores near the chance level. Chance
 * is *not* 0 and depends on the size distribution, so the chance level for each
 * pair of partitions is printed beside the score — a Rand index quoted without
 * it is the rank-measures-nothing landmine wearing a statistic.
 *
 * NOT part of the suite.
 * `npx tsx scripts/probe-stability.ts <repo> <sha> <sha> ...`
 */

import { execFile } from 'node:child_process';
import process from 'node:process';
import { promisify } from 'node:util';

import { buildAtlas, indexOptions } from '../src/indexer/build.js';
import { louvain } from '../src/indexer/louvain.js';

const run = promisify(execFile);

interface Snapshot {
  readonly sha: string;
  /**
   * path → region id, from `buildAtlas` — i.e. **whatever this checkout ships**.
   * It was label propagation while ADR-0041 was being measured and is Louvain
   * since; run on a current tree it duplicates the `lou` arm. Check out
   * `d4acfa5` to reproduce the label-propagation column.
   */
  readonly now: ReadonlyMap<string, string>;
  /** path → louvain community, or undefined for an edgeless node. */
  readonly lou: ReadonlyMap<string, number>;
  /** path → top-level directory. The control arm; trivially stable. */
  readonly dir: ReadonlyMap<string, string>;
}

async function snapshot(repo: string, sha: string): Promise<Snapshot> {
  await run('git', ['-C', repo, 'checkout', '-q', '--detach', sha], {
    env: { ...process.env, LC_ALL: 'C' },
  });
  const atlas = await buildAtlas(indexOptions(repo));

  const now = new Map<string, string>();
  for (const node of atlas.nodes) now.set(node.path, node.region);

  const degree = new Array<number>(atlas.nodes.length).fill(0);
  for (const edge of atlas.edges) {
    if (edge.from === edge.to) continue;
    degree[edge.from] = (degree[edge.from] ?? 0) + 1;
    degree[edge.to] = (degree[edge.to] ?? 0) + 1;
  }
  const linked = new Array<number>(atlas.nodes.length).fill(-1);
  const backwards: number[] = [];
  for (let i = 0; i < atlas.nodes.length; i++) {
    if ((degree[i] ?? 0) > 0) {
      linked[i] = backwards.length;
      backwards.push(i);
    }
  }
  const edges: { from: number; to: number }[] = [];
  for (const edge of atlas.edges) {
    const a = linked[edge.from] ?? -1;
    const b = linked[edge.to] ?? -1;
    if (a < 0 || b < 0 || a === b) continue;
    edges.push({ from: a, to: b });
  }
  const result = louvain(backwards.length, edges, { resolution: 1, maxSweeps: 32, maxLevels: 16 });
  const lou = new Map<string, number>();
  const dir = new Map<string, string>();
  for (let slot = 0; slot < backwards.length; slot++) {
    const node = atlas.nodes[backwards[slot] ?? 0];
    if (node === undefined) continue;
    lou.set(node.path, result.labels[slot] ?? 0);
    const slash = node.path.indexOf('/');
    dir.set(node.path, slash === -1 ? '' : node.path.slice(0, slash));
  }
  return { sha, now, lou, dir };
}

/**
 * Rand index over the nodes both partitions contain, plus the chance level for
 * these two size distributions (the expected Rand index of two independent
 * partitions with the same block sizes).
 */
function randIndex<T>(a: ReadonlyMap<string, T>, b: ReadonlyMap<string, T>): {
  shared: number;
  rand: number;
  chance: number;
} {
  const keys = [...a.keys()].filter((key) => b.has(key)).sort();
  const n = keys.length;
  if (n < 2) return { shared: n, rand: 1, chance: 1 };

  const sizesA = new Map<T, number>();
  const sizesB = new Map<T, number>();
  const joint = new Map<string, number>();
  for (const key of keys) {
    const ka = a.get(key) as T;
    const kb = b.get(key) as T;
    sizesA.set(ka, (sizesA.get(ka) ?? 0) + 1);
    sizesB.set(kb, (sizesB.get(kb) ?? 0) + 1);
    const cell = `${String(ka)}\u0000${String(kb)}`;
    joint.set(cell, (joint.get(cell) ?? 0) + 1);
  }
  const pairs = (k: number): number => (k * (k - 1)) / 2;
  const total = pairs(n);
  const sumA = [...sizesA.values()].reduce((sum, k) => sum + pairs(k), 0);
  const sumB = [...sizesB.values()].reduce((sum, k) => sum + pairs(k), 0);
  const sumJoint = [...joint.values()].reduce((sum, k) => sum + pairs(k), 0);
  // agreements = both-together + both-apart
  const rand = (total + 2 * sumJoint - sumA - sumB) / total;
  // Expected under independence with these block sizes.
  const expectedJoint = (sumA * sumB) / total;
  const chance = (total + 2 * expectedJoint - sumA - sumB) / total;
  return { shared: n, rand, chance };
}

/**
 * The player-facing number: after matching each old region to the new region it
 * overlaps most (greedy, descending overlap, ties by ascending label so it is
 * reproducible), what share of shared nodes ended up somewhere else?
 *
 * Rand and excess-over-chance disagreed about which algorithm is steadier —
 * raw favours the finer partition, excess favours the coarser — so neither
 * alone is quotable. This one is not a similarity coefficient at all: it is
 * "how much of the map changed colour", which is the thing a returning player
 * would notice.
 */
function recoloured<T>(a: ReadonlyMap<string, T>, b: ReadonlyMap<string, T>): number {
  const keys = [...a.keys()].filter((key) => b.has(key)).sort();
  if (keys.length === 0) return 0;
  const overlap = new Map<string, number>();
  for (const key of keys) {
    const cell = `${String(a.get(key))}\u0000${String(b.get(key))}`;
    overlap.set(cell, (overlap.get(cell) ?? 0) + 1);
  }
  const ordered = [...overlap.entries()].sort(
    (x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1),
  );
  const takenOld = new Set<string>();
  const takenNew = new Set<string>();
  let matched = 0;
  for (const [cell, count] of ordered) {
    const [oldLabel = '', newLabel = ''] = cell.split('\u0000');
    if (takenOld.has(oldLabel) || takenNew.has(newLabel)) continue;
    takenOld.add(oldLabel);
    takenNew.add(newLabel);
    matched += count;
  }
  return 1 - matched / keys.length;
}

async function main(): Promise<void> {
  const [repo, ...shas] = process.argv.slice(2);
  if (repo === undefined || shas.length < 2) {
    console.error('usage: probe-stability <repo> <sha> <sha> ...');
    process.exit(1);
  }
  const original = (await run('git', ['-C', repo, 'rev-parse', 'HEAD'])).stdout.trim();
  const snapshots: Snapshot[] = [];
  try {
    for (const sha of shas) snapshots.push(await snapshot(repo, sha));
  } finally {
    await run('git', ['-C', repo, 'checkout', '-q', '--detach', original]);
  }

  console.log('## Region stability across commits — nodes that changed region\n');
  console.log(
    'from      to        shared │  A labelProp  │  B louvain    │  C directory',
  );
  let nowSum = 0;
  let louSum = 0;
  let recolNow = 0;
  let recolLou = 0;
  let recolDir = 0;
  let worstNow = 0;
  let worstLou = 0;
  let pairsCounted = 0;
  for (let i = 1; i < snapshots.length; i++) {
    const previous = snapshots[i - 1];
    const current = snapshots[i];
    if (previous === undefined || current === undefined) continue;
    const now = randIndex(previous.now, current.now);
    const lou = randIndex(previous.lou, current.lou);
    const recolouredNow = recoloured(previous.now, current.now);
    const recolouredLou = recoloured(previous.lou, current.lou);
    recolNow += recolouredNow;
    recolLou += recolouredLou;
    worstNow = Math.max(worstNow, recolouredNow);
    worstLou = Math.max(worstLou, recolouredLou);
    nowSum += now.rand - now.chance;
    louSum += lou.rand - lou.chance;
    pairsCounted++;
    const recolouredDir = recoloured(previous.dir, current.dir);
    recolDir += recolouredDir;
    const cell = (share: number): string =>
      `${String(Math.round(share * now.shared)).padStart(5)} (${(share * 100).toFixed(1)}%)`.padStart(13);
    console.log(
      [
        previous.sha.slice(0, 8),
        current.sha.slice(0, 8),
        String(now.shared).padStart(7),
        '│',
        cell(recolouredNow),
        '│',
        cell(recolouredLou),
        '│',
        cell(recolouredDir),
      ].join(' '),
    );
  }
  console.log(
    `\nmean excess over chance — now ${(nowSum / Math.max(1, pairsCounted)).toFixed(3)}, ` +
      `louvain ${(louSum / Math.max(1, pairsCounted)).toFixed(3)}`,
  );
  console.log(
    `worst single step        — now ${(worstNow * 100).toFixed(1)}%, ` +
      `louvain ${(worstLou * 100).toFixed(1)}%   <- "reshuffles wholesale" lives here, not in the mean`,
  );
  console.log(
    `mean share of shared nodes recoloured — now ` +
      `${((recolNow / Math.max(1, pairsCounted)) * 100).toFixed(1)}%, ` +
      `louvain ${((recolLou / Math.max(1, pairsCounted)) * 100).toFixed(1)}%, ` +
      `directory ${((recolDir / Math.max(1, pairsCounted)) * 100).toFixed(1)}%`,
  );
  console.log(
    'excess is the number to read: a partition of 5 blocks has a high chance Rand\n' +
      'by construction, so the raw score flatters whichever side has fewer regions.',
  );
}

await main();
