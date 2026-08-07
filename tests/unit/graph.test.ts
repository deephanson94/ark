import { describe, expect, it } from 'vitest';

import type { Atlas, AtlasEdge, AtlasNode } from '../../src/atlas/index.js';
import { buildGraph, dependencies, dependents, isChallengeable, refOf } from '../../src/atlas/index.js';
import { atlasWith } from '../fixtures/atlas.js';

/**
 *   d.ts ──▶ c.ts ──▶ b.ts ──▶ a.ts        (arrows point at what is imported)
 *                        island.ts
 */
function chain(overrides: { unresolvedIn?: string[]; probableFrom?: string } = {}): Atlas {
  const paths = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'island.ts'];
  const links: readonly (readonly [string, string])[] = [
    ['b.ts', 'a.ts'],
    ['c.ts', 'b.ts'],
    ['d.ts', 'c.ts'],
  ];
  return atlasWith(paths, links, (node: AtlasNode): AtlasNode =>
    (overrides.unresolvedIn ?? []).includes(node.path)
      ? { ...node, unresolved: ['mystery-lib'] }
      : node,
  (edge: AtlasEdge, fromPath: string): AtlasEdge =>
    overrides.probableFrom === fromPath ? { ...edge, confidence: 'probable' } : edge);
}

describe('reachability', () => {
  const graph = buildGraph(chain());
  const at = (path: string): number => graph.refByPath.get(path) ?? -1;
  const paths = (refs: Iterable<number>): string[] =>
    [...refs].map((ref) => graph.atlas.nodes[ref]?.path ?? '?').sort();

  it('finds transitive dependents, which is the blast radius', () => {
    expect(paths(dependents(graph, at('a.ts'), 3).keys())).toEqual(['b.ts', 'c.ts', 'd.ts']);
  });

  it('respects the depth bound', () => {
    expect(paths(dependents(graph, at('a.ts'), 1).keys())).toEqual(['b.ts']);
    expect(paths(dependents(graph, at('a.ts'), 2).keys())).toEqual(['b.ts', 'c.ts']);
  });

  it('records the distance each node was reached at', () => {
    const found = dependents(graph, at('a.ts'), 3);
    expect(found.get(at('b.ts'))).toBe(1);
    expect(found.get(at('c.ts'))).toBe(2);
    expect(found.get(at('d.ts'))).toBe(3);
  });

  it('walks the other way for dependencies', () => {
    expect(paths(dependencies(graph, at('d.ts'), 3).keys())).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('does not include the subject in its own reach', () => {
    expect(dependents(graph, at('a.ts'), 5).has(at('a.ts'))).toBe(false);
  });

  it('finds nothing from an unconnected node', () => {
    expect(dependents(graph, at('island.ts'), 5).size).toBe(0);
  });

  it('terminates on a cycle', () => {
    const cyclic = atlasWith(
      ['x.ts', 'y.ts'],
      [
        ['x.ts', 'y.ts'],
        ['y.ts', 'x.ts'],
      ],
    );
    const cyclicGraph = buildGraph(cyclic);
    const start = cyclicGraph.refByPath.get('x.ts') ?? 0;
    expect(dependents(cyclicGraph, start, 10).size).toBe(1);
  });

  it('throws rather than guessing when asked for an unknown id', () => {
    expect(() => refOf(graph, 'n:000000000000')).toThrow(/no node with id/);
  });
});

describe('isChallengeable — guardrail 4', () => {
  const candidatesOf = (atlas: Atlas, paths: readonly string[]): number[] => {
    const graph = buildGraph(atlas);
    return paths.map((path) => graph.refByPath.get(path) ?? -1);
  };

  it('accepts a subject whose whole neighbourhood is fully resolved', () => {
    const atlas = chain();
    const graph = buildGraph(atlas);
    const verdict = isChallengeable(
      graph,
      graph.refByPath.get('a.ts') ?? 0,
      candidatesOf(atlas, ['b.ts', 'c.ts', 'd.ts', 'island.ts']),
      3,
    );
    expect(verdict.ok).toBe(true);
  });

  it('refuses when a candidate has an import we could not resolve', () => {
    // island.ts might really import a.ts through that unresolved specifier, so
    // calling it a distractor would be a guess dressed up as an answer key.
    const atlas = chain({ unresolvedIn: ['island.ts'] });
    const graph = buildGraph(atlas);
    const verdict = isChallengeable(
      graph,
      graph.refByPath.get('a.ts') ?? 0,
      candidatesOf(atlas, ['b.ts', 'island.ts']),
      3,
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain('island.ts');
  });

  it('refuses when the uncertainty is upstream of a candidate, not in it', () => {
    // d.ts is clean, but it reaches a.ts through c.ts. If c.ts has an import we
    // could not resolve, d.ts's verdict is not ours to give.
    const atlas = chain({ unresolvedIn: ['c.ts'] });
    const graph = buildGraph(atlas);
    const verdict = isChallengeable(graph, graph.refByPath.get('a.ts') ?? 0, candidatesOf(atlas, ['d.ts']), 3);
    expect(verdict.ok).toBe(false);
  });

  it('stops caring about uncertainty beyond the depth bound', () => {
    const atlas = chain({ unresolvedIn: ['a.ts'] });
    const graph = buildGraph(atlas);
    const verdict = isChallengeable(graph, graph.refByPath.get('d.ts') ?? 0, candidatesOf(atlas, ['c.ts']), 1);
    expect(verdict.ok).toBe(true);
  });

  it('refuses when an edge in range was only a probable resolution', () => {
    const atlas = chain({ probableFrom: 'c.ts' });
    const graph = buildGraph(atlas);
    const verdict = isChallengeable(graph, graph.refByPath.get('a.ts') ?? 0, candidatesOf(atlas, ['d.ts']), 3);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain('ambiguous');
  });
});
