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
import { byteCompare, dependents, idOf } from '../atlas/index.js';
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
  /** True when this grade unlocked the subject's full radius. */
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
  /** True when `member` still transitively depends on `subject`. */
  dependsOn(subject: NodeId, member: NodeId): boolean;
}

/**
 * A `Liveness` that agrees with everything. **Fixtures and tests only** — it
 * turns the decay check off, which is the one thing that keeps a restored save
 * honest.
 */
export const UNCHECKED: Liveness = { exists: () => true, dependsOn: () => true };

/** The real thing, over a loaded graph. Memoised: one sweep per subject. */
export function livenessOf(graph: Graph): Liveness {
  const cones = new Map<NodeId, ReadonlySet<NodeId>>();
  const coneOf = (subject: NodeId): ReadonlySet<NodeId> => {
    const cached = cones.get(subject);
    if (cached !== undefined) return cached;
    const ref = graph.refById.get(subject);
    const cone = new Set<NodeId>();
    if (ref !== undefined) {
      for (const dependent of dependents(graph, ref, Infinity).keys()) cone.add(idOf(graph, dependent));
    }
    cones.set(subject, cone);
    return cone;
  };
  return {
    exists: (id) => graph.refById.has(id),
    dependsOn: (subject, member) => coneOf(subject).has(member),
  };
}

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
      (member) => liveness.exists(member) && liveness.dependsOn(pass.subject, member),
    );
    // A fully decayed pass drops out entirely, which demotes its subject: the
    // map re-fogs, honestly, because the thing the player proved is no longer
    // true — and the question comes back, because it is unanswered again.
    if (proved.length === 0) continue;
    live.push({ verb: pass.verb, subject: pass.subject, proved });
  }
  return live;
}

/**
 * The subjects the player has actually answered a question about.
 *
 * Deliberately **not** the same as `fog.understood`. Picking a file correctly in
 * someone else's question promotes it to `understood` — you proved you knew it
 * sits in that radius — but it says nothing about *its own* radius, which is a
 * different question the player has not been asked. Reading the deck off the
 * fog silently retired questions nobody had answered.
 */
export function answeredSubjects(progress: Progress, liveness: Liveness): Set<NodeId> {
  return new Set(livePasses(progress, liveness).map((pass) => pass.subject));
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
