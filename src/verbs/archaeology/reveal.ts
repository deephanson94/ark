/**
 * Archaeology's reveal: what the player learns from the grade.
 *
 * The lesson is about **how a file's history reads**, and every note states it
 * as a measured fact about the player's own repo:
 *
 *  - a commit that changed the file and never says so — the flagship, because
 *    it is the reason `git log -- that/file` is a different act from reading
 *    commit subjects;
 *  - a commit whose message *names* the file and whose diff does not — a message
 *    says what someone meant to do;
 *  - a commit that changed the file's neighbours, or its usual travelling
 *    companions, and left it alone.
 *
 * ## What this reveal may not say, and why it is a hard rule
 *
 * **It must never name the other files a commit touched.** That is Placement's
 * answer key for that commit, handed over whole — ADR-0014's finding 3 (Blast
 * Radius's reveal handing Companion its key, with the count) running in the
 * other direction, and the direction nobody looks at, because the verb that
 * suffers is written later than the verb that leaks.
 *
 * So the notes below state **relations, never identities**: *"it changed a file
 * that imports this one"*, not *"it changed `src/foo.ts`, which imports this
 * one"*. The existential is the whole of the lesson — that a change next door is
 * not a change here — and it names nothing a Placement board could be ticked
 * from. The identity would add nothing to the teaching and would give away an
 * atom of another verb's key.
 *
 * **And it must never print a commit's width.** `broadKnown` — *"tick the K
 * widest, among the commits somebody has priced"* — beats band A on real boards
 * of this repo, which is why `gate.ts` scores it. Printing the width here would
 * feed the same guess on every *other* file's board, from a panel the gate
 * cannot see. `summary` states how many commits touched **the subject**, which
 * is a fact about the subject rather than about any commit on the board.
 *
 * Nothing here is authored per repo (guardrail 2) and nothing is in the grading
 * path — the score is fixed before this runs.
 */

import type { Atlas, AtlasId, Challenge, Graph, NodeRef } from '../../atlas/index.js';
import { byteCompare, commitAt, commitIdFor, nodeAt, readWitness } from '../../atlas/index.js';
import type { Grade, NoteKind, Reveal, RevealNote } from '../types.js';
import { commitLabel } from '../members.js';
import { directoryOf, nameTokens } from '../paths.js';
import { messageWords } from './corpus.js';

const ORDER: Readonly<Record<NoteKind, number>> = { missed: 0, spurious: 1, correct: 2 };

/**
 * The negative witness: why the generator put this wrong answer here.
 *
 * Three of the four say *"it touched something in this file's neighbourhood"*,
 * which is the header's **relations, never identities** rule again — and so they
 * inherit its guard: a relation over a set of one *is* an identity. `guarded`
 * below carries the three set sizes, and each is a property of the **subject**,
 * so on any given board a class is spoken for every row or for none.
 *
 * That is not tidiness. Withholding a class from some rows of a board and not
 * others makes the *absence* of a line say which class the row was in, which is
 * the fact being withheld — ADR-0020's by-class-or-by-board rule.
 *
 * `sibling` is the class this feature exists for: it has no arm in `whyNot` at
 * all, so the graph re-derives it as `companion` on 103 of this repo's 124
 * `sibling` slots and gets it right **zero** times.
 *
 * `distant` is absent because it is padding rather than a strategy.
 */
const WITNESS: Readonly<
  Record<string, { readonly text: string; readonly guard: 'adjacent' | 'siblings' | 'partners' | null }>
> = {
  neighbour: { text: 'a commit that touched this file’s import neighbours', guard: 'adjacent' },
  sibling: { text: 'a commit that touched this file’s own directory', guard: 'siblings' },
  mentions: { text: 'a commit whose message names this file', guard: null },
  companion: { text: 'a commit that touched this file’s usual travelling companions', guard: 'partners' },
};

export function revealOf(
  _atlas: Atlas,
  graph: Graph,
  challenge: Challenge,
  grade: Grade,
): Reveal {
  const subject = graph.refById.get(challenge.subject);
  if (subject === undefined) {
    throw new RangeError(`challenge ${challenge.id} names a file not in this atlas`);
  }
  const node = nodeAt(graph, subject);
  const words = new Set(nameTokens(node.path));

  // The subject's neighbourhoods, as *sets of refs* — used only to ask "did this
  // commit touch any of them?", never to name one. See the header.
  const adjacent = new Set<NodeRef>();
  for (const edge of graph.out[subject] ?? []) adjacent.add(edge.to);
  for (const edge of graph.in[subject] ?? []) adjacent.add(edge.from);
  const partners = new Set<NodeRef>();
  for (const [a, b] of graph.atlas.history.coChange) {
    if (a === subject) partners.add(b);
    else if (b === subject) partners.add(a);
  }

  // How many files each guarded existential quantifies over. A set of one makes
  // *"a file in this file's directory"* name that file, which is an atom of the
  // commit's Placement key — the leak decision 9's guards exist for, measured at
  // 7 `sibling` slots here and 5 on `honojs/hono` before this guard.
  // `directoryOf`, not an inline `lastIndexOf` — a path with no slash makes
  // `slice(0, -1)` return the path minus its last character, which is a
  // directory no file is in, so a root-level subject would have counted zero
  // siblings and silently withheld a class it was entitled to state.
  const siblings = new Set<NodeRef>();
  const home = directoryOf(node.path);
  for (const [ref, other] of graph.atlas.nodes.entries()) {
    if (ref !== subject && directoryOf(other.path) === home) siblings.add(ref);
  }
  const sizes = { adjacent: adjacent.size, siblings: siblings.size, partners: partners.size };
  const witnesses = readWitness(challenge);
  const witnessFor = (id: AtlasId): string | null => {
    const entry = WITNESS[witnesses.get(id) ?? ''];
    if (entry === undefined) return null;
    return entry.guard === null || sizes[entry.guard] > 1 ? entry.text : null;
  };

  const truth = new Set(challenge.truth);
  // The key in date order, so each member can be placed in the arc of the
  // file's life — which is the thing this verb is asking about (decision 3).
  // Derived from the board rather than from the whole history, so "the earliest
  // of these" says *of these* and means it.
  const keyByDate = [...challenge.truth].sort((x, y) => {
    const a = commitAt(graph, x);
    const b = commitAt(graph, y);
    if (a === null || b === null) return byteCompare(x, y);
    return byteCompare(a.date, b.date) || byteCompare(a.sha, b.sha);
  });
  /**
   * How long each key member landed after the one before it, in days.
   *
   * **This exists because the first version printed one sentence under every
   * correct pick.** With only a names-it/does-not arm and a position clause, a
   * file whose commits never say its name got the identical explanation three
   * times over — which is ADR-0018's `whyYes` defect verbatim, in the verb
   * written to learn from it: *"six words that told the player nothing they
   * could check"*. The gap is a fact about this file's rhythm that differs per
   * member, is derived from the atlas, and names nothing.
   */
  const gapAfter = new Map<AtlasId, number>();
  for (let i = 1; i < keyByDate.length; i++) {
    const previous = commitAt(graph, keyByDate[i - 1] ?? '');
    const current = commitAt(graph, keyByDate[i] ?? '');
    if (previous === null || current === null) continue;
    gapAfter.set(keyByDate[i] ?? '', daysBetween(previous.date, current.date));
  }
  const earliest = keyByDate[0];
  const latest = keyByDate[keyByDate.length - 1];

  const notes: RevealNote[] = [];
  const add = (id: AtlasId, kind: NoteKind): void => {
    const commit = commitAt(graph, id);
    if (commit === null) return;
    const names = messageWords(commit.subject).some((word) => words.has(word));
    notes.push({
      id,
      label: commitLabel(commit),
      kind,
      // A commit is not a path through anything — there is no chain of files to
      // walk. Leaving this empty is the honest answer; inventing a route from
      // the import graph would show evidence that did not produce the grade.
      route: [],
      witness: witnessFor(id),
      note: truth.has(id)
        ? whyYes(names, id === earliest, id === latest, gapAfter.get(id) ?? null)
        : whyNot(commit.files, names, adjacent, partners, node.path),
    });
  };

  for (const id of grade.missed) add(id, 'missed');
  for (const id of grade.spurious) add(id, 'spurious');
  for (const id of grade.correct) add(id, 'correct');

  notes.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || byteCompare(a.label, b.label));

  // How many eligible commits touched this file in all, against how many the
  // board asked about. The gap is exactly what sampling left out, and naming it
  // is what keeps "which of these" a fair question (ADR-0008's argument, reused
  // for the fourth time).
  const shown = challenge.truth.length;
  const total = challenge.evidence.kind === 'history' ? challenge.evidence.touchedBy : shown;
  const summary =
    total > shown
      ? `${total} commits in this window touched ${node.path} — ${total - shown} more than this board asked about.`
      : `That is every commit in this window that touched ${node.path}.`;

  return {
    subject: node.path,
    summary,
    // An Archaeology pass un-fogs its subject, which is a file; its proved
    // members are commits, which have no square on the map and no channel to be
    // drawn in. Second user of `nothing`, and saying so explicitly is the point
    // of that arm existing — a verb that borrows a channel meaning something
    // else is how the first three leaks happened.
    unlocks: 'nothing',
    notes,
  };
}

/**
 * Whole days between two `YYYY-MM-DD` dates.
 *
 * `Date.UTC` on parsed components rather than `new Date(string)`: the latter is
 * fine for ISO dates in every engine that matters, and this file is on the
 * player's side of the wall where "every engine that matters" is a claim nobody
 * is measuring. Parsing the three numbers has no such question attached.
 */
function daysBetween(from: string, to: string): number {
  const parse = (value: string): number => {
    const [y, m, d] = value.split('-').map((part) => Number.parseInt(part, 10));
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

function whyYes(
  names: boolean,
  isEarliest: boolean,
  isLatest: boolean,
  gap: number | null,
): string {
  // Where in the file's life this landed, and how long the file sat still
  // before it. Both are facts the player can check against the board; the
  // naming clause below is the lesson.
  const place = isEarliest
    ? 'the oldest change this board asked about'
    : gap === null
      ? 'part of this file’s history'
      : gap === 0
        ? `landing the same day as the change before it${isLatest ? ', and the most recent here' : ''}`
        : `${gap} day${gap === 1 ? '' : 's'} after the change before it${isLatest ? ', and the most recent here' : ''}`;
  return names
    ? `changed this file and says so in its message — ${place}.`
    : `changed this file without ever naming it — ${place}. A log of subjects is not a log of files.`;
}

function whyNot(
  files: readonly NodeRef[],
  names: boolean,
  adjacent: ReadonlySet<NodeRef>,
  partners: ReadonlySet<NodeRef>,
  path: string,
): string {
  if (names) {
    // The strategy that exists to punish reading the message instead of the
    // repo, explaining itself.
    return `its message names ${path} and its diff does not touch it — a message says what someone meant to do.`;
  }
  // **Relations, not identities — and a relation over a set of one *is* an
  // identity.** Naming the file would hand over an atom of this commit's
  // Placement answer key, so these sentences say only that such a file exists.
  // That argument holds exactly while the player cannot work out *which* file,
  // and it fails when the subject has exactly one co-change partner or one
  // import neighbour: "it changed a file that usually moves with this one" then
  // names it as surely as printing the path would.
  //
  // Measured on `honojs/hono` before this guard: **4 distractor notes** were
  // uniquely determined this way, **2 of them naming a file that is a shipped
  // Placement answer-key member**. The chain was not completable in-product —
  // neither subject carried a Companion board, so nothing ever told the player
  // what the single partner was — but that is a fact about today's deck, not a
  // property anything enforces, and one Companion board on such a subject would
  // complete it with no code change. The guard costs two sentences that fall
  // through to the generic one; the alternative is a leak whose safety depends
  // on which questions happen to exist.
  if (countIn(files, partners) > 0 && partners.size > 1) {
    return 'it changed a file that usually moves with this one — and this one stayed put. A coupling is a tendency, not a rule.';
  }
  if (countIn(files, adjacent) > 0 && adjacent.size > 1) {
    return 'it changed a file on the other end of an import edge from this one, and this one needed no edit.';
  }
  return 'it landed inside this file’s lifetime and never touched it.';
}

/** How many of `files` are in `set`. */
function countIn(files: readonly NodeRef[], set: ReadonlySet<NodeRef>): number {
  let n = 0;
  for (const ref of files) if (set.has(ref)) n++;
  return n;
}

/** Exported for the field note, which needs the same id shape. */
export function idForCommit(sha: string): AtlasId {
  return commitIdFor(sha);
}
