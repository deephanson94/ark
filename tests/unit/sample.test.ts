/**
 * `src/verbs/sample.ts` — `spread` and `retain`, the two functions that decide
 * which questions survive a cap.
 *
 * **There were no tests here.** `retain` decides which subjects a repo's whole
 * deck is spent on, the cap bites on every repo measured, and nothing asserted
 * anything about it — which is how it came to spend hono's 54 Blast Radius slots
 * without giving `src/context.ts` (76 importers) or `src/hono.ts` (72) a board.
 */

import { describe, expect, it } from 'vitest';

import type { Challenge } from '../../src/atlas/index.js';
import { retain, spread } from '../../src/verbs/sample.js';

/** Just enough of an entry: `retain` reads only `difficulty` and `id`. */
function entry(id: string, difficulty: number, weight = 0): { challenge: Challenge; weight: number } {
  return { challenge: { id, difficulty } as Challenge, weight };
}
const weightOf = (e: { weight: number }): number => e.weight;

describe('retain', () => {
  it('keeps everything when the cap does not bite', () => {
    const all = [entry('a', 0.1), entry('b', 0.9)];
    expect(retain(all, 5, weightOf)).toEqual(all);
    expect(retain(all, 2, weightOf)).toEqual(all);
  });

  it('returns exactly `max` distinct entries', () => {
    const pool = Array.from({ length: 97 }, (_, i) => entry(`c${String(i).padStart(3, '0')}`, i / 97));
    for (const max of [1, 2, 7, 40, 96]) {
      const kept = retain(pool, max, weightOf);
      expect(kept).toHaveLength(max);
      expect(new Set(kept.map((k) => k.challenge.id)).size).toBe(max);
    }
  });

  it('keeps the difficulty range — both ends survive the cut', () => {
    // This is the property the function existed for before importance was added,
    // and the one most at risk from changing how a band is picked.
    const pool = Array.from({ length: 200 }, (_, i) => entry(`c${String(i).padStart(3, '0')}`, i / 200));
    const kept = retain(pool, 10, weightOf);
    const difficulties = kept.map((k) => k.challenge.difficulty);
    expect(Math.min(...difficulties)).toBeLessThan(0.05);
    expect(Math.max(...difficulties)).toBeGreaterThan(0.95);
    // …and it is spread rather than clustered: ten bands over 200 entries means
    // consecutive picks about 0.1 apart.
    const sorted = [...difficulties].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      expect((sorted[i] as number) - (sorted[i - 1] as number)).toBeGreaterThan(0.05);
    }
  });

  /**
   * **The rule this function was changed for.** Within a band the most
   * load-bearing subject wins, so the deck's slots go to the files a player is
   * most likely to click rather than to whichever entry landed on a computed
   * index.
   */
  it('spends each band on its most important entry', () => {
    // Four bands of three. The important entry sits at a different offset in
    // each band, so a rule that took a fixed index could not pass by luck.
    const pool = [
      entry('a0', 0.10, 0), entry('a1', 0.11, 9), entry('a2', 0.12, 0),
      entry('b0', 0.20, 7), entry('b1', 0.21, 0), entry('b2', 0.22, 0),
      entry('c0', 0.30, 0), entry('c1', 0.31, 0), entry('c2', 0.32, 5),
      entry('d0', 0.40, 0), entry('d1', 0.41, 3), entry('d2', 0.42, 0),
    ];
    expect(retain(pool, 4, weightOf).map((k) => k.challenge.id)).toEqual(['a1', 'b0', 'c2', 'd1']);
  });

  /**
   * The tiebreak is three-deep — importance, then distance to the band's
   * anchor, then id — and the middle step is the one a reader will not expect,
   * so both of the steps below it are asserted separately.
   */
  it('breaks a tie on the band anchor before the id, which is what preserves the range', () => {
    const pool = [
      entry('z', 0.1, 5), entry('a', 0.11, 5), entry('m', 0.12, 5),
      entry('q', 0.2, 1), entry('b', 0.21, 1), entry('n', 0.22, 1),
    ];
    // Equal weight inside each band, so the anchors decide: band 0's is its
    // first entry and band 1's is its last. Falling through to the lowest id
    // here would give ['a', 'b'] and drop both ends of the difficulty range.
    expect(retain(pool, 2, weightOf).map((k) => k.challenge.id)).toEqual(['z', 'n']);
  });

  it('breaks a tie on the challenge id when two entries are equidistant from the anchor', () => {
    // Nine entries in three bands puts band 1's anchor at its middle member, so
    // starving that member leaves its two neighbours equally distant and only
    // the id can separate them.
    const pool = [
      entry('a0', 0.10, 1), entry('a1', 0.11, 1), entry('a2', 0.12, 1),
      entry('zz', 0.20, 5), entry('b1', 0.21, 0), entry('bb', 0.22, 5),
      entry('c0', 0.30, 1), entry('c1', 0.31, 1), entry('c2', 0.32, 1),
    ];
    expect(retain(pool, 3, weightOf)[1]?.challenge.id).toBe('bb');
  });

  /**
   * **Flat importance must reproduce the previous deck exactly**, not
   * approximately — that is what makes this a generalisation rather than a
   * replacement, and it is what the commit-subject verb relies on. The band
   * anchor is the old rule's index; without it the ends of the range were
   * silently dropped.
   */
  it('is the old even spread when importance is flat, ends included', () => {
    const pool = Array.from({ length: 9 }, (_, i) => entry(`c${String(i)}`, i / 9));
    expect(retain(pool, 3, () => 0).map((k) => k.challenge.id)).toEqual(['c0', 'c4', 'c8']);
    const big = Array.from({ length: 200 }, (_, i) => entry(`c${String(i).padStart(3, '0')}`, i / 200));
    const flat = retain(big, 10, () => 0).map((k) => k.challenge.difficulty);
    expect(Math.min(...flat)).toBe(0);
    expect(Math.max(...flat)).toBeCloseTo(199 / 200, 10);
  });

  /**
   * **The identity, over shapes rather than over two examples.** The first
   * version of the band rule spaced the *bands* evenly and clamped the old
   * rule's index into whichever band it fell outside — which reads as the same
   * thing and is not, because anchors are `(L−1)/(max−1)` apart and bands are
   * `L/max` wide, so the anchors drift forward and the last of them leave their
   * bands entirely. It cost 3 of hono's Placement boards and 7 of kysely's, and
   * the two hand-written examples above both passed while it was wrong. The
   * shapes below include the near-degenerate ratios where the drift is worst.
   */
  it('reproduces the previous rule exactly under flat importance, at every shape', () => {
    /** The rule as it stood at 46352f0, verbatim in behaviour. */
    const previous = (length: number, max: number): number[] => {
      const picked = new Set<number>();
      for (let i = 0; i < max; i++) picked.add(max === 1 ? 0 : Math.round((i * (length - 1)) / (max - 1)));
      for (let i = 0; picked.size < max && i < length; i++) picked.add(i);
      return [...picked].sort((a, b) => a - b);
    };
    for (const max of [1, 2, 3, 7, 10, 54, 75]) {
      for (const over of [1, 2, 3, 7, 40, 129, 300]) {
        const length = max + over;
        const pool = Array.from({ length }, (_, i) => entry(`c${String(i).padStart(4, '0')}`, i / length));
        expect(retain(pool, max, () => 0).map((k) => k.challenge.id)).toEqual(
          previous(length, max).map((i) => `c${String(i).padStart(4, '0')}`),
        );
      }
    }
  });
});

describe('spread', () => {
  it('keeps both ends and is a no-op when the sample is not smaller', () => {
    expect(spread([1, 2, 3], 5)).toEqual([1, 2, 3]);
    expect(spread([1, 2, 3, 4, 5], 3)).toEqual([1, 3, 5]);
    expect(spread([1, 2, 3, 4, 5], 1)).toEqual([1]);
  });
});
