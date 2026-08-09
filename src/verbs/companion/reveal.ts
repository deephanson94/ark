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
import { byteCompare, nodeAt, readWitness } from '../../atlas/index.js';
import type { Grade, NoteKind, Reveal, RevealNote } from '../types.js';
import { directoryOf } from '../paths.js';
import { indexCoChange } from './cochange.js';

const ORDER: Readonly<Record<NoteKind, number>> = { missed: 0, spurious: 1, correct: 2 };

/**
 * The negative witness: why the generator put this wrong answer here.
 *
 * **`structural` is deliberately absent, and it is the one exclusion that is a
 * judgement rather than an arithmetic.** That strategy walks the import graph
 * outward from the subject **unbounded**, so a label saying *"an import edge
 * connects these two"* is free on the direct ring — the map draws those edges
 * (ADR-0008 decision 1) and `whyNot` already names the relation in words — and
 * is a new statement for everything beyond it. Measured: of 219 `structural`
 * slots here 133 are on the direct ring, and of the 86 deeper ones **1 is a
 * member of the subject's own shipped Blast Radius answer key**; on
 * `honojs/hono` 96 of 264, and again 1. So the label buys nothing where it is
 * safe and states an undrawn cone edge where it is not.
 *
 * A per-row guard was the obvious repair and is worse: withholding only the deep
 * rows makes silence mean *"deep structural"*, which is the fact being withheld.
 * ADR-0020's rule — withhold by class or by board, never by row — comes from
 * exactly this case.
 *
 * `distant` is absent because it is padding rather than a strategy.
 */
const WITNESS: Readonly<Record<string, string>> = {
  busy: 'one of the repo’s most-edited files',
  // Not "a directory sibling": this strategy widens outward through shared path
  // prefixes when the directory runs dry, so the textbook gloss is false on 23
  // of this repo's 148 rows and **121 of hono's 211**. See the same note in
  // `blastRadius/reveal.ts`.
  treeSibling: 'a near neighbour in the directory tree',
  nameSimilar: 'a name-alike',
};

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
  const witnesses = readWitness(challenge);

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
      label: path,
      kind,
      witness: WITNESS[witnesses.get(id) ?? ''] ?? null,
      // **No import evidence in a history-graded note.** A chain of files did not
      // produce this answer, so naming one would show the player evidence that did
      // not. The rule used to live on a `route: []` beside this field; it moved here
      // when that field went, because prose is where it can actually be broken.
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
      byteCompare(a.label, b.label),
  );

  // How many partners the matrix knows about, against how many were on the
  // board. The gap is exactly what sampling left out, and naming it is what
  // keeps the answer key honest under "which of these" (ADR-0008's argument,
  // reused).
  const partners = row.size;
  const shown = challenge.truth.length;
  // **What this sentence may promise, and what it must not.**
  //
  // The obvious wording — "now drawn on the map" — is false within one click.
  // A wire is withheld while *either* of its files still carries an open
  // Companion question, so 79% of the pairs named here are not on the map when
  // the panel closes (6 named and 1 drawn on the board the e2e plays). That is
  // the defect `main.ts`'s `onGraded` records shipping once already, in the
  // other direction: a panel insisting the map was drawing something it had
  // stopped drawing.
  //
  // So the claim is about the *record*, which is unconditional, and the timing
  // is stated rather than glossed. A verb may say what it revealed; only the
  // player knows what is on screen.
  const wires = shown === 1 ? 'a history wire' : 'history wires';
  const when = `, drawn once both files' questions are answered`;
  const summary =
    partners > shown
      ? `${subjectPath} has changed with ${partners} files in all — ${partners - shown} more than this board asked about. The ${shown} it did ask about ${shown === 1 ? 'becomes' : 'become'} ${wires}${when}.`
      : `That is every file the history records changing with ${subjectPath}, and ${shown === 1 ? 'it becomes' : 'they become'} ${wires}${when}.`;

  // **Exactly the pairs named above, and not the subject's row.** The sentence
  // states how many partners exist; the notes state *which* of them were on the
  // board. Drawing the row would put 31 pairs on this repo's finished map that
  // no reveal ever named — 18% of the layer — and ADR-0011 decision 3 is
  // precisely the rule that a count may be shown while a name must be earned.
  //
  // The count above is still `row.size`, deliberately: the gap between what
  // exists and what was asked is the honest part, and hiding it to make the
  // sentence tidier is how "which of these" stops being a fair question.
  return { subject: subjectPath, summary, unlocks: 'coChangeTies', notes };
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
