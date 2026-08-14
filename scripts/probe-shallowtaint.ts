/**
 * PHASE 4 — candidate B: taint that stops at the first unresolved edge.
 *
 * ADR-0003 refuses a board when any candidate **or anything on its outgoing side** carries an
 * unresolved import. The candidate here weakens that to the candidate itself (depth 0) or to a
 * bounded number of hops, and the question is the only one that matters: **how many wrong answer
 * keys would it ship?**
 *
 * The ceiling comes first, from atlases that already exist — how many subjects could possibly gain
 * a board. Then the cost, and the cost is what decides.
 *
 *   npx tsx scripts/probe-shallowtaint.ts /tmp/ark-corpus <repo>...
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { buildIndex, indexOptions } from '../src/indexer/build.js';
import { buildGraph, reach, nodeAt } from '../src/atlas/graph.js';
import type { Graph } from '../src/atlas/graph.js';
import type { NodeRef } from '../src/atlas/schema.js';

const corpus = process.argv[2] ?? '/tmp/ark-corpus';
const repos = process.argv.slice(3);
const out = '/tmp/ark-shallow';
mkdirSync(out, { recursive: true });

/** Nodes whose own imports or outgoing edges are unsound. */
function unsound(graph: Graph): Set<NodeRef> {
  const s = new Set<NodeRef>();
  for (let ref = 0; ref < graph.atlas.nodes.length; ref += 1) {
    const node = nodeAt(graph, ref);
    if (node.unresolved.length > 0 || (graph.out[ref] ?? []).some((e) => e.confidence !== 'certain')) s.add(ref);
  }
  return s;
}

/** Tainted at a given depth bound: is anything unsound within `d` hops of my dependency side? */
function taintedAtDepth(graph: Graph, bad: ReadonlySet<NodeRef>, d: number): Set<NodeRef> {
  const t = new Set<NodeRef>();
  for (let ref = 0; ref < graph.atlas.nodes.length; ref += 1) {
    if (bad.has(ref)) { t.add(ref); continue; }
    if (d === 0) continue;
    for (const dep of reach(graph, ref, 'dependencies', d).keys()) {
      if (bad.has(dep)) { t.add(ref); break; }
    }
  }
  return t;
}

console.log('| repo | blast subjects | tainted ∞ (today) | tainted d=3 | tainted d=1 | tainted d=0 | **subjects unlocked at d=0** |');
console.log('|---|---|---|---|---|---|---|');
const rows: unknown[] = [];
for (const repo of repos) {
  const { atlas } = await buildIndex(indexOptions(join(corpus, repo)));
  const graph = buildGraph(atlas);
  const bad = unsound(graph);
  const subjects = new Set<NodeRef>();
  for (let ref = 0; ref < atlas.nodes.length; ref += 1) if ((graph.in[ref] ?? []).length > 0) subjects.add(ref);

  const count = (s: ReadonlySet<NodeRef>): number => [...s].filter((r) => subjects.has(r)).length;
  const inf = count(taintedAtDepth(graph, bad, Infinity));
  const d3 = count(taintedAtDepth(graph, bad, 3));
  const d1 = count(taintedAtDepth(graph, bad, 1));
  const d0 = count(taintedAtDepth(graph, bad, 0));

  rows.push({ repo, sha: atlas.repo.head, subjects: subjects.size, inf, d3, d1, d0, unlocked: inf - d0 });
  console.log(`| ${repo} | ${subjects.size} | ${inf} | ${d3} | ${d1} | ${d0} | **${inf - d0}** |`);
}
writeFileSync(join(out, 'ceiling.json'), JSON.stringify(rows, null, 2));
