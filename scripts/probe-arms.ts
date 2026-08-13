/**
 * Throwaway probe: three arms, scored on nameability **and** modularity side by
 * side, because separately either one is misleading.
 *
 *   A  label propagation   — what ships today
 *   B  Louvain γ = 1       — the prototype
 *   C  top-level directory — the control, and a real candidate
 *
 * ## Why arm C exists
 *
 * `docs/atlas-format.md` §3.4: *"Regions are derived from the import graph by
 * label propagation, **not** from the directory tree (pillar 4)."* A nameability
 * metric built on shared path prefixes therefore scores a clustering higher the
 * more it resembles the thing the spec forbids it to be — so a nameability
 * number quoted on its own will always push the answer back toward the folder
 * tree.
 *
 * Arm C makes that concrete instead of arguing about it. It is the folder tree,
 * five lines, and it is the **ceiling** of the nameability metric by
 * construction. Two readings follow and both are useful:
 *
 *  - If C wins on nameability and loses on modularity, the metric is measuring
 *    directory alignment rather than nameability, and a "wash" on it costs less
 *    than it appeared to.
 *  - If C wins on **both**, the honest recommendation is not Louvain at all —
 *    it is five lines instead of three hundred, it still moves the layout, and
 *    it is a completely different decision. That would be the finding.
 *
 * NOT part of the suite. `npx tsx scripts/probe-arms.ts <dumpdir>`
 */

import process from 'node:process';

import { louvain, modularityOf } from '../src/indexer/louvain.js';
import { bestDirectory } from './probe-nameable.js';
import type { Dump } from './probe-region-stats.js';
import { loadDumps } from './probe-region-stats.js';

const NAMEABLE = 0.7;

function prefixesOf(path: string): string[] {
  const parts = path.split('/');
  const out = [''];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'));
  return out;
}

export interface ArmScore {
  readonly regions: number;
  readonly q: number;
  readonly meanF1: number;
  readonly nameableRegions: number;
  readonly nameableNodes: number;
  readonly largestShare: number;
}

export function scoreArm(
  labels: readonly number[],
  nodesOf: readonly number[],
  paths: readonly string[],
  filesUnder: ReadonlyMap<string, number>,
  edges: readonly { from: number; to: number }[],
): ArmScore {
  const members = new Map<number, number[]>();
  for (const [slot, label] of labels.entries()) {
    const node = nodesOf[slot] ?? 0;
    const bucket = members.get(label);
    if (bucket === undefined) members.set(label, [node]);
    else bucket.push(node);
  }
  const scored = [...members.values()].map((list) => ({
    size: list.length,
    f1: bestDirectory(list, paths, filesUnder).f1,
  }));
  const total = scored.reduce((sum, s) => sum + s.size, 0);
  const nameable = scored.filter((s) => s.f1 >= NAMEABLE);
  return {
    regions: scored.length,
    q: modularityOf(labels, labels.length, edges, 1),
    meanF1: scored.reduce((sum, s) => sum + s.f1, 0) / Math.max(1, scored.length),
    nameableRegions: nameable.length,
    nameableNodes: nameable.reduce((sum, s) => sum + s.size, 0) / Math.max(1, total),
    largestShare: Math.max(0, ...scored.map((s) => s.size)) / Math.max(1, total),
  };
}

export interface Prepared {
  readonly paths: readonly string[];
  readonly filesUnder: ReadonlyMap<string, number>;
  readonly nodesOf: readonly number[];
  readonly edges: readonly { from: number; to: number }[];
  readonly now: readonly number[];
  readonly lou: readonly number[];
  readonly dir: readonly number[];
}

export function prepareArms(dump: Dump): Prepared {
  const paths = dump.nodeRegion.map(([path]) => path);
  const filesUnder = new Map<string, number>();
  for (const path of paths) {
    for (const prefix of prefixesOf(path)) filesUnder.set(prefix, (filesUnder.get(prefix) ?? 0) + 1);
  }

  const degree = new Array<number>(dump.nodes).fill(0);
  for (const [from, to] of dump.edgeList) {
    if (from === to) continue;
    degree[from] = (degree[from] ?? 0) + 1;
    degree[to] = (degree[to] ?? 0) + 1;
  }
  const linked = new Array<number>(dump.nodes).fill(-1);
  const nodesOf: number[] = [];
  for (let i = 0; i < dump.nodes; i++) {
    if ((degree[i] ?? 0) > 0) {
      linked[i] = nodesOf.length;
      nodesOf.push(i);
    }
  }
  const edges: { from: number; to: number }[] = [];
  for (const [from, to] of dump.edgeList) {
    const a = linked[from] ?? -1;
    const b = linked[to] ?? -1;
    if (a < 0 || b < 0 || a === b) continue;
    edges.push({ from: a, to: b });
  }

  // A: today's regions, restricted to the linked subgraph.
  const regionIndexById = new Map(dump.regions.map((region, i) => [region.id, i] as const));
  const now = nodesOf.map((node) => regionIndexById.get(dump.nodeRegion[node]?.[1] ?? '') ?? 0);

  // B: the prototype.
  const lou = [
    ...louvain(nodesOf.length, edges, { resolution: 1, maxSweeps: 32, maxLevels: 16 }).labels,
  ];

  // C: the folder tree. Five lines, and this is all of them.
  const topLevel = new Map<string, number>();
  const dir = nodesOf.map((node) => {
    const path = paths[node] ?? '';
    const slash = path.indexOf('/');
    const top = slash === -1 ? '' : path.slice(0, slash);
    let label = topLevel.get(top);
    if (label === undefined) {
      label = topLevel.size;
      topLevel.set(top, label);
    }
    return label;
  });

  return { paths, filesUnder, nodesOf, edges, now, lou, dir };
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (dir === undefined) {
    console.error('usage: probe-arms <dumpdir>');
    process.exit(1);
  }
  const dumps = await loadDumps(dir);

  console.log('## Three arms — nameability and modularity side by side\n');
  console.log(
    'repo         arm          regs      Q   meanF1  nameable  namedNodes%  largest%',
  );
  const wins = { q: { A: 0, B: 0, C: 0 }, f1: { A: 0, B: 0, C: 0 } };
  for (const dump of dumps) {
    const p = prepareArms(dump);
    if (p.nodesOf.length === 0) continue;
    const arms: [string, readonly number[]][] = [
      ['A labelProp', p.now],
      ['B louvain  ', p.lou],
      ['C directory', p.dir],
    ];
    const scores = arms.map(([name, labels]) => [
      name,
      scoreArm(labels, p.nodesOf, p.paths, p.filesUnder, p.edges),
    ] as const);

    const bestQ = Math.max(...scores.map(([, s]) => s.q));
    const bestF1 = Math.max(...scores.map(([, s]) => s.meanF1));
    for (const [name, s] of scores) {
      const key = (name[0] ?? 'A') as 'A' | 'B' | 'C';
      if (s.q === bestQ) wins.q[key]++;
      if (s.meanF1 === bestF1) wins.f1[key]++;
      console.log(
        [
          (scores[0]?.[0] === name ? dump.repo : '').padEnd(11),
          name,
          String(s.regions).padStart(6),
          `${s.q.toFixed(3)}${s.q === bestQ ? '*' : ' '}`.padStart(7),
          `${s.meanF1.toFixed(3)}${s.meanF1 === bestF1 ? '*' : ' '}`.padStart(8),
          `${s.nameableRegions}/${s.regions}`.padStart(9),
          `${(s.nameableNodes * 100).toFixed(0)}%`.padStart(12),
          `${(s.largestShare * 100).toFixed(0)}%`.padStart(9),
        ].join(' '),
      );
    }
    console.log('');
  }
  console.log(
    `wins on modularity  — A ${wins.q.A}  B ${wins.q.B}  C ${wins.q.C}\n` +
      `wins on mean name F1 — A ${wins.f1.A}  B ${wins.f1.B}  C ${wins.f1.C}\n\n` +
      'Read the two together. Arm C is the folder tree, so it is the nameability\n' +
      "metric's ceiling by construction — atlas-format.md §3.4 says a region is\n" +
      '"derived from the import graph … **not** from the directory tree". If C tops\n' +
      'the name column and not the Q column, the name column is measuring directory\n' +
      'alignment and cannot on its own decide a clustering.',
  );
}

if (process.argv[1]?.includes('probe-arms')) await main();
