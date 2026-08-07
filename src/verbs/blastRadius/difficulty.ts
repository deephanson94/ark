/**
 * Computed difficulty — NORTH-STAR §8.4.
 *
 *     difficulty(c) = w₁·log(fanOut) + w₂·maxDepth + w₃·surprise
 *
 * The third term is the one that matters. `surprise` is the symmetric
 * difference between the true answer and the answer you would give if you
 * assumed only direct neighbours count — so **a question is hard exactly when
 * the true answer differs from the obvious one**. That is computable, which is
 * what lets difficulty tiers work on a codebase nobody has ever seen, with no
 * human tuning (pillar 2).
 *
 * Two readings had to be pinned down here, and both are recorded in the code
 * rather than left to the next session:
 *
 *  - **`fanOut` is the size of the subject's full dependent set**, not the size
 *    of the choice set. §8.4 glosses it "how much there is to get wrong", and
 *    the choice set is a near-constant 20 — a term that barely varies cannot
 *    order anything.
 *  - **The normalisers are per-repo maxima**, not absolute constants. §8.4's
 *    whole claim is that difficulty "adapts automatically to each repo"; a
 *    fixed divisor would make every question on a small repo easy and every
 *    question on a monorepo hard, which is backwards.
 */

import { round2 } from '../../atlas/index.js';

/**
 * Half the weight on surprise, because it is the only term that measures the
 * gap between having read a codebase and knowing it — the two structural terms
 * measure how big the question is, which is not the same as how hard.
 */
export const WEIGHTS = { fanOut: 0.25, depth: 0.25, surprise: 0.5 } as const;

export interface DifficultyInput {
  /** Dependents of the subject at any depth. */
  readonly fanOut: number;
  /** The largest fan-out anywhere in this repo. Normaliser. */
  readonly maxFanOut: number;
  /** Greatest distance from the subject to a member of the answer key. */
  readonly depth: number;
  /** The greatest such distance anywhere in this repo. Normaliser. */
  readonly maxDepth: number;
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
  const fanOutTerm = logShare(input.fanOut, input.maxFanOut);
  // Depth 1 is the floor, not zero distance — a question whose answer key is
  // all direct importers has travelled nowhere, and should score 0 here.
  const depthSpan = Math.max(0, input.maxDepth - 1);
  const depthTerm = depthSpan === 0 ? 0 : Math.min(1, Math.max(0, input.depth - 1) / depthSpan);
  const surpriseTerm = Math.min(1, Math.max(0, input.surprise));

  const raw =
    WEIGHTS.fanOut * fanOutTerm + WEIGHTS.depth * depthTerm + WEIGHTS.surprise * surpriseTerm;
  return round2(Math.min(1, Math.max(0, raw)));
}
