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
import { buildGraph, encodeWitness, validateAtlas } from '../../src/atlas/index.js';
import { revealOf } from '../../src/verbs/blastRadius/index.js';
import { PASS_THRESHOLD, gradeSet } from '../../src/verbs/index.js';
import { PHRASING as BLAST_PHRASING } from '../../src/verbs/blastRadius/index.js';
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
      wideLimit: 25,
      coChange: [pair],
      commits: [],
    },
  });
}

/**
 * `strategies` is by **path**, and defaults to `distant` — the one label the
 * reveal never speaks. A test that wants a witness sentence therefore has to
 * name the class it is asking about, rather than inheriting one and asserting
 * against whatever it inherited.
 */
function noteFor(
  atlas: Atlas,
  picked: readonly string[],
  path: string,
  strategies: Readonly<Record<string, string>> = {},
) {
  const subject = idFor(atlas, 'src/a/subject.ts');
  const candidates = PATHS.filter((p) => p !== 'src/a/subject.ts')
    .map((p) => idFor(atlas, p))
    .sort();
  const truth = [idFor(atlas, 'src/a/direct.ts'), idFor(atlas, 'src/b/distant.ts')].sort();
  const answers = new Set(truth);
  const challenge = {
    id: 'blast-fixture',
    verb: 'blastRadius' as const,
    tier: 3 as const,
    difficulty: 0.5,
    subject,
    candidates,
    truth,
    witness: encodeWitness(
      candidates,
      new Map(
        candidates
          .filter((id) => !answers.has(id))
          .map((id) => {
            const named = PATHS.find((p) => idFor(atlas, p) === id) ?? '';
            return [id, strategies[named] ?? 'distant'];
          }),
      ),
    ),
    evidence: { kind: 'importGraph' as const, depth: 2 },
  };
  const grade = gradeSet(challenge, { picked: picked.map((p) => idFor(atlas, p)) }, BLAST_PHRASING);
  const reveal = revealOf(atlas, buildGraph(atlas), challenge, grade);
  return { grade, reveal, note: reveal.notes.find((entry) => entry.label === path) };
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

  it('never names a co-change count — that is the other verb\'s answer key', () => {
    // This assertion is the **inverse** of the one it replaces, and the reason
    // is the whole M4 seam. Until Companion existed, §8.3's best distractor
    // explaining itself ("changed with the subject in 11 commits, but never
    // imports it") was a free lesson. Now it is a member of Companion's answer
    // key for the same subject, handed over with its count — and Blast Radius is
    // served first for a shared subject, so that question is still open.
    //
    // `coChangeStrategy` picks these distractors *ranked count-descending*, so
    // the file most likely to be explained this way is the strongest companion:
    // the leak lands on the answer's best member, not a random one.
    const atlas = withCoChange(fixture(), 'src/a/subject.ts', 'src/z/companion.ts', 11);
    const { note } = noteFor(atlas, ['src/z/companion.ts'], 'src/z/companion.ts');
    expect(note?.note).not.toContain('11');
    expect(note?.note).not.toContain('commit');
    // It still says something true, from the import graph alone.
    expect(note?.note).toBe('no chain of imports reaches the subject.');
  });

  it('never *labels* a co-change distractor either — the same leak, as provenance', () => {
    // ADR-0020. The generator records `coChange` in the atlas, honestly; this
    // asserts the panel declines to say it. A witness reading "offered because
    // it changes with the subject" is the deleted sentence above wearing a
    // label, and it lands on the strongest member of Companion's key for this
    // very subject, because `coChangeStrategy` ranks count-descending.
    const atlas = withCoChange(fixture(), 'src/a/subject.ts', 'src/z/companion.ts', 11);
    const { note } = noteFor(atlas, ['src/z/companion.ts'], 'src/z/companion.ts', {
      'src/z/companion.ts': 'coChange',
    });
    expect(note?.witness).toBeNull();
  });

  it('states the class that chose a wrong pick, where saying so leaks nothing', () => {
    const { note } = noteFor(fixture(), ['src/a/sibling.ts'], 'src/a/sibling.ts', {
      'src/a/sibling.ts': 'treeSibling',
    });
    expect(note?.witness).toBe('a directory sibling');
    // Two different claims on one row: what is true of the file, and what the
    // board meant by offering it.
    expect(note?.note).toContain('same directory');
  });

  it('says nothing for padding, and nothing at all for an answer', () => {
    // `distant` is not a strategy — "offered because nothing sharper was left"
    // is a confession about the board rather than a lesson about the repo.
    const padded = noteFor(fixture(), ['src/z/stranger.ts'], 'src/z/stranger.ts');
    expect(padded.note?.witness).toBeNull();
    const answer = noteFor(fixture(), ['src/a/direct.ts'], 'src/a/direct.ts', {
      'src/a/sibling.ts': 'treeSibling',
    });
    expect(answer.note?.kind).toBe('correct');
    expect(answer.note?.witness).toBeNull();
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

describe('what a reveal puts on the map (guardrail 6)', () => {
  /**
   * The regression this exists for, which was introduced by the *fix* for a
   * leak rather than by the leak.
   *
   * `onGraded` used to draw `FULL_RADIUS` unconditionally, which let a
   * Companion answer render an import cone nobody had earned. Routing it
   * through `depthFor` closed that — and broke this: `depthFor` reads a set
   * only a **passed** challenge writes to, so a Blast Radius answer that came
   * apart stopped drawing the radius while the panel went on saying "now drawn
   * on the map".
   *
   * So the verb declares it, and the declaration does not depend on the score.
   */
  it('unlocks the import radius on a failed blast-radius answer too', () => {
    const graded = noteFor(fixture(), [], 'src/a/direct.ts');
    expect(graded.grade.score).toBeLessThan(PASS_THRESHOLD);
    expect(graded.reveal.unlocks).toBe('importRadius');
    // ...and the sentence the map has to keep true.
    expect(graded.reveal.summary).toContain('drawn on the map');
  });

  it('unlocks it on a perfect answer as well — the score is not the question', () => {
    const perfect = noteFor(fixture(), ['src/a/direct.ts', 'src/b/distant.ts'], 'src/a/direct.ts');
    expect(perfect.grade.score).toBe(1);
    expect(perfect.reveal.unlocks).toBe('importRadius');
  });
});
