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
import { byteCompare, commitAt, nodeAt, readWitness } from '../../atlas/index.js';
import type { Grade, NoteKind, Reveal, RevealNote } from '../types.js';
import { textSubject } from '../gate.js';
import { nameTokens } from '../paths.js';
import { commitLabel } from '../members.js';

const ORDER: Readonly<Record<NoteKind, number>> = { missed: 0, spurious: 1, correct: 2 };

/**
 * The negative witness: why the generator put this wrong answer here.
 *
 * Every class here is speakable. Each is anchored on the **answer key**, whose
 * members this board has already named, so none of these states a fact about a
 * file the player has not been shown — and the two that mention the import graph
 * mention it only as a relation to a file on this board.
 *
 * **`coChange` is absent, and it is the same refusal `blastRadius/reveal.ts`
 * makes about the same relation.** That sentence would read *"a file that
 * usually moves with one this commit changed"*, which is an existential over
 * this board's answer key — and every pair it quantifies over is Companion's
 * subject matter, stated by the product rather than inferred by the player.
 * Measured on the shipped decks (clean clones, ark `d91ba27` and `honojs/hono`
 * `7075369e`): of this repo's **98** co-change rows, **52 hold a pair that is a
 * member of a shipped Companion board's answer key**; 29 of hono's 141. Blast
 * Radius refuses the same relation at 11 of 15 rows here and 8 of 53 there — so
 * this is 6.5× the rows and 4.7× the atoms of a class already refused at the
 * smaller number.
 *
 * The argument the other way is real and is why ADR-0023 states it: Blast
 * Radius's sentence is an **identity** with the subject where this one is an
 * existential over a key of up to six.
 *
 * And the existential is not always one. On a **one-file answer key** the set it
 * quantifies over has size 1, so *"one this commit changed"* names that file and
 * the sentence becomes the pair — ADR-0019's set-size rule, met here as a
 * property of the board rather than of the row. 8 rows here, **25 of hono's
 * 141**. A `truth.length >= 2` guard would be legal under ADR-0020 decision 3
 * (a board property, not a row property) and would still leave the other 90
 * rows stating the disjunction, which is what is actually being withheld.
 *
 * **What withholding costs, stated rather than hidden.** `distant` ships **0**
 * rows on both repos, so an unexplained row on a Placement board is now
 * *uniquely* a co-change pick, and a player who works the class partition out
 * across boards recovers the disjunction anyway. That is the price, and it is
 * paid on ADR-0019's own line: a **stated** atom is refused, an **implied**
 * relation is accepted. It is also why this is a class-wide silence and never a
 * per-row one (ADR-0020 decision 3).
 *
 * `distant` is absent because it is padding rather than a strategy (ADR-0020).
 */
const WITNESS: Readonly<Record<string, string>> = {
  busy: 'one of the repo’s most-edited files',
  // **"near", not "a neighbour of"** — this strategy's breadth-first walk from
  // the anchors is *unbounded*, so a row at two hops has no import edge to
  // anything on the board and "neighbour" is false of it: 4 of this repo's 100
  // rows and 24 of hono's 188. That is the same shape ADR-0020 decision 4
  // withheld Companion's `structural` over, asked of this verb's identical
  // class — measured, the leak direction is empty here (0 deep rows on either
  // repo sit in a shipped Blast Radius key), so what was wrong was the sentence
  // and not the class.
  structural: 'a file the import graph puts near the change',
  // Widened through shared prefixes exactly as the other two verbs' siblings
  // are, so "living where the change landed" is false on 6 rows here and 63 of
  // hono's 173.
  treeSibling: 'a near neighbour, in the tree, of a file the commit changed',
  nameSimilar: 'a name-alike of a file the commit changed',
  mentioned: 'a file the message names',
};

export function revealOf(_atlas: Atlas, graph: Graph, challenge: Challenge, grade: Grade): Reveal {
  const commit = commitAt(graph, challenge.subject);
  if (commit === null) {
    throw new RangeError(`challenge ${challenge.id} names a commit not in this atlas`);
  }
  const words = textSubject(commit.subject).words;
  const truth = new Set(challenge.truth);
  const witnesses = readWitness(challenge);
  /**
   * The files a note may **name**: the answer key, not the commit's whole
   * membership.
   *
   * This was `new Set(commit.files)`, and that is a leak `discloses` cannot see.
   * `placement/index.ts` declares `touchedFact(commit, member)` for
   * `challenge.truth` only — it has no atlas and so *cannot* declare more — while
   * the sentences below reached into the unsampled membership to find a
   * neighbour to name. Measured on the shipped decks: **32 sentences across 16 of
   * this repo's 40 boards named a file outside their own answer key, and 20 of
   * those atoms are members of a shipped Archaeology answer key**; 12 across 5
   * boards on `honojs/hono`, 4 of them in a key. ADR-0019 decision 7 exists to
   * stop exactly that, and it was being routed around by a sentence written a
   * milestone earlier — the direction that document says nobody looks in.
   *
   * `whyYes` fires on every truth member of every board played, so this was not
   * conditional on a wrong pick: it shipped on every Placement reveal.
   */
  const named = new Set<NodeRef>(
    challenge.truth.map((id) => graph.refById.get(id)).filter((ref) => ref !== undefined),
  );

  const notes: RevealNote[] = [];
  const add = (id: NodeId, kind: NoteKind): void => {
    const ref = graph.refById.get(id);
    if (ref === undefined) return;
    const path = nodeAt(graph, ref).path;
    notes.push({
      id,
      label: path,
      kind,
      // A commit's file list is not a path through anything — there is no chain
      // of files to walk. Leaving this empty is the honest answer; inventing a
      // route from the import graph would show evidence that did not produce
      // the grade.
      route: [],
      witness: WITNESS[witnesses.get(id) ?? ''] ?? null,
      note: truth.has(id)
        ? whyYes(graph, ref, named, nodeAt(graph, ref).churn)
        : whyNot(graph, ref, path, named, words, nodeAt(graph, ref).churn),
    });
  };

  for (const id of grade.missed) add(id, 'missed');
  for (const id of grade.spurious) add(id, 'spurious');
  for (const id of grade.correct) add(id, 'correct');

  notes.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || byteCompare(a.label, b.label));

  // How many indexed files the commit touched, against how many were on the
  // board. The gap is exactly what sampling left out, and naming it is what
  // keeps "which of these" a fair question (ADR-0008's argument, reused).
  const shown = challenge.truth.length;
  const total = commit.files.length;
  const summary =
    total > shown
      ? `${commit.sha} touched ${total} indexed files in all — ${total - shown} more than this board asked about.`
      : `That is every indexed file ${commit.sha} touched.`;

  return {
    subject: commitLabel(commit),
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
  named: ReadonlySet<NodeRef>,
  churn: number,
): string {
  // **Name the neighbour, do not merely assert one.** The first version said
  // "alongside a file it shares an import edge with" and printed the identical
  // sentence under four of six members — six words that told the player nothing
  // they could check. Which file it moved with is the fact, and the atlas has it.
  //
  // `named` is the answer key rather than the commit's whole membership, so the
  // file this points at is always one already on the board. See the caller.
  const imported = (graph.out[ref] ?? []).find((edge) => named.has(edge.to));
  if (imported !== undefined) {
    return `changed here, alongside ${nodeAt(graph, imported.to).path}, which it imports.`;
  }
  const importer = (graph.in[ref] ?? []).find((edge) => named.has(edge.from));
  if (importer !== undefined) {
    return `changed here, alongside ${nodeAt(graph, importer.from).path}, which imports it.`;
  }
  // The flagship lesson: part of the change, invisible to the import graph.
  //
  // *"anything else on this board"*, not *"in the commit"* — the search above is
  // over the answer key now, and the commit may well have touched an unsampled
  // neighbour. The old wording was the stronger claim, and narrowing the search
  // made it false: a sentence that survives a change to what it quantifies over
  // was not really about the quantifier.
  return `changed here, with no import edge to anything else on this board — edited in ${churn} commit${
    churn === 1 ? '' : 's'
  } in all.`;
}

function whyNot(
  graph: Graph,
  ref: NodeRef,
  path: string,
  named: ReadonlySet<NodeRef>,
  words: ReadonlySet<string>,
  churn: number,
): string {
  if (nameTokens(path).some((token) => words.has(token))) {
    // The strategy that exists to punish reading the message instead of the
    // repo, explaining itself.
    return 'its name is in the commit message, and the commit did not touch it — a message says what someone meant to do.';
  }
  const imported = (graph.out[ref] ?? []).find((edge) => named.has(edge.to));
  if (imported !== undefined) {
    return `it imports ${nodeAt(graph, imported.to).path}, which did change — and needed no edit of its own.`;
  }
  const importer = (graph.in[ref] ?? []).find((edge) => named.has(edge.from));
  if (importer !== undefined) {
    return `${nodeAt(graph, importer.from).path} changed and imports it, and it still did not have to move.`;
  }
  if (churn > 0) {
    return `edited in ${churn} commit${churn === 1 ? '' : 's'}, but not in this one.`;
  }
  // A withheld `coChange` row lands on the arm above and never on this one: a
  // pair only enters the matrix by being counted in a commit, so a partner's
  // churn is at least its pair count. Withholding a class must not push a row
  // onto a sentence that is false of it, and this is the one sentence here that
  // could be.
  return 'no commit in the window has touched this file at all.';
}
