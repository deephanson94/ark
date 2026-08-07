/**
 * Verbs. One directory per verb, each self-contained: `generate()`, `grade()`,
 * fixtures, tests. Adding one must not require editing the console, the grader
 * or the map — this barrel and the `Grade` type are the whole seam.
 *
 * M0 shipped the contracts and the shared set scorer; M2 adds `blastRadius`
 * (NORTH-STAR §6.1), the first implementation.
 */

export type { Band, GenerateOptions, Grade, Prompt, SetAnswer, Verb } from './types.js';
export {
  BAND_THRESHOLDS,
  DEFAULT_GENERATE_OPTIONS,
  PASS_THRESHOLD,
  bandFor,
  maxChallengesFor,
} from './types.js';
export type { SetScore } from './score.js';
export { gradeSet, isGameable, scoreSet, selectAllScore } from './score.js';
import { blastRadius } from './blastRadius/index.js';

export { blastRadius, promptFor } from './blastRadius/index.js';

/**
 * Every verb, by id. The console looks a challenge's verb up here and asks it
 * for its wording and its grade — so a new verb is a new directory and one line
 * in this map, and nothing downstream changes.
 */
export const VERBS = { blastRadius } as const;
