/**
 * Computed difficulty — NORTH-STAR §8.4.
 *
 *     difficulty(c) = w₁·log(breadth) + w₂·reach + w₃·surprise
 *
 * The third term is the one that matters. `surprise` is the symmetric
 * difference between the true answer and the answer you would give if you
 * assumed only the obvious thing counts — so **a question is hard exactly when
 * the true answer differs from the obvious one**. That is computable, which is
 * what lets difficulty tiers work on a codebase nobody has ever seen, with no
 * human tuning (pillar 2).
 *
 * Two readings had to be pinned down here, and both are recorded in the code
 * rather than left to the next session:
 *
 *  - **`breadth` is the size of the subject's full answer population** — every
 *    dependent, every companion — not the size of the choice set. §8.4 glosses
 *    it "how much there is to get wrong", and the choice set is a near-constant
 *    20: a term that barely varies cannot order anything.
 *  - **The normalisers are per-repo maxima**, not absolute constants. §8.4's
 *    whole claim is that difficulty "adapts automatically to each repo"; a
 *    fixed divisor would make every question on a small repo easy and every
 *    question on a monorepo hard, which is backwards.
 *
 * ## Why this is shared and the field names are abstract
 *
 * §8.4 is one formula for **every** verb, so this module sits at `src/verbs/`
 * rather than inside one of them. It moved here when Companion landed, and the
 * fields were renamed from `fanOut`/`depth` in the same commit: those names
 * described a *reading* of the formula (import hops) rather than the formula,
 * and a second verb that filled `depth` with something that is not a hop count
 * would have made the type lie about its own contents.
 *
 * Each verb declares what fills the three roles, and says so where it does:
 *
 * | | Blast Radius | Companion |
 * |---|---|---|
 * | `breadth` | transitive dependents | co-change partners |
 * | `reach`   | furthest hop in the key | share of the key with no import edge |
 * | `surprise`| key Δ direct importers | key Δ the busiest candidates |
 *
 * The two `surprise` baselines are different *on purpose*: each is the guess
 * that verb's map view actually hands the player for free.
 */

import { round2 } from '../atlas/index.js';

/**
 * Half the weight on surprise, because it is the only term that measures the
 * gap between having read a codebase and knowing it — the two structural terms
 * measure how big the question is, which is not the same as how hard.
 */
export const WEIGHTS = { breadth: 0.25, reach: 0.25, surprise: 0.5 } as const;

export interface DifficultyInput {
  /** How many answers the subject has in total, before sampling. */
  readonly breadth: number;
  /** The largest such population anywhere in this repo. Normaliser. */
  readonly maxBreadth: number;
  /**
   * How far this answer key sits from the subject, **already normalised to
   * 0..1 by the verb**.
   *
   * Normalised by the caller rather than here because the two verbs measure it
   * in incompatible units — hops for one, a share of the key for the other —
   * and the repo-wide maximum that makes hops comparable is meaningless for a
   * quantity that is already a fraction. A shared `maxReach` field would have
   * forced Companion to invent a denominator of 1 and call it a maximum.
   */
  readonly reach: number;
  /** 0..1, from `surpriseOf`. */
  readonly surprise: number;
}

/**
 * `|truth Δ naiveGuess| / |truth|`, where `naiveGuess` is what you would answer
 * if you assumed only direct importers matter.
 *
 * `naive` must already be restricted to the choice set: a direct importer the
 * player cannot pick is not an answer they could have given. Under the
 * generator's invariant every pickable direct importer is in `truth`, so this
 * reduces to the fraction of the answer key that is *not* obvious — but the
 * symmetric difference is computed properly so the measure stays honest if a
 * future verb relaxes that.
 */
export function surpriseOf(truth: Iterable<string>, naive: Iterable<string>): number {
  const truthSet = new Set(truth);
  const naiveSet = new Set(naive);
  if (truthSet.size === 0) return 0;
  let different = 0;
  for (const id of truthSet) if (!naiveSet.has(id)) different++;
  for (const id of naiveSet) if (!truthSet.has(id)) different++;
  return Math.min(1, different / truthSet.size);
}

/** A logarithm normalised to 0..1 against the repo's own maximum. */
function logShare(value: number, max: number): number {
  if (max <= 0) return 0;
  const scale = Math.log(1 + max);
  if (scale <= 0) return 0;
  return Math.min(1, Math.log(1 + Math.max(0, value)) / scale);
}

/**
 * 0..1. The validator enforces that range, so the clamp here is the contract
 * rather than a belt-and-braces flourish.
 */
export function difficultyOf(input: DifficultyInput): number {
  const breadthTerm = logShare(input.breadth, input.maxBreadth);
  const reachTerm = Math.min(1, Math.max(0, input.reach));
  const surpriseTerm = Math.min(1, Math.max(0, input.surprise));

  const raw =
    WEIGHTS.breadth * breadthTerm + WEIGHTS.reach * reachTerm + WEIGHTS.surprise * surpriseTerm;
  return round2(Math.min(1, Math.max(0, raw)));
}

/**
 * Blast Radius's `reach`: how far past its direct importers the answer key
 * travels, as a share of the repo's own deepest question.
 *
 * **Depth 1 is the floor, not zero distance** — a key that is all direct
 * importers has travelled nowhere and scores 0 — which is why this is not
 * simply `depth / maxDepth`. It lives here beside the formula rather than in
 * the verb only because `difficultyOf` used to do it inline, and moving it
 * without keeping it identical would have silently re-scored every existing
 * question.
 */
export function hopReach(depth: number, maxDepth: number): number {
  const span = Math.max(0, maxDepth - 1);
  return span === 0 ? 0 : Math.min(1, Math.max(0, depth - 1) / span);
}
