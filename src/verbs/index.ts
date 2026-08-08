/**
 * Verbs. One directory per verb, each self-contained: `generate()`, `grade()`,
 * fixtures, tests. Adding one must not require editing the console, the grader
 * or the map — this barrel and the `Grade` type are the whole seam.
 *
 * M0 shipped the contracts and the shared set scorer; M2 added `blastRadius`
 * (NORTH-STAR §6.1); M4 adds `companion` (§6.2), the first verb graded on git
 * rather than on imports.
 *
 * Three things moved up to this level when the second verb arrived, because
 * "self-contained" means a verb owns its *semantics*, not that it hoards shared
 * machinery: `difficulty.ts` (§8.4 is one formula for every verb), `gate.ts`
 * (pillar 3's Ctrl+F check, with a per-verb heuristic set) and `paths.ts`
 * (string work with no verb semantics at all). The alternative was Companion
 * importing from `blastRadius/`, which is the coupling CLAUDE.md forbids.
 */

export type {
  Band,
  GenerateOptions,
  Grade,
  NoteKind,
  Prompt,
  Reveal,
  RevealChannel,
  RevealNote,
  SetAnswer,
  SetPhrasing,
  Verb,
} from './types.js';
export {
  BAND_THRESHOLDS,
  DEFAULT_GENERATE_OPTIONS,
  PASS_THRESHOLD,
  bandFor,
  maxChallengesFor,
} from './types.js';
export type { SetScore } from './score.js';
export { gradeSet, isGameable, scoreSet, selectAllScore } from './score.js';
export type { DifficultyInput } from './difficulty.js';
export { WEIGHTS, difficultyOf, hopReach, surpriseOf } from './difficulty.js';
export type { GateVerdict, HeuristicId } from './gate.js';
export { CTRL_F_THRESHOLD, HISTORY_HEURISTICS, PATH_HEURISTICS, gradeHeuristics } from './gate.js';
export { directoryOf, nameSimilarity, nameTokens, sharedSegments } from './paths.js';
import type { RevealChannel } from './types.js';
import type { VerbId } from '../atlas/index.js';
import { blastRadius } from './blastRadius/index.js';
import { companion } from './companion/index.js';

export { blastRadius, promptFor } from './blastRadius/index.js';
export { companion } from './companion/index.js';

/**
 * Every verb, by id. The console looks a challenge's verb up here and asks it
 * for its wording, its grade and its reveal — so a new verb is a new directory
 * and one line in this map, and nothing downstream changes.
 *
 * **This is the only list of verbs.** `src/player/save.ts` used to keep a second
 * one for validating stored passes and `src/atlas/validate.ts` a third; both now
 * read `VERB_IDS` below. Two lists that must agree is the "never define the
 * shape twice" rule broken in the place where breaking it silently discards a
 * player's progress.
 */
export const VERBS = { blastRadius, companion } as const;

/**
 * Which map channel a verb's answers may be rendered into.
 *
 * The one place the question *"may this be drawn?"* is answered, so that no
 * code outside a verb's own directory ever names a verb to decide it. Before
 * this existed the player reconstructed the licence as
 * `challenge.verb !== 'companion'`, hard-coded in two files — which is exactly
 * the seam M4 spent its budget building, undone by the next feature that
 * needed it.
 *
 * **An unknown id draws nothing, and that direction is load-bearing.** An atlas
 * may name a verb this build does not have — `VERB_IDS` is validated at load,
 * but a save or a hand-edited atlas can still carry one — and the safe answer
 * to "may I draw an answer I do not understand?" is no.
 */
export function channelOf(verb: VerbId): RevealChannel {
  return VERBS[verb as keyof typeof VERBS]?.channel ?? 'nothing';
}
