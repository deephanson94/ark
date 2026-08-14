/**
 * Whether the inspector's `imported by` is a count of files.
 *
 * `scene.ts` sets `dependentCount: (graph.in[ref] ?? []).length`, and `graph.in`
 * holds **edges**. The validator already refuses two edges with the same
 * `(from, to, kind)`, so this is not a duplicate-edge bug — it is that **one
 * file can reach another by more than one kind of edge**: `export * from './x'`
 * beside `import { y } from './x'` is a `reexport` and an `import`, two true and
 * distinct facts about the same pair of files. The inspector prints their sum
 * under the label `imported by`, which makes it a count of *edges* wearing the
 * name of a count of *files*.
 *
 * A cold playtester caught it from the arithmetic rather than from the code:
 * `imported by` exceeded the transitive dependent count on the same node, which
 * is impossible — direct dependents are a subset of transitive ones.
 *
 *   npx tsx scripts/probe-indegree.ts /tmp/ark-corpus <repo>...
 *
 * `ark` reads this checkout rather than a clone, so the figure moves with the
 * working tree; quote it against a named commit.
 */
import { join } from 'node:path';

import { buildGraph, dependents } from '../src/atlas/graph.js';
import { buildIndex, indexOptions } from '../src/indexer/build.js';

const corpus = process.argv[2] ?? '/tmp/ark-corpus';

for (const repo of process.argv.slice(3)) {
  const { atlas } = await buildIndex(
    indexOptions(repo === 'ark' ? process.cwd() : join(corpus, repo)),
  );
  const graph = buildGraph(atlas);
  const pairs = new Set(atlas.edges.map((edge) => `${edge.from} ${edge.to}`));
  const kinds = new Map<string, number>();
  for (const edge of atlas.edges) kinds.set(edge.kind, (kinds.get(edge.kind) ?? 0) + 1);

  let worst = { path: '', gap: 0, edges: 0, files: 0, cone: 0 };
  let impossible = 0;
  for (const [ref, node] of atlas.nodes.entries()) {
    const incoming = graph.in[ref] ?? [];
    const files = new Set(incoming.map((edge) => edge.from)).size;
    const cone = dependents(graph, ref, Infinity).size;
    if (incoming.length > cone) impossible += 1;
    if (incoming.length - files > worst.gap) {
      worst = { path: node.path, gap: incoming.length - files, edges: incoming.length, files, cone };
    }
  }

  console.log(
    `${repo.padEnd(12)} edges ${String(atlas.edges.length).padStart(6)} over ${String(pairs.size).padStart(6)} distinct pairs ` +
      `(${(100 * (1 - pairs.size / Math.max(1, atlas.edges.length))).toFixed(1)}% two-kinded) · ` +
      `kinds ${[...kinds].map(([kind, n]) => `${kind} ${n}`).join(', ')} · ` +
      `nodes printing direct > transitive ${impossible}/${atlas.nodes.length} · ` +
      `worst ${worst.path || '—'} prints ${worst.edges}, files ${worst.files}, cone ${worst.cone}`,
  );
}
