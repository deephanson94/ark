/**
 * Field notes: what the player has *proved*, written down.
 *
 * NORTH-STAR §9 calls this the codex equivalent and says it "accumulates facts
 * you have **proven** you know, not facts you were shown. That distinction is
 * the whole product." This module is where that promise is either kept or
 * quietly broken, so every claim below is narrower than it could be.
 *
 * ## What a note may say
 *
 * §9's own example — *"You know that `engine.ts` has 14 dependents"* — is not
 * provable and is amended by ADR-0011 decision 3. Under ADR-0008 a hub's answer
 * key is a deterministic **sample** of its dependents: a player who passes has
 * proved some of them, never the count. The number was *shown* to them in the
 * reveal, which is the `surveyed` side of the very line §9 says is the product.
 *
 * So a note claims the members, and states the radius **only as revealed**:
 *
 *   claim     "You proved 4 files that depend on engine.ts — a, b, c, d —
 *              the farthest 3 hops away."
 *   revealed  "Its full radius — 39 files — is unlocked on your map."
 *
 * Correct *exclusions* get no note either. `progress.ts` already declines to
 * promote a box you left unticked, and a note must not claim more than the fog.
 *
 * ## Prose is derived, never stored
 *
 * The stored `passes` *are* the notes; the sentences are built here from
 * templates that mention no repo. Names resolve `NodeId → path` through the
 * atlas currently loaded, which is what makes a note follow a rename — ADR-0002
 * doing the job it was written for.
 *
 * ## Facts decay
 *
 * Provenance is immutable: you did prove it. The claim about *today* is not, so
 * every member is re-checked against the live graph by `livePasses`, and a pair
 * the graph no longer supports is dropped rather than shown stale. A subject
 * that no longer exists goes dormant — retained in storage, absent here.
 */

import type { Graph, SubjectId, VerbId } from '../atlas/index.js';
import { byteCompare, nodeAt } from '../atlas/index.js';
import type { NoteFacts, NoteProse, ProvedFile } from '../verbs/index.js';
import { VERBS } from '../verbs/index.js';
import type { Liveness, Progress } from './progress.js';
import { livePasses } from './progress.js';

export type { NoteProse, ProvedFile };

export interface FieldNote extends NoteFacts {
  readonly verb: VerbId;
  readonly subject: SubjectId;
}

/**
 * Every note the record supports against the atlas currently loaded.
 *
 * Ordered by population descending, then subject label — biggest thing you know
 * first, and derived from the graph, so two machines showing the same save show
 * the same page.
 *
 * **Nothing in this file knows what any verb asks, and that is the third time
 * the rule had to be applied here.** `weightsFor` and `noteProse` were both
 * `verb === 'companion' ? … : …`, with Blast Radius as the *else* — so a third
 * verb inherited a claim about import hops by default, and Placement's notes
 * would have read *"all of them direct importers"* about a commit. `subjectPath`
 * was the same shape one field over: `nodeAt(refById.get(subject))` is
 * `undefined` for a commit id, and the `continue` below would have dropped every
 * Placement note in silence. Wording, ruler and label are all on the `Verb`
 * contract now.
 */
export function fieldNotes(graph: Graph, progress: Progress, liveness: Liveness): FieldNote[] {
  const notes: FieldNote[] = [];
  for (const pass of livePasses(progress, liveness)) {
    const verb = VERBS[pass.verb as keyof typeof VERBS];
    // An atlas or a save may name a verb this build does not have. Skipping is
    // the same answer `channelOf` gives to the same question: a claim nothing
    // here understands is not rendered as knowledge.
    if (verb === undefined) continue;
    const subjectLabel = verb.subjectLabel(graph, pass.subject);
    if (subjectLabel === null) continue;
    const weights = verb.noteWeights(graph, pass.subject);

    const proved: ProvedFile[] = [];
    for (const member of pass.proved) {
      const ref = graph.refById.get(member);
      const weight = weights.get(member);
      // Both guards are **unreachable in practice**, and that is deliberate:
      // `livePasses` has already dropped every member the current atlas no
      // longer supports, using the same verb's own rule, so a surviving pass is
      // non-empty and each member has a weight. Mutation testing confirmed it —
      // disabling either changes no test. They stay because the types demand
      // them and because `Math.max()` of an empty list is `-Infinity`, not
      // because there are two filters. The rule lives in `livePasses` and only
      // there.
      if (ref === undefined || weight === undefined) continue;
      proved.push({ path: nodeAt(graph, ref).path, weight });
    }
    if (proved.length === 0) continue;
    // Ascending for hops (nearest first) and for counts alike: the ordering is
    // only there to make the sentence read the same way twice, and `farthest`
    // states which end carries the claim.
    proved.sort((a, b) => a.weight - b.weight || byteCompare(a.path, b.path));
    notes.push({
      verb: pass.verb,
      subject: pass.subject,
      subjectLabel,
      proved,
      farthest: Math.max(...proved.map((file) => file.weight)),
      population: weights.size,
    });
  }
  notes.sort(
    (a, b) =>
      b.population - a.population ||
      byteCompare(a.subjectLabel, b.subjectLabel) ||
      byteCompare(a.verb, b.verb),
  );
  return notes;
}

/**
 * A note in words, written by the verb that earned it.
 *
 * Repo-agnostic templates only (guardrail 2) — every specific string in the
 * output came out of the atlas. See `fieldNotes` for why this dispatches rather
 * than branching.
 */
export function noteProse(note: FieldNote): NoteProse {
  const verb = VERBS[note.verb as keyof typeof VERBS];
  // Unreachable from `fieldNotes`, which has already dropped an unknown verb.
  // Kept because this is exported and the types demand a total function.
  if (verb === undefined) return { claim: '', revealed: null };
  return verb.noteProse(note);
}
