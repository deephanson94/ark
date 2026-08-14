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
import { NO_HISTORY, isSideshow, noteAttempt, noteSkip, suggestNext } from '../../src/player/selector.js';
import { answerKey } from '../../src/player/progress.js';
import { witnessFor } from '../fixtures/atlas.js';

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

/** The same, in a second verb — the two decks' difficulty scales differ. */
function other(spec: Spec): Challenge {
  return { ...challenge(spec), id: `comp-${spec.name}`, verb: 'companion' };
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

describe('the progression band — each verb through its own range', () => {
  /**
   * **The defect this term exists for.** §8.4 computes difficulty from each
   * verb's own inputs, so the numbers are not commensurable: on hono, Blast
   * Radius spans 0.03–0.94 and Companion 0.49–0.96. Ranked on the raw number,
   * every Blast Radius board below 0.49 is served before the first Companion
   * one — a player met the second verb at board 25 there, 19 on graphql-js and
   * 17 on this repo, so a first session never reached the git-graded half of
   * the product at all.
   */
  it('interleaves two verbs whose difficulty scales do not overlap', () => {
    const deck: Challenge[] = [];
    for (let i = 0; i < 10; i++) {
      deck.push(challenge({ name: `b${i}`, subject: 100 + i, truth: [10 + i], difficulty: 0.03 + i * 0.09 }));
      deck.push(other({ name: `c${i}`, subject: 200 + i, truth: [20 + i], difficulty: 0.49 + i * 0.04 }));
    }
    const served: string[] = [];
    const answered = new Set<string>();
    let previous: Challenge | null = null;
    for (let n = 0; n < 6; n++) {
      const next = suggestNext(deck, regionOf, { ...NO_HISTORY, answered, previous });
      if (next === null) break;
      served.push(next.verb);
      answered.add(answerKey(next.verb, next.subject));
      previous = next;
    }
    // Both verbs inside the first six boards, rather than one verb's whole
    // easy tail first. Ranked on raw difficulty this is six blastRadius.
    expect(new Set(served).size).toBe(2);
    expect(served.filter((v) => v === 'companion').length).toBeGreaterThanOrEqual(2);
  });

  /**
   * **The band is over ties, not over positions**, and this is the assertion
   * that separates the two. The first implementation banded by *sorted index*,
   * which gives two equally-hard questions different bands according to the
   * byte order of their ids — so everything below the band in the rank became
   * unreachable between challenges of one verb, and the `overlap` term above
   * silently stopped deciding anything.
   */
  it('gives equally hard questions the same band, whatever their ids', () => {
    const first = challenge({ name: 'first', subject: 1, truth: [10, 11], difficulty: 0.2 });
    const twin = challenge({ name: 'a-twin', subject: 2, truth: [10, 11], difficulty: 0.2 });
    const fresh = challenge({ name: 'z-fresh', subject: 3, truth: [13, 14], difficulty: 0.2 });
    // `a-twin` sorts first by id and repeats the whole key. Only an equal band
    // lets the overlap term below reach it.
    const next = suggestNext([first, twin, fresh], regionOf, { ...NO_HISTORY, previous: first });
    expect(next?.id).toBe('blast-z-fresh');
  });

  it('is a property of the whole deck, not of what is left', () => {
    // **Recomputed over the unanswered remainder, a verb re-scales as it is
    // cleared** — a small deck's last board becomes "the easiest remaining" and
    // jumps to the front however hard it is. The first draft of this test
    // asserted ascending difficulty over one verb, which is true either way; it
    // survived the mutant and was checking nothing.
    const deck: Challenge[] = [];
    for (let i = 0; i < 20; i++) {
      deck.push(challenge({ name: `a${String(i).padStart(2, '0')}`, subject: 100 + i, truth: [10 + i], difficulty: 0.1 + i * 0.025 }));
    }
    // Two boards only, one easy and one the hardest thing in the deck.
    deck.push(other({ name: 'b-easy', subject: 300, truth: [50], difficulty: 0.5 }));
    deck.push(other({ name: 'b-hard', subject: 301, truth: [51], difficulty: 0.9 }));

    // **`verbRun` is held at 0 deliberately, and saying so is the point.** This
    // test is about `withinVerbRank` and nothing else; with the run tracked,
    // `sameVerb` also decides and the assertion below would be measuring two
    // rules at once — which is how a test comes to pass for a reason nobody
    // wrote down. The interaction has its own test in "varying the verb".
    const served: string[] = [];
    const answered = new Set<string>();
    let previous: Challenge | null = null;
    for (let n = 0; n < 8; n++) {
      const next = suggestNext(deck, regionOf, { ...NO_HISTORY, answered, previous });
      if (next === null) break;
      served.push(next.id);
      answered.add(answerKey(next.verb, next.subject));
      previous = next;
    }
    expect(served).toContain('comp-b-easy');
    // Its partner is the hardest board in the deck and belongs late. Banded
    // over the remainder it is the only companion board left the moment
    // `b-easy` is answered, so it re-enters band 0 and is served next.
    expect(served).not.toContain('comp-b-hard');
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
      skipped: new Set<string>(), verbRun: 0, previous: failed,
    };
    expect(suggestNext(deck, regionOf, state)?.id).toBe('blast-b');
  });

  it('comes back to it only after the rest of the deck', () => {
    let state = { answered: new Set<string>(), attempts: new Map<string, number>(), skipped: new Set<string>(), verbRun: 0, previous: null } as {
      answered: Set<string>;
      attempts: Map<string, number>;
      skipped: Set<string>;
      verbRun: number;
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
    let state = { answered: new Set<string>(), attempts: new Map<string, number>(), skipped: new Set<string>(), verbRun: 0, previous: null } as {
      answered: Set<string>;
      attempts: Map<string, number>;
      skipped: Set<string>;
      verbRun: number;
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
      skipped: new Set<string>(), verbRun: 0, previous: null,
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
      skipped: new Set<string>(),
      verbRun: 0,
      previous,
    });
    expect(next?.id).toBe('blast-fresh');
    regions.clear();
  });
});

describe('the opening', () => {
  // ADR-0046. A cold player was opened on `benchmarks/jsx/src/preact.ts` and
  // `keys.test.json` on hono, and on three `__testUtils__` files on graphql-js,
  // because §8.4 makes a *real* subject a hard question — so Blast Radius's easy
  // end is by construction its peripheral end. The rank demotes those.
  const paths = new Map<string, string>();
  const pathOf = (subject: string): string | null => paths.get(subject) ?? null;

  it('knows a sideshow path from a source one', () => {
    for (const path of [
      'tests/unit/thing.test.ts',
      'src/thing.test.ts',
      '__tests__/helper.ts',
      'src/__testUtils__/kitchenSink.ts',
      'benchmarks/jsx/src/preact.ts',
      'scripts/probe-thing.ts',
      'example/src/util/errors.ts',
      'package.json',
      'src/middleware/jwk/keys.test.json',
      // Rule-grade, added after eight more repos: a Markdown file is not a
      // module, and `testdata` is a directory name the Go toolchain reserves.
      'README.md',
      'docs/decisions/0046-the-opening.md',
      'web/ui/__testdata__/testdata.ts',
    ]) {
      expect(isSideshow(path), path).toBe(true);
    }
    for (const path of [
      'src/indexer/build.ts',
      'src/player/main.ts',
      'src/error/GraphQLError.ts',
      // **The near-misses, and they are the point of a list.** A source file
      // whose name merely contains a listed word is not a sideshow; only a whole
      // path segment counts. `contest`/`scripting` are what a substring match
      // gets wrong, and the first draft of this regex did.
      'src/contest/rules.ts',
      'src/scripting/engine.ts',
      'src/testing.ts',
      'src/examples.ts',
      'src/testdata-loader.ts',
      'src/markdown.ts',
    ]) {
      expect(isSideshow(path), path).toBe(false);
    }
    // A commit subject has no path. Not a sideshow — it has nothing to match.
    expect(isSideshow(null)).toBe(false);
  });

  it('serves a real module before a fixture of the same difficulty', () => {
    paths.clear();
    paths.set(id(1), 'src/__testUtils__/kitchenSink.ts');
    paths.set(id(2), 'src/error/GraphQLError.ts');
    const fixture = challenge({ name: 'aaa-fixture', subject: 1, truth: [10], difficulty: 0.1 });
    const real = challenge({ name: 'zzz-real', subject: 2, truth: [11], difficulty: 0.1 });
    // Identical difficulty and the fixture wins the id tie-break, so without the
    // term it is served first — which is the assertion this has to fail without.
    expect(suggestNext([fixture, real], regionOf, NO_HISTORY)?.id).toBe('blast-aaa-fixture');
    expect(suggestNext([fixture, real], regionOf, NO_HISTORY, pathOf)?.id).toBe('blast-zzz-real');
    paths.clear();
  });

  it('serves a real module before an easier fixture, which is why it sits above progress', () => {
    // **The placement, pinned.** Below `progress` the term can only reorder
    // within a difficulty band, and Blast Radius's band 0 is entirely sideshow on
    // graphql-js — so it moved 8 of 15 junk openings to 8 of 15. Above it, 0 of
    // 15 on all four measured repos. Here: the fixture is *easier*, so anything
    // ranked below difficulty or below `progress` serves it first.
    paths.clear();
    paths.set(id(1), 'benchmarks/jsx/src/preact.ts');
    paths.set(id(2), 'src/utils/http-status.ts');
    const easyFixture = challenge({ name: 'fixture', subject: 1, truth: [10], difficulty: 0.05 });
    const harderReal = challenge({ name: 'real', subject: 2, truth: [11], difficulty: 0.60 });
    expect(suggestNext([easyFixture, harderReal], regionOf, NO_HISTORY, pathOf)?.id).toBe('blast-real');
    paths.clear();
  });

  it('demotes and never refuses — the whole deck is still served', () => {
    // What makes a path *list* acceptable in the product at all (ADR-0025's
    // whitelist landmine): a missing pattern costs one junk board served early,
    // and an over-firing one costs a good board served late. Nothing is lost, so
    // the deck a player can finish is unchanged.
    paths.clear();
    paths.set(id(1), 'tests/unit/a.test.ts');
    paths.set(id(2), 'tests/unit/b.test.ts');
    const deck = [
      challenge({ name: 'a', subject: 1, truth: [10] }),
      challenge({ name: 'b', subject: 2, truth: [11] }),
    ];
    const answered = new Set<string>();
    const served: string[] = [];
    for (let step = 0; step < deck.length; step += 1) {
      const next = suggestNext(deck, regionOf, { answered, attempts: new Map(), skipped: new Set(), verbRun: 0, previous: null }, pathOf);
      expect(next).not.toBeNull();
      if (next === null) break;
      served.push(next.id);
      answered.add(answerKey(next.verb, next.subject));
    }
    expect(served.sort()).toEqual(['blast-a', 'blast-b']);
    paths.clear();
  });

  it('leaves the rank exactly as it was when no path is supplied', () => {
    // The default argument is what keeps every other test in this file a test of
    // the rank it was written for, rather than of this term silently.
    paths.clear();
    paths.set(id(1), 'tests/unit/a.test.ts');
    const deck = [
      challenge({ name: 'aaa', subject: 1, truth: [10], difficulty: 0.1 }),
      challenge({ name: 'zzz', subject: 2, truth: [11], difficulty: 0.1 }),
    ];
    expect(suggestNext(deck, regionOf, NO_HISTORY)?.id).toBe('blast-aaa');
    paths.clear();
  });
});

/**
 * Skipping a suggestion, and the one rule that keeps it from being a lockout.
 *
 * A cold playtester's first three suggestions were the same shape and there was
 * no way past them but to answer one — *"Where next?"* offered exactly one next.
 * The board is never removed: it keeps its rank and returns when the list
 * clears, which is what makes this a preference rather than a refusal.
 */
describe('skipping a suggestion', () => {
  const deck = [
    challenge({ name: 'a', subject: 1, truth: [11], difficulty: 0.2 }),
    challenge({ name: 'b', subject: 2, truth: [12], difficulty: 0.5 }),
  ];
  const keyOf = (board: Challenge): string => answerKey(board.verb, board.subject);
  const all = deck.map(keyOf);

  it('offers a different board once one is waved away', () => {
    const first = suggestNext(deck, regionOf, NO_HISTORY);
    if (first === null) throw new Error('the fixture served nothing');
    const state = { ...NO_HISTORY, skipped: noteSkip(new Set(), keyOf(first), all) };
    const second = suggestNext(deck, regionOf, state);
    expect(second).not.toBeNull();
    expect(second?.id).not.toBe(first.id);
  });

  it('clears the list rather than run the deck to empty', () => {
    // **The rule that matters.** Without it, skipping the last unanswered board
    // leaves `suggestNext` returning null over a deck that is not finished — the
    // guide then says "every question answered" and the HUD says "158 left",
    // which is the count-of-zero landmine with a third cause for the same
    // number. Guardrail 6's spirit: nothing the player does to a board takes it
    // away from them.
    let skipped = new Set<string>();
    for (const board of deck) skipped = noteSkip(skipped, keyOf(board), all);
    expect(skipped.size).toBe(0);
    expect(suggestNext(deck, regionOf, { ...NO_HISTORY, skipped })).not.toBeNull();
  });

  it('only counts what is left unanswered towards clearing', () => {
    // The remaining set is the *unanswered* boards, so skipping the one open
    // board clears the list even though the deck holds an answered one too —
    // otherwise the player is stuck exactly when there is least to do.
    const answered = new Set([keyOf(deck[0] as Challenge)]);
    const open = all.filter((key) => !answered.has(key));
    const skipped = noteSkip(new Set(), keyOf(deck[1] as Challenge), open);
    expect(skipped.size).toBe(0);
  });
});

/**
 * Breaking a run of one verb, without overriding the progression.
 *
 * A cold playtester said the first three boards were the same shape. Measured
 * (`npx tsx scripts/probe-opening.ts`) the longest same-verb run in the first
 * fifteen was **3** here, 4 on hono and kysely and **5** on graphql-js.
 */
describe('varying the verb', () => {
  const run = (deck: readonly Challenge[], n: number): string[] => {
    const served: string[] = [];
    let state = NO_HISTORY;
    for (let i = 0; i < n; i += 1) {
      const next = suggestNext(deck, regionOf, state);
      if (next === null) break;
      served.push(next.verb);
      state = {
        ...state,
        answered: new Set([...state.answered, answerKey(next.verb, next.subject)]),
        verbRun: state.previous !== null && state.previous.verb === next.verb ? state.verbRun + 1 : 1,
        previous: next,
      };
    }
    return served;
  };

  it('never serves three of one verb in a row while another has supply', () => {
    // **The fixture has to be one that *would* run, or this passes vacuously.**
    // The first draft gave both verbs matched difficulties, which alternate on
    // their own through `progress` and the raw-difficulty tie-break — so
    // deleting `sameVerb` changed nothing and the assertion was decoration.
    // Two drafts failed before this one, and both failed the same way:
    // `withinVerbRank` normalises each verb to *its own* range, so two verbs
    // with the same number of boards land on the same bands and alternate
    // through `progress` no matter what their raw difficulties are. Making one
    // verb uniformly cheaper does not help either — the band still comes first.
    //
    // What produces a run is **unequal supply**, which is the shape a real repo
    // has: with twelve boards against three, the many-verb's bands are 0.09
    // apart and the few-verb's are 0.5 apart, so six of the first fall between
    // each pair of the second. Measured, ark opened `blastRadius blastRadius
    // blastRadius` and graphql-js ran **five**.
    const deck: Challenge[] = [];
    for (let i = 0; i < 12; i += 1) {
      deck.push(challenge({ name: `a${String(i).padStart(2, '0')}`, subject: 100 + i, truth: [10 + i], difficulty: 0.1 + i * 0.05 }));
    }
    for (let i = 0; i < 3; i += 1) {
      deck.push(other({ name: `b${i}`, subject: 200 + i, truth: [30 + i], difficulty: 0.2 + i * 0.3 }));
    }
    const verbs = run(deck, 12);
    expect(verbs.length).toBe(12);
    // **Only while the other verb has supply**, which is what the title says and
    // what the term promises: once the three companion boards are spent every
    // remaining board scores 1 and `sameVerb` goes inert by design. Measuring
    // the whole twelve would be asserting that the term does something it
    // explicitly does not, and a first draft did exactly that and went red.
    const lastOther = verbs.lastIndexOf('companion');
    expect(lastOther).toBeGreaterThan(0);
    let longest = 1;
    let current = 1;
    for (let i = 1; i <= lastOther; i += 1) {
      current = verbs[i] === verbs[i - 1] ? current + 1 : 1;
      longest = Math.max(longest, current);
    }
    expect(longest, `served ${verbs.join(' ')}`).toBeLessThanOrEqual(2);
  });

  it('allows a pair, and does not spend a starved verb in the first three', () => {
    // **The cost of forbidding *any* repeat, measured on a fixture rather than
    // argued — and the residue, stated rather than hidden.** With only two
    // boards of the second verb against twenty of the first, strict alternation
    // serves both immediately and the hardest board in the whole deck arrives
    // **third**. A cap of two pushes it to sixth. It does still arrive earlier
    // than banding alone would put it, because `sameVerb` outranks `progress`
    // by construction: on a starved verb, "vary the tour" and "ascend the
    // range" genuinely conflict and this rank resolves it towards variety.
    //
    // No measured repo looks like this fixture — 20 against 2 — and on the four
    // that were measured every opening is a real module in ascending bands. The
    // fixture is here to show the shape of the trade, not to claim there isn't
    // one.
    const deck: Challenge[] = [];
    for (let i = 0; i < 20; i += 1) {
      deck.push(challenge({ name: `a${String(i).padStart(2, '0')}`, subject: 100 + i, truth: [10 + i], difficulty: 0.1 + i * 0.025 }));
    }
    deck.push(other({ name: 'b-easy', subject: 300, truth: [50], difficulty: 0.5 }));
    deck.push(other({ name: 'b-hard', subject: 301, truth: [51], difficulty: 0.9 }));
    const served: string[] = [];
    let state = NO_HISTORY;
    for (let i = 0; i < 8; i += 1) {
      const next = suggestNext(deck, regionOf, state);
      if (next === null) break;
      served.push(next.id);
      state = {
        ...state,
        answered: new Set([...state.answered, answerKey(next.verb, next.subject)]),
        verbRun: state.previous !== null && state.previous.verb === next.verb ? state.verbRun + 1 : 1,
        previous: next,
      };
    }
    // The easy one first, always — which is the half of the progression that
    // survives, and the half a starved deck can still honour.
    expect(served.indexOf('comp-b-easy')).toBeGreaterThanOrEqual(0);
    expect(served.indexOf('comp-b-easy')).toBeLessThan(served.indexOf('comp-b-hard'));
    expect(served.slice(0, 3)).not.toContain('comp-b-hard');
  });

  it('goes inert when only one verb has anything left', () => {
    // Self-limiting: every remaining board scores 1, so the term stops
    // discriminating rather than refusing to serve. It can never shorten a deck.
    const deck = [
      challenge({ name: 'a0', subject: 100, truth: [10], difficulty: 0.2 }),
      challenge({ name: 'a1', subject: 101, truth: [11], difficulty: 0.4 }),
      challenge({ name: 'a2', subject: 102, truth: [12], difficulty: 0.6 }),
    ];
    expect(run(deck, 3)).toHaveLength(3);
  });
});
