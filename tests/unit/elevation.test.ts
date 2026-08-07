/**
 * Elevation — the third coordinate.
 *
 * The assertions that matter are the ones that would catch a *wrong landscape*:
 * a height that does not mean "how load-bearing", or one that moves when
 * something unrelated changes. A wrong height is not as bad as a wrong answer
 * key, but the map is the thing the player builds a memory of, and a memory of
 * a lie is worse than no memory.
 */

import { describe, expect, it } from 'vitest';

import { computeElevations, layerOf } from '../../src/indexer/elevation.js';
import { atlasWith } from '../fixtures/atlas.js';

/** `[importer, imported]`, the same direction `atlasWith` takes. */
function elevations(nodes: number, links: readonly (readonly [number, number])[]): number[] {
  const edges = links.map(([from, to]) => ({
    from,
    to,
    kind: 'import' as const,
    confidence: 'certain' as const,
    weight: 1,
  }));
  return [...computeElevations(nodes, edges).layers];
}

describe('layerOf', () => {
  it('is the bit length of the count', () => {
    expect([0, 1, 2, 3, 4, 7, 8, 15, 16, 255, 256].map(layerOf)).toEqual([
      0, 1, 2, 2, 3, 3, 4, 4, 5, 8, 9,
    ]);
  });

  it('means the same thing at every scale — one layer up is twice as depended-upon', () => {
    // The property that lets a layer number be compared across repos, which a
    // percentile could never do.
    for (const count of [1, 4, 17, 300, 2999]) {
      expect(layerOf(count * 2)).toBe(layerOf(count) + 1);
    }
  });

  it('never returns a negative or fractional layer', () => {
    expect(layerOf(-5)).toBe(0);
    expect(layerOf(2.7)).toBe(layerOf(2));
  });
});

describe('computeElevations', () => {
  it('puts a file nothing imports on the ground', () => {
    expect(elevations(3, [])).toEqual([0, 0, 0]);
  });

  it('counts dependents transitively, not just direct importers', () => {
    // 3 → 2 → 1 → 0. Node 0 is reached by three files, node 1 by two.
    // Direct in-degree is 1 for all of them; only the transitive count
    // separates them, and separating them is the entire point.
    expect(elevations(4, [[1, 0], [2, 1], [3, 2]])).toEqual([2, 2, 1, 0]);
  });

  it('does not double-count a file that reaches the subject two ways', () => {
    // A diamond: 3 reaches 0 through both 1 and 2. Cone is {1,2,3} = 3, not 4.
    const layers = elevations(4, [[1, 0], [2, 0], [3, 1], [3, 2]]);
    expect(layers[0]).toBe(layerOf(3));
  });

  it('terminates on a cycle, and gives every member of it the same height', () => {
    // A cycle is one unit — every member has the identical dependent set, so a
    // ring of files renders as a plateau. That is true, and it is a shape worth
    // being able to see.
    const layers = elevations(4, [[0, 1], [1, 2], [2, 0], [3, 0]]);
    expect(layers[0]).toBe(layers[1]);
    expect(layers[1]).toBe(layers[2]);
    expect(layers[0]).toBeGreaterThan(0);
  });

  it('depends on the node itself, not on the rest of the repo', () => {
    // Why bit length and not a rank. Adding an unrelated island must not move
    // an existing file's height: the save is keyed to the repo (ADR-0011), so a
    // landscape that restacks on every commit is a memory the player loses.
    const base = elevations(4, [[1, 0], [2, 1], [3, 2]]);
    const widened = elevations(9, [
      [1, 0],
      [2, 1],
      [3, 2],
      // A separate, much larger component that would dominate any percentile.
      [5, 4],
      [6, 4],
      [7, 4],
      [8, 4],
    ]);
    expect(widened.slice(0, 4)).toEqual(base);
  });

  it('counts every edge kind, including the uncertain ones', () => {
    // Guardrail 4 governs what may be *asked*, not what may be *drawn*. A
    // silhouette that dropped `type` and `probable` edges would misdraw the
    // terrain in exactly the districts the player most needs to distrust.
    const edges = [
      { from: 1, to: 0, kind: 'type' as const, confidence: 'probable' as const, weight: 1 },
    ];
    expect([...computeElevations(2, edges).layers]).toEqual([1, 0]);
  });
});

describe('elevation on a real fixture', () => {
  it('makes the barrel the peak, and the file that imports nothing the ground', () => {
    const atlas = atlasWith(
      ['src/barrel.ts', 'src/leaf.ts', 'src/a.ts', 'src/b.ts', 'src/c.ts'],
      [
        ['src/barrel.ts', 'src/leaf.ts'],
        ['src/a.ts', 'src/barrel.ts'],
        ['src/b.ts', 'src/barrel.ts'],
        ['src/c.ts', 'src/barrel.ts'],
      ],
    );
    const at = (path: string): number =>
      atlas.nodes.find((node) => node.path === path)?.elevation ?? -1;
    // `leaf` is reached by barrel + a + b + c = 4 files; barrel by 3.
    expect(at('src/leaf.ts')).toBe(layerOf(4));
    expect(at('src/barrel.ts')).toBe(layerOf(3));
    expect(at('src/a.ts')).toBe(0);
    // And the ordering is the thing a player would read off the map.
    expect(at('src/leaf.ts')).toBeGreaterThan(at('src/a.ts'));
  });
});
