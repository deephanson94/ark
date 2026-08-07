import { describe, expect, it } from 'vitest';

import { round2 } from '../../src/atlas/index.js';
import { DEFAULT_LAYOUT_OPTIONS, computeLayout } from '../../src/indexer/layout.js';
import type { LayoutEdge } from '../../src/indexer/layout.js';

function distance(a: readonly [number, number], b: readonly [number, number]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
}

const CHAIN: LayoutEdge[] = [
  { from: 0, to: 1, weight: 1 },
  { from: 1, to: 2, weight: 1 },
];

describe('computeLayout', () => {
  it('is identical across runs — spatial memory depends on it', () => {
    const first = computeLayout(40, CHAIN);
    const second = computeLayout(40, CHAIN);
    expect(second).toEqual(first);
  });

  it('is identical across runs at a size where the grid has many cells', () => {
    const edges: LayoutEdge[] = [];
    for (let i = 1; i < 200; i++) edges.push({ from: i, to: i % 7, weight: 1 });
    expect(computeLayout(200, edges)).toEqual(computeLayout(200, edges));
  });

  it('produces finite coordinates that serialise to at most two decimals', () => {
    // `x * 100` is not an exact integer even for a rounded value — -153.64 * 100
    // is -15363.999999999998. What has to hold is the property the atlas
    // actually depends on: the serialised form is short and stable.
    const shortDecimal = /^-?\d+(\.\d{1,2})?$/;
    for (const [x, y] of computeLayout(30, CHAIN)) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
      expect(String(x)).toMatch(shortDecimal);
      expect(String(y)).toMatch(shortDecimal);
      expect(round2(x)).toBe(x);
      expect(round2(y)).toBe(y);
    }
  });

  it('places connected nodes closer together than unconnected ones', () => {
    // Two triangles with no edge between them.
    const edges: LayoutEdge[] = [
      { from: 0, to: 1, weight: 1 },
      { from: 1, to: 2, weight: 1 },
      { from: 2, to: 0, weight: 1 },
      { from: 3, to: 4, weight: 1 },
      { from: 4, to: 5, weight: 1 },
      { from: 5, to: 3, weight: 1 },
    ];
    const positions = computeLayout(6, edges);
    const inside = distance(positions[0] ?? [0, 0], positions[1] ?? [0, 0]);
    const across = distance(positions[0] ?? [0, 0], positions[3] ?? [0, 0]);
    expect(inside).toBeLessThan(across);
  });

  it('separates nodes rather than collapsing them onto each other', () => {
    const positions = computeLayout(25, []);
    const unique = new Set(positions.map(([x, y]) => `${x},${y}`));
    expect(unique.size).toBe(25);
  });

  it('handles the degenerate sizes', () => {
    expect(computeLayout(0, [])).toEqual([]);
    expect(computeLayout(1, [])).toEqual([[0, 0]]);
  });

  it('ignores edges that point outside the node range', () => {
    expect(() => computeLayout(3, [{ from: 0, to: 99, weight: 1 }])).not.toThrow();
  });

  it('changes when the graph changes — the map is a function of the topology', () => {
    const withoutEdges = computeLayout(20, []);
    const withEdges = computeLayout(20, CHAIN);
    expect(withEdges).not.toEqual(withoutEdges);
  });

  it('uses only exactly-specified float operations, so it is portable', () => {
    // A canary rather than a proof: if someone reaches for Math.sin or Math.pow
    // the layout stops being bit-identical across engines, and the failure is
    // invisible until a colleague reports a different map.
    const source = computeLayout.toString();
    for (const forbidden of ['Math.sin', 'Math.cos', 'Math.pow', 'Math.exp', 'Math.log', 'Math.random']) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('respects a lower iteration count without breaking', () => {
    const quick = computeLayout(20, CHAIN, { ...DEFAULT_LAYOUT_OPTIONS, iterations: 5 });
    expect(quick).toHaveLength(20);
    expect(quick).toEqual(computeLayout(20, CHAIN, { ...DEFAULT_LAYOUT_OPTIONS, iterations: 5 }));
  });
});
