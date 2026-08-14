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

import type { Graph, AtlasId, VerbId } from '../atlas/index.js';
import { byteCompare } from '../atlas/index.js';
import type { NoteFacts, NoteProse, NoteRegister, ProvedMember } from '../verbs/index.js';
import { VERBS, memberLabel, memberNoun } from '../verbs/index.js';
import type { Liveness, Progress } from './progress.js';
import { livePasses } from './progress.js';

export type { NoteProse, ProvedMember };

export interface FieldNote extends NoteFacts {
  readonly verb: VerbId;
  readonly subject: AtlasId;
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
 *
 * **The fourth instance was the *member* resolution, and it was still here.**
 * ADR-0018 fixed the subject; the loop below went on resolving each proved
 * member through `refById` because a member was always a file. Archaeology's are
 * commits, so every one of its notes would have vanished by the same
 * `continue` — the identical bug, in the same function, one line down, surviving
 * the fix that was written for it. `memberLabel` answers for both arms by
 * prefix, so there is nothing left here to be wrong about.
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

    // **A note claims one register, never a mixture** (ADR-0047). A pass can
    // hold both — proved on the first answer, shown on a later one — and a
    // sentence over the union would either overclaim the shown half or
    // underclaim the proved half. So the proved members are the note whenever
    // there are any, which is exactly the behaviour before this change; a pass
    // that proved nothing writes its note from what it was shown, in the
    // register §9 keeps for it. Shown members reach `surveyed` and the map
    // either way (`deriveFog`); what they do not do is get counted as knowledge.
    const register: NoteRegister = pass.proved.length > 0 ? 'proved' : 'shown';
    const claimed = register === 'proved' ? pass.proved : pass.shown;
    const proved: ProvedMember[] = [];
    const provedIds: AtlasId[] = [];
    for (const member of claimed) {
      const weight = weights.get(member);
      // **The name is resolved by prefix, not through `refById`.** This read
      // `graph.refById.get(member)` and `continue`d on a miss, which for an
      // Archaeology member — a commit — is every member: the note would simply
      // never appear, with nothing anywhere to say it had gone. That is
      // ADR-0018's defect 1 exactly, one field over, and the same silent-drop
      // failure `weightsFor` was written to stop.
      //
      // The remaining guard is **unreachable in practice**, and that is
      // deliberate: `livePasses` has already dropped every member the current
      // atlas no longer supports, using the same verb's own rule, so a surviving
      // pass is non-empty and each member has a weight. Mutation testing
      // confirmed it — disabling it changes no test. It stays because the type
      // demands it and because `Math.max()` of an empty list is `-Infinity`, not
      // because there are two filters. The rule lives in `livePasses` and only
      // there.
      if (weight === undefined) continue;
      proved.push({ label: memberLabel(graph, member), weight });
      provedIds.push(member);
    }
    if (proved.length === 0) continue;
    // Ascending for hops (nearest first) and for counts alike: the ordering is
    // only there to make the sentence read the same way twice, and `farthest`
    // states which end carries the claim.
    proved.sort((a, b) => a.weight - b.weight || byteCompare(a.label, b.label));
    notes.push({
      verb: pass.verb,
      subject: pass.subject,
      subjectLabel,
      proved,
      farthest: Math.max(...proved.map((file) => file.weight)),
      population: weights.size,
      // **Two nouns, because they count two different sets.** A Go package's
      // co-change partners include Markdown, so a note can honestly prove four
      // *packages* out of a population of *places*; one noun for both would be
      // wrong about one of the two sentences on every such note.
      noun: memberNoun(graph, provedIds),
      populationNoun: memberNoun(graph, weights.keys()),
      register,
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
  const prose = verb.noteProse(note);
  if (note.register === 'proved') return prose;
  // **The sentence about the *rule* is shared, and the one about the relation is
  // not.** Which register a note is in is a fact about the pass — the board had
  // already been graded once, so it had already explained itself — and it reads
  // identically whatever the verb asked. That is the same seam the deleted
  // `withhold.ts` used for its own sentence, and the reason ADR-0027 holds:
  // nothing here knows what the question was.
  const rule =
    'Recorded as shown rather than proved: this board had already explained ' +
    'itself when you answered it.';
  return {
    claim: prose.claim,
    revealed: prose.revealed === null ? rule : `${prose.revealed} ${rule}`,
  };
}
