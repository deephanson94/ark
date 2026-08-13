/**
 * Placement — M4's second verb (NORTH-STAR §6.2).
 *
 * > *"Feature X was added. Which file(s) changed?"* — ground truth: the real
 * > commit.
 *
 * The first verb whose **subject is not a file**. Companion's own header named
 * that as the reason it went first: *"`Challenge.subject` is a `NodeId` — so it
 * would have meant changing the atlas shape, the save key, the selector and the
 * map's click path before a single question could be asked."* That was true, and
 * ADR-0018 is the change; what it cost is recorded there and in the CHANGELOG,
 * because "the third verb is cheap now" was a claim this verb existed to test.
 *
 * Two things follow from a commit subject and they run in opposite directions.
 *
 * **It makes the ground truth easier.** Both earlier verbs certify a wrong
 * answer by *absence* — from a cone, from a matrix — and absence is only as good
 * as the walk behind it. A commit's file list is a positive record, complete for
 * every commit the atlas kept, so this verb needs none of ADR-0014's
 * whole-repo refusals (`commits.ts` has the argument).
 *
 * **It makes the presentation harder.** A commit has no place on the map, no
 * fog to lift and no region, so every player module that read a subject as a
 * node had to be asked which kind it had. That is where the remaining work was.
 *
 * Self-contained per CLAUDE.md: generation, grading, wording, the reveal and the
 * field note all live under this directory. `grade` is the shared `gradeSet` —
 * every subset-selection verb reduces to one `Grade`.
 *
 * The seam claim, stated at the width it actually holds: **nothing in the
 * console, the map, the field notes, the deck or the selector names this verb**,
 * and `VERBS` gained one line. The *indexer* does name it — `build.ts` runs the
 * generator and `cli.ts` prints its refusals — exactly as it names the other two,
 * because a report about what a verb declined has nowhere else to live. A
 * blanket "nothing outside this directory names it" would be the kind of
 * overclaim this repo keeps having to walk back.
 */

import type { Challenge, Graph, NodeId, AtlasId } from '../../atlas/index.js';
import { commitAt, idOf, isCommitId, nodeAt } from '../../atlas/index.js';
import { CTRL_F_THRESHOLD } from '../gate.js';
import { gradeSet, keyRule, scoreSet } from '../score.js';
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
import { decidedFact, touchedFact, widthFact } from '../disclosure.js';
import { commitLabel, counted } from '../members.js';
import { generatePlacement } from './generate.js';
import { revealOf } from './reveal.js';

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export function promptFor(challenge: Challenge, words: Words): Prompt {
  const evidence = challenge.evidence;
  const message = evidence.kind === 'commit' ? evidence.subject : '';
  const date = evidence.kind === 'commit' ? evidence.date : '';
  // A commit touches whatever it touches, so this board is the most mixed of
  // the four: 118 of hugo's 121 hold Go packages *and* files.
  const members = words.noun(challenge.candidates);
  return {
    title: 'placement',
    // The commit's own words, quoted. `words.label` is unused here and that is
    // the shape of the verb rather than an omission: the subject is an event,
    // so there is no path to substitute.
    question: `On ${date} a commit landed: "${message}". Which of these ${members.many} did it change?`,
    // "Which of these" is load-bearing exactly as it is for the other two verbs:
    // it never claims the choice set is exhaustive, which is what lets a
    // twenty-file commit ship a six-file answer key honestly. The second
    // sentence is the certification — every other candidate is a file this
    // commit provably did not touch, which is the invariant stated to the
    // player rather than kept in the generator.
    instruction:
      `Every other ${members.one} on this board was untouched by that commit. ` +
      keyRule(challenge),
    action: 'Place a commit',
  };
}

export const PHRASING: SetPhrasing = {
  scope: () => "read off the commit's own file list",
  missed: (count) => `${count} changed in that commit and you left ${plural(count, 'it', 'them')} out.`,
  spurious: (count) => `${count} of your picks ${plural(count, 'was', 'were')} untouched by it.`,
  exact: 'Exact — you placed the change, not the neighbourhood.',
};

export const placement: Verb = {
  id: 'placement',
  /**
   * A commit is not a node, so there is no cone to widen and no pair to wire.
   * `nothing` is the honest answer and it is why the channel exists: a verb
   * that borrowed `importRadius` here would draw a cone the player had not
   * earned, which is the leak class ADR-0014 records three instances of.
   */
  channel: 'nothing',
  generate(atlas, options: GenerateOptions = DEFAULT_GENERATE_OPTIONS) {
    return generatePlacement(atlas, options);
  },
  grade(challenge: Challenge, answer: SetAnswer) {
    return gradeSet(challenge, answer, PHRASING);
  },
  prompt: promptFor,
  reveal: revealOf,
  /**
   * A Placement claim is "this file changed in that commit". It stops being
   * checkable when the commit falls out of the atlas's window — the fact is
   * still true of the repo, but nothing here can confirm it, and ADR-0011
   * decision 3 drops what the atlas can no longer support rather than showing
   * it stale.
   *
   * Note what this does **not** do: it does not re-derive whether the commit
   * would still be *eligible* (wide, truncated, contested). Eligibility decides
   * which questions to ask; a pass records what was proved, and re-testing a
   * generation rule against a stored proof would invent a fact the save never
   * recorded — the same reason Companion checks matrix presence rather than the
   * bar its pass was earned at.
   */
  stillHolds(graph: Graph, subject: AtlasId, member: NodeId) {
    const commit = commitAt(graph, subject);
    if (commit === null) return false;
    return commit.files.some((ref) => idOf(graph, ref) === member);
  },
  subjectLabel(graph: Graph, subject: AtlasId) {
    const commit = commitAt(graph, subject);
    return commit === null ? null : commitLabel(commit);
  },
  /**
   * Every file the commit touched, at weight 1.
   *
   * **This relation has no gradient and the flat weight says so.** Blast Radius
   * measures hops and Companion counts shared commits; "was in this commit" is a
   * boolean, and inventing a ranking for it — by churn, by size, by directory —
   * would put a number in front of the player that the grade never used.
   * `noteProse` below therefore never mentions `farthest`.
   */
  noteWeights(graph: Graph, subject: AtlasId): NoteWeights {
    const weights = new Map<NodeId, number>();
    const commit = commitAt(graph, subject);
    if (commit === null) return weights;
    for (const ref of commit.files) weights.set(nodeAt(graph, ref).id, 1);
    return weights;
  },
  noteProse(facts: NoteFacts): NoteProse {
    const count = facts.proved.length;
    const names = facts.proved.map((member) => member.label).join(', ');
    const claim =
      `You proved ${counted(count, facts.noun)} that ` +
      `${plural(count, 'changed', 'changed')} in ${facts.subjectLabel} — ${names}.`;
    // The gap between what was proved and what the commit touched is exactly
    // what sampling left out (ADR-0018), and naming it as *revealed* is what
    // keeps the sentence above honest.
    const revealed =
      facts.population > count
        ? `It touched ${counted(facts.population, facts.populationNoun)} in all — the other ${facts.population - count} revealed to you, never proved.`
        : null;
    return { claim, revealed };
  },
  /**
   * Everything this verb's reveal states about a commit, and it is the only
   * verb in this build that states anything (ADR-0019 decision 7).
   *
   * Two kinds, because two different things leaked and they have different
   * shapes:
   *
   *  - **`touched`, once per key member.** `revealOf` names each file in
   *    `truth` beside the commit, so *"this commit changed that file"* is a
   *    sentence on the screen. It is also, read the other way, a member of that
   *    file's Archaeology answer key.
   *  - **`width`, once.** `evidence.touched` is printed as the commit's full
   *    file count so the reveal can say what sampling left out (ADR-0018
   *    decision 2). That single number lets a later board be ranked by commit
   *    size without reading a message.
   *
   * Only `truth` is declared, never `candidates`. The reveal explains a
   * *distractor* as a file the commit did not touch, which is a negative fact:
   * it cannot put a commit into an answer key, only keep one out of a board it
   * was never on.
   */
  *discloses(challenge: Challenge) {
    // A guard rather than an assertion: `Verb` is typed over the general
    // `Challenge`, and a hand-edited atlas can put anything in `subject`.
    if (!isCommitId(challenge.subject)) return;
    for (const member of challenge.truth) yield touchedFact(challenge.subject, member);
    if (challenge.evidence.kind === 'commit') yield widthFact(challenge.subject);
  },
  /**
   * The members of this key, as the facts that would state them.
   *
   * **The same atoms `discloses` yields and deliberately not the same call.**
   * That one also yields `widthFact`, which names a *size* and no member at
   * all — reusing it would refuse a held-out board because some served reveal
   * printed its file count, which gives away how big the answer is and not one
   * of the answers. `CLAUDE.md`'s landmine about a class label standing in for
   * a class description is this exact substitution, and the two functions
   * agreeing on every other line is what would have made it look right.
   *
   * Not `null`: a commit-membership atom is precisely what the vocabulary was
   * built to express, so a zero here is a measurement.
   */
  *keyFacts(challenge: Challenge) {
    if (!isCommitId(challenge.subject)) return;
    for (const member of challenge.truth) yield touchedFact(challenge.subject, member);
  },
  /**
   * **Which co-change seeds decide this board** — ADR-0022, and the only verb
   * that answers this at all.
   *
   * A later verb's sentence *"it touched a file that usually moves with this
   * one"* hands the player a seed, and the map draws that seed's partners
   * (ADR-0016, whose gate knows nothing about an open Placement board). Ticking
   * the candidates wired to the seed then beat band A on **3 of this repo's 40
   * boards** — measured through the visible wires alone, not the whole matrix.
   * This is that guess, scored here where the answer key lives, so the verb that
   * would say it can decline without ever seeing this deck.
   *
   * **One pass over the matrix, and the seeds come out of it.** A seed only
   * matters if it is wired to a candidate, so the pass that finds the seeds is
   * the pass that builds their picked sets — no per-node work inside a
   * per-candidate loop, which is the cost landmine two files in this repo carry.
   * The relation is symmetric, so each pair is inspected from both ends.
   */
  *decidedBy(graph: Graph, challenge: Challenge) {
    if (!isCommitId(challenge.subject)) return;
    const candidates = new Set<number>();
    for (const id of challenge.candidates) {
      const ref = graph.refById.get(id);
      if (ref !== undefined) candidates.add(ref);
    }
    // seed → the candidates on this board that co-change with it.
    const wired = new Map<number, number[]>();
    const link = (seed: number, candidate: number): void => {
      if (seed === candidate) return;
      const bucket = wired.get(seed);
      if (bucket === undefined) wired.set(seed, [candidate]);
      else bucket.push(candidate);
    };
    for (const [a, b] of graph.atlas.history.coChange) {
      if (candidates.has(a)) link(b, a);
      if (candidates.has(b)) link(a, b);
    }
    for (const [seed, picked] of wired) {
      // The real scorer against the real bar, so a change to §8.2's bands moves
      // this with them rather than leaving a second copy of the threshold.
      const { score } = scoreSet(
        picked.map((ref) => nodeAt(graph, ref).id),
        challenge.truth,
      );
      if (score >= CTRL_F_THRESHOLD) {
        yield decidedFact(challenge.subject, nodeAt(graph, seed).id, 'coChange');
      }
    }
  },
};


export type { DistractorChoice, StrategyId } from './distractors.js';
export { TARGET_MIX, mixOf, quotas, selectDistractors } from './distractors.js';
export type { GenerationReport, GenerationResult, SkipReason } from './generate.js';
export { generatePlacement, generateWithReport } from './generate.js';
export { revealOf } from './reveal.js';
