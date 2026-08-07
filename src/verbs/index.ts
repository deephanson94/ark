/**
 * Verbs. One directory per verb, each self-contained: `generate()`, `grade()`,
 * fixtures, tests. Adding one must not require editing the console, the grader
 * or the map — this barrel and the `Grade` type are the whole seam.
 *
 * M0 ships the contracts and the shared set scorer. `blastRadius` (NORTH-STAR
 * §6.1) is the first implementation and lands at M2.
 */

export type { Band, GenerateOptions, Grade, SetAnswer, Verb } from './types.js';
export { BAND_THRESHOLDS, DEFAULT_GENERATE_OPTIONS, PASS_THRESHOLD, bandFor } from './types.js';
export type { SetScore } from './score.js';
export { gradeSet, isGameable, scoreSet, selectAllScore } from './score.js';
