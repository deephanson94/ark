/**
 * Throwaway probe: find a graph where the **ascending candidate scan** decides
 * the answer, so the rule can be pinned by a unit test.
 *
 * A tie alone is not enough. `links` is a `Map` filled by scanning the node's
 * neighbours in ascending *index* order, so its key order is "communities
 * ordered by this node's lowest neighbour in each" — while community *numbers*
 * are "communities ordered by their lowest member globally". Those two agree in
 * every symmetric fixture, which is why a mutant iterating unsorted survived
 * six other tests.
 *
 * They disagree when a community's lowest global member is small but its only
 * neighbour of *this* node is large. So: two equal cliques, the first one
 * carrying a deliberately high-numbered member, and the bridge attached to that
 * high member and to a low member of the second clique.
 *
 * `npx tsx scripts/probe-tie.ts`
 */

import { louvain } from '../src/indexer/louvain.js';

function grouping(labels: readonly number[]): string[] {
  const buckets = new Map<number, number[]>();
  for (const [node, label] of labels.entries()) {
    const bucket = buckets.get(label);
    if (bucket === undefined) buckets.set(label, [node]);
    else bucket.push(node);
  }
  return [...buckets.values()].map((m) => m.join(',')).sort();
}

/**
 * Clique A = {0,1,2,high}, clique B = {3,4,5,6}, bridge = high + 1 joined to
 * `high` (in A) and to 6 (in B). Scanning the bridge's neighbours ascending
 * reaches 6 — clique B — before `high`, so B is inserted into `links` first
 * while A holds the lower community number.
 */
function attempt(high: number): void {
  const a = [0, 1, 2, high];
  const b = [3, 4, 5, 6];
  const bridge = high + 1;
  const edges: { from: number; to: number }[] = [];
  for (const group of [a, b]) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        edges.push({ from: group[i] ?? 0, to: group[j] ?? 0 });
      }
    }
  }
  edges.push({ from: bridge, to: high });
  edges.push({ from: bridge, to: 6 });

  const labels = [...louvain(bridge + 1, edges, { resolution: 1, maxSweeps: 32, maxLevels: 16 }).labels];
  const withA = labels[bridge] === labels[0];
  const withB = labels[bridge] === labels[3];
  console.log(
    `high=${high} bridge=${bridge}: joins ${withA ? 'A (lower community id — the rule)' : withB ? 'B (insertion order — the mutant)' : 'neither'}` +
      `   grouping=${JSON.stringify(grouping(labels))}`,
  );
}

for (const high of [7, 8, 10, 12]) attempt(high);
