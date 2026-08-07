/**
 * Set scoring (NORTH-STAR §8.2).
 *
 * The reason F1 and not accuracy: the naive exploit for "select the subset" is
 * to select everything. Under F1 that gives recall 1.0 and precision
 * |truth| / |candidates|, which collapses the score. The anti-gaming property
 * falls out of the metric — there is no special-case cheat detection here, and
 * there should never be one.
 */

import { byteCompare } from '../atlas/index.js';
import type { Challenge, NodeId } from '../atlas/index.js';
import type { Grade, SetAnswer } from './types.js';
import { PASS_THRESHOLD } from './types.js';

export interface SetScore {
  readonly score: number;
  readonly precision: number;
  readonly recall: number;
  readonly correct: readonly NodeId[];
  readonly missed: readonly NodeId[];
  readonly spurious: readonly NodeId[];
}

/**
 * F1 over two sets of node ids. Duplicates in `picked` are ignored rather than
 * rewarded or punished — picking the same file twice is a UI event, not an
 * answer.
 */
export function scoreSet(picked: Iterable<NodeId>, truth: Iterable<NodeId>): SetScore {
  const pickedSet = new Set(picked);
  const truthSet = new Set(truth);

  const correct: NodeId[] = [];
  const spurious: NodeId[] = [];
  for (const id of pickedSet) {
    if (truthSet.has(id)) correct.push(id);
    else spurious.push(id);
  }
  const missed: NodeId[] = [];
  for (const id of truthSet) {
    if (!pickedSet.has(id)) missed.push(id);
  }

  correct.sort(byteCompare);
  missed.sort(byteCompare);
  spurious.sort(byteCompare);

  // Both empty: nothing to find and nothing claimed, which is a correct answer.
  // Either one empty on its own: no overlap is possible, so the score is 0.
  const precision = pickedSet.size === 0 ? (truthSet.size === 0 ? 1 : 0) : correct.length / pickedSet.size;
  const recall = truthSet.size === 0 ? (pickedSet.size === 0 ? 1 : 0) : correct.length / truthSet.size;
  const score = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return { score, precision, recall, correct, missed, spurious };
}

/**
 * What "select every candidate" would score on this challenge. The generator
 * uses it to refuse to ship a question the exploit can pass.
 */
export function selectAllScore(challenge: Challenge): number {
  return scoreSet(challenge.candidates, challenge.truth).score;
}

/** True when selecting every candidate would reach the pass threshold. */
export function isGameable(challenge: Challenge, threshold = PASS_THRESHOLD): boolean {
  return selectAllScore(challenge) >= threshold;
}

/**
 * The shared `grade()` body for every subset-selection verb.
 *
 * `evidence` is assembled from the measured result — counts, the depth the
 * ground truth was traced to — so it cannot drift out of sync with the score.
 * It deliberately names no files: `correct`, `missed` and `spurious` carry the
 * ids, and only the player has the atlas needed to turn those into paths.
 */
export function gradeSet(challenge: Challenge, answer: SetAnswer): Grade {
  const result = scoreSet(answer.picked, challenge.truth);
  return {
    score: result.score,
    correct: result.correct,
    missed: result.missed,
    spurious: result.spurious,
    evidence: explain(challenge, result),
  };
}

function explain(challenge: Challenge, result: SetScore): string {
  const found = `${result.correct.length} of ${challenge.truth.length}`;
  // `evidence.depth` is the *measured* furthest hop in this answer key, not a
  // bound the generator imposed — there is no bound (ADR-0008) — so the claim
  // here is a fact about the question rather than a description of the tool.
  const scope =
    challenge.evidence.kind === 'importGraph'
      ? `traced through the import graph; the furthest is ${challenge.evidence.depth} ${
          challenge.evidence.depth === 1 ? 'hop' : 'hops'
        } away`
      : `drawn from files that changed together at least ${challenge.evidence.minCount} times`;

  const parts = [`Found ${found} (${scope}).`];
  if (result.missed.length > 0) {
    parts.push(
      `${result.missed.length} reached the subject by a path you did not select.`,
    );
  }
  if (result.spurious.length > 0) {
    parts.push(
      `${result.spurious.length} of your picks do not reach the subject at all.`,
    );
  }
  if (result.missed.length === 0 && result.spurious.length === 0) {
    parts.push('Exact — you drew the boundary where it actually is.');
  }
  return parts.join(' ');
}
