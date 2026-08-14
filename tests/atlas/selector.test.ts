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

import type { Atlas, Challenge, AtlasId } from '../../src/atlas/index.js';
import { buildAtlas, indexOptions } from '../../src/indexer/build.js';
import { NO_HISTORY, noteAttempt, suggestNext } from '../../src/player/selector.js';
import { answerKey } from '../../src/player/progress.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

let atlas: Atlas;
let regionOf: (subject: AtlasId) => string | null;

beforeAll(async () => {
  atlas = await buildAtlas(indexOptions(ROOT));
  const byId = new Map(atlas.nodes.map((node) => [node.id, node.region]));
  // Null, exactly as `main.ts` resolves it: a Placement subject is a commit and
  // has no square on the map. Returning `''` made every pair of Placement
  // questions look like two questions about the same region — 34 consecutive
  // "same region" pairs on this repo, from a signal that was really "neither of
  // these is anywhere".
  regionOf = (subject) => byId.get(subject) ?? null;
}, 60_000);

const truthKey = (challenge: Challenge): string => challenge.truth.join('\n');

/** Jaccard over two answer keys — the quantity the selector now ranks on. */
function overlap(a: Challenge, b: Challenge): number {
  const before = new Set(b.truth);
  let shared = 0;
  for (const id of a.truth) if (before.has(id)) shared++;
  const union = before.size + a.truth.length - shared;
  return union === 0 ? 0 : shared / union;
}

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
  const answered = new Set<string>();
  let attempts = new Map<string, number>();
  let previous: Challenge | null = null;
  const served: Step[] = [];
  const limit = atlas.challenges.length * 3;
  for (let step = 0; step < limit; step++) {
    const open = atlas.challenges.filter((c) => !answered.has(answerKey(c.verb, c.subject))).length;
    const next = suggestNext(atlas.challenges, regionOf, { answered, attempts, skipped: new Set(), verbRun: 0, previous });
    if (next === null) break;
    served.push({ challenge: next, open });
    previous = next;
    if (outcomeFor(step) === 'pass') answered.add(answerKey(next.verb, next.subject));
    else attempts = noteAttempt(attempts, answerKey(next.verb, next.subject));
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
  it('has no duplicate answer keys within a verb — the generator removed them', () => {
    // This assertion used to be its own inverse. Until `dedupe()` it read
    // "there ARE identical answer keys here", because there were five pairs and
    // the selector's job was to keep them apart. The cause is fixed upstream
    // now, so the instrument flips: if it ever regresses the failure lands here
    // rather than in a player who notices the repetition.
    //
    // **Keyed by `(verb, truth)` and not by `truth` alone, which is a
    // correction rather than a loosening.** ADR-0012 and `docs/atlas-format.md`
    // §3.6 both say uniqueness is a **within-verb** property, in as many words:
    // *"two different verbs may honestly share an answer set, because they are
    // asking different questions about the same files."* This test asserted the
    // stronger, undocumented thing and got away with it for two verbs, because
    // a cross-verb collision never happened to occur. With three it does — a
    // Companion key and the Placement board for the commit that produced that
    // coupling are the same three files, which is not a repeat but the second
    // question explaining the first.
    const byKey = new Map<string, Challenge[]>();
    for (const challenge of atlas.challenges) {
      const key = `${challenge.verb}\n${truthKey(challenge)}`;
      byKey.set(key, [...(byKey.get(key) ?? []), challenge]);
    }
    expect([...byKey.values()].filter((group) => group.length > 1)).toEqual([]);
  });

  it('still serves half-shared answer keys back to back without the overlap rank', () => {
    // The anti-vacuity check for what replaced the byte-equality flag. Exact
    // duplicates are gone; *partial* repetition is not, and it is what the
    // continuous overlap term exists for. If this ever hits 0, the term is
    // guarding nothing on this repo and the assertions below stop meaning
    // anything — so fail loudly rather than quietly, exactly as the old test did
    // for its own constraint.
    const plain = plainOrder(atlas.challenges);
    const shared = consecutive(plain, (a, b) => overlap(a, b) >= 0.5);
    expect(shared).toBeGreaterThan(0);
    // ...and the selector has to actually reduce it, or the rank component is
    // decoration. Measured on this repo: 13 such pairs in the plain order, 4
    // under the selector.
    const served = challenges(playthrough(() => 'pass'));
    expect(consecutive(served, (a, b) => overlap(a, b) >= 0.5)).toBeLessThan(shared);
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
    //
    // Restricted to pairs that are both *on* the map, because that is what the
    // property is about. A Placement subject is a commit with no region, and
    // counting two of those as "the same region" measures nothing.
    const order = challenges(playthrough(() => 'pass'));
    const sameRegion = consecutive(order, (a, b) => {
      const region = regionOf(a.subject);
      return region !== null && regionOf(b.subject) === region;
    });
    expect(sameRegion).toBeLessThan(3);
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
  it('the region term changes a real choice on this deck', () => {
    // **This used to assert the opposite and it stopped being true.** The old
    // form counted how often the constraint had to be *relaxed* — consecutive
    // questions in one region — on the reasoning that a term never overridden is
    // decoration. On an 80-question deck that happened; on 116 it does not,
    // because with a third verb added the selector can always find a different
    // region and the constraint simply always wins.
    //
    // Which is the term working perfectly, not the term being dead — so the old
    // check was measuring failure and calling it liveness. This measures the
    // thing the heading claims, in the same shape as the overlap test below:
    // run the rank with and without the term against one shared history and
    // count the picks that differ. A term that changed no pick would fail here
    // however large the deck grew. Measured at the commit that added Placement:
    // 19 of 116 — but the assertion is the invariant, not the number, because
    // ark indexes itself and the deck moves under it.
    const answered = new Set<string>();
    let previous: Challenge | null = null;
    let diverged = 0;
    for (let step = 0; step < atlas.challenges.length; step++) {
      const withRegion = suggestNext(atlas.challenges, regionOf, {
        answered,
        attempts: new Map(),
        skipped: new Set(),
        verbRun: 0,
        previous,
      });
      // Neutralised: with no subject anywhere, `sameRegion` is 0 for every
      // candidate and the term cannot break a tie.
      const without = suggestNext(atlas.challenges, () => null, {
        answered,
        attempts: new Map(),
        skipped: new Set(),
        verbRun: 0,
        previous,
      });
      if (withRegion === null) break;
      if (withRegion.id !== without?.id) diverged++;
      previous = withRegion;
      answered.add(answerKey(withRegion.verb, withRegion.subject));
    }
    expect(diverged).toBeGreaterThan(0);
  });

  it('the overlap tiebreak changes a real choice on this deck', () => {
    // The landmine bar, counted rather than assumed: `overlap` sits below
    // `difficulty`, so it only decides when two open questions are equally hard.
    // That happens constantly (difficulty is rounded to two decimals), but it
    // has to change an actual *pick* to be worth its code. Measured: 2 here, 3
    // on vite, 41 on svelte. Run both rules against one shared history, so a
    // divergence is a disagreement and not two trajectories drifting apart.
    const answered = new Set<string>();
    let previous: Challenge | null = null;
    let diverged = 0;
    for (let step = 0; step < atlas.challenges.length; step++) {
      const withOverlap = suggestNext(atlas.challenges, regionOf, {
        answered,
        attempts: new Map(),
        skipped: new Set(),
        verbRun: 0,
        previous,
      });
      // The same rank with the overlap term neutralised: every candidate is
      // handed a `previous` it shares nothing with.
      const without = suggestNext(atlas.challenges, regionOf, {
        answered,
        attempts: new Map(),
        skipped: new Set(),
        verbRun: 0,
        previous: previous === null ? null : { ...previous, truth: [] },
      });
      if (withOverlap === null) break;
      if (withOverlap.id !== without?.id) diverged++;
      previous = withOverlap;
      answered.add(answerKey(withOverlap.verb, withOverlap.subject));
    }
    expect(diverged).toBeGreaterThan(0);
  });

  it('answered subjects are excluded — the deck shrinks', () => {
    const first = suggestNext(atlas.challenges, regionOf, NO_HISTORY);
    expect(first).not.toBeNull();
    if (first === null) return;
    const after = suggestNext(atlas.challenges, regionOf, {
      ...NO_HISTORY,
      answered: new Set([answerKey(first.verb, first.subject)]),
    });
    expect(after?.id).not.toBe(first.id);
  });
});
