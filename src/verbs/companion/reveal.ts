/**
 * Companion's reveal: what the player learns from the grade.
 *
 * The lesson this verb teaches lives here, not in the score. A player who picks
 * a file because the subject imports it should be told *that is why they picked
 * it and it was not enough* — an import is a compile-time fact and this
 * question is about maintenance. And a player who missed a companion with no
 * import edge in either direction should be told exactly that, because it is
 * NORTH-STAR §2's "secretly one module wearing two hats" arriving as a
 * measured fact about their own repo.
 *
 * Every note below is read off the co-change matrix or the import graph. None
 * of it is authored per repo (guardrail 2), and none of it is in the grading
 * path — the score is fixed before this runs.
 */

import type { Atlas, Challenge, Graph, NodeId, NodeRef } from '../../atlas/index.js';
import { byteCompare, nodeAt } from '../../atlas/index.js';
import type { Grade, NoteKind, Reveal, RevealNote } from '../types.js';
import { directoryOf } from '../paths.js';
import { indexCoChange } from './cochange.js';

const ORDER: Readonly<Record<NoteKind, number>> = { missed: 0, spurious: 1, correct: 2 };

export function revealOf(
  atlas: Atlas,
  graph: Graph,
  challenge: Challenge,
  grade: Grade,
): Reveal {
  const refById = graph.refById;
  const subjectRef = refById.get(challenge.subject);
  if (subjectRef === undefined) {
    throw new RangeError(`challenge ${challenge.id} names a subject not in this atlas`);
  }
  const subjectPath = nodeAt(graph, subjectRef).path;
  const row = indexCoChange(atlas).rows.get(subjectRef) ?? new Map<NodeRef, number>();

  // Direct import neighbours, either direction — the relation a player most
  // often mistakes for this one.
  const imports = new Set<NodeRef>();
  for (const edge of graph.out[subjectRef] ?? []) imports.add(edge.to);
  const importedBy = new Set<NodeRef>();
  for (const edge of graph.in[subjectRef] ?? []) importedBy.add(edge.from);

  const notes: RevealNote[] = [];
  const add = (id: NodeId, kind: NoteKind): void => {
    const ref = refById.get(id);
    if (ref === undefined) return;
    const path = nodeAt(graph, ref).path;
    const together = row.get(ref);
    notes.push({
      id,
      path,
      kind,
      // A co-change pair is not a path through anything — there is no chain of
      // files to walk. Leaving this empty is the honest answer; inventing a
      // route from the import graph would show the player evidence that did not
      // produce the grade.
      route: [],
      note:
        together === undefined
          ? whyNot(ref, path, subjectPath, imports, importedBy, nodeAt(graph, ref).churn)
          : whyYes(together, ref, imports, importedBy),
    });
  };

  for (const id of grade.missed) add(id, 'missed');
  for (const id of grade.spurious) add(id, 'spurious');
  for (const id of grade.correct) add(id, 'correct');

  notes.sort(
    (a, b) =>
      ORDER[a.kind] - ORDER[b.kind] ||
      (row.get(refById.get(b.id) ?? -1) ?? 0) - (row.get(refById.get(a.id) ?? -1) ?? 0) ||
      byteCompare(a.path, b.path),
  );

  // How many partners the matrix knows about, against how many were on the
  // board. The gap is exactly what sampling left out, and naming it is what
  // keeps the answer key honest under "which of these" (ADR-0008's argument,
  // reused).
  const partners = row.size;
  const shown = challenge.truth.length;
  const summary =
    partners > shown
      ? `${subjectPath} has changed with ${partners} files in all — ${partners - shown} more than this board asked about.`
      : `That is every file the history records changing with ${subjectPath}.`;

  return { subject: subjectPath, summary, notes };
}

function whyYes(
  together: number,
  ref: NodeRef,
  imports: ReadonlySet<NodeRef>,
  importedBy: ReadonlySet<NodeRef>,
): string {
  const times = `changed with the subject in ${together} commit${together === 1 ? '' : 's'}`;
  if (imports.has(ref)) return `${times} — and the subject imports it, so they move as one unit.`;
  if (importedBy.has(ref)) return `${times} — and it imports the subject.`;
  // The flagship lesson: coupled in fact, invisible to the import graph.
  return `${times}, and neither file imports the other — a coupling the import graph cannot see.`;
}

function whyNot(
  ref: NodeRef,
  path: string,
  subjectPath: string,
  imports: ReadonlySet<NodeRef>,
  importedBy: ReadonlySet<NodeRef>,
  churn: number,
): string {
  if (imports.has(ref) || importedBy.has(ref)) {
    // §8.3's best distractor class, explaining itself: a dependency you never
    // have to touch is the healthiest thing in a codebase.
    return imports.has(ref)
      ? 'the subject imports it, and yet they have never changed together — a stable dependency.'
      : 'it imports the subject, and yet they have never changed together.';
  }
  if (churn > 0) {
    return `edited in ${churn} commit${churn === 1 ? '' : 's'}, but never in one that also touched the subject.`;
  }
  if (directoryOf(path) === directoryOf(subjectPath)) {
    return 'same directory, never changed together — a folder is not a change unit.';
  }
  return 'no commit in the window touched both files.';
}
