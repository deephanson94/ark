/**
 * PHASE 5 — candidate C: bounded-depth truth. Refuted from existing atlases, no implementation.
 *
 * ADR-0008 chose unbounded truth deliberately, and named the defect a bound reintroduces:
 *
 *   > §8.3's highest-weighted distractor strategy is "nodes at distance n±1". At n = maxDepth,
 *   > "n+1" is a **real dependent** presented as a distractor: a player who knows the codebase
 *   > picks it and is told they are wrong.
 *
 * That objection is checkable without building anything. For a bound `d`, `truth` would be
 * `dependents(S, d)` and every node in `dependents(S, ∞) \ dependents(S, d)` becomes eligible as a
 * **wrong answer** while genuinely depending on the subject. Count them.
 *
 * ADR-0008's own measured claim — *"on this repo depth-3 truth equals unbounded truth for every
 * node"* — was taken on a 69-node atlas. This re-runs it across the corpus.
 *
 *   npx tsx scripts/probe-bounded.ts /tmp/atlas-A <repo>...
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildGraph, reach, nodeAt } from '../src/atlas/graph.js';
import type { Atlas, NodeRef } from '../src/atlas/schema.js';

const dir = process.argv[2] ?? '/tmp/atlas-A';
const repos = process.argv.slice(3);

console.log('| repo | blast subjects | subjects where d=2 truth ≠ ∞ truth | d=3 | d=4 | **real dependents beyond d=3** | worst subject |');
console.log('|---|---|---|---|---|---|---|');

for (const repo of repos) {
  const atlas = JSON.parse(readFileSync(join(dir, `${repo}.json`), 'utf8')) as Atlas;
  const graph = buildGraph(atlas);

  const differs: Record<number, number> = { 2: 0, 3: 0, 4: 0 };
  let beyond3 = 0;
  let subjects = 0;
  let worst = { path: '', n: 0 };

  for (let ref = 0; ref < atlas.nodes.length; ref += 1) {
    if ((graph.in[ref] ?? []).length === 0) continue;
    subjects += 1;
    const full = reach(graph, ref, 'dependents', Infinity).size;
    for (const d of [2, 3, 4]) {
      const bounded = reach(graph, ref, 'dependents', d).size;
      if (bounded !== full) differs[d] = (differs[d] ?? 0) + 1;
      if (d === 3) {
        const lost = full - bounded;
        beyond3 += lost;
        if (lost > worst.n) worst = { path: nodeAt(graph, ref).path, n: lost };
      }
    }
  }
  console.log(
    `| ${repo} | ${subjects} | ${differs[2]} | **${differs[3]}** | ${differs[4]} | **${beyond3}** | ` +
    `${worst.path === '' ? '—' : `\`${worst.path}\` (${worst.n})`} |`,
  );
}
