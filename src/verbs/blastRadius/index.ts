/**
 * Blast Radius — the v1 verb (NORTH-STAR §6.1).
 *
 * > *"You're changing the signature of `parseConfig()`. Select every file that
 * > will need to change."* — the original wording, and it is **not** what ships.
 *
 * The import graph proves *reachability*, which overapproximates required
 * change: a file importing a different symbol, or importing only a type, may
 * need no edit at all. Promising "will need to change" would mark players wrong
 * on files that provably need no change — the tool's approximation sold as the
 * player's error, which is the trust destruction guardrail 4 exists to prevent.
 * So the prompt promises exactly what the graph proves: **dependence**
 * (ADR-0008).
 *
 * Self-contained per CLAUDE.md: generation, grading and wording all live under
 * this directory, and nothing outside it knows what this verb asks. `grade` is
 * the shared `gradeSet` — every subset-selection verb reduces to one `Grade`,
 * which is the seam that makes adding the next verb free downstream.
 */

import type { Challenge, Graph, NodeId, AtlasId } from '../../atlas/index.js';
import { dependents, idOf, nodeAt } from '../../atlas/index.js';
import { gradeSet, keyRule } from '../score.js';
import { counted, credited } from '../members.js';
import { decidedByNothing, disclosesNothing, keyNotExpressible } from '../disclosure.js';
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
import { generateBlastRadius } from './generate.js';
import { revealOf } from './reveal.js';

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export function promptFor(challenge: Challenge, words: Words): Prompt {
  // The board's own noun, not a constant. Measured on `gohugoio/hugo`, 153 of
  // its 156 Blast Radius boards offer packages and this sentence said *files*.
  const members = words.noun(challenge.candidates);
  return {
    title: 'blast radius',
    // "Which of these" is load-bearing: it never claims the choice set is
    // exhaustive, which is what makes a hub's sampled answer key honest.
    question: `A breaking change lands in ${words.label(challenge.subject)}. Which of these ${members.many} depend on it — directly, or through a chain of imports?`,
    instruction: `Select every ${members.one} that reaches it. ${keyRule(challenge)}`,
    action: 'Map its blast radius',
    // **Where to look, which the map has been able to answer all along.** Point
    // at anything and its direct importers light up (ADR-0008 decision 1, and
    // ADR-0048 for the two sessions the player spent switching that off). This
    // says so rather than assuming it is discovered: six cold testers reported
    // the board as a checkbox list over a map that told them nothing, and one
    // named the cause — *"the evidence you need to reason lives on a different
    // screen from the reasoning."*
    //
    // **It said "hover any file on the map" and that does not work here.** With a
    // board open, a pointer move over the map highlights the matching *row*
    // (`main.ts`'s pointermove returns early on `challengePanel.isOpen()`); it
    // never sets the map's hover, so no ring is drawn for the file under the
    // cursor. Three of ten cold playtesters reported the line as broken, one
    // calling it *"dead on arrival"* and *"the entire bridge between 'the map is
    // pretty' and 'the map is a tool I used to answer the question'"*.
    //
    // The instruction was also unnecessary, which is what made it careless: the
    // subject's own direct importers are drawn the whole time a board is open —
    // that is ADR-0008 decision 1, restored in ADR-0048 — so the thing the
    // sentence sent the player hunting for is already on screen. It now says
    // where to look instead of what to do, which is both true and useful.
    //
    // A sentence that tells a player how to win, and cannot be followed at the
    // moment it appears, is worse than no sentence: two testers failed boards
    // that the drawn ring alone scores 0.729 on.
    //
    // **The version that replaced it was worse, because it was false.** It read
    // *"…import X directly — this question is about what reaches it beyond
    // them"*, and ADR-0008 makes truth the **unbounded** dependent set, so a
    // direct importer is not outside the question, it is 38.8% of this repo's
    // key members and 34.0% of hono's. **7 of ark's 40 boards and 15 of hono's
    // 54 have a key made *entirely* of direct importers**, where a player who
    // believes the sentence scores 0.000; deck-wide, obeying it caps you at
    // 0.654 and 0.598 against a 0.78 band A. Four of five cold testers in round
    // 6 excluded the direct importers and said so unprompted — *"I scored 40%
    // against a 50% bar because I believed the instructions"*.
    //
    // Two defects in one sentence, and the second is why nothing caught it.
    // *"Ringed"* is the **legend's** word for something else — "has a question
    // you have not answered" — so one screen used one term for two things, and
    // three testers named that collision separately. This repo's landmine is
    // exact about the class: a suite that checks the shape of a sentence never
    // checks whether it is true. `tests/unit/wording.test.ts` now holds this one
    // to the fact it asserts.
    evidence: `The lines drawn into ${words.label(challenge.subject)} are the ${members.many} that import it directly. Those count — and so does anything that reaches it through a chain of them.`,
  };
}

/**
 * M2's `explain()` wording, moved onto the verb it was always describing.
 * Every sentence here asserts something about *imports*, which is why a second
 * verb could not go on sharing it.
 */
export const PHRASING: SetPhrasing = {
  scope: (challenge) =>
    // `evidence.depth` is the *measured* furthest hop in this answer key, not a
    // bound the generator imposed — there is no bound (ADR-0008) — so the claim
    // here is a fact about the question rather than a description of the tool.
    challenge.evidence.kind === 'importGraph'
      ? `traced through the import graph; the furthest is ${challenge.evidence.depth} ${
          challenge.evidence.depth === 1 ? 'hop' : 'hops'
        } away`
      : 'traced through the import graph',
  missed: (count) =>
    `${count} ${plural(count, 'reaches', 'reach')} the subject by a path you did not select.`,
  spurious: (count) =>
    `${count} of your picks ${plural(count, 'does', 'do')} not reach the subject at all.`,
  exact: 'Exact — you drew the boundary where it actually is.',
};

export const blastRadius: Verb = {
  id: 'blastRadius',
  channel: 'importRadius',
  generate(atlas, options: GenerateOptions = DEFAULT_GENERATE_OPTIONS) {
    return generateBlastRadius(atlas, options);
  },
  grade(challenge: Challenge, answer: SetAnswer) {
    return gradeSet(challenge, answer, PHRASING);
  },
  prompt: promptFor,
  reveal: revealOf,
  /**
   * A Blast Radius claim is "this file reaches that one". It stops being true
   * when the import chain is deleted, so the live graph is the whole check.
   */
  stillHolds(graph: Graph, subject: AtlasId, member: NodeId) {
    const ref = graph.refById.get(subject);
    const memberRef = graph.refById.get(member);
    if (ref === undefined || memberRef === undefined) return false;
    return dependents(graph, ref, Number.POSITIVE_INFINITY).has(memberRef);
  },
  subjectLabel(graph: Graph, subject: AtlasId) {
    const ref = graph.refById.get(subject);
    return ref === undefined ? null : nodeAt(graph, ref).path;
  },
  /** Import hops. The population is the subject's whole transitive cone. */
  noteWeights(graph: Graph, subject: AtlasId): NoteWeights {
    const weights = new Map<NodeId, number>();
    const ref = graph.refById.get(subject);
    if (ref === undefined) return weights;
    for (const [member, distance] of dependents(graph, ref, Number.POSITIVE_INFINITY)) {
      weights.set(idOf(graph, member), distance);
    }
    return weights;
  },
  noteProse(facts: NoteFacts): NoteProse {
    const count = facts.proved.length;
    const names = facts.proved.map((member) => member.label).join(', ');
    const claim =
      `${credited(facts.register, count, facts.noun)} that ` +
      `${plural(count, 'depends', 'depend')} on ${facts.subjectLabel} — ${names} — ` +
      `${facts.farthest === 1 ? 'all of them direct importers' : `the farthest ${facts.farthest} hops away`}.`;
    // The gap between what was proved and what the map shows is exactly the
    // sampled part of the answer key (ADR-0008). Naming it as *revealed* is
    // what keeps the sentence above honest; collapsing the two would restore
    // NORTH-STAR §9's unprovable example.
    const revealed =
      facts.population > count
        ? `Its full radius — ${counted(facts.population, facts.populationNoun)} — is revealed on your map.`
        : null;
    return { claim, revealed };
  },
  /**
   * Nothing. This reveal names files and the import route between them — a
   * relation no other verb's answer key is made of. Measured against
   * Archaeology's keys, which are commits: an import edge states no commit.
   */
  discloses: disclosesNothing,
  /** Its candidates are files, and a hint about a relation between files is
   * this verb's own question rather than a shortcut past it. ADR-0022. */
  decidedBy: decidedByNothing,
  /**
   * **Inexpressible, and that is the answer the hold-out check has to print.**
   *
   * A member of this key is a file that transitively imports the subject. Every
   * fact `disclosure.ts` can build is keyed on a commit, so there is no string
   * an accumulator could hold that would state one — the check is blind here by
   * construction rather than satisfied. It is the same reasoning that makes
   * `discloses` nothing, read from the other end, and it lands on `null` rather
   * than `[]` because this verb is half of `docs/experiments/0001` §4.4's
   * discriminating tier: a zero printed here would be read as *the quiz is
   * clean* on precisely the items the experiment is scored on.
   */
  keyFacts: keyNotExpressible,
};

export type { Corpus, DistractorChoice, DistractorContext, StrategyId } from './distractors.js';
export {
  TARGET_MIX,
  analyse,
  mixOf,
  nameSimilarity,
  nameTokens,
  quotas,
  selectDistractors,
  undirectedDistances,
} from './distractors.js';
export type { DifficultyInput } from '../difficulty.js';
export { WEIGHTS, difficultyOf, hopReach, surpriseOf } from '../difficulty.js';
export type { GenerationReport, GenerationResult, SkipReason } from './generate.js';
export { generateBlastRadius, generateWithReport, sampleByDistance } from './generate.js';
export type { NoteKind, Reveal, RevealNote } from './reveal.js';
export { revealOf } from './reveal.js';
