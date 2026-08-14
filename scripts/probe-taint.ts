/**
 * PHASE 2 — where the taint sits.
 *
 * ADR-0028 §8.1 found 7 computed `import_module(expr)` sites out of 12,000 tainting 83.7% of
 * django's blast subjects: 0.06% of sites causing the whole effect, because of **position** rather
 * than rate. This asks the same question of every taint-limited repo in the corpus.
 *
 * The ranking is by **blast subjects poisoned**, not by unresolved count. Those are different
 * orderings and only the first one decides a deck.
 *
 *   npx tsx scripts/probe-taint.ts /tmp/ark-corpus <repo>...
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { buildIndex, indexOptions } from '../src/indexer/build.js';
import { buildGraph, reach, nodeAt } from '../src/atlas/graph.js';
import type { Graph } from '../src/atlas/graph.js';
import type { Atlas, NodeRef } from '../src/atlas/schema.js';

const corpus = process.argv[2] ?? '/tmp/ark-corpus';
const repos = process.argv.slice(3);
const out = '/tmp/ark-taint';
mkdirSync(out, { recursive: true });

/** Nodes whose own imports or outgoing edges are unsound — the sources of all taint. */
function unsoundRefs(graph: Graph): NodeRef[] {
  const refs: NodeRef[] = [];
  for (let ref = 0; ref < graph.atlas.nodes.length; ref += 1) {
    const node = nodeAt(graph, ref);
    const unsound =
      node.unresolved.length > 0 || (graph.out[ref] ?? []).some((e) => e.confidence !== 'certain');
    if (unsound) refs.push(ref);
  }
  return refs;
}

/**
 * Which blast subjects each unsound node poisons.
 *
 * A node X taints every node that can reach X along import edges — X is in their dependency
 * closure. That is `reach(graph, X, 'dependents', ∞)` plus X itself, which is the same walk
 * `taintedRefs` does in aggregate, run one source at a time so the blame is attributable.
 */
function poisonedBy(graph: Graph, source: NodeRef, blastSubjects: ReadonlySet<NodeRef>): Set<NodeRef> {
  const hit = new Set<NodeRef>();
  if (blastSubjects.has(source)) hit.add(source);
  for (const ref of reach(graph, source, 'dependents', Infinity).keys()) {
    if (blastSubjects.has(ref)) hit.add(ref);
  }
  return hit;
}

for (const repo of repos) {
  const { atlas } = await buildIndex(indexOptions(join(corpus, repo)));
  const graph = buildGraph(atlas);

  const blastSubjects = new Set<NodeRef>();
  for (let ref = 0; ref < atlas.nodes.length; ref += 1) {
    if ((graph.in[ref] ?? []).length > 0) blastSubjects.add(ref);
  }

  const sources = unsoundRefs(graph);
  const scored = sources
    .map((ref) => {
      const node = nodeAt(graph, ref);
      return {
        ref,
        path: node.path,
        unresolvedCount: node.unresolved.length,
        probableEdges: (graph.out[ref] ?? []).filter((e) => e.confidence !== 'certain').length,
        specimens: node.unresolved.slice(0, 6),
        poisoned: poisonedBy(graph, ref, blastSubjects),
      };
    })
    .sort((a, b) => b.poisoned.size - a.poisoned.size || a.path.localeCompare(b.path));

  // The union of the worst k — what share of the starvation they account for **together**, which
  // is the only figure that can be quoted as "the worst five account for X". Summing the rows
  // double-counts every subject poisoned by two sources.
  const union = new Set<NodeRef>();
  const cumulative: number[] = [];
  for (const s of scored) {
    for (const r of s.poisoned) union.add(r);
    cumulative.push(union.size);
  }
  const totalTainted = union.size;

  const byUnresolvedCount = [...scored].sort(
    (a, b) => b.unresolvedCount - a.unresolvedCount || a.path.localeCompare(b.path),
  );

  const totalSites =
    atlas.edges.reduce((n, e) => n + e.weight, 0) +
    atlas.nodes.reduce((n, x) => n + x.externals.length + x.unresolved.length, 0);
  const unresolvedSites = atlas.nodes.reduce((n, x) => n + x.unresolved.length, 0);

  const report = {
    repo,
    sha: atlas.repo.head,
    nodes: atlas.nodes.length,
    blastSubjects: blastSubjects.size,
    taintedSubjects: totalTainted,
    unsoundNodes: sources.length,
    unresolvedSites,
    totalSites,
    top: scored.slice(0, 12).map((s, i) => ({
      rank: i + 1,
      path: s.path,
      unresolvedSpecifiers: s.unresolvedCount,
      probableEdges: s.probableEdges,
      subjectsPoisoned: s.poisoned.size,
      shareOfTainted: totalTainted === 0 ? 0 : s.poisoned.size / totalTainted,
      cumulativeUnionShare: totalTainted === 0 ? 0 : (cumulative[i] ?? 0) / totalTainted,
      specimens: s.specimens,
    })),
    /** How many unsound nodes it takes to reach 50% / 90% of the tainted subjects. */
    sourcesFor50: cumulative.findIndex((c) => c >= totalTainted * 0.5) + 1,
    sourcesFor90: cumulative.findIndex((c) => c >= totalTainted * 0.9) + 1,
    top5UnionShare: totalTainted === 0 ? 0 : (cumulative[4] ?? cumulative[cumulative.length - 1] ?? 0) / totalTainted,
    /** The other ordering, to show they disagree. */
    byUnresolvedCount: byUnresolvedCount.slice(0, 5).map((s) => ({
      path: s.path,
      unresolvedSpecifiers: s.unresolvedCount,
      subjectsPoisoned: s.poisoned.size,
    })),
  };

  writeFileSync(join(out, `${repo}.json`), JSON.stringify(report, null, 2));

  console.log(`\n### ${repo}  \`${report.sha.slice(0, 8)}\``);
  console.log(
    `${report.blastSubjects} blast subjects, ${report.taintedSubjects} tainted (${((report.taintedSubjects / report.blastSubjects) * 100).toFixed(1)}%); ` +
      `${report.unsoundNodes} unsound nodes carrying ${report.unresolvedSites} unresolved sites of ${report.totalSites} ` +
      `(${((report.unresolvedSites / report.totalSites) * 100).toFixed(2)}%)`,
  );
  console.log(
    `**${report.sourcesFor50} node(s) reach 50% of the taint; ${report.sourcesFor90} reach 90%. The worst five together account for ${(report.top5UnionShare * 100).toFixed(1)}%.**`,
  );
  console.log('\n| rank | file | unresolved specifiers | subjects poisoned | share | cumulative | specimen |');
  console.log('|---|---|---|---|---|---|---|');
  for (const t of report.top.slice(0, 8)) {
    console.log(
      `| ${t.rank} | \`${t.path}\` | ${t.unresolvedSpecifiers} | **${t.subjectsPoisoned}** | ${(t.shareOfTainted * 100).toFixed(1)}% | ${(t.cumulativeUnionShare * 100).toFixed(1)}% | \`${t.specimens[0] ?? '—'}\` |`,
    );
  }
  console.log('\nranked by unresolved **count** instead (the ordering that does not matter):');
  for (const t of report.byUnresolvedCount) {
    console.log(`  ${String(t.unresolvedSpecifiers).padStart(5)} specifiers → ${String(t.subjectsPoisoned).padStart(5)} subjects   ${t.path}`);
  }
}
