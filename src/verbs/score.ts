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
import type { Grade, SetAnswer, SetPhrasing } from './types.js';
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
 * The rule of the board, in one sentence: how many count, and what a spare
 * pick costs.
 *
 * **Every prompt used to end with *"Wrong picks cost you nothing"*, and it was
 * false.** Under §8.2 a spare pick lowers precision, so on a one-file key a
 * player who ticked the right file plus two plausible wrong ones scored **50%
 * where the single right pick scores 100%** — three independent playtesters
 * hit it, and one called it the worst moment of their session. The sentence was
 * trying to say guardrail 6 (*never punish a wrong answer* — no penalty, no
 * fail state, no lockout) and instead denied the metric the whole anti-gaming
 * argument rests on.
 *
 * **Stating the key size is free against the Ctrl-F gate**, which is the reason
 * it is safe rather than a judgement that it feels fair: `gate.ts` already
 * hands every heuristic `truth.length`, so every board that ships has been
 * scored against guesses *sized exactly like the key*. A player who knows the
 * count knows nothing the gate did not already assume — and it turns F1 from an
 * unexplained verdict into a rule they can play against, which is the
 * difference between a quiz and a game.
 *
 * **And the first-attempt rule is stated here rather than discovered** (ADR-0035
 * §10). A board's pass is decided by its first graded answer, which is the only
 * thing that stops a farmed pass being written down as knowledge — but a player
 * who learns that from its consequence has been tricked, and `challenge.ts` can
 * only say it on a board that is *already* spent. So the fresh board says it too.
 * *Nothing is locked either way* is guardrail 6 and is literally true: the board
 * reopens, the reveal fires, the map still unlocks off the score.
 */
export function keyRule(challenge: Challenge): string {
  const key = challenge.truth.length;
  const count = challenge.candidates.length;
  return (
    `Exactly ${key === 1 ? 'one' : key} of these ${count} ${key === 1 ? 'counts' : 'count'}, ` +
    'so extra picks lower the score. Your first answer is the one your notebook ' +
    'keeps; nothing is locked either way.'
  );
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
 *
 * **The metric is shared; the sentences are not.** `phrasing` comes from the
 * verb, because the three lines below used to assert that a missed answer
 * "reached the subject by a path you did not select" — true of an import chain,
 * false of a co-change pair, and the kind of wrong-but-fluent copy that costs
 * exactly as much trust as a wrong answer key.
 */
export function gradeSet(challenge: Challenge, answer: SetAnswer, phrasing: SetPhrasing): Grade {
  const result = scoreSet(answer.picked, challenge.truth);
  return {
    score: result.score,
    correct: result.correct,
    missed: result.missed,
    spurious: result.spurious,
    evidence: explain(challenge, result, phrasing),
  };
}

function explain(challenge: Challenge, result: SetScore, phrasing: SetPhrasing): string {
  const parts = [
    `Found ${result.correct.length} of ${challenge.truth.length} (${phrasing.scope(challenge)}).`,
  ];
  if (result.missed.length > 0) parts.push(phrasing.missed(result.missed.length));
  if (result.spurious.length > 0) parts.push(phrasing.spurious(result.spurious.length));
  if (result.missed.length === 0 && result.spurious.length === 0) parts.push(phrasing.exact);
  const arithmetic = howScored(challenge, result);
  if (arithmetic !== null) parts.push(arithmetic);
  return parts.join(' ');
}

/**
 * Where the number came from.
 *
 * **A playtester found every correct answer on a one-file key, was shown
 * `1 of 1` and `33% · not yet`, and called it the worst moment of the
 * session** — two true facts on one screen that read as a contradiction, with
 * nothing anywhere naming precision, recall or F1. §8.2 makes over-selection
 * cost you *by construction* rather than by a penalty, which is the property
 * that makes "select everything" score 0.33 on a 20-candidate board and is why
 * no anti-cheat code exists. But a rule the player cannot see is not a rule
 * they can play against; it is a verdict.
 *
 * So the two ratios are stated in words, in the units they are actually in.
 * Null on a perfect answer, where `phrasing.exact` has already said it, and on
 * an empty one, where there is no fraction to report.
 */
function howScored(challenge: Challenge, result: SetScore): string | null {
  const picked = result.correct.length + result.spurious.length;
  if (picked === 0 || result.score >= 1) return null;
  const found = result.correct.length;
  const key = challenge.truth.length;
  return (
    `Scored ${Math.round(result.score * 100)}% — ` +
    `${found} of your ${picked} ${picked === 1 ? 'pick is' : 'picks are'} right, ` +
    `and there ${key === 1 ? 'is 1' : `are ${key}`} to find in all.`
  );
}
