/**
 * What the player has proved, as a record — and what that record means for the
 * fog.
 *
 * `fog.ts` draws a distinction the whole product rests on:
 *
 *   surveyed    you looked at it. You were shown its name and its numbers.
 *   understood  you proved you knew something about it, by being graded
 *               against ground truth.
 *
 * §9 says field notes accumulate facts you have **proven** you know, not facts
 * you were shown, and that distinction is the product. So:
 *
 *   surveyed    every file whose name appeared in the choice set, plus the
 *               subject. You were shown them. That is all `surveyed` claims.
 *   understood  the subject, and the truth members you actually picked —
 *               and only when the score reached the pass threshold.
 *
 * The two halves matter separately. A file you *missed* was in the answer and
 * you did not know it, so promoting it would write a field note you never
 * earned. A file you picked correctly in an answer that came apart overall is
 * as likely to have been a guess as knowledge, so the pass threshold gates the
 * whole promotion rather than each pick.
 *
 * Guardrail 6 is why nothing here can subtract: every function only ever adds,
 * so a wrong answer costs the player exactly nothing.
 *
 * **`Progress` is the state; `Fog` is a view of it** (ADR-0011 decision 2).
 * `understood` is never stored, because storing it as well as the passes that
 * justify it would be two representations of one fact — and after a reindex
 * they would disagree. `surveyed` *is* stored, because map clicks are not
 * reconstructible from anything else.
 */

import type { NodeId, AtlasId, VerbId } from '../atlas/index.js';
import type { Graph } from '../atlas/index.js';
import { byteCompare, commitIdFor, isNodeId } from '../atlas/index.js';
import type { Challenge } from '../atlas/index.js';
import type { Grade } from '../verbs/index.js';
import { PASS_THRESHOLD } from '../verbs/index.js';
import type { Fog } from './fog.js';

/** Bumped when the stored shape changes. Independent of `ATLAS_VERSION`. */
export const SAVE_VERSION = 1;

/**
 * One challenge the player passed.
 *
 * Keyed by `(verb, subject)`, **never by `challenge.id`**: `docs/atlas-format.md`
 * promises only that a challenge id is stable *within* an atlas, so keying a
 * save on it would depend on a cross-atlas guarantee the format explicitly
 * declines to make.
 */
export interface Pass {
  readonly verb: VerbId;
  /**
   * A node id, or a commit id for a verb that asks about an event (ADR-0018).
   *
   * Opaque here: the save keys on it, orders on it and compares it, and never
   * needs to know which kind it is. That is what let Placement's key be
   * `(verb, subject)` like everyone else's.
   */
  readonly subject: AtlasId;
  /**
   * The truth members the player actually picked. Sorted, unique.
   *
   * A place **or** an event, like the subject and for the same reason
   * (ADR-0019): Archaeology's members are commits. Opaque here — the save keys,
   * orders and compares these and never needs to know which kind they are.
   */
  readonly proved: readonly AtlasId[];
}

export interface Progress {
  readonly version: number;
  /**
   * Sorted, unique. **Node ids only** — this is the map's memory of what you
   * were shown, and a commit has no square to remember.
   */
  readonly surveyed: readonly NodeId[];
  /** Sorted by `(verb, subject)`. */
  readonly passes: readonly Pass[];
  /**
   * `(verb, subject)` keys that have been **graded at least once**, sorted.
   *
   * **A board's pass is decided by its first graded attempt** (ADR-0035 §10,
   * owner's decision). Without this the deck was farmable: the grade line is an
   * oracle — `Found 1 of 4` after a single pick says whether that pick was in
   * the key — and guardrail 6 makes each probe free, so ~20 probes bought a
   * pass and a field note reading *"You proved…"*. Withholding the reveal
   * (ADR-0035) stops the product *handing* the key over; only this stops a
   * farmed pass being recorded as knowledge, which is NORTH-STAR §9's whole
   * distinction.
   *
   * **Additive, and absent means empty**, so a save written before this field
   * existed stays valid and every board's next attempt is its first. That is the
   * generous direction and the only one that does not silently void a player's
   * progress.
   */
  readonly attempted: readonly string[];
}

export const EMPTY_PROGRESS: Progress = {
  version: SAVE_VERSION,
  surveyed: [],
  passes: [],
  attempted: [],
};

function union<T extends string>(existing: readonly T[], added: Iterable<T>): T[] {
  return [...new Set([...existing, ...added])].sort(byteCompare);
}

function passOrder(a: Pass, b: Pass): number {
  return byteCompare(a.verb, b.verb) || byteCompare(a.subject, b.subject);
}

/** Record that the player was shown these nodes. Adds only. */
export function recordSurvey(progress: Progress, ids: Iterable<NodeId>): Progress {
  const surveyed = union(progress.surveyed, ids);
  if (surveyed.length === progress.surveyed.length) return progress;
  return { ...progress, surveyed };
}

/**
 * Record that the player proved something about `subject`.
 *
 * A second pass on the same subject **unions** with the first rather than
 * replacing it: answer keys are sampled (ADR-0008), so two passes on one hub can
 * prove different members, and guardrail 6 forbids the second attempt taking
 * away what the first earned.
 */
export function recordPass(
  progress: Progress,
  verb: VerbId,
  subject: AtlasId,
  proved: Iterable<AtlasId>,
): Progress {
  const passes = [...progress.passes];
  const at = passes.findIndex((pass) => pass.verb === verb && pass.subject === subject);
  const existing = at === -1 ? undefined : passes[at];
  const merged: Pass = {
    verb,
    subject,
    proved: union(existing?.proved ?? [], proved),
  };
  if (at === -1) passes.push(merged);
  else passes[at] = merged;
  passes.sort(passOrder);
  return { ...progress, passes };
}

export interface Progression {
  readonly progress: Progress;
  /**
   * True when this grade reached the pass threshold.
   *
   * Named for what it means now rather than for what one verb does with it:
   * this used to read "unlocked the subject's full radius", which is false for
   * a Companion pass and is the kind of verb-specific wording that invites the
   * next leak. What a pass unlocks is the verb's business (`subjectsPassed`).
   */
  readonly unlocked: boolean;
}

export function applyGrade(
  progress: Progress,
  challenge: Challenge,
  grade: Grade,
  threshold = PASS_THRESHOLD,
): Progression {
  // **Node ids only.** `surveyed` and `understood` are sets of *files* — the
  // fog is a property of the map — and a commit has no square on it. Filtering
  // here rather than inside `recordSurvey` keeps the filter next to the one
  // place a non-node subject can enter the record.
  const seen = [challenge.subject, ...challenge.candidates].filter(isNodeId);
  let next = recordSurvey(progress, seen);
  const key = answerKey(challenge.verb, challenge.subject);
  // **The first graded attempt is the one that counts** (ADR-0035 §10). Reading
  // it *before* recording keeps this a property of the answer rather than of the
  // order of two lines — the shape of defect this file already carries a comment
  // about one field down.
  const first = !progress.attempted.includes(key);
  next = { ...next, attempted: union(next.attempted, [key]) };
  const passed = grade.score >= threshold && first;
  if (passed) next = recordPass(next, challenge.verb, challenge.subject, grade.correct);
  // `unlocked` is the *map* channel and stays keyed on the score alone: ADR-0008
  // decision 1 and guardrail 6 both say a reveal's picture follows its words, and
  // the words are still shown (ADR-0035 explains any passing answer). A retry
  // that reads well and draws nothing would be the vanishing-wires defect again.
  return { progress: next, unlocked: grade.score >= threshold };
}

// ---------------------------------------------------------------------------
// deriving the fog
// ---------------------------------------------------------------------------

/**
 * What the *current* atlas still says about a stored claim.
 *
 * A save outlives the repo state it was earned against, so every claim has to
 * be re-checked before it is rendered as knowledge (ADR-0011 decision 3).
 * Provenance is immutable — you did prove it — but the claim about *today* is
 * validated here, and a pair that no longer holds is dropped. Showing a stale
 * claim as current knowledge would be a worse lie than showing nothing.
 */
export interface Liveness {
  /**
   * True when this id names something the atlas now loaded still contains — a
   * node, or (for a commit subject) a retained commit.
   *
   * Both arms are the same question and it is deliberately **not** asked of the
   * verb: "is this still here?" is a fact about the atlas, and answering it by
   * prefix keeps it total for an id whose verb this build does not have.
   */
  exists(id: AtlasId): boolean;
  /**
   * True when the claim `(verb, subject, member)` still holds.
   *
   * **Per verb, and that is not a refinement — it is the difference between
   * dropping true claims and keeping false ones.** Before M4 this was
   * `dependsOn`, one rule for one verb: "does `member` still transitively
   * import `subject`". Applied to a Companion pass it would delete every claim
   * about a co-change pair that never imported anything — which is most of them
   * (67% on hono, 89% on svelte) — while a Blast Radius claim checked against
   * the co-change matrix would survive on coincidence.
   *
   * The rule itself belongs to the verb (`Verb.stillHolds`), because only the
   * verb knows what it asserted.
   */
  holds(verb: VerbId, subject: AtlasId, member: AtlasId): boolean;
}

/**
 * A `Liveness` that agrees with everything. **Fixtures and tests only** — it
 * turns the decay check off, which is the one thing that keeps a restored save
 * honest.
 */
export const UNCHECKED: Liveness = { exists: () => true, holds: () => true };

/**
 * The real thing, over a loaded graph.
 *
 * Memoised per `(verb, subject)`: restoring a save asks this once per stored
 * member, and both verbs' checks are a whole-cone or whole-matrix sweep.
 */
export function livenessOf(graph: Graph, verbs: VerbLookup): Liveness {
  const cones = new Map<string, ReadonlySet<AtlasId>>();
  const commits = new Set(graph.atlas.history.commits.map((commit) => commitIdFor(commit.sha)));
  return {
    // A commit that has slid out of the atlas's window takes its pass with it,
    // which is ADR-0011 decision 3 rather than a loss: the claim is still true
    // of the repo, and nothing loaded can confirm it. The record is retained in
    // storage, so a reindex that brings the commit back brings the note back.
    exists: (id) => (isNodeId(id) ? graph.refById.has(id) : commits.has(id)),
    holds: (verb, subject, member) => {
      const key = `${verb}\n${subject}`;
      let cone = cones.get(key);
      if (cone === undefined) {
        const implementation = verbs[verb];
        const found = new Set<AtlasId>();
        // Ask the verb about every id once rather than per member: the
        // implementations are a cone walk and a matrix lookup, and calling
        // either once per stored claim turns an O(1) question into an O(V·E)
        // one on a save with a full notebook.
        //
        // **Both populations, and this is a defect the compiler could not see.**
        // The scan was `atlas.nodes` alone, on the assumption a member is a
        // file. Archaeology's members are commits, so every one of its claims
        // would have been absent from this set, `livePasses` would have filtered
        // the pass to empty, and `livePasses` drops an empty pass — silently
        // re-fogging the subject and putting the question back. Asking each verb
        // about ids it never issues is cheap and total: a commit id is not in a
        // cone and a node id is not in a file list, so both simply answer false.
        if (implementation !== undefined) {
          for (const node of graph.atlas.nodes) {
            if (implementation.stillHolds(graph, subject, node.id)) found.add(node.id);
          }
          for (const id of commits) {
            if (implementation.stillHolds(graph, subject, id)) found.add(id);
          }
        }
        cone = found;
        cones.set(key, cone);
      }
      return cone.has(member);
    },
  };
}

/** Just enough of `VERBS` to check a claim. Injected so this module stays pure. */
export type VerbLookup = Readonly<Partial<Record<VerbId, { stillHolds: StillHolds }>>>;
type StillHolds = (graph: Graph, subject: AtlasId, member: AtlasId) => boolean;

/**
 * The stored passes that the current atlas still bears out, each narrowed to
 * the members whose claim still holds.
 *
 * This is the seam everything downstream reads: the fog, the question deck, and
 * (at rung 3) the field notes. One decay rule, applied once.
 *
 * Stored ids that name nothing are ignored here and **kept in storage**:
 * retention is what makes reverting a deletion restore your map.
 */
export function livePasses(progress: Progress, liveness: Liveness): Pass[] {
  const live: Pass[] = [];
  for (const pass of progress.passes) {
    if (!liveness.exists(pass.subject)) continue;
    const proved = pass.proved.filter(
      (member) => liveness.exists(member) && liveness.holds(pass.verb, pass.subject, member),
    );
    // A fully decayed pass drops out entirely, which demotes its subject: the
    // map re-fogs, honestly, because the thing the player proved is no longer
    // true — and the question comes back, because it is unanswered again.
    if (proved.length === 0) continue;
    live.push({ verb: pass.verb, subject: pass.subject, proved });
  }
  return live;
}

/** The key a challenge is "answered" under. `(verb, subject)`, never `id`. */
export function answerKey(verb: VerbId, subject: AtlasId): string {
  return `${verb}\n${subject}`;
}

/**
 * The questions the player has actually answered, as `(verb, subject)` keys.
 *
 * Deliberately **not** the same as `fog.understood`. Picking a file correctly in
 * someone else's question promotes it to `understood` — you proved you knew it
 * sits in that answer — but it says nothing about the question *that file* is
 * the subject of. Reading the deck off the fog silently retired questions
 * nobody had answered.
 *
 * **Keyed per verb since M4, and the old comment here predicted exactly why**:
 * collapsing over verbs was correct only while there was one, because a Blast
 * Radius pass would otherwise retire the Companion question about the same
 * file. `Pass` has carried the verb since M3 for this.
 */
export function answeredKeys(progress: Progress, liveness: Liveness): Set<string> {
  return new Set(livePasses(progress, liveness).map((pass) => answerKey(pass.verb, pass.subject)));
}

/**
 * The files whose **own** question of one verb the player has passed.
 *
 * This exists because `fog.understood` is verb-blind and one consumer must not
 * be. `main.ts` unlocks a node's full transitive dependent radius for anything
 * in this set, which is ADR-0008 decision 1: you may see the cone you proved
 * you knew. Feed that rule a verb-blind set the moment a second verb exists and
 * **passing a Companion question prints the answer to the still-open Blast
 * Radius question about the same file** — the M1 hover leak, reopened from the
 * side, and it would have shipped invisibly because no test asks what one
 * verb's pass does to another verb's board.
 *
 * **Subjects only, and the members are excluded for the same reason the other
 * verb is.** This returned `pass.proved` as well until ADR-0016 measured what
 * that costs: a file picked correctly inside S's question got its own full cone
 * drawn while *its own* board was still open, and by ADR-0008's invariant
 * (`candidates ∩ dependents(M, ∞) = truth`) the drawn set intersected with that
 * board is its answer key — measured at `e6f7e2f`, **26 of 40 boards are
 * exposable this way and all 26 recover byte-exact**; 9 of them do in the
 * deck's actual serving order, 6 at once at the worst frame. Hovering S does
 * not substitute: `cone(S)` strictly overapproximates `cone(M)` and can contain
 * M's certified distractors, so it never isolates the key, where `cone(M)`
 * does, precisely.
 *
 * ADR-0008 decision 1 always said this — *"permanently unlocked by passing that
 * node's challenge"* — so the member half was a divergence from the decision of
 * record rather than a decision anyone took. Proving that D depends on S is not
 * proving you know what depends on D.
 *
 * **Not gated on whether M's board is open**, which was the other candidate fix:
 * ADR-0008 forbids it in as many words (*"the rule must not depend on whether a
 * challenge is open, because the leak happens at the moment of choosing the
 * subject"*), and a rule that reads deck state would go stale the moment a
 * question is added.
 *
 * `understood` stays verb-blind on purpose: proving *anything* about a file is
 * a real reason to know its name. It is the radius, not the label, that has to
 * be earned in the verb that asks about it.
 */
export function subjectsPassed(
  progress: Progress,
  liveness: Liveness,
  verb: VerbId,
): Set<NodeId> {
  const subjects = new Set<NodeId>();
  for (const pass of livePasses(progress, liveness)) {
    // `isNodeId` because the caller draws a cone around each member: a commit
    // subject has no position, and letting one through would make the map's
    // unlock set contain an id `refById` cannot resolve.
    if (pass.verb === verb && isNodeId(pass.subject)) subjects.add(pass.subject);
  }
  return subjects;
}

/**
 * The fog implied by a record, against the atlas currently loaded.
 *
 * `base` is the head start `fog.ts` derives from the graph — the landmarks. It
 * is passed in rather than stored, because it is a property of the repo and not
 * of the player, and a stored copy would go stale the moment the graph moved.
 */
export function deriveFog(
  progress: Progress,
  liveness: Liveness,
  base: Iterable<NodeId> = [],
): Fog {
  const surveyed = new Set<NodeId>();
  for (const id of base) if (liveness.exists(id)) surveyed.add(id);
  for (const id of progress.surveyed) if (liveness.exists(id)) surveyed.add(id);

  const understood = new Set<NodeId>();
  for (const pass of livePasses(progress, liveness)) {
    // A commit subject un-fogs nothing of its own — it is not on the map. Its
    // proved members still promote, below, which is the whole of what a
    // Placement pass reveals.
    if (isNodeId(pass.subject)) {
      understood.add(pass.subject);
      surveyed.add(pass.subject);
    }
    // **Node members only, and that filter is new.** `understood` and
    // `surveyed` are sets of *squares*; an Archaeology pass proves commits,
    // which have none. Without this the fog would carry ids `refById` cannot
    // resolve — invisible on the map, and counted in every "how much have I
    // uncovered" number that reads `fog.surveyed.size`.
    for (const member of pass.proved) {
      if (!isNodeId(member)) continue;
      understood.add(member);
      surveyed.add(member);
    }
  }
  return { surveyed, understood };
}
