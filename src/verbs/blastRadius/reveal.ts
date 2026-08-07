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
 * note below is a fact read off the graph or the co-change matrix; none of it
 * is authored per repo (guardrail 2).
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
  routeTo,
} from '../../atlas/index.js';
import type { Grade } from '../types.js';
import { directoryOf } from './distractors.js';

export type NoteKind = 'correct' | 'missed' | 'spurious';

export interface RevealNote {
  readonly id: NodeId;
  readonly path: string;
  readonly kind: NoteKind;
  /** Hops from this file to the subject, or `null` when it does not reach it. */
  readonly distance: number | null;
  /** The import chain to the subject, as paths. Empty when there is none. */
  readonly route: readonly string[];
  /** Why. Derived from the graph, never canned. */
  readonly note: string;
}

export interface Reveal {
  readonly subject: string;
  /** Every dependent of the subject, whether or not it was on the board. */
  readonly radius: number;
  /** Sorted: missed first (the lesson), then spurious, then correct. */
  readonly notes: readonly RevealNote[];
}

const ORDER: Readonly<Record<NoteKind, number>> = { missed: 0, spurious: 1, correct: 2 };

export function revealOf(atlas: Atlas, graph: Graph, challenge: Challenge, grade: Grade): Reveal {
  const refById = graph.refById;
  const subjectRef = refById.get(challenge.subject);
  if (subjectRef === undefined) {
    throw new RangeError(`challenge ${challenge.id} names a subject not in this atlas`);
  }
  const subjectPath = nodeAt(graph, subjectRef).path;
  const reached = dependents(graph, subjectRef, Number.POSITIVE_INFINITY);
  const routes = dependentRoutes(graph, subjectRef);
  const coChange = coChangeWith(atlas, subjectRef);
  const imported = dependencies(graph, subjectRef, Number.POSITIVE_INFINITY);

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
      path,
      kind,
      distance,
      route,
      note:
        distance === null
          ? whyNot(ref, path, subjectPath, imported, coChange)
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
      byteCompare(a.path, b.path),
  );

  return { subject: subjectPath, radius: reached.size, notes };
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
  coChange: ReadonlyMap<NodeRef, number>,
): string {
  const depth = imported.get(ref);
  if (depth !== undefined) {
    // The flagship distractor (ADR-0008 §4) explaining itself.
    return depth === 1
      ? 'the subject imports this — the arrow points the other way.'
      : `the subject depends on this (${depth} hops out), not the reverse.`;
  }
  const together = coChange.get(ref);
  if (together !== undefined) {
    return `changed with the subject in ${together} commits, but never imports it.`;
  }
  if (directoryOf(path) === directoryOf(subjectPath)) {
    return 'same directory, no import path — a folder is not a module.';
  }
  return 'no chain of imports reaches the subject.';
}

function coChangeWith(atlas: Atlas, subject: NodeRef): Map<NodeRef, number> {
  const counts = new Map<NodeRef, number>();
  for (const [a, b, count] of atlas.history.coChange) {
    if (a === subject) counts.set(b, count);
    else if (b === subject) counts.set(a, count);
  }
  return counts;
}
