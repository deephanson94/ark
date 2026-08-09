import { describe, expect, it } from 'vitest';

import type { Challenge } from '../../src/atlas/index.js';
import { PASS_THRESHOLD, bandFor, gradeSet, isGameable, scoreSet, selectAllScore } from '../../src/verbs/index.js';
import { PHRASING as BLAST_PHRASING } from '../../src/verbs/blastRadius/index.js';
import { witnessFor } from '../fixtures/atlas.js';

function ids(count: number, prefix = 'n:'): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}${i.toString(16).padStart(12, '0')}`);
}

describe('scoreSet', () => {
  it('scores a perfect answer 1', () => {
    const result = scoreSet(['a', 'b'], ['b', 'a']);
    expect(result.score).toBe(1);
    expect(result.correct).toEqual(['a', 'b']);
    expect(result.missed).toEqual([]);
    expect(result.spurious).toEqual([]);
  });

  it('reports the three sets sorted, whatever order they were picked in', () => {
    const result = scoreSet(['z', 'b', 'a'], ['a', 'b', 'c']);
    expect(result.correct).toEqual(['a', 'b']);
    expect(result.missed).toEqual(['c']);
    expect(result.spurious).toEqual(['z']);
  });

  it('scores half credit as F1, not as a fraction of truth', () => {
    // 2 of 4 correct, 2 spurious: precision 0.5, recall 0.5.
    const result = scoreSet(['a', 'b', 'y', 'z'], ['a', 'b', 'c', 'd']);
    expect(result.precision).toBe(0.5);
    expect(result.recall).toBe(0.5);
    expect(result.score).toBe(0.5);
  });

  it('ignores duplicate picks rather than rewarding them', () => {
    expect(scoreSet(['a', 'a', 'a'], ['a']).score).toBe(1);
  });

  it('scores an empty answer 0 when there is something to find', () => {
    expect(scoreSet([], ['a']).score).toBe(0);
  });

  it('scores no picks against no truth as correct', () => {
    expect(scoreSet([], []).score).toBe(1);
  });

  it('scores a disjoint answer 0 without dividing by zero', () => {
    const result = scoreSet(['x'], ['a']);
    expect(result.score).toBe(0);
    expect(Number.isNaN(result.score)).toBe(false);
  });
});

describe('the select-everything exploit', () => {
  // NORTH-STAR §8.2: the anti-gaming property has to fall out of the metric,
  // not out of special-case cheat detection. This is that claim, measured.
  it('scores ~0.33 on a 20-candidate question with 4 correct answers', () => {
    const candidates = ids(20);
    const truth = candidates.slice(0, 4);
    const result = scoreSet(candidates, truth);

    expect(result.recall).toBe(1);
    expect(result.precision).toBe(0.2);
    expect(result.score).toBeCloseTo(0.3333, 4);
    expect(result.score).toBeLessThan(PASS_THRESHOLD);
    expect(bandFor(result.score)).toBe('incomplete');
  });

  it('stays below the pass threshold whenever candidates outnumber truth 3:1', () => {
    for (let truthSize = 1; truthSize <= 12; truthSize++) {
      const candidates = ids(truthSize * 3 + 1);
      const score = scoreSet(candidates, candidates.slice(0, truthSize)).score;
      expect(score).toBeLessThan(PASS_THRESHOLD);
    }
  });

  it('does pass once the choice set is too small — which is why isGameable exists', () => {
    const candidates = ids(6);
    const challenge = challengeWith(candidates, candidates.slice(0, 4));
    expect(selectAllScore(challenge)).toBeGreaterThan(PASS_THRESHOLD);
    expect(isGameable(challenge)).toBe(true);
  });

  it('accepts a challenge whose choice set is wide enough', () => {
    const candidates = ids(20);
    expect(isGameable(challengeWith(candidates, candidates.slice(0, 4)))).toBe(false);
  });
});

describe('bandFor', () => {
  it('maps scores onto the bands from NORTH-STAR §8.2', () => {
    expect(bandFor(1)).toBe('S');
    expect(bandFor(0.95)).toBe('S');
    expect(bandFor(0.94)).toBe('A');
    expect(bandFor(0.78)).toBe('A');
    expect(bandFor(0.77)).toBe('B');
    expect(bandFor(0.6)).toBe('B');
    expect(bandFor(0.59)).toBe('C');
    expect(bandFor(0.5)).toBe('C');
    expect(bandFor(0.49)).toBe('incomplete');
    expect(bandFor(0)).toBe('incomplete');
  });
});

describe('gradeSet', () => {
  const candidates = ids(20);
  const truth = candidates.slice(0, 4);
  const challenge = challengeWith(candidates, truth);

  it('derives evidence from the measured result', () => {
    const grade = gradeSet(challenge, { picked: [...truth.slice(0, 2), candidates[10] ?? ''] }, BLAST_PHRASING);
    expect(grade.evidence).toContain('Found 2 of 4');
    // The measured furthest hop, not a bound the generator imposed (ADR-0008).
    expect(grade.evidence).toContain('furthest is 2 hops away');
    expect(grade.evidence).toContain('2 reached the subject');
    expect(grade.evidence).toContain('1 of your picks');
  });

  it('says so when the boundary was drawn exactly right', () => {
    const grade = gradeSet(challenge, { picked: truth }, BLAST_PHRASING);
    expect(grade.score).toBe(1);
    expect(grade.evidence).toContain('Exact');
  });

  it('never returns a negative score for a wrong answer', () => {
    const grade = gradeSet(challenge, { picked: candidates.slice(4) }, BLAST_PHRASING);
    expect(grade.score).toBe(0);
    expect(grade.score).toBeGreaterThanOrEqual(0);
  });
});

function challengeWith(candidates: readonly string[], truth: readonly string[]): Challenge {
  return {
    id: 'test-01',
    verb: 'blastRadius',
    tier: 3,
    difficulty: 0.5,
    subject: 'n:ffffffffffff',
    candidates,
    truth,
    witness: witnessFor(candidates, truth),
    evidence: { kind: 'importGraph', depth: 2 },
  };
}
