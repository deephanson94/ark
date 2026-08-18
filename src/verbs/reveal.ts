/**
 * Shared reveal-side helpers — the parts every verb's `reveal()` needs and none
 * of them should own.
 *
 * There is one function here so far and it exists because it would otherwise be
 * the same three lines in four files, which is how a rule comes to live four
 * times and diverge twice.
 */
import type { Challenge } from '../atlas/index.js';
import type { Grade } from './types.js';

/**
 * The wrong answers the player correctly left alone.
 *
 * `Grade` names three sets — `missed`, `spurious`, `correct` — and their union
 * is `truth ∪ picked`, which is exactly what every reveal used to render. So a
 * player who answered **perfectly** was told nothing at all about the candidates
 * they were right to skip: on a twenty-candidate board with four right answers,
 * sixteen wrong answers walked off unexamined. Measured across this repo's deck,
 * **2,411 wrong-answer slots of which 1,869 carry a recorded reason** (ADR-0020)
 * that nobody ever hears.
 *
 * Derived rather than passed in, because `Grade`'s three sets already determine
 * it and widening `reveal()`'s signature to carry the raw answer would let a
 * verb see a pick the grader did not.
 *
 * **The witness does not come with these rows**, and that is measured rather
 * than cautious — see ADR-0050.
 */
export function avoidedOf(challenge: Challenge, grade: Grade): string[] {
  const accounted = new Set<string>([...grade.correct, ...grade.missed, ...grade.spurious]);
  return challenge.candidates.filter((id) => !accounted.has(id));
}
