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
