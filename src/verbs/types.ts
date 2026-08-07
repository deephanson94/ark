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

import type { Atlas, Challenge, Graph, NodeId, VerbId } from '../atlas/index.js';

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
  /**
   * The label on the control that opens this question, e.g. *"Map its blast
   * radius"*.
   *
   * Here rather than in the inspector because the inspector hard-coded Blast
   * Radius's phrasing until M4 and then opened Companion questions with it —
   * a button promising an import radius and delivering a question about
   * commits. Templating the verb's `title` into a fixed sentence was the first
   * fix and it produced *"Map its companion"*; a verb that owns its wording
   * owns all of it.
   */
  readonly action: string;
}

export type NoteKind = 'correct' | 'missed' | 'spurious';

/** One line of the reveal: a pick, and the measured reason it was right or wrong. */
export interface RevealNote {
  readonly id: NodeId;
  readonly path: string;
  readonly kind: NoteKind;
  /**
   * The chain of files the verb traced to justify `note`, as paths, or empty
   * when the verb's evidence is not a path. Blast Radius fills it with the
   * import route; Companion has no route to draw, and leaves it empty rather
   * than inventing one.
   */
  readonly route: readonly string[];
  /** Why. Derived from the graph or the history, never canned. */
  readonly note: string;
}

/**
 * What the player learns from a grade.
 *
 * `grade()` is pure over `(challenge, answer)` and so has no atlas to turn an
 * id into a path; `reveal()` has both, and turns each pick into the *reason* it
 * was or was not in the answer. Nothing here is in the grading path — the score
 * is already fixed by the time this runs.
 */
export interface Reveal {
  /** The subject's display path. */
  readonly subject: string;
  /**
   * One sentence naming what the full answer was, beyond the sampled key —
   * **written by the verb, because only the verb knows what it sampled**.
   * The console used to say "its full blast radius is N files" for every
   * challenge, which is the console knowing what a verb asks.
   */
  readonly summary: string;
  /** Sorted: missed first (the lesson), then spurious, then correct. */
  readonly notes: readonly RevealNote[];
}

/**
 * The verb-supplied half of `explain()`.
 *
 * F1 stays in one place (`scoreSet`) because a second copy of the metric is how
 * two verbs come to disagree about what 0.6 means. The *sentences* move here,
 * because "reached the subject by a path you did not select" is a claim about
 * imports and Companion would be lying if it said it.
 */
export interface SetPhrasing {
  /** How this answer key was derived, e.g. "traced through the import graph". */
  scope(challenge: Challenge): string;
  /** `n` truth members the player did not pick. `n` is always ≥ 1. */
  missed(count: number): string;
  /** `n` picks that are not in the answer key. `n` is always ≥ 1. */
  spurious(count: number): string;
  /** Nothing missed and nothing spurious. */
  readonly exact: string;
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
  /**
   * Why each pick was right or wrong. On the contract rather than imported from
   * one verb's directory, which is what the console did until M4 — it reached
   * straight into `../verbs/blastRadius/` for `revealOf`, so a second verb's
   * grade would have been explained in the first verb's terms.
   */
  reveal(atlas: Atlas, graph: Graph, challenge: C, grade: Grade): Reveal;
  /**
   * Whether a stored pass still holds against the atlas now loaded.
   *
   * ADR-0011 decision 3: provenance is immutable, but the claim about *today*
   * is re-checked before it renders as knowledge. The check is **per verb**
   * because the claims differ — "still depends on" for Blast Radius, "still
   * changes with" for Companion — and applying one verb's rule to the other's
   * pass would drop true claims and keep false ones.
   */
  stillHolds(graph: Graph, subject: NodeId, member: NodeId): boolean;
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
