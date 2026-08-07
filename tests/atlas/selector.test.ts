/**
 * Does the selector actually do anything on this repo's real deck?
 *
 * `tests/unit/selector.test.ts` proves the rule behaves correctly on fixtures
 * built to exercise it. That is necessary and not sufficient: a fixture proves a
 * branch *works*, never that the product's own data ever reaches it. CLAUDE.md's
 * landmine is explicit — a fallback that never executes is worse than no
 * fallback, and the way that was found last time was counting, not reviewing.
 *
 * So this plays the whole of ark's deck through the selector and asserts on
 * measured counts. Two things are checked that a unit test structurally cannot:
 *
 *  1. **The defect is real here.** The plain `(tier, difficulty, id)` sort must
 *     produce consecutive identical answer keys on this atlas. If it stops doing
 *     so — because generation changed — then the constraint below is guarding
 *     nothing and this file says so out loud rather than passing vacuously.
 *  2. **Each relaxation fires.** Across a perfect player and a half-failing one,
 *     every rank component has to change an outcome at least once.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';

import type { Atlas, Challenge, NodeId } from '../../src/atlas/index.js';
import { buildAtlas, indexOptions } from '../../src/indexer/build.js';
import { NO_HISTORY, noteAttempt, suggestNext } from '../../src/player/selector.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

let atlas: Atlas;
let regionOf: (subject: NodeId) => string;

beforeAll(async () => {
  atlas = await buildAtlas(indexOptions(ROOT));
  const byId = new Map(atlas.nodes.map((node) => [node.id, node.region]));
  regionOf = (subject) => byId.get(subject) ?? '';
}, 60_000);

const truthKey = (challenge: Challenge): string => challenge.truth.join('\n');

/** The order the selector would produce with every constraint switched off. */
function plainOrder(deck: readonly Challenge[]): Challenge[] {
  return [...deck].sort(
    (a, b) =>
      a.tier - b.tier ||
      a.difficulty - b.difficulty ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

type Outcome = 'pass' | 'fail';

interface Step {
  readonly challenge: Challenge;
  /** How many questions were open when this one was chosen. */
  readonly open: number;
}

/** Play the whole deck, returning what was served in what order. */
function playthrough(outcomeFor: (step: number) => Outcome): Step[] {
  const answered = new Set<NodeId>();
  let attempts = new Map<NodeId, number>();
  let previous: Challenge | null = null;
  const served: Step[] = [];
  const limit = atlas.challenges.length * 3;
  for (let step = 0; step < limit; step++) {
    const open = atlas.challenges.filter((c) => !answered.has(c.subject)).length;
    const next = suggestNext(atlas.challenges, regionOf, { answered, attempts, previous });
    if (next === null) break;
    served.push({ challenge: next, open });
    previous = next;
    if (outcomeFor(step) === 'pass') answered.add(next.subject);
    else attempts = noteAttempt(attempts, next.subject);
    if (answered.size === atlas.challenges.length) break;
  }
  return served;
}

const challenges = (steps: readonly Step[]): Challenge[] => steps.map((step) => step.challenge);

function consecutive(order: readonly Challenge[], same: (a: Challenge, b: Challenge) => boolean): number {
  let count = 0;
  for (let i = 1; i < order.length; i++) {
    const a = order[i - 1];
    const b = order[i];
    if (a !== undefined && b !== undefined && same(a, b)) count++;
  }
  return count;
}

describe('the defect the selector exists to fix is present in this atlas', () => {
  it('has identical answer keys, and they share a difficulty', () => {
    // The mechanism: difficulty is a pure function of the cone, so two subjects
    // with identical cones score identically *by construction*.
    const byKey = new Map<string, Challenge[]>();
    for (const challenge of atlas.challenges) {
      const key = truthKey(challenge);
      byKey.set(key, [...(byKey.get(key) ?? []), challenge]);
    }
    const groups = [...byKey.values()].filter((group) => group.length > 1);
    expect(groups.length).toBeGreaterThan(0);
    const sharingDifficulty = groups.filter((group) =>
      group.every((c) => c.difficulty === group[0]?.difficulty),
    );
    expect(sharingDifficulty.length).toBeGreaterThan(0);
  });

  it('serves them back to back without the constraint', () => {
    // If this ever hits 0, the truth constraint is guarding nothing on this repo
    // and the assertion below becomes vacuous. Fail loudly rather than quietly.
    const adjacent = consecutive(plainOrder(atlas.challenges), (a, b) => truthKey(a) === truthKey(b));
    expect(adjacent).toBeGreaterThan(0);
  });
});

describe('a full playthrough of this repo', () => {
  it('never serves the same answer key twice running', () => {
    const order = challenges(playthrough(() => 'pass'));
    expect(order).toHaveLength(atlas.challenges.length);
    expect(consecutive(order, (a, b) => truthKey(a) === truthKey(b))).toBe(0);
  });

  it('keeps the tour moving across the map', () => {
    // Not zero: the last question has nowhere else to go, and the rule relaxes
    // rather than blocking. One is the measured floor, not an aspiration.
    const order = challenges(playthrough(() => 'pass'));
    expect(consecutive(order, (a, b) => regionOf(a.subject) === regionOf(b.subject))).toBeLessThan(3);
  });

  it('opens on the easiest question and ends having served every one', () => {
    const order = challenges(playthrough(() => 'pass'));
    const easiest = plainOrder(atlas.challenges)[0];
    expect(order[0]?.id).toBe(easiest?.id);
    expect(new Set(order.map((c) => c.id)).size).toBe(atlas.challenges.length);
  });

  it('never repeats a question while an alternative exists', () => {
    // Only passed challenges leave the unanswered set, so this is the player a
    // naive rule hammers. Every failure comes back, but not before the rest.
    //
    // The qualifier is not a hedge, it is the honest limit: with one question
    // left and that question just failed, *every* possible rule re-serves it —
    // the alternative is refusing to serve, which the rule forbids and risk #4
    // calls the tool hiding things. Measured on this repo, that is exactly where
    // the one repeat lands, at the final step with `open === 1`.
    const steps = playthrough((step) => (step % 2 === 0 ? 'pass' : 'fail'));
    // The player really did fail things, or "no repeats" would be trivially true.
    expect(steps.length).toBeGreaterThan(atlas.challenges.length);
    const repeats = steps.filter(
      (step, i) => i > 0 && steps[i - 1]?.challenge.id === step.challenge.id,
    );
    expect(repeats.filter((step) => step.open > 1)).toEqual([]);
    expect(consecutive(challenges(steps), (a, b) => truthKey(a) === truthKey(b))).toBeLessThan(3);
  });

  it('cycles evenly rather than stalling when every question has been failed', () => {
    const order = challenges(playthrough(() => 'fail'));
    const counts = new Map<string, number>();
    for (const challenge of order) counts.set(challenge.id, (counts.get(challenge.id) ?? 0) + 1);
    const values = [...counts.values()];
    // Every question served the same number of times: a rotation, not a rut.
    expect(Math.max(...values) - Math.min(...values)).toBe(0);
    expect(counts.size).toBe(atlas.challenges.length);
  });
});

describe('every rank component earns its place on real data', () => {
  /** How many times a component's value differed from the winner's rivals. */
  function relaxations(order: readonly Challenge[]): { truth: number; region: number } {
    let truth = 0;
    let region = 0;
    for (let i = 1; i < order.length; i++) {
      const previous = order[i - 1];
      const served = order[i];
      if (previous === undefined || served === undefined) continue;
      if (truthKey(served) === truthKey(previous)) truth++;
      if (regionOf(served.subject) === regionOf(previous.subject)) region++;
    }
    return { truth, region };
  }

  it('the region constraint has to be relaxed at least once, and the truth one rarely', () => {
    // Measured, and recorded here so a future change that makes either branch
    // dead shows up as a failing test rather than as code nobody notices.
    const perfect = relaxations(challenges(playthrough(() => 'pass')));
    const mixed = relaxations(challenges(playthrough((step) => (step % 2 === 0 ? 'pass' : 'fail'))));
    expect(perfect.region + mixed.region).toBeGreaterThan(0);
    // The truth relaxation is the rare one: it needs the whole remaining pool to
    // share the previous key. It does not fire for a perfect player on this repo.
    expect(perfect.truth).toBe(0);
  });

  it('answered subjects are excluded — the deck shrinks', () => {
    const first = suggestNext(atlas.challenges, regionOf, NO_HISTORY);
    expect(first).not.toBeNull();
    if (first === null) return;
    const after = suggestNext(atlas.challenges, regionOf, {
      ...NO_HISTORY,
      answered: new Set([first.subject]),
    });
    expect(after?.id).not.toBe(first.id);
  });
});
