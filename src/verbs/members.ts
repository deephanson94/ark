/**
 * What an id is called on screen — for **either** arm of `AtlasId`.
 *
 * Since ADR-0019 a challenge's members are files for three verbs and commits for
 * Archaeology, so three separate surfaces have to name a member without knowing
 * which verb produced it: the console's choice rows, the reveal's notes, and the
 * field notes' proved list. Before this module the console did
 * `refById.get(id)` and fell back to printing the raw id, which for a commit is
 * `c:1a2b3c4d5e6f` — a board of twenty of those.
 *
 * ## Why it dispatches on the id and not on the verb
 *
 * ADR-0018 decision 1, applied to display: *"can this be drawn?"* is a question
 * about the id, and so is *"what is this called?"*. Routing it through the verb
 * would make a fact about the value into a fact about the asker, which is the
 * direction every leak in this codebase has run. A prefix keeps the answer total
 * — including for a verb this build does not have.
 *
 * ## Why one label rather than one per surface
 *
 * The three surfaces show the *same member* within seconds of each other: you
 * tick a row, the reveal explains that row, and the field note records it. Two
 * formats would read as two different things, and a player comparing a note
 * against the board would have to translate. This repo's recurring lesson is
 * that a rule living twice is a rule that diverges, so there is one.
 */

import type { AtlasId, CommitRecord, Graph } from '../atlas/index.js';
import type { NoteRegister, Words } from './types.js';
import { commitAt, nodeAt } from '../atlas/index.js';

/** A singular and a plural, for a sentence that has to count something. */
export interface Noun {
  readonly one: string;
  readonly many: string;
}

const FILE: Noun = { one: 'file', many: 'files' };
const PACKAGE: Noun = { one: 'package', many: 'packages' };
const COMMIT: Noun = { one: 'commit', many: 'commits' };
/**
 * What a board of more than one kind is called.
 *
 * *Place* is this product's own word for a node — ADR-0018 is titled *"a
 * subject is a place or an event"* — rather than a term invented for the
 * sentence. It is needed because a mixed board is the **normal** case on a Go
 * repo, not an edge case: 151 of `gohugoio/hugo`'s 156 Companion boards and 118
 * of its 121 Placement boards hold Go packages *and* files, because a commit
 * touches both. Only Blast Radius is reliably uniform, and for a structural
 * reason — only Go imports Go, so a package's cone holds packages.
 */
const PLACE: Noun = { one: 'place', many: 'places' };

/**
 * What to call these ids on screen — `files`, `packages`, `commits`, or
 * `places` when the set is more than one kind.
 *
 * **The verb writes the sentence; this supplies the fact.** Wording belongs to
 * the verb (ADR-0020), and *what kind of thing is this id* is a question about
 * the atlas that `Verb.prompt` cannot answer — it is pure over a challenge and
 * a lookup, with no graph. So the lookup grew a second question rather than the
 * console growing a vocabulary, which is the cheap fix this repo's landmines
 * forbid.
 *
 * Until Go there was one answer and every verb hard-coded it, which was true
 * and became **false on every board a Go repo ships**: 153 of hugo's and 35 of
 * prometheus's Blast Radius boards asked *"which of these **files** depend on
 * it"* about a list of packages.
 *
 * Keyed on `(kind, lang)` rather than on `kind` alone, because `dir` is a
 * *shape* and `package` is Go's name for it. A later language that groups by
 * directory and calls it something else adds a row here and changes nothing
 * about who asks.
 */
export function memberNoun(graph: Graph, ids: Iterable<AtlasId>): Noun {
  let seen: Noun | null = null;
  for (const id of ids) {
    const found = nounOf(graph, id);
    if (seen === null) seen = found;
    else if (seen !== found) return PLACE;
  }
  return seen ?? PLACE;
}

function nounOf(graph: Graph, id: AtlasId): Noun {
  const ref = graph.refById.get(id);
  if (ref === undefined) return COMMIT;
  const node = nodeAt(graph, ref);
  if (node.kind !== 'dir') return FILE;
  return node.lang === 'go' ? PACKAGE : PLACE;
}

/** `4 files`, `1 package`. The count and its noun, agreeing. */
export function counted(count: number, noun: Noun): string {
  return `${count} ${count === 1 ? noun.one : noun.many}`;
}

/**
 * How a field note opens: `You proved 4 files` or `You were shown 4 files`.
 *
 * **A shared prefix under a verb-written predicate**, which is the safe half of
 * ADR-0027's rule rather than an exception to it. The thing that must stay with
 * the verb is the *claim* — "that depend on X", "that change with X", "that
 * landed on X" — because a shared clause there is how *"Map its companion"*
 * happened. Which register the note is in is a fact about the **pass**, not
 * about the question, and every verb says it the same way; a copy per verb would
 * be the rule living four times, which this repository has a landmine about.
 */
export function credited(register: NoteRegister, count: number, noun: Noun): string {
  return `${register === 'proved' ? 'You proved' : 'You were shown'} ${counted(count, noun)}`;
}

/**
 * A commit, as the player sees it: when it landed and what it said.
 *
 * Date first because every list of these is read in time order — Archaeology's
 * board is date-ascending — and a leading date is what makes such a list scan.
 * The abbreviated sha is carried because two commits on one day can share a
 * subject line, and two identical rows on a board is a question with no answer.
 *
 * The message is **quoted, never paraphrased**. Guardrail 2 forbids authoring
 * content about a particular project; repeating what the repo already says about
 * itself is derived content, and it is the only thing that makes a history
 * question mean anything.
 */
export function commitLabel(commit: CommitRecord): string {
  return `${commit.date}  ${commit.sha}  "${commit.subject}"`;
}

/**
 * A member or subject id, as a display string.
 *
 * Falls back to the id itself when the atlas holds neither — which happens for a
 * stored pass whose commit has slid out of the window. Callers that must *drop*
 * such a member rather than print it check the atlas first (`livePasses`); this
 * function never throws, because a panel that cannot name one row should still
 * render the other nineteen.
 */
export function memberLabel(graph: Graph, id: AtlasId): string {
  const ref = graph.refById.get(id);
  if (ref !== undefined) return pathLabel(nodeAt(graph, ref).path);
  const commit = commitAt(graph, id);
  return commit === null ? id : commitLabel(commit);
}

/**
 * A node's path as a sentence can carry it.
 *
 * The repo root is `.` — the only path that names a real place and reads as
 * punctuation. `spf13/cobra` is one flat Go package at the root, so its prompts
 * said *"changed alongside ."*. The path stays, because it is what the row and
 * the map agree on and it is what sorts; the gloss is what makes it a noun
 * phrase.
 */
export function pathLabel(path: string): string {
  return path === '.' ? '. (the root package)' : path;
}

/**
 * The vocabulary for one atlas: how to name an id, and what to call a set.
 *
 * One factory rather than each caller assembling its own, because there are
 * two — the console and the inspector — and a rule that lives twice diverges.
 * That is not hypothetical here: the inspector hard-coded Blast Radius's button
 * text until M4 while the console was already verb-blind, and the seam held in
 * one file and failed in the one nobody thought about.
 */
export function wordsFor(graph: Graph): Words {
  // Computed once per atlas, not per prompt: it is a fold over every node, and
  // `prompt()` is called on every render.
  const repo = memberNoun(
    graph,
    graph.atlas.nodes.map((node) => node.id),
  );
  return {
    label: (id) => memberLabel(graph, id),
    noun: (ids) => memberNoun(graph, ids),
    repo,
  };
}
