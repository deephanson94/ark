/**
 * **Can a failed board be honestly re-earned?**
 *
 * The owner's decision is that it should be. ADR-0047 decision 2 says the
 * opposite, and its reasoning is not a preference: `Grade.missed` is
 * `truth \ picked` and §8.1 requires an honest grade, so **any failing
 * submission names the whole key** — reveal or no reveal. Guardrail 6 then makes
 * retries free and unlimited. So *within one board* there is no state after a
 * failed answer in which the player does not know the answer, and a second pass
 * on the same key certifies nothing.
 *
 * The only honest re-earn is therefore a **different sample of the same
 * subject**: window 0 was named, so ask window 1. That is machinery this repo
 * already has — ADR-0012's `reWindow` re-asks a colliding subject with a
 * disjoint window of its own ranking — and knowing window 0 tells you nothing
 * about window 1.
 *
 * This measures the **ceiling**: for how many shipped boards does a disjoint
 * second window of the eligible population exist at all? A board whose key *is*
 * its whole population can never be re-earned, and no amount of design changes
 * that. Computed from the atlas, per verb, so each verb's population is the one
 * its own generator draws from.
 *
 *   npx tsx scripts/probe-retry.ts [repo ...]
 */
import { join } from 'node:path';

import { commitIdFor } from '../src/atlas/index.js';
import { buildIndex, indexOptions } from '../src/indexer/build.js';

const repos = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['ark', 'hono', 'kysely'];

for (const repo of repos) {
  const { atlas } = await buildIndex(
    indexOptions(repo === 'ark' ? process.cwd() : join('/tmp/ark-corpus', repo)),
  );
  const refById = new Map(atlas.nodes.map((n, ref) => [n.id, ref]));

  // Reverse import graph over **certain** edges only: guardrail 4 means an
  // uncertain edge may not be sampled, and the first draft of ADR-0012's own
  // comment overstated a cone 900-fold by forgetting that.
  const importers = new Map<number, number[]>();
  for (const edge of atlas.edges) {
    if (edge.confidence !== 'certain') continue;
    const at = importers.get(edge.to);
    if (at === undefined) importers.set(edge.to, [edge.from]);
    else at.push(edge.from);
  }
  const coneOf = (ref: number): number => {
    const seen = new Set<number>([ref]);
    const queue = [ref];
    while (queue.length > 0) {
      const at = queue.pop();
      if (at === undefined) continue;
      for (const from of importers.get(at) ?? []) {
        if (seen.has(from)) continue;
        seen.add(from);
        queue.push(from);
      }
    }
    return seen.size - 1;
  };

  // **Both of these are node *refs*, not ids and not paths.** The first draft of
  // this probe keyed them by `challenge.subject` and reported a flat **0% with a
  // median pool of 0.0x** for Companion and Archaeology — an instrument
  // measuring nothing, in the direction that says "this feature is impossible",
  // which is the one that gets believed.
  const partners = new Map<number, Set<number>>();
  for (const [a, b] of atlas.history.coChange) {
    if (!partners.has(a)) partners.set(a, new Set());
    if (!partners.has(b)) partners.set(b, new Set());
    partners.get(a)?.add(b);
    partners.get(b)?.add(a);
  }
  const touchers = new Map<number, number>();
  const filesBySha = new Map<string, number>();
  for (const commit of atlas.history.commits) {
    filesBySha.set(commitIdFor(commit.sha), commit.files.length);
    for (const ref of commit.files) touchers.set(ref, (touchers.get(ref) ?? 0) + 1);
  }

  const byVerb = new Map<string, { boards: number; retriable: number; pool: number[] }>();
  for (const board of atlas.challenges) {
    const size = board.truth.length;
    if (size === 0) continue;
    let pool = 0;
    if (board.verb === 'blastRadius') {
      const ref = refById.get(board.subject);
      pool = ref === undefined ? 0 : coneOf(ref);
    } else if (board.verb === 'companion') {
      const ref = refById.get(board.subject);
      pool = ref === undefined ? 0 : partners.get(ref)?.size ?? 0;
    } else if (board.verb === 'placement') {
      pool = filesBySha.get(board.subject) ?? 0;
    } else if (board.verb === 'archaeology') {
      const ref = refById.get(board.subject);
      pool = ref === undefined ? 0 : touchers.get(ref) ?? 0;
    }
    const at = byVerb.get(board.verb) ?? { boards: 0, retriable: 0, pool: [] };
    at.boards += 1;
    // A disjoint window of the same size needs twice the key, and only whole
    // windows are used — a short tail would silently shrink the answer key,
    // which is `reWindow`'s own rule.
    if (Math.floor(pool / size) >= 2) at.retriable += 1;
    at.pool.push(pool / size);
    byVerb.set(board.verb, at);
  }
  for (const [verb, at] of [...byVerb].sort()) {
    const median = [...at.pool].sort((a, b) => a - b)[Math.floor(at.pool.length / 2)] ?? 0;
    console.log(
      `${repo} ${verb.padEnd(12)}: ${at.boards} boards | a disjoint second window exists for ` +
        `${at.retriable} (${((at.retriable / at.boards) * 100).toFixed(0)}%)` +
        ` | median pool/key ${median.toFixed(1)}x`,
    );
  }
}
