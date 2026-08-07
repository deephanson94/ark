/**
 * Blast Radius — the v1 verb (NORTH-STAR §6.1).
 *
 * > *"You're changing the signature of `parseConfig()`. Select every file that
 * > will need to change."* — the original wording, and it is **not** what ships.
 *
 * The import graph proves *reachability*, which overapproximates required
 * change: a file importing a different symbol, or importing only a type, may
 * need no edit at all. Promising "will need to change" would mark players wrong
 * on files that provably need no change — the tool's approximation sold as the
 * player's error, which is the trust destruction guardrail 4 exists to prevent.
 * So the prompt promises exactly what the graph proves: **dependence**
 * (ADR-0008).
 *
 * Self-contained per CLAUDE.md: generation, grading and wording all live under
 * this directory, and nothing outside it knows what this verb asks. `grade` is
 * the shared `gradeSet` — every subset-selection verb reduces to one `Grade`,
 * which is the seam that makes adding the next verb free downstream.
 */

import type { Challenge, NodeId } from '../../atlas/index.js';
import { gradeSet } from '../score.js';
import type { GenerateOptions, Prompt, SetAnswer, Verb } from '../types.js';
import { DEFAULT_GENERATE_OPTIONS } from '../types.js';
import { generateBlastRadius } from './generate.js';

export function promptFor(challenge: Challenge, pathOf: (id: NodeId) => string): Prompt {
  return {
    title: 'blast radius',
    // "Which of these" is load-bearing: it never claims the choice set is
    // exhaustive, which is what makes a hub's sampled answer key honest.
    question: `A breaking change lands in ${pathOf(challenge.subject)}. Which of these files depend on it — directly, or through a chain of imports?`,
    instruction: 'Select every file that reaches it. Wrong picks cost you nothing.',
  };
}

export const blastRadius: Verb = {
  id: 'blastRadius',
  generate(atlas, options: GenerateOptions = DEFAULT_GENERATE_OPTIONS) {
    return generateBlastRadius(atlas, options);
  },
  grade(challenge: Challenge, answer: SetAnswer) {
    return gradeSet(challenge, answer);
  },
  prompt: promptFor,
};

export type { Corpus, DistractorChoice, DistractorContext, StrategyId } from './distractors.js';
export {
  TARGET_MIX,
  analyse,
  mixOf,
  nameSimilarity,
  nameTokens,
  quotas,
  selectDistractors,
  undirectedDistances,
} from './distractors.js';
export type { DifficultyInput } from './difficulty.js';
export { WEIGHTS, difficultyOf, surpriseOf } from './difficulty.js';
export type { GenerationReport, GenerationResult, SkipReason } from './generate.js';
export { generateBlastRadius, generateWithReport, sampleByDistance, truthCap } from './generate.js';
export type { NoteKind, Reveal, RevealNote } from './reveal.js';
export { revealOf } from './reveal.js';
