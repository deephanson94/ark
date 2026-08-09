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

import type { Atlas, AtlasId, Challenge, Graph, VerbId } from '../atlas/index.js';
import type { DisclosedFact } from './disclosure.js';

/**
 * **Every id below is an `AtlasId`, not a `NodeId`, and none of that widening
 * was visible to the compiler.**
 *
 * A member of a choice set is a place *or* an event since ADR-0019 — Archaeology
 * boards commits. `NodeId` and `CommitId` are both aliases of `string`, so the
 * fields here type-checked unchanged while every reader downstream went on
 * assuming a file: the save dropped members it could not parse, the fog put
 * commit ids in a set of squares, and the field notes resolved a member through
 * `refById` and `continue`d on the miss. The alias is a comment; the assumptions
 * it licenses live in its readers (ADR-0018's lesson, one field over).
 */
export interface Grade {
  /** 0..1. Never negative — a wrong pick teaches, it does not subtract. */
  readonly score: number;
  /** picked ∩ truth, sorted. */
  readonly correct: readonly AtlasId[];
  /** truth \ picked, sorted. */
  readonly missed: readonly AtlasId[];
  /** picked \ truth, sorted. */
  readonly spurious: readonly AtlasId[];
  /** Why, derived from the measured result. Never a canned string. */
  readonly evidence: string;
}

/** The answer shape for every "select the right subset" verb. */
export interface SetAnswer {
  readonly picked: readonly AtlasId[];
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
  /**
   * Facts the reveals of **already-generated** verbs have stated (ADR-0019
   * decision 7). Empty for the first verb to run.
   *
   * A set of opaque strings rather than another verb's challenges, so that a
   * verb reading it still names no verb — see `disclosure.ts`. A generator is
   * free to ignore it; the two verbs whose answers are files do, because no
   * reveal in this build states an import edge or a co-change pair as an atom
   * another verb could tick.
   */
  readonly disclosed: ReadonlySet<DisclosedFact>;
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
  // The first verb to run has been told nothing, and a caller generating one
  // verb alone is in exactly that position.
  disclosed: new Set<DisclosedFact>(),
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

/**
 * How far one proved member sits from a note's subject, in the unit its verb
 * measures in: import hops, shared commits, or — for a relation with no
 * gradient at all — a flat 1.
 *
 * The verb supplies these (`Verb.noteWeights`), because the player module that
 * used to compute them did it with `verb === 'companion' ? … : …` and the
 * *else* arm was Blast Radius. A third verb inherits that arm silently, which
 * is how a Placement note would have come to say "all of them direct
 * importers" about a commit.
 */
export type NoteWeights = ReadonlyMap<AtlasId, number>;

/** A field note's two sentences: what was proved, and what was merely shown. */
export interface NoteProse {
  /** What the player proved. Safe to state as knowledge. */
  readonly claim: string;
  /** What they were shown. Null when there is nothing beyond the claim. */
  readonly revealed: string | null;
}

/**
 * One proved member of a note, with its weight in the verb's own unit.
 *
 * `label`, not `path`: a member is a file for three verbs and a **commit** for
 * Archaeology, and `path` was the field name asserting otherwise. `notes.ts`
 * resolves it verb-blindly by prefix (`memberLabel`), so the sentence a verb
 * writes never has to ask which kind it was handed.
 */
export interface ProvedMember {
  readonly label: string;
  readonly weight: number;
}

/** Everything `Verb.noteProse` needs to write a note. Assembled by `notes.ts`. */
export interface NoteFacts {
  /** The subject's display name — a path, or a commit's own label. */
  readonly subjectLabel: string;
  /** Sorted by weight, then label. Never empty. */
  readonly proved: readonly ProvedMember[];
  /** The largest `weight` among `proved`. */
  readonly farthest: number;
  /** The size of the subject's full population **today**. Revealed, not proved. */
  readonly population: number;
}

export type NoteKind = 'correct' | 'missed' | 'spurious';

/** One line of the reveal: a pick, and the measured reason it was right or wrong. */
export interface RevealNote {
  readonly id: AtlasId;
  /** What to call it on screen: a file's path, or a commit's date and message. */
  readonly label: string;
  readonly kind: NoteKind;
  /**
   * Why. Derived from the graph or the history, never canned.
   *
   * **This used to have a `route: string[]` beside it**, holding the chain of
   * files Blast Radius traced, and the console never drew it: `whyYes` already
   * spells the chain into this sentence (*"reaches the subject in 2 hops through
   * src/a/direct.ts"*), so the field was a second encoding of a fact the player
   * was already being told. Three unit tests asserted its shape and nothing
   * rendered it — infrastructure with no consumer, which `CLAUDE.md` has a
   * landmine about, sitting under it since M2.
   *
   * The claim the empty-array assertions were really making — *a history-graded
   * verb must not show import evidence* — is now made against this string, which
   * is the thing a player reads.
   */
  readonly note: string;
  /**
   * **Why this wrong answer was put on the board** — the generator's own reason,
   * read off `challenge.witness` rather than reconstructed (ADR-0020).
   *
   * `note` and this are different claims and both are wanted: `note` states what
   * is *true* of the candidate today, measured off the graph; this states what
   * the board *intended* by offering it. They agree about half the time, which
   * is the whole reason the label had to be recorded — see `atlas/witness.ts`.
   *
   * `null` on three kinds of row, and the distinction between them is a design
   * decision rather than an omission:
   *
   *  - an **answer**, which no strategy chose;
   *  - a class the verb declines to name because saying it aloud would state a
   *    relation another verb grades — Blast Radius's `coChange` and Companion's
   *    `structural`;
   *  - `distant`, which is padding rather than a strategy, so *"offered because
   *    nothing sharper was left"* is a confession about the board and not a
   *    lesson about the repo.
   *
   * A witness is withheld **by class or by board, never by row**. That rule is
   * what stops the absence of a line from carrying information: on any given
   * board a class is either always spoken or never, so silence separates
   * classes and never candidates within one.
   */
  readonly witness: string | null;
}

/**
 * A map channel an answer may be rendered into.
 *
 * One list, used two ways: `Verb.channel` is the standing licence a restored
 * save is rebuilt from, and `Reveal.unlocks` is what a particular grade just
 * put there. They must agree — `tests/unit/companion.test.ts` pins them — and
 * they are separate because only the second can vary with the answer.
 */
export type RevealChannel = 'importRadius' | 'coChangeTies' | 'nothing';

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
  /**
   * What this reveal has just put on the **map**, as opposed to in the panel.
   *
   * `importRadius` means the subject's full transitive dependent cone may now
   * be drawn, whatever the score — guardrail 6 says a wrong answer takes
   * nothing away, and the reveal has already named every member in words, so
   * withholding the picture would make `summary` a lie ("now drawn on the map"
   * beside a map that is not drawing it).
   *
   * `coChangeTies` means the pairs this reveal has just **named in words** may
   * now be drawn as history wires. Deliberately the named pairs and not the
   * subject's whole co-change row: the summary sentence states the row's
   * *cardinality* ("has changed with N files in all"), while the notes state
   * the *identities* of the board members only. Drawing the row would put 31
   * pairs on this repo's map that no reveal ever named — 18% of the finished
   * layer — which is a new disclosure dressed as a rendering. See ADR-0016.
   *
   * `nothing` means this verb revealed something the map has no channel for.
   * No verb returns it today; it is kept because a verb that reveals a relation
   * the map cannot draw must be able to say so rather than borrow a channel
   * that means something else, which is how the first three leaks happened.
   *
   * On the contract rather than in the console because *"which cone may be
   * drawn"* is a claim about a verb's own answer, and this codebase has three
   * separate instances on record of that judgement being made outside the verb
   * and getting it wrong.
   */
  readonly unlocks: RevealChannel;
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
  /**
   * Which map channel this verb's answers may ever appear in.
   *
   * The **static** twin of `Reveal.unlocks`, and it exists because the reveal
   * alone could not carry the rule. `unlocks` is a fact about one grade and
   * lives only for as long as the panel does; the map has to rebuild the same
   * licence from a *restored save*, where no `Reveal` object has ever existed.
   * Without this the shell reconstructs it by name — `challenge.verb !==
   * 'companion'`, hard-coded, twice — which is precisely the "nothing outside a
   * verb names a verb" seam M4 spent its whole budget building, quietly undone.
   *
   * A verb whose relation the map cannot draw says `nothing`, and its answers
   * are then not drawable by construction rather than by omission.
   */
  readonly channel: RevealChannel;
  /** Pure: same atlas and options ⇒ same challenges, in the same order. */
  generate(atlas: Atlas, options: GenerateOptions): readonly C[];
  /** Pure and self-contained. */
  grade(challenge: C, answer: A): Grade;
  /**
   * The wording, given a way to turn an id into its display name. Pure — the
   * verb never sees the atlas here, only the one name it needs.
   *
   * Total over `AtlasId`: a node resolves to its path, a commit to its date and
   * message. A verb asking for the wrong kind therefore gets a wrong-looking
   * string rather than an id, which is the honest failure — but no verb needs
   * to, since each knows what its own subject is.
   */
  prompt(challenge: C, labelOf: (id: AtlasId) => string): Prompt;
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
   * changes with" for Companion, "was still in that commit" for Placement,
   * "still landed on that file" for Archaeology — and applying one verb's rule
   * to another's pass would drop true claims and keep false ones.
   *
   * `member` is an `AtlasId` since ADR-0019: Archaeology's members are commits.
   * A verb is asked only about its own passes, so each may assume the kind its
   * own boards carry, and a mismatched id falls out as `false` rather than
   * throwing — which is what `livenessOf` wants when a save names a verb's
   * member from an older atlas shape.
   */
  stillHolds(graph: Graph, subject: AtlasId, member: AtlasId): boolean;
  /**
   * What to call this subject on screen, or null when the atlas no longer has
   * it.
   *
   * On the contract because a subject is a place **or** an event (ADR-0018) and
   * only the verb knows which of its atlas's sections to look in. `notes.ts`
   * resolved this with `nodeAt(graph, refById.get(subject))` — correct for two
   * verbs and, for a commit id, `undefined`, which `continue`s: the note would
   * simply never appear, with nothing anywhere to say it had gone. That is the
   * same silent-drop failure `weightsFor` was written to stop, one field over.
   */
  subjectLabel(graph: Graph, subject: AtlasId): string | null;
  /**
   * How far each member of the subject's population sits from it, in this
   * verb's own unit — and, by its key set, **what that population is today**.
   *
   * Recomputed from the atlas rather than stored, so a note follows a rename
   * and decays when the repo does (ADR-0011 decision 3).
   */
  noteWeights(graph: Graph, subject: AtlasId): NoteWeights;
  /**
   * A field note in words. Repo-agnostic templates only (guardrail 2) — every
   * specific string must have come out of the atlas.
   */
  noteProse(facts: NoteFacts): NoteProse;
  /**
   * The atoms this challenge's **reveal** states outright, for a later verb to
   * avoid asking back (ADR-0019 decision 7).
   *
   * Derived from the challenge alone and never from a grade, because the
   * accumulator runs at generation time — before any player exists.
   *
   * **Required rather than optional, and that is the whole point.** An optional
   * member is one a verb author never notices; a required one makes "what does
   * my reveal give away?" a question you must answer to compile. Two of the
   * three existing verbs answer *nothing* (`disclosesNothing`), and that is a
   * measured answer rather than a default: an import cone and a co-change pair
   * are relations between files, and no other verb's answer key is made of
   * them. The moment one is, this is where it gets declared.
   *
   * The direction it runs in is the one nobody looks at: the *offending* reveal
   * belongs to a verb written a milestone earlier, so the leak is invisible from
   * inside the verb that suffers it.
   */
  discloses(challenge: C): Iterable<DisclosedFact>;
  /**
   * The guesses that would **decide** this board, for a later verb to know it
   * must not hand one over (ADR-0022).
   *
   * The mirror of `discloses` and a different kind of claim. That one says
   * *what my reveal states*; this says *what would beat me* — a verdict a later
   * verb checks before speaking, never a fact about my answer key. It takes the
   * graph because a verdict is scored against the repo's own relations, which a
   * `Challenge` alone does not carry — the limit ADR-0020 recorded for
   * `discloses` and worked around, met head-on here.
   *
   * Required for `discloses`'s reason: three verbs answer `decidedByNothing()`
   * and that is a measured answer rather than a default.
   */
  decidedBy(graph: Graph, challenge: C): Iterable<DisclosedFact>;
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
