/**
 * The verb contract (NORTH-STAR §8.1).
 *
 * Every verb, however different its interaction, reduces to one `Grade`. That
 * seam is what makes adding a verb free downstream: the console, the map and
 * the progression code only ever see a `Grade`.
 *
 * `grade` takes the challenge and the answer and nothing else. No atlas, no
 * graph, no I/O — so it is a pure function of two plain values, trivially
 * testable, and structurally incapable of having a model in the path.
 */

import type { Atlas, Challenge, NodeId, VerbId } from '../atlas/index.js';

export interface Grade {
  /** 0..1. Never negative — a wrong pick teaches, it does not subtract. */
  readonly score: number;
  /** picked ∩ truth, sorted. */
  readonly correct: readonly NodeId[];
  /** truth \ picked, sorted. */
  readonly missed: readonly NodeId[];
  /** picked \ truth, sorted. */
  readonly spurious: readonly NodeId[];
  /** Why, derived from the measured result. Never a canned string. */
  readonly evidence: string;
}

/** The answer shape for every "select the right subset" verb. */
export interface SetAnswer {
  readonly picked: readonly NodeId[];
}

export interface GenerateOptions {
  /** Upper bound on challenges emitted for this verb. */
  readonly maxChallenges: number;
  /** How far propagation is traced, in graph hops. */
  readonly depth: number;
  /** Target size of the choice set shown to the player. */
  readonly candidateCount: number;
}

export const DEFAULT_GENERATE_OPTIONS: GenerateOptions = {
  maxChallenges: 40,
  depth: 3,
  candidateCount: 20,
};

export interface Verb<C extends Challenge = Challenge, A = SetAnswer> {
  readonly id: VerbId;
  /** Pure: same atlas and options ⇒ same challenges, in the same order. */
  generate(atlas: Atlas, options: GenerateOptions): readonly C[];
  /** Pure and self-contained. */
  grade(challenge: C, answer: A): Grade;
}

/**
 * Grade bands (NORTH-STAR §8.2). `incomplete` is not a failure state — there is
 * no fail state — it just means the fog does not lift yet.
 */
export type Band = 'S' | 'A' | 'B' | 'C' | 'incomplete';

/**
 * Above this counts as understanding the structure. Chosen to sit above the
 * "select everything" ceiling: that exploit tops out at 2·|truth| /
 * (|truth| + |candidates|), which is below 0.5 whenever the choice set is more
 * than three times the size of the answer — see `selectAllScore`.
 */
export const PASS_THRESHOLD = 0.5;

export const BAND_THRESHOLDS: readonly (readonly [Band, number])[] = [
  ['S', 0.95],
  ['A', 0.78],
  ['B', 0.6],
  ['C', PASS_THRESHOLD],
];

export function bandFor(score: number): Band {
  for (const [band, threshold] of BAND_THRESHOLDS) {
    if (score >= threshold) return band;
  }
  return 'incomplete';
}
