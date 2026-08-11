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
import { nodeIdFor } from '../../src/atlas/index.js';
import { NO_HISTORY, noteAttempt, suggestNext } from '../../src/player/selector.js';
import { answerKey } from '../../src/player/progress.js';
import { atlasWith, challengeFor, witnessFor } from '../fixtures/atlas.js';

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
    witness: witnessFor(
      [...spec.truth, 90, 91, 92, 93, 94, 95, 96, 97, 98].map(id).sort(),
      [...spec.truth].map(id),
    ),
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
    const state = { ...NO_HISTORY, answered: new Set([answerKey('blastRadius', id(1))]) };
    expect(suggestNext(deck, regionOf, state)?.id).toBe('blast-open');
  });

  it('returns null only when every question has been passed', () => {
    const deck = [challenge({ name: 'only', subject: 1, truth: [10] })];
    expect(suggestNext(deck, regionOf, { ...NO_HISTORY, answered: new Set([answerKey('blastRadius', id(1))]) })).toBeNull();
    expect(suggestNext([], regionOf, NO_HISTORY)).toBeNull();
  });
});

describe('the overlap rank — how much of the last answer this one repeats', () => {
  // The names below are chosen so that the **id tiebreak is adversarial**: the
  // most repetitive option always sorts first. Without that, `blast-fresh` wins
  // on alphabetical order alone and the assertions pass with the overlap rank
  // deleted entirely — which is exactly what a mutation run found them doing.
  it('prefers the least-overlapping question among equally hard ones', () => {
    // The replacement for a byte-equality "is this the same key" flag, which the
    // generator's `dedupe()` made unreachable. All are difficulty 0.2, so the
    // base order cannot separate them and overlap decides: `c-fresh` shares
    // nothing, `b-partial` shares one file, `a-twin` shares both.
    const first = challenge({ name: 'first', subject: 1, truth: [10, 11], difficulty: 0.2 });
    const twin = challenge({ name: 'a-twin', subject: 2, truth: [10, 11], difficulty: 0.2 });
    const partial = challenge({ name: 'b-partial', subject: 3, truth: [10, 12], difficulty: 0.2 });
    const fresh = challenge({ name: 'c-fresh', subject: 4, truth: [13, 14], difficulty: 0.2 });
    const state = { ...NO_HISTORY, previous: first };
    expect(suggestNext([first, twin, partial, fresh], regionOf, state)?.id).toBe('blast-c-fresh');
    // And it is a **gradient, not a flag**: with `c-fresh` gone, sharing one file
    // still beats sharing two. A boolean "same key or not" scores both of these
    // 1, calls them equal, and falls through to the id tiebreak — which picks
    // `blast-a-twin`, the worst of the two.
    expect(suggestNext([first, twin, partial], regionOf, state)?.id).toBe('blast-b-partial');
  });

  it('compares the whole key, not its size', () => {
    // A same-sized but different answer is a different question and must be
    // served — 33 of this repo's 39 keys are exactly 6 files. `a-twin` sorts
    // first by id and is the same difficulty, so only the key comparison saves it.
    const first = challenge({ name: 'first', subject: 1, truth: [10, 11], difficulty: 0.2 });
    const twin = challenge({ name: 'a-twin', subject: 3, truth: [10, 11], difficulty: 0.3 });
    const sameSize = challenge({ name: 'b-same-size', subject: 2, truth: [12, 13], difficulty: 0.3 });
    const next = suggestNext([first, twin, sameSize], regionOf, { ...NO_HISTORY, previous: first });
    expect(next?.id).toBe('blast-b-same-size');
  });

  it('is outranked by difficulty, deliberately — the curriculum wins', () => {
    // The one trade-off this rung made, pinned so nobody reverses it by accident.
    // `twin` repeats the whole answer key and is still served, because it is the
    // easier question and §5's tiers are the progression. Ranked *above*
    // difficulty the overlap term measured 39 descending-difficulty steps in 152
    // on svelte against 4 — a tour rather than a curriculum. This costs nothing
    // in practice because `dedupe()` guarantees no two blastRadius challenges
    // share a key at all; the ordering only decides *partial* repeats.
    const first = challenge({ name: 'first', subject: 1, truth: [10, 11], difficulty: 0.5 });
    const twin = challenge({ name: 'twin', subject: 2, truth: [10, 11], difficulty: 0.2 });
    const fresh = challenge({ name: 'fresh', subject: 3, truth: [12, 13], difficulty: 0.8 });
    const next = suggestNext([first, twin, fresh], regionOf, { ...NO_HISTORY, previous: first });
    expect(next?.id).toBe('blast-twin');
  });

  it('serves the twin anyway rather than blocking, when it is all that is left', () => {
    const first = challenge({ name: 'first', subject: 1, truth: [10, 11] });
    const twin = challenge({ name: 'twin', subject: 2, truth: [10, 11] });
    const next = suggestNext([first, twin], regionOf, {
      ...NO_HISTORY,
      answered: new Set([answerKey('blastRadius', id(1))]),
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

  it('outranks the overlap term — moving on beats a fresh answer key', () => {
    // The case that fixes the two constraints' priority relative to each other.
    // Staying put would buy a completely fresh answer key; crossing the map
    // repeats the whole previous one. The tour wins, because §4's loop is "pick
    // the next landmark" and a landmark you can see from where you are standing
    // is not one. (Under the old rule this test read the other way round, when
    // an identical key was blocked outright.)
    regions.clear();
    regions.set(1, 'atlas');
    regions.set(2, 'atlas');
    regions.set(3, 'player');
    const first = challenge({ name: 'first', subject: 1, truth: [10, 11], difficulty: 0.1 });
    const sameRegion = challenge({ name: 'same-region', subject: 2, truth: [12], difficulty: 0.2 });
    const twinAcross = challenge({ name: 'twin-across', subject: 3, truth: [10, 11], difficulty: 0.2 });
    const next = suggestNext([first, sameRegion, twinAcross], regionOf, {
      ...NO_HISTORY,
      previous: first,
    });
    expect(next?.id).toBe('blast-twin-across');
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
      answered: new Set([answerKey('blastRadius', id(1))]),
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
      answered: new Set<string>(),
      attempts: noteAttempt(new Map(), answerKey('blastRadius', id(1))),
      previous: failed,
    };
    expect(suggestNext(deck, regionOf, state)?.id).toBe('blast-b');
  });

  it('comes back to it only after the rest of the deck', () => {
    let state = { answered: new Set<string>(), attempts: new Map<string, number>(), previous: null } as {
      answered: Set<string>;
      attempts: Map<string, number>;
      previous: Challenge | null;
    };
    const served: string[] = [];
    for (let i = 0; i < 4; i++) {
      const next = suggestNext(deck, regionOf, state);
      if (next === null) break;
      served.push(next.id);
      state = { ...state, attempts: noteAttempt(state.attempts, answerKey(next.verb, next.subject)), previous: next };
    }
    // Every question once before any repeat — guardrail 6 says a wrong answer
    // costs nothing, and being asked it again immediately is a cost.
    expect(served.slice(0, 3).sort()).toEqual(['blast-a', 'blast-b', 'blast-c']);
    expect(served[3]).toBe('blast-a');
  });

  it('keeps cycling instead of stalling when the whole deck has been failed', () => {
    let state = { answered: new Set<string>(), attempts: new Map<string, number>(), previous: null } as {
      answered: Set<string>;
      attempts: Map<string, number>;
      previous: Challenge | null;
    };
    const served: string[] = [];
    for (let i = 0; i < 9; i++) {
      const next = suggestNext(deck, regionOf, state);
      expect(next).not.toBeNull();
      if (next === null) break;
      served.push(next.id);
      state = { ...state, attempts: noteAttempt(state.attempts, answerKey(next.verb, next.subject)), previous: next };
    }
    // Three passes over three questions, evenly — not one question nine times.
    for (const name of ['blast-a', 'blast-b', 'blast-c']) {
      expect(served.filter((entry) => entry === name)).toHaveLength(3);
    }
  });

  it('prefers an untried question to an easier one already failed', () => {
    const state = {
      answered: new Set<string>(),
      attempts: noteAttempt(new Map(), answerKey('blastRadius', id(1))),
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
      answered: new Set([answerKey('blastRadius', id(1))]),
      attempts: noteAttempt(new Map(), answerKey('blastRadius', id(3))),
      previous,
    });
    expect(next?.id).toBe('blast-fresh');
    regions.clear();
  });
});

describe('the tour does not open with the boards the map already answers', () => {
  /**
   * **Hovering a node paints gold lines to every direct importer** (ADR-0008
   * decision 1, on purpose), so a board whose truth *is* that set is answerable
   * by pointing. Measured across four repos, such boards are 8–24% of the Blast
   * Radius deck and **every one of them is among the ten easiest** — so ascending
   * difficulty served a newcomer's entire first session from exactly that set. A
   * cold playtester found it and called it the difference between a first session
   * that teaches the graph and one that teaches you to point at it.
   *
   * `gate.ts` declines to *refuse* this guess, for a stated reason: §8.4 already
   * prices it and the progression needs easy rungs. So this asserts the fix that
   * was taken — the order — and not the one that was not.
   */
  const atlas = atlasWith(
    ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts', 'src/f.ts'],
    [],
  );
  const easyButNaive = challengeFor(atlas, {
    id: 'blast-naive',
    difficulty: 0.03,
    subject: nodeIdFor('src/a.ts'),
    candidates: ['src/b.ts', 'src/c.ts', 'src/d.ts'].map(nodeIdFor).sort(),
    truth: [nodeIdFor('src/b.ts')],
  });
  const harder = challengeFor(atlas, {
    id: 'blast-real',
    difficulty: 0.61,
    subject: nodeIdFor('src/e.ts'),
    candidates: ['src/b.ts', 'src/c.ts', 'src/d.ts'].map(nodeIdFor).sort(),
    truth: [nodeIdFor('src/c.ts')],
  });
  const deck = [easyButNaive, harder];
  const anywhere = (): string | null => null;

  it('offers the board the map cannot answer first, even though it is harder', () => {
    const picked = suggestNext(deck, anywhere, NO_HISTORY, new Set(['blast-naive']));
    expect(picked?.id).toBe('blast-real');
  });

  it('still offers it once nothing else is left — the deck is not narrowed', () => {
    // The boards are legitimately easy questions and `gate.ts` keeps them; what
    // changed is when they are served. Withdrawing them instead would be the
    // refusal that document declines to make.
    const state = { ...NO_HISTORY, answered: new Set([answerKey('blastRadius', harder.subject)]) };
    const picked = suggestNext(deck, anywhere, state, new Set(['blast-naive']));
    expect(picked?.id).toBe('blast-naive');
  });

  it('orders by difficulty as before when neither is map-answerable', () => {
    // The control: without the set, ascending difficulty is unchanged, so this
    // ranking term cannot be quietly reordering everything else.
    const picked = suggestNext(deck, anywhere, NO_HISTORY, new Set());
    expect(picked?.id).toBe('blast-naive');
  });
});

describe('a board whose attempt is spent sinks to the back of the tour', () => {
  /**
   * **The guide's outermost rank key is `attempts`, and since ADR-0035 §10 a
   * board graded once can never be passed again.** So a restored session whose
   * counts start at zero opens by offering the one question in the deck with
   * nothing left to give — and it is not a small effect, because *fewest
   * attempts* beats the region constraint, the tier and the difficulty all at
   * once.
   *
   * `main.ts` seeds `attempts` from `progress.attempted` at load, which is what
   * these assert as a property of the ranking. Seeding is not the stored cursor
   * ADR-0011 decision 2 forbids: a cursor is a position in the rotation, and this
   * is the record telling the ranking a fact the record already keeps.
   */
  const atlas = atlasWith(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'], []);
  const spentBoard = challengeFor(atlas, {
    id: 'blast-spent',
    difficulty: 0.05,
    subject: nodeIdFor('src/a.ts'),
    candidates: ['src/b.ts', 'src/c.ts', 'src/d.ts'].map(nodeIdFor).sort(),
    truth: [nodeIdFor('src/b.ts')],
  });
  const freshBoard = challengeFor(atlas, {
    id: 'blast-fresh-board',
    difficulty: 0.9,
    subject: nodeIdFor('src/c.ts'),
    candidates: ['src/b.ts', 'src/d.ts'].map(nodeIdFor).sort(),
    truth: [nodeIdFor('src/d.ts')],
  });
  const deck = [spentBoard, freshBoard];
  const anywhere = (): string | null => null;
  /** What `main.ts` builds at load: every spent key at 1. */
  const seeded = (keys: readonly string[]): ReadonlyMap<string, number> =>
    new Map(keys.map((key) => [key, 1]));

  it('offers the fresh board first, even though it is much harder', () => {
    const state = {
      ...NO_HISTORY,
      attempts: seeded([answerKey('blastRadius', spentBoard.subject)]),
    };
    expect(suggestNext(deck, anywhere, state)?.id).toBe('blast-fresh-board');
  });

  it('offers the spent board once nothing fresh is left — it is not withdrawn', () => {
    // Guardrail 6: the board is not locked, it is last. Everything except the
    // notebook entry still fires on it, and the reveal is the best thing in the
    // product.
    const state = {
      ...NO_HISTORY,
      answered: new Set([answerKey('blastRadius', freshBoard.subject)]),
      attempts: seeded([answerKey('blastRadius', spentBoard.subject)]),
    };
    expect(suggestNext(deck, anywhere, state)?.id).toBe('blast-spent');
  });

  it('orders by difficulty when nothing is spent — the control', () => {
    // Without this the assertion above would pass on the difficulty ordering
    // alone, and nothing here would be about seeding at all.
    expect(suggestNext(deck, anywhere, NO_HISTORY)?.id).toBe('blast-spent');
  });
});
