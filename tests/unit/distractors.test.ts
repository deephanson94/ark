/**
 * The distractor subsystem (NORTH-STAR §8.3).
 *
 * Two of the four strategies are nearly dry on this repo — `nameSimilar` finds
 * 2 wrong answers across 35 challenges and `coChange` finds none, because files
 * with confusable names here usually *do* import each other and are therefore
 * banned from the choice set. That is a true fact about a small, disciplined
 * codebase and not a reason to leave the strategies untested, so each one is
 * exercised here against a fixture built to give it supply.
 */

import { describe, expect, it } from 'vitest';

import type { Atlas, NodeRef } from '../../src/atlas/index.js';
import { buildGraph, dependents, nodeAt } from '../../src/atlas/index.js';
import {
  TARGET_MIX,
  analyse,
  mixOf,
  nameSimilarity,
  nameTokens,
  quotas,
  selectDistractors,
  undirectedDistances,
} from '../../src/verbs/blastRadius/index.js';
import { atlasWith } from '../fixtures/atlas.js';

function refOfPath(atlas: Atlas, path: string): NodeRef {
  const ref = atlas.nodes.findIndex((node) => node.path === path);
  if (ref < 0) throw new Error(`fixture has no ${path}`);
  return ref;
}

/** Everything eligible: not the subject, not a dependent at any depth. */
function poolFor(atlas: Atlas, subjectPath: string): Set<NodeRef> {
  const graph = buildGraph(atlas);
  const subject = refOfPath(atlas, subjectPath);
  const reached = dependents(graph, subject, Number.POSITIVE_INFINITY);
  const pool = new Set<NodeRef>();
  for (const ref of atlas.nodes.keys()) {
    if (ref !== subject && !reached.has(ref)) pool.add(ref);
  }
  return pool;
}

function contextFor(
  atlas: Atlas,
  subjectPath: string,
  coChange: ReadonlyMap<NodeRef, number> = new Map(),
  /** The answer key, for `keySibling`. Empty unless a test is about that. */
  truth: readonly NodeRef[] = [],
): {
  graph: ReturnType<typeof buildGraph>;
  corpus: ReturnType<typeof analyse>;
  subject: NodeRef;
  pool: Set<NodeRef>;
  coChange: ReadonlyMap<NodeRef, number>;
  truth: readonly NodeRef[];
} {
  const graph = buildGraph(atlas);
  return {
    graph,
    corpus: analyse(graph),
    subject: refOfPath(atlas, subjectPath),
    pool: poolFor(atlas, subjectPath),
    truth,
    coChange,
  };
}

function pathsOf(atlas: Atlas, refs: readonly NodeRef[]): string[] {
  const graph = buildGraph(atlas);
  return refs.map((ref) => nodeAt(graph, ref).path);
}

describe('nameTokens', () => {
  it('drops the extension so every .ts file does not match every other', () => {
    expect(nameTokens('src/a/parse-config.util.ts')).toEqual(['parse', 'config', 'util']);
    expect(nameTokens('src/a/index.ts')).toEqual(['index']);
  });

  it('splits camelCase, because half of a repo names files that way', () => {
    expect(nameTokens('src/blastRadius.ts')).toEqual(['blast', 'radius']);
  });

  it('keeps a dotted middle segment as its own token', () => {
    expect(nameTokens('tests/unit/scene.test.ts')).toEqual(['scene', 'test']);
  });
});

describe('nameSimilarity', () => {
  it('scores the same basename in another directory highest', () => {
    expect(nameSimilarity('src/atlas/index.ts', 'src/verbs/index.ts')).toBe(1);
  });

  it('scores a shared stem above an unrelated name', () => {
    const related = nameSimilarity('src/config/parse.ts', 'src/util/parse-config.util.ts');
    const unrelated = nameSimilarity('src/config/parse.ts', 'src/player/camera.ts');
    expect(related).toBeGreaterThan(0);
    expect(unrelated).toBe(0);
    expect(related).toBeGreaterThan(unrelated);
  });

  it('does not treat the extension as a shared token', () => {
    expect(nameSimilarity('a/one.ts', 'b/two.ts')).toBe(0);
  });
});

describe('undirectedDistances', () => {
  it('finds the cousins no directed query reaches', () => {
    // subject and cousin both import shared.ts. Neither imports the other, and
    // neither is reachable from the other in either direction.
    const atlas = atlasWith(
      ['a/subject.ts', 'a/cousin.ts', 'a/shared.ts', 'a/far.ts'],
      [
        ['a/subject.ts', 'a/shared.ts'],
        ['a/cousin.ts', 'a/shared.ts'],
      ],
    );
    const graph = buildGraph(atlas);
    const subject = refOfPath(atlas, 'a/subject.ts');
    expect(dependents(graph, subject, Number.POSITIVE_INFINITY).size).toBe(0);

    const hops = undirectedDistances(graph, subject, 2);
    const byPath = new Map(pathsOf(atlas, [...hops.keys()]).map((p, i) => [p, [...hops.values()][i]]));
    expect(byPath.get('a/shared.ts')).toBe(1);
    expect(byPath.get('a/cousin.ts')).toBe(2);
    expect(byPath.has('a/far.ts')).toBe(false);
  });
});

describe('quotas', () => {
  it('splits by the §8.3 ratio and never loses or invents a slot', () => {
    for (let count = 0; count <= 40; count++) {
      const split = quotas(count);
      let total = 0;
      for (const value of split.values()) {
        expect(value).toBeGreaterThanOrEqual(0);
        total += value;
      }
      expect(total, `count ${count}`).toBe(count);
    }
  });

  it('gives graph-adjacency the largest share at the default choice-set size', () => {
    const split = quotas(14);
    const adjacent = split.get('graphAdjacent') ?? 0;
    for (const [id, share] of TARGET_MIX) {
      if (id === 'graphAdjacent') continue;
      expect(adjacent).toBeGreaterThan(split.get(id) ?? 0);
      expect(share).toBeLessThan(0.4);
    }
  });
});

describe('the four strategies', () => {
  it('ranks what the subject imports above merely-nearby files', () => {
    // ADR-0008 §4: confusing "imports" with "is imported by" is the tier-2
    // mistake worth teaching, so the subject's own dependencies are the
    // flagship structural distractor and must outrank the undirected cousins.
    //
    // The ordering is the assertion, not the membership — an earlier version
    // asserted only that `dep.ts` came out and could not fail, because the
    // undirected sweep finds a direct dependency too. `deep.ts` is two hops
    // *out* and `cousin.ts` is two hops away ignoring direction with a higher
    // in-degree, so they tie on everything except the dependency tier.
    //
    // Nothing shares a directory or a name token with the subject, which keeps
    // the other three strategies dry so this reads `graphAdjacent`'s own order.
    const atlas = atlasWith(
      ['s/subject.ts', 'm/mid.ts', 'd/deep.ts', 'c/cousin.ts', 'x/one.ts', 'x/two.ts'],
      [
        ['s/subject.ts', 'm/mid.ts'],
        ['m/mid.ts', 'd/deep.ts'],
        ['c/cousin.ts', 'm/mid.ts'],
        ['x/one.ts', 'c/cousin.ts'],
        ['x/two.ts', 'c/cousin.ts'],
      ],
    );
    const chosen = selectDistractors(contextFor(atlas, 's/subject.ts'), 3);
    expect(pathsOf(atlas, chosen.map((c) => c.ref))).toEqual([
      'm/mid.ts',
      'd/deep.ts',
      'c/cousin.ts',
    ]);
    for (const choice of chosen) expect(choice.strategy).toBe('graphAdjacent');
  });

  it('offers directory siblings that are not dependents', () => {
    const atlas = atlasWith([
      'src/core/subject.ts',
      'src/core/neighbour.ts',
      'far/away.ts',
      'far/other.ts',
    ]);
    const chosen = selectDistractors(contextFor(atlas, 'src/core/subject.ts'), 4);
    const sibling = chosen.find((c) => c.strategy === 'treeSibling');
    expect(sibling).toBeDefined();
    expect(pathsOf(atlas, [sibling?.ref ?? 0])).toEqual(['src/core/neighbour.ts']);
  });

  it('offers the same basename from another directory', () => {
    const atlas = atlasWith([
      'src/atlas/index.ts',
      'src/verbs/index.ts',
      'src/atlas/other.ts',
      'src/atlas/more.ts',
      'src/atlas/extra.ts',
    ]);
    const chosen = selectDistractors(contextFor(atlas, 'src/atlas/index.ts'), 4);
    const named = chosen.find((c) => c.strategy === 'nameSimilar');
    expect(named).toBeDefined();
    expect(pathsOf(atlas, [named?.ref ?? 0])).toEqual(['src/verbs/index.ts']);
  });

  it('offers files that co-change with the subject but never import it', () => {
    // §8.3 calls these the best distractors: getting one wrong is the lesson.
    const atlas = atlasWith([
      'src/a/subject.ts',
      'docs/companion.ts',
      'src/a/quiet.ts',
      'src/a/quieter.ts',
    ]);
    const companion = refOfPath(atlas, 'docs/companion.ts');
    const chosen = selectDistractors(
      contextFor(atlas, 'src/a/subject.ts', new Map([[companion, 17]])),
      4,
    );
    const historical = chosen.find((c) => c.strategy === 'coChange');
    expect(historical?.ref).toBe(companion);
  });

  it('never offers a node outside the pool', () => {
    // The pool has already had every dependent removed. This is the assertion
    // that a wrong answer can never secretly be a right one.
    const atlas = atlasWith(
      [
        'src/a/subject.ts',
        'src/a/one.ts',
        'src/a/two.ts',
        'src/b/three.ts',
        'src/b/four.ts',
        'src/b/five.ts',
      ],
      [
        ['src/a/one.ts', 'src/a/subject.ts'],
        ['src/b/three.ts', 'src/a/one.ts'],
      ],
    );
    const context = contextFor(atlas, 'src/a/subject.ts');
    const chosen = selectDistractors(context, 20);
    expect(chosen.length).toBe(context.pool.size);
    for (const choice of chosen) expect(context.pool.has(choice.ref)).toBe(true);
    const offered = pathsOf(atlas, chosen.map((c) => c.ref));
    expect(offered).not.toContain('src/a/one.ts');
    expect(offered).not.toContain('src/b/three.ts');
  });

  it('hands unspent quota back rather than losing it', () => {
    // No history and no name matches here, so `coChange` and `nameSimilar` are
    // dry. The choice set must still fill from the strategies that have supply.
    const paths = ['src/a/subject.ts', ...Array.from({ length: 12 }, (_, i) => `src/a/f${i}.ts`)];
    const chosen = selectDistractors(contextFor(atlas12(paths), 'src/a/subject.ts'), 10);
    expect(chosen).toHaveLength(10);
    const mix = mixOf(chosen);
    expect(mix.get('coChange')).toBe(0);
    expect((mix.get('graphAdjacent') ?? 0) + (mix.get('treeSibling') ?? 0)).toBe(10);
  });

  it('labels padding as padding instead of hiding it', () => {
    // Nothing shares a directory, a name or an edge with the subject, so every
    // wrong answer is a fallback — and `mixOf` says so out loud.
    const atlas = atlasWith([
      'a/subject.ts',
      'b/alpha.ts',
      'c/beta.ts',
      'd/gamma.ts',
      'e/delta.ts',
    ]);
    const chosen = selectDistractors(contextFor(atlas, 'a/subject.ts'), 4);
    expect(mixOf(chosen).get('distant')).toBe(4);
  });

  it('is a pure function of its input', () => {
    const atlas = atlasWith(
      ['src/a/subject.ts', 'src/a/one.ts', 'src/a/two.ts', 'src/b/three.ts', 'src/b/four.ts'],
      [['src/a/subject.ts', 'src/a/one.ts']],
    );
    const first = selectDistractors(contextFor(atlas, 'src/a/subject.ts'), 3);
    const second = selectDistractors(contextFor(atlas, 'src/a/subject.ts'), 3);
    expect(second).toEqual(first);
  });
});

function atlas12(paths: readonly string[]): Atlas {
  return atlasWith(paths);
}
