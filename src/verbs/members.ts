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
import { commitAt, nodeAt } from '../atlas/index.js';

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
  if (ref !== undefined) return nodeAt(graph, ref).path;
  const commit = commitAt(graph, id);
  return commit === null ? id : commitLabel(commit);
}
