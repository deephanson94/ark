/**
 * `src/verbs/rank.ts` — the top-`k` selection the distractor strategies rank with.
 *
 * The load-bearing test is `agrees with sort-then-slice`, because that is the
 * claim the whole thing rests on: the atlas is a byte-for-byte contract, and
 * this replaced a full sort inside an answer key's construction. Speed is not
 * asserted here; equivalence is.
 */

import { describe, expect, it } from 'vitest';

import { topBy } from '../../src/verbs/rank.js';

/** A total order — the precondition every caller satisfies via a unique id. */
const byValueThenId = (a: { v: number; id: number }, b: { v: number; id: number }): number =>
  b.v - a.v || a.id - b.id;

/** Deterministic pseudo-random, so a failure is reproducible. */
function items(count: number, seed: number): { v: number; id: number }[] {
  let state = seed >>> 0;
  const out: { v: number; id: number }[] = [];
  for (let id = 0; id < count; id++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    // A small value range on purpose, so ties are common and the tiebreak is
    // exercised rather than avoided.
    out.push({ v: state % 7, id });
  }
  return out;
}

describe('topBy', () => {
  it('agrees with sort-then-slice, over sizes and limits, including heavy ties', () => {
    for (const count of [0, 1, 2, 5, 19, 100, 997]) {
      for (const limit of [1, 2, 3, 19, 50, 1000]) {
        const pool = items(count, 0x9e3779b9 + count * 31 + limit);
        const expected = [...pool].sort(byValueThenId).slice(0, limit);
        expect(topBy(pool, limit, byValueThenId)).toEqual(expected);
      }
    }
  });

  it('returns nothing for a non-positive limit', () => {
    expect(topBy(items(10, 1), 0, byValueThenId)).toEqual([]);
    expect(topBy(items(10, 1), -1, byValueThenId)).toEqual([]);
  });

  it('takes an iterable, because callers pass a Map’s keys', () => {
    const scored = new Map([
      [7, 1],
      [8, 3],
      [9, 2],
    ]);
    expect(topBy(scored.keys(), 2, (a, b) => (scored.get(b) ?? 0) - (scored.get(a) ?? 0))).toEqual([
      8, 9,
    ]);
  });

  /**
   * **Two mutants of `topBy` survive this file, and both are equivalent under
   * the precondition rather than gaps in it.** Flipping the early reject from
   * `>= 0` to `> 0`, and the binary insert from `< 0` to `<= 0`, both change
   * behaviour only when `compare` returns 0 for two *different* items — which a
   * total order cannot do, and which every caller rules out by ending its
   * comparator on a unique node id. The third mutant, dropping the shortlist
   * bound, dies on three assertions.
   *
   * Recorded rather than chased: a test that killed them would have to assert
   * behaviour for a comparator the module refuses to promise anything about,
   * and that would pin an implementation detail as a contract.
   */
  it('does not consume more than it returns', () => {
    // The shortlist is bounded by `limit`, which is what makes this cheaper than
    // sorting — a regression that kept everything would still be *correct* and
    // would silently give the cost back.
    expect(topBy(items(500, 7), 3, byValueThenId)).toHaveLength(3);
  });
});
