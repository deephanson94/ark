/**
 * Archaeology — M4's third verb, and the one that closes the milestone
 * (NORTH-STAR §6.2, tier 5).
 *
 * > *"This file was rewritten three times. What problem kept recurring?"*
 *
 * The second sentence is not gradeable, so the question is **recognition rather
 * than generation**: show a file, show twenty commits from the repo's own
 * history, ask which of them landed here. The recurring problem is what the
 * answer key *is* — the player reads it off the reveal — and nothing about the
 * grade depends on their being able to articulate it. `generate.ts` carries the
 * full argument; ADR-0019 carries the measurements.
 *
 * ## It is Placement transposed, and that is the whole design problem
 *
 * Placement asks *commit → which files?*; this asks *file → which commits?*
 * They are the two projections of one incidence relation, and pretending
 * otherwise would have been dishonest. Three things make it a different verb:
 * the direction of inference (prose→code is §5's tier 6, code→prose is tier 5,
 * and a player can be good at one and bad at the other); what a pass is worth (a
 * Placement pass un-fogs the files it named and never its subject, this un-fogs
 * **the subject** and never its members); and the fact that the overlap is
 * measured rather than assumed — 55.6% of this repo's key members were facts a
 * shipped Placement reveal already stated, which is what `discloses` and
 * `options.disclosed` exist for.
 *
 * ## The first verb whose *members* are not files
 *
 * ADR-0018 widened a subject; this widened a member, and the widening was
 * invisible to the compiler both times because `NodeId` and `CommitId` are
 * aliases of `string`. Nine places assumed a subject was a node; eight assumed a
 * member was a file. Both lists were produced the same way — grep every read,
 * ask *what am I assuming this names?* — and the worst entries were the same
 * kind of silent drop: a save that filters a member at parse and erases it on
 * the next write, a note that `continue`s past a member it cannot resolve, a
 * report that counts a commit as a square on the map.
 *
 * Self-contained per CLAUDE.md: generation, grading, wording, the reveal and the
 * field note all live under this directory. `grade` is the shared `gradeSet` —
 * every subset-selection verb reduces to one `Grade`.
 *
 * The seam claim at the width it actually holds: **nothing in the console, the
 * map, the field notes, the deck or the selector names this verb**, and `VERBS`
 * gained one line. The indexer does name it — `build.ts` runs the generator and
 * `cli.ts` prints its refusals — exactly as it names the other three.
 */

import type { AtlasId, Challenge, Graph, NodeId } from '../../atlas/index.js';
import { commitAt, commitIdFor, isCommitId, isNodeId, nodeAt } from '../../atlas/index.js';
import { gradeSet, keyRule } from '../score.js';
import { credited } from '../members.js';
import type {
  GenerateOptions,
  NoteFacts,
  NoteProse,
  NoteWeights,
  Prompt,
  SetAnswer,
  SetPhrasing,
  Verb,
  Words,
} from '../types.js';
import { DEFAULT_GENERATE_OPTIONS } from '../types.js';
import { decidedByNothing, touchedFact } from '../disclosure.js';
import { generateArchaeology } from './generate.js';
import { revealOf } from './reveal.js';

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export function promptFor(challenge: Challenge, words: Words): Prompt {
  // Its members are commits and its **subject** is a place — the one verb that
  // needs both nouns, and the reason `Words.noun` takes a set rather than the
  // caller handing down a single word for the board.
  const members = words.noun(challenge.candidates);
  const subject = words.noun([challenge.subject]);
  return {
    title: 'archaeology',
    question: `Which of these ${members.many} changed ${words.label(challenge.subject)}?`,
    // Two claims, and both are the invariant stated to the player rather than
    // kept in the generator. "Which of these" never asserts the choice set is
    // exhaustive, which is what lets a file touched twelve times ship a
    // six-commit key honestly. The second sentence is the certification — every
    // other row is a commit whose own file list does not name this file — and it
    // says *inside its lifetime*, which is decision 5's pool filter made
    // visible: the board is not a trick about dates, so guessing by date is not
    // a strategy the question invites.
    instruction:
      `Every other commit here landed inside this ${subject.one}'s lifetime and left it untouched. ` +
      keyRule(challenge),
    action: 'Dig up its history',
  };
}

export const PHRASING: SetPhrasing = {
  scope: () => "read off each commit's own file list",
  missed: (count) =>
    `${count} of them changed this file and you left ${plural(count, 'it', 'them')} out.`,
  spurious: (count) => `${count} of your picks never touched it.`,
  exact: 'Exact — you read the file, not the messages.',
};

export const archaeology: Verb = {
  id: 'archaeology',
  /**
   * A commit has no square on the map, so an answer here draws nothing.
   *
   * Note this is *not* the same statement as Placement's, despite the same
   * value: there the **subject** is placeless, here the **members** are. Checked
   * in code rather than assumed — `main.ts` builds its import-cone licence from
   * `subjectsPassed(progress, liveness, 'blastRadius')`, keyed to that verb by
   * name, so passing an Archaeology board about F does not license drawing F's
   * cone. That was the `tracedRadius` leak, and the fix that closed it holds
   * here for free.
   */
  channel: 'nothing',
  generate(atlas, options: GenerateOptions = DEFAULT_GENERATE_OPTIONS) {
    return generateArchaeology(atlas, options);
  },
  grade(challenge: Challenge, answer: SetAnswer) {
    return gradeSet(challenge, answer, PHRASING);
  },
  prompt: promptFor,
  reveal: revealOf,
  /**
   * An Archaeology claim is "that commit changed this file".
   *
   * It stops being checkable when the commit falls out of the atlas's window —
   * the fact is still true of the repo, but nothing here can confirm it, and
   * ADR-0011 decision 3 drops what the atlas can no longer support rather than
   * showing it stale.
   *
   * As in Placement, this does **not** re-derive whether the commit would still
   * be *eligible* (wide, truncated, contested). Eligibility decides which
   * questions to ask; a pass records what was proved, and re-testing a
   * generation rule against a stored proof would invent a fact the save never
   * recorded.
   */
  stillHolds(graph: Graph, subject: AtlasId, member: AtlasId) {
    if (!isNodeId(subject) || !isCommitId(member)) return false;
    const ref = graph.refById.get(subject);
    if (ref === undefined) return false;
    const commit = commitAt(graph, member);
    return commit !== null && commit.files.includes(ref);
  },
  subjectLabel(graph: Graph, subject: AtlasId) {
    const ref = graph.refById.get(subject);
    return ref === undefined ? null : nodeAt(graph, ref).path;
  },
  /**
   * Every retained commit that touched this file, at weight 1.
   *
   * **Flat, and the flatness is the honest answer.** Blast Radius measures hops
   * and Companion counts shared commits; "landed on this file" is a boolean.
   * Time *looks* like a gradient and is not one — a commit is not "further from"
   * a file for being older, and ranking by age would put a number in front of
   * the player that the grade never used. `noteProse` below therefore never
   * mentions `farthest`, exactly as Placement's does not.
   *
   * The population is every **retained** commit that names the subject, not the
   * eligible subset the generator drew from: this is `Verb.noteWeights`'s "what
   * that population is today", recomputed from the atlas so a note decays when
   * the window slides (ADR-0011 decision 3), and it must agree with
   * `stillHolds`, which also reads the retained list.
   */
  noteWeights(graph: Graph, subject: AtlasId): NoteWeights {
    const weights = new Map<AtlasId, number>();
    const ref = graph.refById.get(subject);
    if (ref === undefined) return weights;
    for (const commit of graph.atlas.history.commits) {
      if (commit.files.includes(ref)) weights.set(commitIdFor(commit.sha), 1);
    }
    return weights;
  },
  noteProse(facts: NoteFacts): NoteProse {
    const count = facts.proved.length;
    const names = facts.proved.map((member) => member.label).join('; ');
    const claim =
      `${credited(facts.register, count, facts.noun)} that ` +
      `${plural(count, 'changed', 'changed')} ${facts.subjectLabel} — ${names}.`;
    // The gap between what was proved and what the history holds is exactly what
    // sampling left out, and naming it as *revealed* is what keeps the sentence
    // above honest (ADR-0011 decision 3, NORTH-STAR §9's proved-versus-shown).
    const revealed =
      facts.population > count
        ? `${facts.population} commits in the window touched it in all — the other ${facts.population - count} revealed to you, never proved.`
        : null;
    return { claim, revealed };
  },
  /**
   * What this verb's reveal states outright, for a later verb not to ask back.
   *
   * Each key member is the atom *"commit C touched file F"*, and `revealOf`
   * puts it on screen in as many words — the same atom Placement declares,
   * arrived at from the other side of the incidence matrix.
   *
   * **No `width` fact, and that asymmetry is deliberate.** Placement's reveal
   * prints `evidence.touched`, so it declares one; this reveal is forbidden from
   * printing a commit's file count (ADR-0019 decision 6), so it has none to
   * declare. Declaring one anyway would price a leak the product does not have —
   * the mistake that document's own review caught running the other way.
   *
   * **Nothing consumes these facts in this build**, because Archaeology
   * generates last and the direction it would close — Archaeology→Placement — is
   * shut by construction: `F ∈ files(C)` can never be a candidate on C's
   * Placement board, and `F ∈ truth(C)` means decision 7 already removed C from
   * F's key. It is declared regardless, because `discloses` asks *what does my
   * reveal give away?* and the honest answer is not "nothing"; a build that
   * reorders generation, or a fifth verb, would need it to be right.
   */
  *discloses(challenge: Challenge) {
    // A guard rather than an assertion: `Verb` is typed over the general
    // `Challenge`, and a hand-edited atlas can put anything in `subject`.
    if (!isNodeId(challenge.subject)) return;
    const subject: NodeId = challenge.subject;
    for (const member of challenge.truth) {
      if (isCommitId(member)) yield touchedFact(member, subject);
    }
  },
  /**
   * Nothing. Its candidates are commits, and no verb states a relation over
   * those — the mirror of why `directory` is not in its gate set. ADR-0022.
   */
  decidedBy: decidedByNothing,
  /**
   * The commits in this key, as the facts that would state them.
   *
   * Byte-identical to `discloses` here, and the duplication is the honest
   * shape rather than an oversight: this verb's reveal happens to state exactly
   * its own key, so the two questions have one answer *on this verb*. Placement
   * is the counter-example one file over — same relation, and its `discloses`
   * carries a `widthFact` that belongs to neither key — so collapsing them into
   * one call would be right here and wrong there, which is the way a seam
   * usually breaks.
   *
   * This is the direction that actually fires: ADR-0019 measured a served
   * Placement reveal stating **55.6% of this repo's Archaeology key members**,
   * so a hold-out that ignored it would ship quiz items whose answers are
   * printed in the deck the participant plays.
   */
  *keyFacts(challenge: Challenge) {
    if (!isNodeId(challenge.subject)) return;
    const subject: NodeId = challenge.subject;
    for (const member of challenge.truth) {
      if (isCommitId(member)) yield touchedFact(member, subject);
    }
  },
};

export type { GenerationReport, GenerationResult, SkipReason } from './generate.js';
export { generateArchaeology, generateWithReport } from './generate.js';
export type { StrategyId } from './distractors.js';
export { TARGET_MIX, mixOf, quotas, selectDistractors } from './distractors.js';
export { analyseCommits, messageWords } from './corpus.js';
export { revealOf } from './reveal.js';
