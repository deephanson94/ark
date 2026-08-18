/**
 * What drawing edge direction would give away.
 *
 * The most-requested visual change across five rounds of cold playtests, twice
 * running, and permanently refused — **ADR-0049**. This is the measurement that
 * document rests on, kept as a script so the claim can be re-run rather than
 * quoted from prose.
 *
 * The guess: walk **backwards** along the drawn arrows from the subject and tick
 * every candidate you arrive at. ADR-0008's generator invariant is
 * `candidates ∩ dependents(subject, ∞) = truth`, so that walk does not
 * approximate the answer key — it *is* the answer key, by construction. Scored
 * with `scoreSet`, the metric §8.2 grades in.
 *
 * **Its first version reported 0.000 on 94 boards**, because it iterated
 * `graph.in[ref]`, which holds *edges* rather than refs, so the walk never left
 * depth 0. A mean of exactly zero across two repositories is an instrument
 * measuring nothing, and it errs in the direction that makes shipping look safe.
 *
 *   npx tsx scripts/probe-direction.ts
 */
import { join } from 'node:path';
import { buildGraph } from '../src/atlas/graph.js';
import { isNodeId } from '../src/atlas/index.js';
import { buildIndex, indexOptions } from '../src/indexer/build.js';
import { scoreSet } from '../src/verbs/score.js';

for (const repo of ['ark', 'hono']) {
  const { atlas } = await buildIndex(
    indexOptions(repo === 'ark' ? process.cwd() : join('/tmp/ark-corpus', repo)),
  );
  const graph = buildGraph(atlas);
  const blast = atlas.challenges.filter((c) => c.verb === 'blastRadius');
  let sum = 0, beat = 0, exact = 0;
  for (const board of blast) {
    const ref = graph.refById.get(board.subject);
    if (ref === undefined) continue;
    // Walk *backwards* along the drawn arrows: everything that reaches the subject.
    const seen = new Set<number>();
    const stack = [ref];
    while (stack.length > 0) {
      const at = stack.pop() as number;
      for (const edge of graph.in[at] ?? []) {
        if (seen.has(edge.from)) continue;
        seen.add(edge.from);
        stack.push(edge.from);
      }
    }
    const picked = board.candidates.filter(
      (id) => isNodeId(id) && seen.has(graph.refById.get(id) ?? -1),
    );
    const f1 = scoreSet(picked as never, board.truth.filter(isNodeId) as never).score;
    sum += f1;
    if (f1 >= 0.78) beat += 1;
    if (f1 >= 0.999) exact += 1;
  }
  console.log(
    `${repo}: ${blast.length} boards · mean F1 ${(sum / Math.max(1, blast.length)).toFixed(3)} · beat A ${beat} · exact ${exact}`,
  );
}
