/**
 * The progression selector.
 *
 * ADR-0011 decision 4 exists because of a measured defect: difficulty is a pure
 * function of the cone, so two subjects with identical cones get identical
 * difficulty *by construction*, and any ascending-difficulty sort therefore
 * serves them back to back. Most of this file is about that — and about the
 * failure mode the fix introduces, which is a stuck player being handed the
 * same board forever.
 *
 * Every relaxation the rule can apply is asserted here with a fixture where the
 * unrelaxed answer is available, so a test that passes proves the relaxation
 * happened rather than that it was never needed.
 */

import { describe, expect, it } from 'vitest';

import type { Challenge, NodeId } from '../../src/atlas/index.js';
import { NO_HISTORY, noteAttempt, suggestNext } from '../../src/player/selector.js';

const id = (n: number): NodeId => `n:${n.toString(16).padStart(12, '0')}`;

interface Spec {
  readonly name: string;
  readonly subject: number;
  readonly truth: readonly number[];
  readonly difficulty?: number;
  readonly tier?: 1 | 2 | 3 | 4 | 5 | 6;
}

function challenge(spec: Spec): Challenge {
  return {
    id: `blast-${spec.name}`,
    verb: 'blastRadius',
    tier: spec.tier ?? 3,
    difficulty: spec.difficulty ?? 0.5,
    subject: id(spec.subject),
    // Candidates are irrelevant to selection; the truth set is what is compared.
    candidates: [...spec.truth, 90, 91, 92, 93, 94, 95, 96, 97, 98].map(id).sort(),
    truth: [...spec.truth].sort((a, b) => a - b).map(id),
    evidence: { kind: 'importGraph', depth: 1 },
  };
}

/** Regions by subject number; anything unlisted is its own region. */
const regions = new Map<number, string>();
const regionOf = (subject: NodeId): string => {
  for (const [n, region] of regions) if (id(n) === subject) return region;
  return subject;
};

describe('the base order', () => {
  it('opens on the easiest question', () => {
    const deck = [
      challenge({ name: 'hard', subject: 1, truth: [10], difficulty: 0.9 }),
      challenge({ name: 'easy', subject: 2, truth: [11], difficulty: 0.1 }),
      challenge({ name: 'mid', subject: 3, truth: [12], difficulty: 0.5 }),
    ];
    expect(suggestNext(deck, regionOf, NO_HISTORY)?.id).toBe('blast-easy');
  });

  it('orders by tier before difficulty — §5 tiers are the progression', () => {
    const deck = [
      challenge({ name: 'tier3-easy', subject: 1, truth: [10], difficulty: 0.1, tier: 3 }),
      challenge({ name: 'tier1-hard', subject: 2, truth: [11], difficulty: 0.9, tier: 1 }),
    ];
    expect(suggestNext(deck, regionOf, NO_HISTORY)?.id).toBe('blast-tier1-hard');
  });

  it('breaks a tie on id, so two machines serve the same question', () => {
    const deck = [
      challenge({ name: 'zzz', subject: 1, truth: [10], difficulty: 0.5 }),
      challenge({ name: 'aaa', subject: 2, truth: [11], difficulty: 0.5 }),
    ];
    expect(suggestNext(deck, regionOf, NO_HISTORY)?.id).toBe('blast-aaa');
  });

  it('does not depend on the order of the deck it is handed', () => {
    const deck = [
      challenge({ name: 'a', subject: 1, truth: [10], difficulty: 0.3 }),
      challenge({ name: 'b', subject: 2, truth: [11], difficulty: 0.1 }),
      challenge({ name: 'c', subject: 3, truth: [12], difficulty: 0.2 }),
    ];
    const forwards = suggestNext(deck, regionOf, NO_HISTORY)?.id;
    const backwards = suggestNext([...deck].reverse(), regionOf, NO_HISTORY)?.id;
    expect(forwards).toBe('blast-b');
    expect(backwards).toBe(forwards);
  });

  it('never offers a question the player has passed', () => {
    const deck = [
      challenge({ name: 'done', subject: 1, truth: [10], difficulty: 0.1 }),
      challenge({ name: 'open', subject: 2, truth: [11], difficulty: 0.9 }),
    ];
    const state = { ...NO_HISTORY, answered: new Set([id(1)]) };
    expect(suggestNext(deck, regionOf, state)?.id).toBe('blast-open');
  });

  it('returns null only when every question has been passed', () => {
    const deck = [challenge({ name: 'only', subject: 1, truth: [10] })];
    expect(suggestNext(deck, regionOf, { ...NO_HISTORY, answered: new Set([id(1)]) })).toBeNull();
    expect(suggestNext([], regionOf, NO_HISTORY)).toBeNull();
  });
});

describe('the truth constraint — the measured defect', () => {
  it('does not serve an identical answer key twice in a row', () => {
    // Identical cones ⇒ identical difficulty, so the plain sort puts these
    // adjacent. 5 of 6 identical-key groups on this repo share a difficulty to
    // the byte; 21 of 22 on vite.
    const twin = challenge({ name: 'twin', subject: 2, truth: [10, 11], difficulty: 0.2 });
    const first = challenge({ name: 'first', subject: 1, truth: [10, 11], difficulty: 0.2 });
    const other = challenge({ name: 'other', subject: 3, truth: [12], difficulty: 0.8 });
    const next = suggestNext([first, twin, other], regionOf, { ...NO_HISTORY, previous: first });
    expect(next?.id).toBe('blast-other');
  });

  it('compares the whole key, not its size', () => {
    // A same-sized but different answer is a different question and must be
    // served — 32 of this repo's 40 keys are exactly 6 files.
    const first = challenge({ name: 'first', subject: 1, truth: [10, 11], difficulty: 0.2 });
    const sameSize = challenge({ name: 'same-size', subject: 2, truth: [12, 13], difficulty: 0.3 });
    const easier = challenge({ name: 'twin', subject: 3, truth: [10, 11], difficulty: 0.25 });
    const next = suggestNext([first, easier, sameSize], regionOf, { ...NO_HISTORY, previous: first });
    expect(next?.id).toBe('blast-same-size');
  });

  it('serves the twin anyway rather than blocking, when it is all that is left', () => {
    const first = challenge({ name: 'first', subject: 1, truth: [10, 11] });
    const twin = challenge({ name: 'twin', subject: 2, truth: [10, 11] });
    const next = suggestNext([first, twin], regionOf, {
      ...NO_HISTORY,
      answered: new Set([id(1)]),
      previous: first,
    });
    expect(next?.id).toBe('blast-twin');
  });
});

describe('the region constraint — the tour', () => {
  it('moves to a different region when it can', () => {
    regions.clear();
    regions.set(1, 'atlas');
    regions.set(2, 'atlas');
    regions.set(3, 'player');
    const first = challenge({ name: 'first', subject: 1, truth: [10], difficulty: 0.1 });
    const neighbour = challenge({ name: 'neighbour', subject: 2, truth: [11], difficulty: 0.2 });
    const across = challenge({ name: 'across', subject: 3, truth: [12], difficulty: 0.9 });
    const next = suggestNext([first, neighbour, across], regionOf, { ...NO_HISTORY, previous: first });
    // Harder *and* later in the base order, so passing this proves the region
    // constraint moved the answer rather than the sort landing there anyway.
    expect(next?.id).toBe('blast-across');
    regions.clear();
  });

  it('yields to the truth constraint — region is dropped first', () => {
    // The one case that distinguishes the two constraints' priority. The
    // same-region option has a different key; the cross-region one is a twin.
    regions.clear();
    regions.set(1, 'atlas');
    regions.set(2, 'atlas');
    regions.set(3, 'player');
    const first = challenge({ name: 'first', subject: 1, truth: [10, 11], difficulty: 0.1 });
    const sameRegion = challenge({ name: 'same-region', subject: 2, truth: [12], difficulty: 0.5 });
    const twinAcross = challenge({ name: 'twin-across', subject: 3, truth: [10, 11], difficulty: 0.2 });
    const next = suggestNext([first, sameRegion, twinAcross], regionOf, {
      ...NO_HISTORY,
      previous: first,
    });
    expect(next?.id).toBe('blast-same-region');
    regions.clear();
  });

  it('stays in the region rather than blocking, when nothing else is open', () => {
    regions.clear();
    regions.set(1, 'atlas');
    regions.set(2, 'atlas');
    const first = challenge({ name: 'first', subject: 1, truth: [10] });
    const only = challenge({ name: 'only', subject: 2, truth: [11] });
    const next = suggestNext([first, only], regionOf, {
      ...NO_HISTORY,
      answered: new Set([id(1)]),
      previous: first,
    });
    expect(next?.id).toBe('blast-only');
    regions.clear();
  });
});

describe('a wrong answer rotates rather than repeats', () => {
  const deck = [
    challenge({ name: 'a', subject: 1, truth: [10], difficulty: 0.1 }),
    challenge({ name: 'b', subject: 2, truth: [11], difficulty: 0.2 }),
    challenge({ name: 'c', subject: 3, truth: [12], difficulty: 0.3 }),
  ];

  it('offers something else after a failure', () => {
    // Only *passed* challenges leave the unanswered set, so a naive "first
    // unanswered" rule hands a stuck player the same board forever.
    const failed = deck[0];
    if (failed === undefined) throw new Error('fixture');
    const state = {
      answered: new Set<NodeId>(),
      attempts: noteAttempt(new Map(), id(1)),
      previous: failed,
    };
    expect(suggestNext(deck, regionOf, state)?.id).toBe('blast-b');
  });

  it('comes back to it only after the rest of the deck', () => {
    let state = { answered: new Set<NodeId>(), attempts: new Map<NodeId, number>(), previous: null } as {
      answered: Set<NodeId>;
      attempts: Map<NodeId, number>;
      previous: Challenge | null;
    };
    const served: string[] = [];
    for (let i = 0; i < 4; i++) {
      const next = suggestNext(deck, regionOf, state);
      if (next === null) break;
      served.push(next.id);
      state = { ...state, attempts: noteAttempt(state.attempts, next.subject), previous: next };
    }
    // Every question once before any repeat — guardrail 6 says a wrong answer
    // costs nothing, and being asked it again immediately is a cost.
    expect(served.slice(0, 3).sort()).toEqual(['blast-a', 'blast-b', 'blast-c']);
    expect(served[3]).toBe('blast-a');
  });

  it('keeps cycling instead of stalling when the whole deck has been failed', () => {
    let state = { answered: new Set<NodeId>(), attempts: new Map<NodeId, number>(), previous: null } as {
      answered: Set<NodeId>;
      attempts: Map<NodeId, number>;
      previous: Challenge | null;
    };
    const served: string[] = [];
    for (let i = 0; i < 9; i++) {
      const next = suggestNext(deck, regionOf, state);
      expect(next).not.toBeNull();
      if (next === null) break;
      served.push(next.id);
      state = { ...state, attempts: noteAttempt(state.attempts, next.subject), previous: next };
    }
    // Three passes over three questions, evenly — not one question nine times.
    for (const name of ['blast-a', 'blast-b', 'blast-c']) {
      expect(served.filter((entry) => entry === name)).toHaveLength(3);
    }
  });

  it('prefers an untried question to an easier one already failed', () => {
    const state = {
      answered: new Set<NodeId>(),
      attempts: noteAttempt(new Map(), id(1)),
      previous: null,
    };
    expect(suggestNext(deck, regionOf, state)?.id).toBe('blast-b');
  });

  it('prefers an untried question even when a failed one varies the tour better', () => {
    // The case that fixes where `attempts` sits in the rank. If the constraints
    // outranked it, the selector would re-serve a question the player has
    // already failed in order to move to a different region — spending a
    // *fresh* question to buy variety it could have had for free. Nothing else
    // in this file distinguishes the two orderings.
    regions.clear();
    regions.set(1, 'atlas');
    regions.set(2, 'atlas');
    regions.set(3, 'player');
    const previous = challenge({ name: 'previous', subject: 1, truth: [10], difficulty: 0.1 });
    const fresh = challenge({ name: 'fresh', subject: 2, truth: [11], difficulty: 0.9 });
    const failedElsewhere = challenge({ name: 'failed', subject: 3, truth: [12], difficulty: 0.2 });
    const next = suggestNext([previous, fresh, failedElsewhere], regionOf, {
      answered: new Set([id(1)]),
      attempts: noteAttempt(new Map(), id(3)),
      previous,
    });
    expect(next?.id).toBe('blast-fresh');
    regions.clear();
  });
});
