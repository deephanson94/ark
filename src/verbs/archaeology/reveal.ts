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
import { avoidedOf } from '../reveal.js';
import { commitLabel } from '../members.js';
import { nameTokens } from '../paths.js';
import { messageWords } from './corpus.js';

// `avoided` last: the lesson is what you missed, and 16 rows you were right to
// skip must not sit above it (ADR-0050).
const ORDER: Readonly<Record<NoteKind, number>> = { missed: 0, spurious: 1, correct: 2, avoided: 3 };

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
 * `sibling` **was** the class this feature exists for — it has no arm in
 * `whyNot` at all, so the graph re-derives it as `companion` on 103 of this
 * repo's 124 `sibling` slots and gets it right zero times — and it is now
 * **withheld**, which is the most expensive silence in this file and the one
 * with the least room for argument. See below.
 *
 * `distant` is absent because it is padding rather than a strategy.
 */
const WITNESS: Readonly<
  Record<string, { readonly text: string; readonly guard: 'adjacent' | 'partners' | null }>
> = {
  neighbour: { text: 'a commit that touched this file’s import neighbours', guard: 'adjacent' },
  // **`sibling` is withheld, and it is the third class to be — ADR-0021's
  // re-measure.** It used to read *"a commit that touched this file's own corner
  // of the tree"*. That sentence is a **string prefix**, which is the one kind of
  // hint a player can run with no knowledge of the repository at all, and
  // pooling it across the boards that hint about one commit decides that
  // commit's Placement board: **0.800 against a 0.78 bar**, measured at
  // `1220b9b`.
  //
  // The cheaper guards were measured and both are refuted, which is why this
  // costs what it costs:
  //
  //  - **By board.** ADR-0020's rule escalates class → board → nothing, and a
  //    by-board guard is where a previous review left this. It cannot bound it:
  //    the best *single* board reaches **0.667**, and the 0.800 is the union of
  //    **three**. No guard that sees one board can see this guess.
  //  - **Narrowing the class to the subject's exact directory** — which would
  //    also have fixed the subtree/directory mismatch this comment used to be
  //    about. It scores **0.800 too**: the subject sits in a leaf directory, so
  //    subtree and directory are the same set. The breadth was never the lever.
  //
  // The price is stated rather than buried: **171 of this repo's 626 spoken
  // rows and 101 of hono's 734** lose their sentence, across 34 of 40 boards
  // here and 30 of 54 there. That is the largest withholding in the product and
  // it buys a leak that is closed rather than held 0.011 under a bar.
  // **Not "names this file".** The strategy matches any commit whose message
  // shares *one token* with the subject's filename, and measured on real repos
  // that is what nearly all of them are: 87% of graphql-js's 315 firings, 82%
  // of kysely's and 54% of hono's are a single word, very often `test` — so
  // `"Refactoring and test changes"` was shown to a playtester as *naming*
  // `extensions-test.ts`, which they falsified in three seconds. A class label
  // is not a class description, and this is that landmine in the witness line:
  // the label was right and the gloss was a separate claim nobody checked.
  mentions: { text: 'a commit whose message uses a word from this file’s name', guard: null },
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
  // *"a file in this file's corner of the tree"* name that file, which is an atom
  // of the commit's Placement key — the leak decision 9's guards exist for.
  //
  // **The subtree, matching `byDirPrefix` and therefore matching the strategy.**
  // An exact-directory count was a third population, different from both the set
  // the strategy draws from and the set the sentence describes; a guard that
  // counts something else is not a guard.
  //
  // **The subtree set went with the `sibling` sentence it guarded.** It counted
  // the subject's corner of the tree so that a corner holding one file could not
  // have the existential name it, and so that a root-level subject — whose
  // corner is the whole repo — said nothing. Both guards are moot now that the
  // class is never spoken, and a size nothing reads is the infrastructure-with-
  // no-consumer smell this repo has a landmine about.
  const sizes = { adjacent: adjacent.size, partners: partners.size };
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
    const shared = messageWords(commit.subject).filter((word) => words.has(word));
    // Two claims, not one. `namesIt` is the strong one the old sentence made
    // unconditionally; `shared` is what the strategy actually selects on.
    const namesIt = namesTheFile(commit.subject, node.path, words);
    notes.push({
      id,
      label: commitLabel(commit),
      kind,
      // **No witness on a row the player did not pick** (ADR-0050 §3). This verb
      // builds its witness through `witnessFor`'s set-size guards rather than a
      // plain map lookup, so the suppression the other three got by editing one
      // expression had to be written here by hand — which is exactly the shape
      // of defect this file's header warns about, four reveals deep.
      witness: kind === 'avoided' ? null : witnessFor(id),
      // **No import evidence in a history-graded note.** A chain of files did not
      // produce this answer, so naming one would show the player evidence that did
      // not. The rule used to live on a `route: []` beside this field; it moved here
      // when that field went, because prose is where it can actually be broken.
      note: truth.has(id)
        ? whyYes(
            namesIt,
            shared,
            id === earliest,
            id === latest,
            gapAfter.get(id) ?? null,
            keyByDate.indexOf(id) + 1,
            keyByDate.length,
          )
        : whyNot(commit.files, namesIt, shared, adjacent, partners, node.path),
    });
  };

  for (const id of grade.missed) add(id, 'missed');
  for (const id of grade.spurious) add(id, 'spurious');
  for (const id of grade.correct) add(id, 'correct');
  // Every remaining candidate: the wrong answers the player was right to skip.
  // Their `witness` is suppressed in `add` — ADR-0050 §3 measures why.
  for (const id of avoidedOf(challenge, grade)) add(id, 'avoided');

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

/**
 * Does this message really *name* the file, or just share a word with it?
 *
 * The strategy that offers these commits matches on **any one token** of the
 * filename, which is the right net to cast for a wrong answer — a message that
 * sounds like this file is exactly the confusion the class exists to punish —
 * and it is not what *"its message names this file"* claims. Measured across
 * three repos, 54–87% of the firings share a single generic word, usually
 * `test`. The strong claim is kept for the rows that earn it: the basename's
 * stem appears verbatim, or every token of it does.
 */
function namesTheFile(message: string, path: string, tokens: ReadonlySet<string>): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  const stem = dot <= 0 ? base : base.slice(0, dot);
  if (stem.length > 2 && message.toLowerCase().includes(stem.toLowerCase())) return true;
  const words = new Set(messageWords(message));
  return tokens.size > 0 && [...tokens].every((token) => words.has(token));
}

/**
 * The shared token this row may quote as evidence, or `null` if it has none.
 *
 * **It used to be `shared[0]`, and a cold playtester was shown *"its message
 * talks about “a”, and so does this file's name"*.** The path `…/a.ts`
 * tokenises to `['a']`, English messages contain the article, and `shared` is
 * in message order — so the sentence was literally true and carried no
 * information at all. That is the class-label landmine arriving in a witness
 * line: the strategy picked the row correctly and the gloss explaining it was a
 * separate claim nobody checked.
 *
 * Two changes and both are needed. **Longest, not first**, because message order
 * has nothing to do with how much a word tells you; and a **floor**, because on
 * most of these rows there is no good token to promote. Measured over every
 * gloss a shipped board can print (`npx tsx scripts/probe-gloss.ts`, at
 * `9b13cf6`): 36.0% of this repo's 161 glossed rows quoted a token under three
 * characters — 43 of them the word `a` — against 8.1% on graphql-js, 1.0% on
 * django and 0.0% on hono. Picking the longest rescues 11 of ark's 58 and none
 * of graphql-js's 25; the rest fall through to a weaker sentence that is true.
 *
 * Byte order breaks a length tie so the sentence is the same on every machine.
 */
const MIN_EVIDENCE_TOKEN = 3;

function evidenceWord(shared: readonly string[]): string | null {
  let best: string | null = null;
  for (const word of shared) {
    if (word.length < MIN_EVIDENCE_TOKEN) continue;
    if (best === null || word.length > best.length || (word.length === best.length && word < best)) {
      best = word;
    }
  }
  return best;
}

/** `1` → `first`, up to the key sizes ADR-0007 allows. */
const ORDINAL = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];

function whyYes(
  namesIt: boolean,
  shared: readonly string[],
  isEarliest: boolean,
  isLatest: boolean,
  gap: number | null,
  position: number,
  total: number,
): string {
  // Where in the file's life this landed, and how long the file sat still
  // before it. Both are facts the player can check against the board; the
  // naming clause below is the lesson.
  //
  // **The same-day arm used to say only *"landing the same day as the change
  // before it"*, and on a busy repo that is every row.** Measured over every
  // shipped Archaeology board (`npx tsx scripts/probe-sameday.ts`): **27.5% of
  // this repo's 40 boards** carry the identical clause on every row after the
  // first, and 49.5% of all rows are same-day — against 0.0% of hono's and
  // kysely's boards and 5.8% of graphql-js's. So it is worst on the bootstrap
  // repo, which is the one every session and every playtester looks at, and it
  // is ADR-0018's own `whyYes` defect — *"six words that told the player nothing
  // they could check"* — in the clause written to avoid it.
  //
  // The replacement is the one fact that still differs per row when the dates do
  // not: **where this commit sits in the board's own date order**. Checkable,
  // because every row's label leads with its date; derived, because the order is
  // the key's; and it degrades rather than lies when the key is long, since the
  // ordinal falls back to a number.
  const ordinal = ORDINAL[position] ?? `${position}th`;
  const sameDay = `the ${ordinal} of the ${total} changes this board asked about, landing the same day as the one before it`;
  const place = isEarliest
    ? 'the oldest change this board asked about'
    : gap === null
      ? 'part of this file’s history'
      : gap === 0
        ? `${sameDay}${isLatest ? ', and the most recent here' : ''}`
        : `${gap} day${gap === 1 ? '' : 's'} after the change before it${isLatest ? ', and the most recent here' : ''}`;
  if (namesIt) return `changed this file and says so in its message — ${place}.`;
  // The middle case is the common one and used to be told as the strong one.
  // It is still worth saying: the message is *about* something this file's name
  // is about, which is a weaker and checkable claim. `evidenceWord` is what
  // keeps it checkable rather than merely true — see its header.
  const word = evidenceWord(shared);
  if (word !== null) {
    return `changed this file, and its message talks about “${word}” — ${place}.`;
  }
  return `changed this file without ever naming it — ${place}. A log of subjects is not a log of files.`;
}

function whyNot(
  files: readonly NodeRef[],
  namesIt: boolean,
  shared: readonly string[],
  adjacent: ReadonlySet<NodeRef>,
  partners: ReadonlySet<NodeRef>,
  path: string,
): string {
  if (namesIt) {
    // The strategy that exists to punish reading the message instead of the
    // repo, explaining itself.
    return `its message names ${path} and its diff does not touch it — a message says what someone meant to do.`;
  }
  // The same lesson, on the weaker fact that is actually true of most of these
  // rows. Quoting the word makes it checkable against the message on screen,
  // which the old sentence was not: a player could read both and see it lie.
  const word = evidenceWord(shared);
  if (word !== null) {
    return `its message talks about “${word}”, and so does this file’s name — but its diff does not touch it. A message says what someone meant to do.`;
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
