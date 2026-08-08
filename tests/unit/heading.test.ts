/**
 * The turn between challenges.
 *
 * The assertions that matter here are about the *schedule*, not the arithmetic:
 * a step that closes into a cycle hands the player back the north-up alignment
 * the feature exists to break, and a step that can be zero skips the
 * intervention entirely while the animation still runs. Both were measured on
 * this repo's deck before the constant was chosen (ADR-0017), and both are
 * pinned below so a later session cannot round 137.5° to 135° and keep the
 * suite green.
 */

import { describe, expect, it } from 'vitest';

import { GOLDEN_TURN, TURN_MS, bearingDuring, easeTurn } from '../../src/player/heading.js';

const TAU = Math.PI * 2;
const DEG = 180 / Math.PI;

/** Shortest angle between two headings, in degrees, 0..180. */
function apart(a: number, b: number): number {
  const d = Math.abs((((a - b) % TAU) + TAU) % TAU);
  return Math.min(d, TAU - d) * DEG;
}

/** The headings a player is served over a full clear of this repo's deck. */
const SESSION = Array.from({ length: 80 }, (_, i) => (i + 1) * GOLDEN_TURN);

describe('the schedule', () => {
  it('always turns, and always turns a long way', () => {
    // A hashed heading — the rejected alternative — collided on consecutive
    // grades 14 times in 80 on this deck, so the console closed, the animation
    // ran, and the map did not move. A fixed step cannot do that.
    let previous = 0;
    for (const bearing of SESSION) {
      expect(apart(bearing, previous)).toBeGreaterThan(137);
      previous = bearing;
    }
  });

  it('never comes back to a heading it has already used', () => {
    // The property that rules out every round number. A step of 135° — three
    // eighths of a turn, the reviewed alternative — is a *closed cycle*: it
    // visits eight headings and then repeats them, so 10 of these 80 questions
    // would be answered from exactly north-up, which is the alignment the whole
    // feature is trying to stop being the only one the player has.
    for (let i = 0; i < SESSION.length; i++) {
      for (let j = i + 1; j < SESSION.length; j++) {
        expect(apart(SESSION[i] ?? 0, SESSION[j] ?? 0)).toBeGreaterThan(2);
      }
    }
  });

  it('never lands back on north during a full clear of this repo', () => {
    // The same claim from the player's side, and the one a cycle fails first.
    for (const bearing of SESSION) expect(apart(bearing, 0)).toBeGreaterThan(2);
  });

  it('spreads over the whole circle rather than favouring a quadrant', () => {
    // Orientation-flexible knowledge needs orientations, plural and everywhere.
    // Twelve 30° buckets, all occupied within a deck this size.
    const buckets = new Set(SESSION.map((b) => Math.floor(((((b % TAU) + TAU) % TAU) * DEG) / 30)));
    expect(buckets.size).toBe(12);
  });
});

describe('easeTurn', () => {
  it('starts still, ends still, and clamps outside the turn', () => {
    expect(easeTurn(0)).toBe(0);
    expect(easeTurn(1)).toBe(1);
    expect(easeTurn(-3)).toBe(0);
    expect(easeTurn(9)).toBe(1);
    expect(easeTurn(0.5)).toBeCloseTo(0.5, 12);
  });

  it('never goes backwards', () => {
    let previous = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const eased = easeTurn(t);
      expect(eased).toBeGreaterThanOrEqual(previous);
      previous = eased;
    }
  });
});

describe('bearingDuring', () => {
  it('leaves from where the map was and arrives where it was sent', () => {
    expect(bearingDuring(1, 1 + GOLDEN_TURN, 0, TURN_MS)).toBe(1);
    expect(bearingDuring(1, 1 + GOLDEN_TURN, TURN_MS, TURN_MS)).toBe(1 + GOLDEN_TURN);
    expect(bearingDuring(1, 1 + GOLDEN_TURN, TURN_MS * 4, TURN_MS)).toBe(1 + GOLDEN_TURN);
  });

  it('goes the way it was pointed, not the way round', () => {
    // The caller picks the direction by choosing `to` — `facingNorth` returns
    // the near multiple of a full turn for exactly this reason — and this must
    // never re-derive a shortest path of its own.
    const from = 7.9;
    const home = TAU;
    for (const elapsed of [0, 100, 300, 620]) {
      const at = bearingDuring(from, home, elapsed, TURN_MS);
      expect(at).toBeLessThanOrEqual(from + 1e-12);
      expect(at).toBeGreaterThanOrEqual(home - 1e-12);
    }
  });

  it('arrives immediately when there is to be no motion', () => {
    // `prefers-reduced-motion`: the map still ends up where the next question
    // is asked from, it just does not spin to get there.
    expect(bearingDuring(0, GOLDEN_TURN, 0, 0)).toBe(GOLDEN_TURN);
  });

  it('eases rather than sweeping at a constant rate', () => {
    // Without this the interpolation can be linear and `easeTurn` becomes a
    // tested function the product never calls — the machinery-that-never-fires
    // landmine, arriving through the back door of a helper that looks used.
    // Smoothstep is behind a linear ramp early and ahead of it late.
    const quarter = bearingDuring(0, 1, TURN_MS * 0.25, TURN_MS);
    const threeQuarters = bearingDuring(0, 1, TURN_MS * 0.75, TURN_MS);
    expect(quarter).toBeLessThan(0.25);
    expect(threeQuarters).toBeGreaterThan(0.75);
    // ...and symmetric about the middle, which is what makes it read as one
    // movement rather than as a start and a separate stop.
    expect(quarter + threeQuarters).toBeCloseTo(1, 9);
  });

  it('is monotone through the turn', () => {
    let previous = -Infinity;
    for (let elapsed = 0; elapsed <= TURN_MS; elapsed += 40) {
      const at = bearingDuring(0, GOLDEN_TURN, elapsed, TURN_MS);
      expect(at).toBeGreaterThanOrEqual(previous);
      previous = at;
    }
  });
});
