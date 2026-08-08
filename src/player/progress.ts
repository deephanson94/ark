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

import type { NodeId, VerbId } from '../atlas/index.js';
import type { Graph } from '../atlas/index.js';
import { byteCompare } from '../atlas/index.js';
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
  readonly subject: NodeId;
  /** The truth members the player actually picked. Sorted, unique. */
  readonly proved: readonly NodeId[];
}

export interface Progress {
  readonly version: number;
  /** Sorted, unique. */
  readonly surveyed: readonly NodeId[];
  /** Sorted by `(verb, subject)`. */
  readonly passes: readonly Pass[];
}

export const EMPTY_PROGRESS: Progress = { version: SAVE_VERSION, surveyed: [], passes: [] };

function union(existing: readonly NodeId[], added: Iterable<NodeId>): NodeId[] {
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
  subject: NodeId,
  proved: Iterable<NodeId>,
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
  let next = recordSurvey(progress, [challenge.subject, ...challenge.candidates]);
  const passed = grade.score >= threshold;
  if (passed) next = recordPass(next, challenge.verb, challenge.subject, grade.correct);
  return { progress: next, unlocked: passed };
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
  /** True when this id names a node in the atlas now loaded. */
  exists(id: NodeId): boolean;
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
  holds(verb: VerbId, subject: NodeId, member: NodeId): boolean;
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
  const cones = new Map<string, ReadonlySet<NodeId>>();
  return {
    exists: (id) => graph.refById.has(id),
    holds: (verb, subject, member) => {
      const key = `${verb}\n${subject}`;
      let cone = cones.get(key);
      if (cone === undefined) {
        const implementation = verbs[verb];
        const found = new Set<NodeId>();
        // Ask the verb about every node once rather than per member: the
        // implementations are a cone walk and a matrix lookup, and calling
        // either once per stored claim turns an O(1) question into an O(V·E)
        // one on a save with a full notebook.
        if (implementation !== undefined) {
          for (const node of graph.atlas.nodes) {
            if (implementation.stillHolds(graph, subject, node.id)) found.add(node.id);
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
type StillHolds = (graph: Graph, subject: NodeId, member: NodeId) => boolean;

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
export function answerKey(verb: VerbId, subject: NodeId): string {
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
    if (pass.verb === verb) subjects.add(pass.subject);
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
    understood.add(pass.subject);
    surveyed.add(pass.subject);
    for (const member of pass.proved) {
      understood.add(member);
      surveyed.add(member);
    }
  }
  return { surveyed, understood };
}
