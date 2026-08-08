/**
 * Placement's reveal: what the player learns from the grade.
 *
 * The lesson this verb teaches is about the **shape of a change**, and every
 * note below states it as a measured fact about the player's own repo:
 *
 *  - a file they picked that the commit did not touch, but that *imports* one it
 *    did — the compile-time neighbourhood of a change is not the change;
 *  - a file they picked whose **name is in the message** and whose contents are
 *    not in the diff — the message says what someone meant, the diff says what
 *    moved;
 *  - a file they missed that sits nowhere near the others — the cross-cutting
 *    member, which is the whole reason this question is worth asking.
 *
 * Nothing here is authored per repo (guardrail 2) and nothing is in the grading
 * path — the score is fixed before this runs.
 */

import type { Atlas, Challenge, Graph, NodeId, NodeRef } from '../../atlas/index.js';
import { byteCompare, nodeAt } from '../../atlas/index.js';
import type { Grade, NoteKind, Reveal, RevealNote } from '../types.js';
import { textSubject } from '../gate.js';
import { nameTokens } from '../paths.js';
import { commitOf, labelOf } from './commits.js';

const ORDER: Readonly<Record<NoteKind, number>> = { missed: 0, spurious: 1, correct: 2 };

export function revealOf(atlas: Atlas, graph: Graph, challenge: Challenge, grade: Grade): Reveal {
  const commit = commitOf(atlas, challenge.subject);
  if (commit === null) {
    throw new RangeError(`challenge ${challenge.id} names a commit not in this atlas`);
  }
  const touched = new Set<NodeRef>(commit.files);
  const words = textSubject(commit.subject).words;
  const truth = new Set(challenge.truth);

  const notes: RevealNote[] = [];
  const add = (id: NodeId, kind: NoteKind): void => {
    const ref = graph.refById.get(id);
    if (ref === undefined) return;
    const path = nodeAt(graph, ref).path;
    notes.push({
      id,
      path,
      kind,
      // A commit's file list is not a path through anything — there is no chain
      // of files to walk. Leaving this empty is the honest answer; inventing a
      // route from the import graph would show evidence that did not produce
      // the grade.
      route: [],
      note: truth.has(id)
        ? whyYes(graph, ref, touched, nodeAt(graph, ref).churn)
        : whyNot(graph, ref, path, touched, words, nodeAt(graph, ref).churn),
    });
  };

  for (const id of grade.missed) add(id, 'missed');
  for (const id of grade.spurious) add(id, 'spurious');
  for (const id of grade.correct) add(id, 'correct');

  notes.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || byteCompare(a.path, b.path));

  // How many indexed files the commit touched, against how many were on the
  // board. The gap is exactly what sampling left out, and naming it is what
  // keeps "which of these" a fair question (ADR-0008's argument, reused).
  const shown = challenge.truth.length;
  const total = touched.size;
  const summary =
    total > shown
      ? `${commit.sha} touched ${total} indexed files in all — ${total - shown} more than this board asked about.`
      : `That is every indexed file ${commit.sha} touched.`;

  return {
    subject: labelOf(commit),
    summary,
    // A commit is not a node, so there is no cone to widen and no wire to draw.
    // Saying so explicitly is the point of `nothing` existing: a verb that
    // borrows a channel meaning something else is how the first three leaks
    // happened.
    unlocks: 'nothing',
    notes,
  };
}

function whyYes(
  graph: Graph,
  ref: NodeRef,
  touched: ReadonlySet<NodeRef>,
  churn: number,
): string {
  // **Name the neighbour, do not merely assert one.** The first version said
  // "alongside a file it shares an import edge with" and printed the identical
  // sentence under four of six members — six words that told the player nothing
  // they could check. Which file it moved with is the fact, and the atlas has it.
  const imported = (graph.out[ref] ?? []).find((edge) => touched.has(edge.to));
  if (imported !== undefined) {
    return `changed here, alongside ${nodeAt(graph, imported.to).path}, which it imports.`;
  }
  const importer = (graph.in[ref] ?? []).find((edge) => touched.has(edge.from));
  if (importer !== undefined) {
    return `changed here, alongside ${nodeAt(graph, importer.from).path}, which imports it.`;
  }
  // The flagship lesson: part of the change, invisible to the import graph.
  return `changed here, with no import edge to anything else in the commit — edited in ${churn} commit${
    churn === 1 ? '' : 's'
  } in all.`;
}

function whyNot(
  graph: Graph,
  ref: NodeRef,
  path: string,
  touched: ReadonlySet<NodeRef>,
  words: ReadonlySet<string>,
  churn: number,
): string {
  if (nameTokens(path).some((token) => words.has(token))) {
    // The strategy that exists to punish reading the message instead of the
    // repo, explaining itself.
    return 'its name is in the commit message, and the commit did not touch it — a message says what someone meant to do.';
  }
  const imported = (graph.out[ref] ?? []).find((edge) => touched.has(edge.to));
  if (imported !== undefined) {
    return `it imports ${nodeAt(graph, imported.to).path}, which did change — and needed no edit of its own.`;
  }
  const importer = (graph.in[ref] ?? []).find((edge) => touched.has(edge.from));
  if (importer !== undefined) {
    return `${nodeAt(graph, importer.from).path} changed and imports it, and it still did not have to move.`;
  }
  if (churn > 0) {
    return `edited in ${churn} commit${churn === 1 ? '' : 's'}, but not in this one.`;
  }
  return 'no commit in the window has touched this file at all.';
}
