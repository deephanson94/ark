/**
 * The reveal: what the player learns from the grade.
 *
 * `grade()` returns ids and a one-line evidence string, because it is pure over
 * `(challenge, answer)` and has no atlas to turn an id into a path. This module
 * has the atlas, and turns each pick into the *reason* it was or was not in the
 * blast radius — the route it travels, or the specific way it looks coupled and
 * isn't.
 *
 * Nothing here is in the grading path (guardrail 3 is about models, but the
 * same discipline applies: the score must not depend on presentation). Every
 * note below is a fact read off **the import graph**, and only that; none of it
 * is authored per repo (guardrail 2).
 *
 * It used to read the co-change matrix too. See `whyNot` for why it must not.
 *
 * This is where the distractor strategies pay off. A player who picks
 * `src/atlas/order.ts` for a question about `src/atlas/schema.ts` gets told
 * that the two are imported by the same files and never import each other —
 * which is a better thing to learn than "wrong".
 */

import type { Atlas, Challenge, Graph, NodeId, NodeRef } from '../../atlas/index.js';
import {
  byteCompare,
  dependencies,
  dependentRoutes,
  dependents,
  nodeAt,
  readWitness,
  routeTo,
} from '../../atlas/index.js';
import type { Grade, NoteKind, Reveal as VerbReveal, RevealNote as VerbRevealNote } from '../types.js';
import { directoryOf } from '../paths.js';

export type { NoteKind };

/**
 * The shared note plus the one field only an import graph has. Widening rather
 * than replacing keeps `Verb.reveal`'s return type honest — the console reads
 * the shared shape and never learns what a hop is.
 */
export interface RevealNote extends VerbRevealNote {
  /** Hops from this file to the subject, or `null` when it does not reach it. */
  readonly distance: number | null;
}

/**
 * The negative witness: why the generator put this wrong answer here.
 *
 * **`coChange` is deliberately absent, and this is the trap of the whole
 * feature.** `coChangeStrategy` seeds those distractors from the matrix ranked
 * count-descending, which is exactly Companion's answer key for the same
 * subject — so *"offered because it changes with the subject"* is the sentence
 * `whyNot` deleted below, reintroduced as a label. Measured on the shipped
 * decks: of this repo's 12 co-change distractors, 6 sit on a subject that also
 * carries a Companion board and **3 are members of that board's answer key**; on
 * `honojs/hono`, 6 and 3 of 53. The atlas still *records* `coChange` — that is
 * the honest provenance, and §7.1 puts `truth` in plaintext for the same reason
 * — and this table is the gate on what the panel says out loud.
 *
 * `distant` is absent because it is padding rather than a strategy (ADR-0020).
 */
const WITNESS: Readonly<Record<string, string>> = {
  graphAdjacent: 'a structural near-miss in the import graph',
  treeSibling: 'a directory sibling',
  nameSimilar: 'a name-alike',
};

export interface Reveal extends VerbReveal {
  /** Every dependent of the subject, whether or not it was on the board. */
  readonly radius: number;
  readonly notes: readonly RevealNote[];
}

const ORDER: Readonly<Record<NoteKind, number>> = { missed: 0, spurious: 1, correct: 2 };

// `_atlas` is unused since the co-change sentence went (see `whyNot`), but the
// parameter stays because `Verb.reveal` is the seam's shape and Companion needs
// it. A verb that happens not to read the atlas is not a reason to change the
// contract for the one that does.
export function revealOf(_atlas: Atlas, graph: Graph, challenge: Challenge, grade: Grade): Reveal {
  const refById = graph.refById;
  const subjectRef = refById.get(challenge.subject);
  if (subjectRef === undefined) {
    throw new RangeError(`challenge ${challenge.id} names a subject not in this atlas`);
  }
  const subjectPath = nodeAt(graph, subjectRef).path;
  const reached = dependents(graph, subjectRef, Number.POSITIVE_INFINITY);
  const routes = dependentRoutes(graph, subjectRef);
  const imported = dependencies(graph, subjectRef, Number.POSITIVE_INFINITY);
  const witnesses = readWitness(challenge);

  const notes: RevealNote[] = [];
  const add = (id: NodeId, kind: NoteKind): void => {
    const ref = refById.get(id);
    if (ref === undefined) return;
    const path = nodeAt(graph, ref).path;
    const distance = reached.get(ref) ?? null;
    const route =
      distance === null ? [] : routeTo(routes, ref).map((step) => nodeAt(graph, step).path);
    notes.push({
      id,
      label: path,
      kind,
      distance,
      route,
      witness: WITNESS[witnesses.get(id) ?? ''] ?? null,
      note:
        distance === null
          ? whyNot(ref, path, subjectPath, imported)
          : whyYes(distance, route),
    });
  };

  for (const id of grade.missed) add(id, 'missed');
  for (const id of grade.spurious) add(id, 'spurious');
  for (const id of grade.correct) add(id, 'correct');

  notes.sort(
    (a, b) =>
      ORDER[a.kind] - ORDER[b.kind] ||
      (b.distance ?? 0) - (a.distance ?? 0) ||
      byteCompare(a.label, b.label),
  );

  return {
    subject: subjectPath,
    radius: reached.size,
    // The console used to write this sentence itself, which meant it knew what
    // a blast radius was. It belongs to the verb that sampled the key.
    summary: `Its full blast radius is ${reached.size} file${reached.size === 1 ? '' : 's'} — now drawn on the map.`,
    // Pass or fail. The sentence above promises the map draws it, and
    // guardrail 6 forbids a wrong answer taking that away.
    unlocks: 'importRadius',
    notes,
  };
}

function whyYes(distance: number, route: readonly string[]): string {
  if (distance === 1) return 'imports the subject directly.';
  const via = route.slice(1, -1);
  const through = via.length === 0 ? '' : ` through ${via.join(' → ')}`;
  return `reaches the subject in ${distance} hops${through}.`;
}

function whyNot(
  ref: NodeRef,
  path: string,
  subjectPath: string,
  imported: ReadonlyMap<NodeRef, number>,
): string {
  const depth = imported.get(ref);
  if (depth !== undefined) {
    // The flagship distractor (ADR-0008 §4) explaining itself.
    return depth === 1
      ? 'the subject imports this — the arrow points the other way.'
      : `the subject depends on this (${depth} hops out), not the reverse.`;
  }
  // **There is deliberately no co-change sentence here any more.**
  //
  // This used to read "changed with the subject in N commits, but never imports
  // it" — §8.3's best distractor explaining itself, and free while this was the
  // only verb. It is not free now. `coChangeStrategy` seeds these distractors
  // from the matrix *ranked count-descending*, which is precisely Companion's
  // answer key for the same subject; and for a shared subject Blast Radius is
  // always served first (`blast-` sorts before `companion-`), so that Companion
  // question is open when this renders. Falling for the flagship distractor
  // handed the player a member of the other verb's answer, with its count.
  //
  // Third instance of one class — after the map's radius unlock and the
  // inspector's count — and the first to run in the *opposite* direction, from
  // the older verb into the newer one. The lesson it carried is not lost:
  // Companion now asks about that coupling directly, which teaches it better
  // than a parenthetical ever did.
  if (directoryOf(path) === directoryOf(subjectPath)) {
    return 'same directory, no import path — a folder is not a module.';
  }
  return 'no chain of imports reaches the subject.';
}

