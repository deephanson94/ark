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
  /**
   * Upper bound on challenges emitted for this verb.
   *
   * `null` means "scale with the repo" — see `maxChallengesFor`. A fixed number
   * is available for tests and for anyone who wants a short deck.
   */
  readonly maxChallenges: number | null;
  /** Target size of the choice set shown to the player. */
  readonly candidateCount: number;
}

/**
 * How many questions a repo of `n` files should carry.
 *
 * A flat cap is the wrong shape and measurement said so: 40 was fine for this
 * repo's 80 files and produced **26 questions for vitejs/vite's 2,025** — a
 * deck you exhaust in one sitting on a codebase you could not learn in a month.
 * One question per eight files, floor 40, tracks the thing that actually varies.
 *
 * The cost is bounded and small: a challenge serialises to roughly 600 bytes,
 * so this adds ~150 KiB at 2,000 files against a 5 MB ceiling.
 */
export function maxChallengesFor(nodeCount: number): number {
  return Math.max(40, Math.ceil(nodeCount / 8));
}

/**
 * There is deliberately no `depth` here. Propagation is traced without a
 * bound: a depth bound made §8.3's "distance n±1" distractor strategy present
 * real dependents as correct exclusions, and it protected nothing measurable
 * (ADR-0008).
 */
export const DEFAULT_GENERATE_OPTIONS: GenerateOptions = {
  maxChallenges: null,
  candidateCount: 20,
};

/**
 * What the console shows above the choice set.
 *
 * A verb owns its own wording, because "adding a verb must not require editing
 * the console" (CLAUDE.md) is only true if the console never has to know what
 * this verb is asking. Repo-specific content is still forbidden (guardrail 2):
 * the only thing substituted in is a path the atlas already contains.
 */
export interface Prompt {
  /** The verb's question type, e.g. `blast radius`. */
  readonly title: string;
  /** The question itself, with the subject substituted in. */
  readonly question: string;
  /** How to answer. Must never claim the choice set is exhaustive. */
  readonly instruction: string;
}

export interface Verb<C extends Challenge = Challenge, A = SetAnswer> {
  readonly id: VerbId;
  /** Pure: same atlas and options ⇒ same challenges, in the same order. */
  generate(atlas: Atlas, options: GenerateOptions): readonly C[];
  /** Pure and self-contained. */
  grade(challenge: C, answer: A): Grade;
  /**
   * The wording, given a way to turn a node id into its display path. Pure —
   * the verb never sees the atlas here, only the one name it needs.
   */
  prompt(challenge: C, pathOf: (id: NodeId) => string): Prompt;
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
