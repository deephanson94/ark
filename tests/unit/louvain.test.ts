import { describe, expect, it } from 'vitest';

import { louvain, modularityOf, splitDisconnected } from '../../src/indexer/louvain.js';

const OPTIONS = { resolution: 1, maxSweeps: 32, maxLevels: 16 };

/** An all-pairs clique over `[offset, offset + n)`. */
function clique(offset: number, n: number): { from: number; to: number }[] {
  const edges: { from: number; to: number }[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) edges.push({ from: offset + i, to: offset + j });
  }
  return edges;
}

/** Node → community, as a set-of-sets, so labels themselves do not matter. */
function grouping(labels: readonly number[]): string[] {
  const buckets = new Map<number, number[]>();
  for (const [node, label] of labels.entries()) {
    const bucket = buckets.get(label);
    if (bucket === undefined) buckets.set(label, [node]);
    else bucket.push(node);
  }
  return [...buckets.values()].map((members) => members.join(',')).sort();
}

describe('louvain', () => {
  it('separates two cliques joined by a single edge', () => {
    const edges = [...clique(0, 5), ...clique(5, 5), { from: 0, to: 5 }];
    expect(grouping([...louvain(10, edges, OPTIONS).labels])).toEqual(['0,1,2,3,4', '5,6,7,8,9']);
  });

  it('is unchanged by the order the edges arrive in', () => {
    // The indexer feeds edges in walk order, which is a filesystem property.
    // Nothing about the partition may depend on it — this is the determinism
    // claim that `test:determinism` cannot see, because it runs one input twice.
    const edges = [...clique(0, 5), ...clique(5, 5), { from: 0, to: 5 }];
    const shuffled = [...edges].reverse();
    expect(grouping([...louvain(10, shuffled, OPTIONS).labels])).toEqual(
      grouping([...louvain(10, edges, OPTIONS).labels]),
    );
  });

  it('gives byte-identical labels on repeated runs', () => {
    const edges = [...clique(0, 6), ...clique(6, 6), ...clique(12, 6), { from: 0, to: 6 }, { from: 6, to: 12 }];
    const first = [...louvain(18, edges, OPTIONS).labels];
    expect([...louvain(18, edges, OPTIONS).labels]).toEqual(first);
  });

  it('puts every node somewhere, and labels densely from zero', () => {
    const edges = [...clique(0, 4), ...clique(4, 4), { from: 0, to: 4 }];
    const labels = [...louvain(8, edges, OPTIONS).labels];
    expect(labels).toHaveLength(8);
    const distinct = [...new Set(labels)].sort((a, b) => a - b);
    expect(distinct).toEqual(distinct.map((_, i) => i));
  });

  it('returns one community per node when there are no edges', () => {
    // Not a real input — `regions.ts` runs this over the linked subgraph only —
    // but a partition of an empty graph must still be a partition.
    const result = louvain(3, [], OPTIONS);
    expect(result.labels).toHaveLength(3);
    expect(new Set(result.labels).size).toBe(1);
  });

  it('handles the degenerate sizes without throwing', () => {
    expect(louvain(0, [], OPTIONS).labels).toEqual([]);
    expect(louvain(1, [], OPTIONS).labels).toEqual([0]);
  });

  it('breaks a genuine tie towards the lower community id', () => {
    // **The determinism rule that decides real partitions**, and the one three
    // documents asserted while no test executed it: two mutants — iterating
    // candidates unsorted, and `>=` for `>` — survived the first draft of this
    // file because every fixture in it was too symmetric for the rule to get a
    // choice.
    //
    // Two identical cliques and a bridge attached to exactly one node of each.
    // The modularity gain of joining either is equal by construction, so
    // nothing but the ascending scan and the strict `>` decides, and the answer
    // must be the clique holding the lower-numbered nodes.
    for (const size of [4, 5, 6]) {
      const edges: { from: number; to: number }[] = [];
      for (let i = 0; i < size; i++) {
        for (let j = i + 1; j < size; j++) {
          edges.push({ from: i, to: j });
          edges.push({ from: size + i, to: size + j });
        }
      }
      const bridge = 2 * size;
      edges.push({ from: bridge, to: 0 });
      edges.push({ from: bridge, to: size });
      const labels = [...louvain(2 * size + 1, edges, OPTIONS).labels];
      expect(labels[bridge], `bridge at clique size ${size}`).toBe(labels[0]);
      expect(labels[bridge]).not.toBe(labels[size]);
    }
  });

  it('scans candidate communities in ascending id, not in the order it met them', () => {
    // **A tie alone does not pin this**, which is why a mutant iterating
    // `links.keys()` unsorted survived every other test in this file including
    // the one above. `links` is a Map filled by scanning neighbours in ascending
    // *index* order, so its key order is "communities ordered by this node's
    // lowest neighbour in each" — while community *numbers* order them by their
    // lowest member globally. Symmetric fixtures make those agree.
    //
    // Here they disagree by construction: clique A is {0,1,2,7} and clique B is
    // {3,4,5,6}, so A holds the lower community id — but the bridge's ascending
    // neighbour scan meets 6 (in B) before 7 (in A), so B is inserted first.
    // The cliques are the same size, so the gain is tied and only the scan
    // order decides. Sorted picks A; insertion order picks B.
    const a = [0, 1, 2, 7];
    const b = [3, 4, 5, 6];
    const bridge = 8;
    const edges: { from: number; to: number }[] = [];
    for (const group of [a, b]) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          edges.push({ from: group[i] ?? 0, to: group[j] ?? 0 });
        }
      }
    }
    edges.push({ from: bridge, to: 7 });
    edges.push({ from: bridge, to: 6 });
    expect(grouping([...louvain(9, edges, OPTIONS).labels])).toEqual(['0,1,2,7,8', '3,4,5,6']);
  });

  it('raises modularity above the everything-in-one-community baseline', () => {
    const edges = [...clique(0, 5), ...clique(5, 5), { from: 0, to: 5 }];
    const found = modularityOf([...louvain(10, edges, OPTIONS).labels], 10, edges, 1);
    const lumped = modularityOf(new Array<number>(10).fill(0), 10, edges, 1);
    expect(found).toBeGreaterThan(lumped);
    // One community always scores exactly 0: internal/m2 = 1 and (total/m2)² = 1.
    expect(lumped).toBeCloseTo(0, 10);
  });
});

describe('splitDisconnected', () => {
  /**
   * Leiden's guarantee is the module's headline claim and **nothing executed
   * this function** until this block: a review replaced its body with
   * `return { labels, splits: 0 }` and all 858 unit and 112 atlas tests passed.
   * It also fires 0 times on all eight reference repos, so the real deck cannot
   * stand in for a test either. An unverified prover proves nothing.
   */
  const adjacency = (pairs: readonly (readonly [number, number])[], count: number) => {
    const lists: [number, number][][] = Array.from({ length: count }, () => []);
    for (const [a, b] of pairs) {
      lists[a]?.push([b, 1]);
      lists[b]?.push([a, 1]);
    }
    for (const list of lists) list.sort((x, y) => x[0] - y[0]);
    return lists;
  };

  it('splits a community whose members are not connected to each other', () => {
    // 0–1 and 2–3 share a label but no path. That is exactly the Louvain defect
    // Leiden's refinement exists to prevent.
    const labels = [0, 0, 0, 0];
    const result = splitDisconnected(labels, adjacency([[0, 1], [2, 3]], 4));
    expect(result.splits).toBe(1);
    expect(grouping(result.labels)).toEqual(['0,1', '2,3']);
  });

  it('leaves a connected community alone and reports no split', () => {
    const result = splitDisconnected([0, 0, 0], adjacency([[0, 1], [1, 2]], 3));
    expect(result.splits).toBe(0);
    expect(grouping(result.labels)).toEqual(['0,1,2']);
  });

  it('splits a community into three when it has three components', () => {
    const result = splitDisconnected([0, 0, 0, 0, 0, 0], adjacency([[0, 1], [2, 3], [4, 5]], 6));
    expect(result.splits).toBe(2);
    expect(grouping(result.labels)).toEqual(['0,1', '2,3', '4,5']);
  });

  it('keeps the label on the component holding the lowest node index', () => {
    // Ascending `start` is what makes the choice reproducible rather than
    // whichever component the walk happened to reach first.
    const result = splitDisconnected([7, 7, 7, 7], adjacency([[0, 1], [2, 3]], 4));
    expect(result.labels[0]).toBe(result.labels[1]);
    expect(result.labels[2]).toBe(result.labels[3]);
    expect(result.labels[0]).toBeLessThan(result.labels[2] ?? 0);
  });

  it('does not merge two communities that are adjacent', () => {
    // The walk must refuse to cross a label boundary, or it would dissolve the
    // partition it is supposed to be repairing.
    const result = splitDisconnected([0, 0, 1, 1], adjacency([[0, 1], [1, 2], [2, 3]], 4));
    expect(result.splits).toBe(0);
    expect(grouping(result.labels)).toEqual(['0,1', '2,3']);
  });

  it('splits a label whose members straddle another community', () => {
    // **The case that pins the boundary check.** The test above cannot: with
    // labels [0,0,1,1] a walk that ignores the boundary still relabels nothing,
    // because the first component claims its label and no second one is left —
    // so a mutant deleting the check survives it.
    //
    // Here label 0 holds {0, 1, 3} and node 3 reaches the rest only *through*
    // node 2, which is label 1. Two components, so it must split. Crossing the
    // boundary swallows 2 and 3 into one component and splits nothing.
    const result = splitDisconnected([0, 0, 1, 0], adjacency([[0, 1], [1, 2], [2, 3]], 4));
    expect(result.splits).toBe(1);
    expect(grouping(result.labels)).toEqual(['0,1', '2', '3']);
  });
});
