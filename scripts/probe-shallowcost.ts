/**
 * PHASE 4 — what candidate B would cost: wrong answer keys, measured rather than argued.
 *
 * ADR-0003 refuses a board when anything on a candidate's **outgoing side** is unsound, and states
 * the fear exactly: *"a candidate we are presenting as a distractor might reach the subject through
 * an import we could not resolve."* Relaxing the walk to depth 0 keeps only the candidate's own
 * imports, which unlocks a very large number of subjects (`probe-shallowtaint.ts`) and makes that
 * fear live.
 *
 * ## The instrument
 *
 * You cannot check the fear against the atlas that has it — the missing edge is missing (ADR-0026
 * §6.1). So this compares two atlases built from the **same source at the same commit**:
 *
 *   A — the shipped resolver
 *   B — the shipped resolver plus §3's three fixes, which resolve 98–99% of the previously
 *       unresolved specifiers on apollo-client, rxjs and nest
 *
 * A node in `dependents_B(S) \ dependents_A(S)` is a **real dependent of S that A's graph cannot
 * see**. ADR-0008's invariant is computed on A, so A does not put it in `truth` and the distractor
 * generator is free to offer it — as a wrong answer. That is a wrong answer key, and B proves it is
 * one without any appeal to A.
 *
 * This is a **lower bound**: B still cannot resolve `require(<expression>)`, so on typeorm — where
 * that is the whole story — it can see almost nothing. Where it reads 0, say "B could not see any",
 * never "there are none".
 *
 * ## The gate
 *
 * `--plant` deletes a random-but-deterministic 5% of A's edges before comparing. Those deletions
 * make real dependents invisible to A by construction, so the probe must find them.
 *
 *   npx tsx scripts/probe-shallowcost.ts /tmp/atlas-A /tmp/atlas-B <repo>...
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildGraph, reach, nodeAt } from '../src/atlas/graph.js';
import type { Atlas, AtlasEdge, NodeRef } from '../src/atlas/schema.js';

const dirA = process.argv[2] ?? '/tmp/atlas-A';
const dirB = process.argv[3] ?? '/tmp/atlas-B';
const plant = process.argv.includes('--plant');
const repos = process.argv.slice(4).filter((a) => !a.startsWith('--'));

const load = (dir: string, repo: string): Atlas =>
  JSON.parse(readFileSync(join(dir, `${repo}.json`), 'utf8')) as Atlas;

/** Unsound nodes: their own imports or outgoing edges are not trustworthy. */
function unsoundOf(atlas: Atlas): Set<NodeRef> {
  const graph = buildGraph(atlas);
  const s = new Set<NodeRef>();
  for (let ref = 0; ref < atlas.nodes.length; ref += 1) {
    const node = nodeAt(graph, ref);
    if (node.unresolved.length > 0 || (graph.out[ref] ?? []).some((e) => e.confidence !== 'certain')) s.add(ref);
  }
  return s;
}

console.log('| repo | subjects d=0 unlocks | with an **invisible real dependent** | invisible slots | **mean share of the wrong-answer pool that really depends on the subject** | worst subject |');
console.log('|---|---|---|---|---|---|');

let totalHits = 0;
for (const repo of repos) {
  let atlasA = load(dirA, repo);
  const atlasB = load(dirB, repo);

  if (plant) {
    // Delete every 20th edge from A. Those targets' importers become invisible dependents by
    // construction — if the probe reports 0 after this, it is measuring nothing.
    const kept: AtlasEdge[] = atlasA.edges.filter((_, i) => i % 20 !== 0);
    atlasA = { ...atlasA, edges: kept };
  }

  const graphA = buildGraph(atlasA);
  const graphB = buildGraph(atlasB);
  // Node ids are content-derived (ADR-0002) and both atlases index the same commit, so paths line
  // up one-to-one. Assert it rather than assume it.
  const refBOf = new Map(atlasB.nodes.map((n, i) => [n.path, i as NodeRef]));
  if (atlasA.nodes.length !== atlasB.nodes.length) {
    console.log(`| ${repo} | *node counts differ (${atlasA.nodes.length} vs ${atlasB.nodes.length}) — skipped* | | | |`);
    continue;
  }

  const unsoundA = unsoundOf(atlasA);
  let unlocked = 0;
  let subjectsWithHit = 0;
  let slots = 0;
  let worst = { path: '', n: 0 };
  const poolShares: number[] = [];

  for (let ref = 0; ref < atlasA.nodes.length; ref += 1) {
    if ((graphA.in[ref] ?? []).length === 0) continue;
    // Tainted today (∞) but clean at depth 0 — exactly the set candidate B would unlock.
    const deepTainted =
      unsoundA.has(ref) ||
      [...reach(graphA, ref, 'dependencies', Infinity).keys()].some((d) => unsoundA.has(d));
    if (!deepTainted || unsoundA.has(ref)) continue;
    unlocked += 1;

    const path = nodeAt(graphA, ref).path;
    const refB = refBOf.get(path);
    if (refB === undefined) continue;

    const depsA = new Set([...reach(graphA, ref, 'dependents', Infinity).keys()].map((r) => nodeAt(graphA, r).path));
    const depsB = [...reach(graphB, refB, 'dependents', Infinity).keys()].map((r) => nodeAt(graphB, r).path);
    const invisible = depsB.filter((p) => !depsA.has(p));
    if (invisible.length > 0) {
      subjectsWithHit += 1;
      slots += invisible.length;
      if (invisible.length > worst.n) worst = { path, n: invisible.length };
      // The number that decides: of everything A would happily offer as a wrong answer about this
      // subject, what share really depends on it? `slots` alone is a pool size, not a risk.
      const eligible = atlasA.nodes.length - depsA.size - 1;
      if (eligible > 0) poolShares.push(invisible.length / eligible);
    }
  }
  totalHits += slots;
  const meanShare = poolShares.length === 0 ? 0 : poolShares.reduce((a, b) => a + b, 0) / poolShares.length;
  console.log(
    `| ${repo} | ${unlocked} | **${subjectsWithHit}** (${unlocked === 0 ? '0' : ((subjectsWithHit / unlocked) * 100).toFixed(0)}%) | ${slots} | **${(meanShare * 100).toFixed(1)}%** | ${worst.path === '' ? '—' : `\`${worst.path}\` (${worst.n})`} |`,
  );
}
if (plant) {
  console.log(`\nPLANT GATE: ${totalHits > 0 ? 'PASS — the probe finds dependents made invisible on purpose' : 'FAIL — measuring nothing'}`);
}
