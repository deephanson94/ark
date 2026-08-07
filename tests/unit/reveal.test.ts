/**
 * The reveal.
 *
 * `grade()` says "you missed two". This says *which* two and, more usefully,
 * why the ones you invented looked coupled and were not — which is the part of
 * the loop that teaches rather than scores. Everything asserted here has to be
 * derived from the graph or the co-change matrix; a canned string would pass a
 * shape test and fail the product.
 */

import { describe, expect, it } from 'vitest';

import type { Atlas, NodeId } from '../../src/atlas/index.js';
import { buildGraph, validateAtlas } from '../../src/atlas/index.js';
import { revealOf } from '../../src/verbs/blastRadius/index.js';
import { gradeSet } from '../../src/verbs/index.js';
import { atlasWith } from '../fixtures/atlas.js';

const PATHS = [
  'src/a/subject.ts',
  'src/a/direct.ts',
  'src/b/distant.ts',
  'src/a/dependency.ts',
  'src/a/sibling.ts',
  'src/z/stranger.ts',
  'src/z/companion.ts',
];

/**
 * `distant → direct → subject → dependency`, with a sibling, a stranger, and a
 * co-changing companion that never imports anything.
 */
function fixture(): Atlas {
  return atlasWith(PATHS, [
    ['src/a/direct.ts', 'src/a/subject.ts'],
    ['src/b/distant.ts', 'src/a/direct.ts'],
    ['src/a/subject.ts', 'src/a/dependency.ts'],
  ]);
}

function idFor(atlas: Atlas, path: string): NodeId {
  const node = atlas.nodes.find((candidate) => candidate.path === path);
  if (node === undefined) throw new Error(`fixture has no ${path}`);
  return node.id;
}

function withCoChange(atlas: Atlas, a: string, b: string, count: number): Atlas {
  const refA = atlas.nodes.findIndex((node) => node.path === a);
  const refB = atlas.nodes.findIndex((node) => node.path === b);
  const pair = refA < refB ? [refA, refB, count] : [refB, refA, count];
  return validateAtlas({
    ...atlas,
    history: {
      present: false,
      commitsWalked: 0,
      commitsRetained: 0,
      window: null,
      coChange: [pair],
      commits: [],
    },
  });
}

function noteFor(atlas: Atlas, picked: readonly string[], path: string) {
  const subject = idFor(atlas, 'src/a/subject.ts');
  const candidates = PATHS.filter((p) => p !== 'src/a/subject.ts')
    .map((p) => idFor(atlas, p))
    .sort();
  const truth = [idFor(atlas, 'src/a/direct.ts'), idFor(atlas, 'src/b/distant.ts')].sort();
  const challenge = {
    id: 'blast-fixture',
    verb: 'blastRadius' as const,
    tier: 3 as const,
    difficulty: 0.5,
    subject,
    candidates,
    truth,
    evidence: { kind: 'importGraph' as const, depth: 2 },
  };
  const grade = gradeSet(challenge, { picked: picked.map((p) => idFor(atlas, p)) });
  const reveal = revealOf(atlas, buildGraph(atlas), challenge, grade);
  return { reveal, note: reveal.notes.find((entry) => entry.path === path) };
}

describe('revealOf', () => {
  it('names the route a distant dependent actually travels', () => {
    const { note } = noteFor(fixture(), ['src/a/direct.ts'], 'src/b/distant.ts');
    expect(note?.kind).toBe('missed');
    expect(note?.distance).toBe(2);
    expect(note?.route).toEqual(['src/b/distant.ts', 'src/a/direct.ts', 'src/a/subject.ts']);
    // The intermediate hop is the lesson: "you missed the two reached through
    // the re-export" (NORTH-STAR appendix A), stated as a measured path.
    expect(note?.note).toContain('src/a/direct.ts');
    expect(note?.note).toContain('2 hops');
  });

  it('tells a player who picked a dependency that the arrow points the other way', () => {
    const { note } = noteFor(fixture(), ['src/a/dependency.ts'], 'src/a/dependency.ts');
    expect(note?.kind).toBe('spurious');
    expect(note?.distance).toBeNull();
    expect(note?.note).toContain('the other way');
  });

  it('separates a co-change companion from a structural dependent', () => {
    const atlas = withCoChange(fixture(), 'src/a/subject.ts', 'src/z/companion.ts', 11);
    const { note } = noteFor(atlas, ['src/z/companion.ts'], 'src/z/companion.ts');
    // §8.3 calls this the best distractor there is, because the explanation is
    // itself a fact about the codebase.
    expect(note?.note).toContain('11 commits');
    expect(note?.note).toContain('never imports it');
  });

  it('calls out the same-directory guess for what it is', () => {
    const { note } = noteFor(fixture(), ['src/a/sibling.ts'], 'src/a/sibling.ts');
    expect(note?.note).toContain('same directory');
  });

  it('falls back to the plain truth for an unrelated pick', () => {
    const { note } = noteFor(fixture(), ['src/z/stranger.ts'], 'src/z/stranger.ts');
    expect(note?.note).toBe('no chain of imports reaches the subject.');
  });

  it('reports the full radius, including members that were never on the board', () => {
    const { reveal } = noteFor(fixture(), [], 'src/a/direct.ts');
    expect(reveal.radius).toBe(2);
    expect(reveal.subject).toBe('src/a/subject.ts');
  });

  it('orders missed first, then spurious, then correct', () => {
    const { reveal } = noteFor(
      fixture(),
      ['src/a/direct.ts', 'src/a/sibling.ts'],
      'src/a/direct.ts',
    );
    expect(reveal.notes.map((entry) => entry.kind)).toEqual(['missed', 'spurious', 'correct']);
  });

  it('says "directly" for a one-hop dependent, without inventing a route', () => {
    const { note } = noteFor(fixture(), ['src/a/direct.ts'], 'src/a/direct.ts');
    expect(note?.kind).toBe('correct');
    expect(note?.note).toBe('imports the subject directly.');
  });
});
