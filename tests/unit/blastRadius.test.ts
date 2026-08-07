/**
 * Blast Radius generation.
 *
 * The assertions that matter here are the ones that would catch a **wrong
 * answer key**, because a wrong answer key destroys trust permanently while a
 * missing challenge costs nothing (guardrail 4). So the invariant is checked
 * against a graph query recomputed from the atlas rather than against anything
 * the generator returns about itself, and the guardrail cases are checked by
 * building an atlas that should *not* produce a challenge and asserting it
 * does not.
 */

import { describe, expect, it } from 'vitest';

import type { Atlas, Challenge, NodeId } from '../../src/atlas/index.js';
import { buildGraph, dependents, nodeAt, refOf, validateAtlas } from '../../src/atlas/index.js';
import {
  difficultyOf,
  generateBlastRadius,
  generateWithReport,
  sampleByDistance,
  surpriseOf,
  truthCap,
} from '../../src/verbs/blastRadius/index.js';
import { DEFAULT_GENERATE_OPTIONS, isGameable, blastRadius } from '../../src/verbs/index.js';
import { atlasWith } from '../fixtures/atlas.js';

/** A chain `f0 → f1 → … → fN` plus `spare` unattached files to pad choice sets. */
function chain(length: number, spare: number): Atlas {
  const paths = [
    ...Array.from({ length }, (_, i) => `src/chain/f${String(i).padStart(2, '0')}.ts`),
    ...Array.from({ length: spare }, (_, i) => `src/spare/s${String(i).padStart(2, '0')}.ts`),
  ];
  const links: [string, string][] = [];
  for (let i = 0; i + 1 < length; i++) {
    links.push([`src/chain/f${String(i + 1).padStart(2, '0')}.ts`, `src/chain/f${String(i).padStart(2, '0')}.ts`]);
  }
  return atlasWith(paths, links);
}

/** A hub imported by `fanOut` files, each of which is imported by one more. */
function hub(fanOut: number, spare: number): Atlas {
  const paths = ['src/hub.ts'];
  const links: [string, string][] = [];
  for (let i = 0; i < fanOut; i++) {
    const near = `src/near/n${String(i).padStart(2, '0')}.ts`;
    const far = `src/far/f${String(i).padStart(2, '0')}.ts`;
    paths.push(near, far);
    links.push([near, 'src/hub.ts'], [far, near]);
  }
  for (let i = 0; i < spare; i++) paths.push(`src/spare/s${String(i).padStart(2, '0')}.ts`);
  return atlasWith(paths, links);
}

function pathOf(atlas: Atlas, id: NodeId): string {
  const graph = buildGraph(atlas);
  return nodeAt(graph, refOf(graph, id)).path;
}

/** Recomputed from the atlas, deliberately not from anything the generator said. */
function trueDependentIds(atlas: Atlas, subject: NodeId): Set<NodeId> {
  const graph = buildGraph(atlas);
  const reached = dependents(graph, refOf(graph, subject), Number.POSITIVE_INFINITY);
  return new Set([...reached.keys()].map((ref) => nodeAt(graph, ref).id));
}

describe('the generator invariant', () => {
  const atlases: readonly (readonly [string, Atlas])[] = [
    ['a chain', chain(6, 20)],
    ['a hub needing a sample', hub(9, 16)],
    ['a deep chain', chain(12, 24)],
  ];

  for (const [name, atlas] of atlases) {
    it(`holds on ${name}: candidates ∩ dependents(subject, ∞) = truth`, () => {
      const challenges = generateBlastRadius(atlas);
      expect(challenges.length).toBeGreaterThan(0);
      for (const challenge of challenges) {
        const truthful = trueDependentIds(atlas, challenge.subject);
        const intersection = challenge.candidates.filter((id) => truthful.has(id));
        expect(intersection, challenge.id).toEqual([...challenge.truth]);
      }
    });

    it(`never ships a gameable question on ${name}`, () => {
      for (const challenge of generateBlastRadius(atlas)) {
        expect(isGameable(challenge), challenge.id).toBe(false);
      }
    });

    it(`produces an atlas the validator accepts on ${name}`, () => {
      const challenges = generateBlastRadius(atlas);
      expect(() => validateAtlas({ ...atlas, challenges })).not.toThrow();
    });
  }

  it('bans every unsampled dependent from the choice set', () => {
    // The half of the invariant that is easy to get wrong: on a hub the answer
    // key is a sample, and the dependents left out must be *absent*, not
    // present-and-wrong. A player who knows the codebase must never be told
    // that a real dependent is not one.
    const atlas = hub(9, 16);
    const challenge = generateBlastRadius(atlas).find(
      (c) => pathOf(atlas, c.subject) === 'src/hub.ts',
    );
    expect(challenge).toBeDefined();
    if (challenge === undefined) return;

    const truthful = trueDependentIds(atlas, challenge.subject);
    expect(truthful.size).toBe(18);
    expect(challenge.truth.length).toBeLessThan(truthful.size);

    const truthSet = new Set(challenge.truth);
    for (const id of challenge.candidates) {
      if (truthSet.has(id)) continue;
      expect(truthful.has(id), `${pathOf(atlas, id)} is a real dependent offered as a distractor`).toBe(
        false,
      );
    }
  });

  it('samples across distances rather than skimming the direct importers', () => {
    // ADR-0008 §2: the map gives away depth 1 by design, so an answer key made
    // only of direct importers is a question with no content.
    const atlas = hub(9, 16);
    const graph = buildGraph(atlas);
    const challenge = generateBlastRadius(atlas).find(
      (c) => pathOf(atlas, c.subject) === 'src/hub.ts',
    );
    expect(challenge).toBeDefined();
    if (challenge === undefined) return;

    const reached = dependents(graph, refOf(graph, challenge.subject), Number.POSITIVE_INFINITY);
    const distances = challenge.truth.map((id) => reached.get(refOf(graph, id)) ?? 0);
    expect(Math.min(...distances)).toBe(1);
    expect(Math.max(...distances)).toBe(2);
  });

  it('states the measured furthest hop as its evidence', () => {
    const atlas = chain(6, 20);
    const graph = buildGraph(atlas);
    for (const challenge of generateBlastRadius(atlas)) {
      const reached = dependents(graph, refOf(graph, challenge.subject), Number.POSITIVE_INFINITY);
      const furthest = Math.max(...challenge.truth.map((id) => reached.get(refOf(graph, id)) ?? 0));
      expect(challenge.evidence.kind).toBe('importGraph');
      if (challenge.evidence.kind === 'importGraph') {
        expect(challenge.evidence.depth, challenge.id).toBe(furthest);
      }
    }
    // The chain is deep enough that at least one answer key travels further
    // than one hop, so a generator hard-coding 1 would be caught above.
    const depths = generateBlastRadius(atlas).map((c) =>
      c.evidence.kind === 'importGraph' ? c.evidence.depth : 0,
    );
    expect(Math.max(...depths)).toBeGreaterThan(1);
  });
});

describe('guardrail 4', () => {
  it('refuses a subject reachable through an unresolved import', () => {
    const paths = [
      'src/a/subject.ts',
      'src/a/importer.ts',
      ...Array.from({ length: 20 }, (_, i) => `src/b/p${String(i).padStart(2, '0')}.ts`),
    ];
    const links: [string, string][] = [['src/a/importer.ts', 'src/a/subject.ts']];
    const clean = atlasWith(paths, links);
    expect(generateBlastRadius(clean).some((c) => pathOf(clean, c.subject) === 'src/a/subject.ts')).toBe(
      true,
    );

    // The same graph, except the importer has an import we could not pin down —
    // so we no longer know that the rest of the choice set is *not* coupled.
    const murky = atlasWith(paths, links, (node) =>
      node.path === 'src/a/importer.ts' ? { ...node, unresolved: ['./built-at-runtime'] } : node,
    );
    const generated = generateBlastRadius(murky);
    expect(generated.some((c) => pathOf(murky, c.subject) === 'src/a/subject.ts')).toBe(false);
    expect(generateWithReport(murky).report.skipped).toContainEqual(['uncertain', expect.any(Number)]);
  });

  it('refuses a subject reached over a probable edge', () => {
    const paths = [
      'src/a/subject.ts',
      'src/a/importer.ts',
      ...Array.from({ length: 20 }, (_, i) => `src/b/p${String(i).padStart(2, '0')}.ts`),
    ];
    const links: [string, string][] = [['src/a/importer.ts', 'src/a/subject.ts']];
    const guessed = atlasWith(paths, links, undefined, (edge) => ({
      ...edge,
      confidence: 'probable',
    }));
    expect(
      generateBlastRadius(guessed).some((c) => pathOf(guessed, c.subject) === 'src/a/subject.ts'),
    ).toBe(false);
  });

  it('refuses a subject nothing imports', () => {
    const atlas = chain(4, 20);
    const report = generateWithReport(atlas).report;
    // The head of the chain has no dependents; the spares have none either.
    expect(report.skipped).toContainEqual(['noDependents', expect.any(Number)]);
    for (const challenge of generateBlastRadius(atlas)) {
      expect(trueDependentIds(atlas, challenge.subject).size).toBeGreaterThan(0);
    }
  });

  it('refuses when there are too few certified non-dependents to ask with', () => {
    // Four files in a chain: every other node is a dependent or a dependency,
    // so a choice set that beats the 3:1 rule cannot be built.
    const atlas = chain(4, 0);
    const report = generateWithReport(atlas).report;
    expect(report.skipped).toContainEqual(['tooFewDistractors', expect.any(Number)]);
  });
});

describe('choice-set shape', () => {
  it('offers only files that could have imported the subject', () => {
    // The inert files sit in the *subject's own directory*, so the sibling
    // strategy ranks them top and they would be offered if eligibility were not
    // enforced. Putting them somewhere the strategies never reach would make
    // this assertion unable to fail.
    const atlas = atlasWith(
      [
        'src/a/subject.ts',
        'src/a/importer.ts',
        'src/a/README.md',
        'src/a/tsconfig.json',
        ...Array.from({ length: 20 }, (_, i) => `src/b/p${String(i).padStart(2, '0')}.ts`),
      ],
      [['src/a/importer.ts', 'src/a/subject.ts']],
    );
    const challenges = generateBlastRadius(atlas);
    expect(challenges.length).toBeGreaterThan(0);
    for (const challenge of challenges) {
      for (const id of challenge.candidates) {
        expect(pathOf(atlas, id), `${challenge.id} offers an inert file`).toMatch(/\.ts$/);
      }
    }
  });

  it('caps the answer key at what the 3:1 rule allows', () => {
    expect(truthCap(20)).toBe(6);
    expect(truthCap(DEFAULT_GENERATE_OPTIONS.candidateCount)).toBe(6);
    for (const challenge of generateBlastRadius(hub(9, 16))) {
      expect(challenge.truth.length).toBeLessThanOrEqual(truthCap(20));
    }
  });

  it('respects a smaller choice set by shrinking the answer key', () => {
    const atlas = hub(9, 16);
    const small = generateBlastRadius(atlas, { maxChallenges: 40, candidateCount: 10 });
    expect(small.length).toBeGreaterThan(0);
    for (const challenge of small) {
      expect(challenge.candidates.length).toBeLessThanOrEqual(10);
      expect(challenge.truth.length).toBeLessThanOrEqual(truthCap(10));
      expect(isGameable(challenge)).toBe(false);
    }
  });

  it('keeps the difficulty range when it has to drop challenges', () => {
    const atlas = hub(9, 16);
    const all = generateBlastRadius(atlas);
    const few = generateBlastRadius(atlas, { maxChallenges: 3, candidateCount: 20 });
    expect(all.length).toBeGreaterThan(3);
    expect(few).toHaveLength(3);
    const spread = (cs: readonly Challenge[]): number =>
      Math.max(...cs.map((c) => c.difficulty)) - Math.min(...cs.map((c) => c.difficulty));
    // Taking the first three by id would collapse the range; even spacing over
    // the difficulty-sorted list keeps both ends.
    expect(spread(few)).toBeCloseTo(spread(all), 5);
    expect(generateWithReport(atlas, { maxChallenges: 3, candidateCount: 20 }).report.skipped)
      .toContainEqual(['capped', all.length - 3]);
  });
});

describe('determinism', () => {
  it('returns byte-identical challenges for the same atlas', () => {
    const atlas = hub(9, 16);
    expect(JSON.stringify(generateBlastRadius(atlas))).toBe(
      JSON.stringify(generateBlastRadius(atlas)),
    );
  });

  it('emits challenges sorted by id', () => {
    const ids = generateBlastRadius(hub(9, 16)).map((c) => c.id);
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('difficulty (§8.4)', () => {
  it('is 0 when the true answer is exactly the obvious one', () => {
    expect(surpriseOf(['a', 'b'], ['a', 'b'])).toBe(0);
    expect(difficultyOf({ fanOut: 0, maxFanOut: 40, depth: 1, maxDepth: 4, surprise: 0 })).toBe(0);
  });

  it('rises with surprise, holding everything else fixed', () => {
    const base = { fanOut: 10, maxFanOut: 40, depth: 2, maxDepth: 4 };
    const dull = difficultyOf({ ...base, surprise: 0 });
    const sharp = difficultyOf({ ...base, surprise: 1 });
    expect(sharp).toBeGreaterThan(dull);
    // §8.4 calls surprise "the interesting term", so it must move the number
    // more than either structural term can.
    expect(sharp - dull).toBeGreaterThan(
      difficultyOf({ ...base, fanOut: 40, surprise: 0 }) - dull,
    );
  });

  it('counts a member of the answer that the naive guess missed', () => {
    expect(surpriseOf(['a', 'b', 'c', 'd'], ['a', 'b'])).toBe(0.5);
  });

  it('stays inside 0..1 whatever it is handed', () => {
    const extremes = [
      { fanOut: 0, maxFanOut: 0, depth: 1, maxDepth: 1, surprise: 0 },
      { fanOut: 9999, maxFanOut: 1, depth: 99, maxDepth: 1, surprise: 5 },
      { fanOut: -3, maxFanOut: 10, depth: -1, maxDepth: 4, surprise: -1 },
    ];
    for (const input of extremes) {
      const value = difficultyOf(input);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('ranks a barrel-driven cone above a question the map already answers', () => {
    // The whole claim of §8.4, end to end: a subject whose radius is exactly its
    // direct importers must score below one whose radius reaches further.
    const atlas = hub(9, 16);
    const graph = buildGraph(atlas);
    const challenges = generateBlastRadius(atlas);
    const shallow = challenges.filter((c) => {
      const reached = dependents(graph, refOf(graph, c.subject), Number.POSITIVE_INFINITY);
      return [...reached.values()].every((d) => d === 1);
    });
    const deep = challenges.filter((c) => c.evidence.kind === 'importGraph' && c.evidence.depth > 1);
    expect(shallow.length).toBeGreaterThan(0);
    expect(deep.length).toBeGreaterThan(0);
    expect(Math.max(...shallow.map((c) => c.difficulty))).toBeLessThan(
      Math.min(...deep.map((c) => c.difficulty)),
    );
  });
});

describe('sampleByDistance', () => {
  it('takes from the deepest bucket first, then works inward', () => {
    // An odd sample size is the assertion: with an even one, round-robin gives
    // the same split whichever end it starts from, and the test cannot fail.
    const atlas = hub(4, 4);
    const graph = buildGraph(atlas);
    const subject = atlas.nodes.findIndex((n) => n.path === 'src/hub.ts');
    const reached = dependents(graph, subject, Number.POSITIVE_INFINITY);
    const breadth = new Map([...reached.keys()].map((ref) => [ref, 1]));
    const picked = sampleByDistance(graph, reached, 3, breadth);
    const distances = picked.map((ref) => reached.get(ref));
    expect(picked).toHaveLength(3);
    expect(distances.filter((d) => d === 2), 'the far members must survive the cut').toHaveLength(2);
    expect(distances.filter((d) => d === 1)).toHaveLength(1);
  });

  it('prefers the dependent with the smallest dependency footprint', () => {
    const atlas = hub(4, 4);
    const graph = buildGraph(atlas);
    const subject = atlas.nodes.findIndex((n) => n.path === 'src/hub.ts');
    const reached = dependents(graph, subject, Number.POSITIVE_INFINITY);
    const narrow = atlas.nodes.findIndex((n) => n.path === 'src/near/n03.ts');
    const breadth = new Map([...reached.keys()].map((ref) => [ref, ref === narrow ? 0 : 99]));
    const picked = sampleByDistance(graph, reached, 2, breadth);
    expect(picked).toContain(narrow);
  });
});

describe('the verb object', () => {
  it('promises dependence, not required change', () => {
    // ADR-0008: the graph proves reachability, which overapproximates required
    // change. Promising the second would mark players wrong on files that
    // provably need no edit.
    const atlas = hub(9, 16);
    const challenge = generateBlastRadius(atlas)[0];
    expect(challenge).toBeDefined();
    if (challenge === undefined) return;
    const prompt = blastRadius.prompt(challenge, (id) => pathOf(atlas, id));
    expect(prompt.question).toContain('depend on it');
    expect(prompt.question).toContain(pathOf(atlas, challenge.subject));
    expect(prompt.question).not.toMatch(/will need to change/i);
    // "Which of these" never claims the choice set is exhaustive, which is what
    // makes a sampled answer key honest.
    expect(prompt.question).toContain('Which of these');
  });

  it('grades through the shared set scorer', () => {
    const atlas = hub(9, 16);
    const challenge = generateBlastRadius(atlas)[0];
    expect(challenge).toBeDefined();
    if (challenge === undefined) return;
    expect(blastRadius.grade(challenge, { picked: [...challenge.truth] }).score).toBe(1);
    expect(blastRadius.grade(challenge, { picked: [] }).score).toBe(0);
  });
});
