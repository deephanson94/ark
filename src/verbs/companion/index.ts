/**
 * Companion — the M4 verb (NORTH-STAR §6.2).
 *
 * > *"Which file changes with this one most often?"* — ground truth: the
 * > co-change matrix.
 *
 * This is the first verb graded on **git rather than on imports**, which is the
 * thesis NORTH-STAR §2 rests on (*"git is the rubric"*) and which M4 exists to
 * test. It was chosen over Placement and Archaeology for a measured reason and
 * a structural one:
 *
 *  - **Measured.** `docs/prior-art.md` §4.2 found the import graph and the
 *    change-history hotspots are nearly disjoint populations. On `honojs/hono`
 *    this verb reaches 27 files with no import edge at all and lifts the
 *    provable share of the map from 156 nodes to 339; on `sveltejs/svelte`,
 *    from 283 to 808. Those are files Blast Radius **structurally cannot**
 *    ask about.
 *  - **Structural.** Placement's subject is a *commit*, and `Challenge.subject`
 *    is a `NodeId` — so it would have meant changing the atlas shape, the save
 *    key, the selector and the map's click path before a single question could
 *    be asked. Its ground truth is also already lossy in the atlas
 *    (`maxCommitFiles` truncates a retained commit's file list), so it needs
 *    indexer work before guardrail 4 would even allow it. Companion's subject
 *    is a file and its ground truth is complete, so it fits the seam that
 *    already exists.
 *
 * Self-contained per CLAUDE.md: generation, grading, wording and the reveal all
 * live under this directory. `grade` is the shared `gradeSet` — every
 * subset-selection verb reduces to one `Grade`.
 */

import type { Challenge, Graph, NodeId, AtlasId } from '../../atlas/index.js';
import { idOf, nodeAt } from '../../atlas/index.js';
import { gradeSet, keyRule } from '../score.js';
import { counted } from '../members.js';
import { decidedByNothing, disclosesNothing } from '../disclosure.js';
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
import { indexCoChange } from './cochange.js';
import { generateCompanion } from './generate.js';
import { revealOf } from './reveal.js';

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export function promptFor(challenge: Challenge, words: Words): Prompt {
  const evidence = challenge.evidence;
  const bar =
    evidence.kind === 'coChange'
      ? `in at least ${evidence.minCount} separate commit${evidence.minCount === 1 ? '' : 's'}`
      : 'in the same commit';
  const wide = evidence.kind === 'coChange' ? evidence.wideLimit : 0;
  const atMost = evidence.kind === 'coChange' ? evidence.atMost : 1;
  const members = words.noun(challenge.candidates);
  return {
    title: 'companion',
    // "Which of these" is load-bearing, exactly as it is for Blast Radius: it
    // never claims the choice set is exhaustive, which is what lets a file with
    // eighty partners ship a six-file answer key honestly.
    question: `Which of these ${members.many} have changed alongside ${words.label(challenge.subject)} ${bar}?`,
    // The rule is stated with its actual number rather than described. An
    // earlier draft said "commits touching a large fraction of the repo", which
    // is false in both directions: the limit is absolute, so on a small repo it
    // admits a commit touching a quarter of the files and on a monorepo it
    // excludes an ordinary feature landing.
    instruction: `Everything else on this board has changed with it ${atMost === 1 ? 'at most once' : `at most ${atMost} times`}. Commits touching more than ${wide} of the ${words.repo.many} on this map are ignored — they couple everything to everything. ${keyRule(challenge)}`,
    action: 'Map what changes with it',
  };
}

export const PHRASING: SetPhrasing = {
  scope: (challenge) =>
    challenge.evidence.kind === 'coChange'
      ? `read off the change history; the weakest of them shares ${challenge.evidence.minCount} commit${
          challenge.evidence.minCount === 1 ? '' : 's'
        } with the subject`
      : 'read off the change history',
  missed: (count) => `${count} changed with the subject and you left ${plural(count, 'it', 'them')} out.`,
  spurious: (count) => `${count} of your picks ${plural(count, 'has', 'have')} never changed with it.`,
  exact: 'Exact — you found the change unit, not the folder.',
};

export const companion: Verb = {
  id: 'companion',
  channel: 'coChangeTies',
  generate(atlas, options: GenerateOptions = DEFAULT_GENERATE_OPTIONS) {
    return generateCompanion(atlas, options);
  },
  grade(challenge: Challenge, answer: SetAnswer) {
    return gradeSet(challenge, answer, PHRASING);
  },
  prompt: promptFor,
  reveal: revealOf,
  /**
   * A Companion claim is "these two files change together". It stops being true
   * when the current matrix no longer records the pair — a file died, or the
   * walk window slid past the commits that coupled them. (An earlier version of
   * this comment also claimed a focused commit could *become* wide; it cannot —
   * deleting files only shrinks `touched`, so wideness can only fall away.)
   *
   * Checked against **presence in the matrix**, not against the bar the pass was
   * earned at: ADR-0011 stores what was proved, not what it was proved against,
   * and re-deriving a threshold the save never recorded would invent a fact.
   */
  stillHolds(graph: Graph, subject: AtlasId, member: NodeId) {
    const ref = graph.refById.get(subject);
    const memberRef = graph.refById.get(member);
    if (ref === undefined || memberRef === undefined) return false;
    return indexCoChange(graph.atlas).rows.get(ref)?.has(memberRef) === true;
  },
  subjectLabel(graph: Graph, subject: AtlasId) {
    const ref = graph.refById.get(subject);
    return ref === undefined ? null : nodeAt(graph, ref).path;
  },
  /** Shared commits. The population is every partner the matrix records. */
  noteWeights(graph: Graph, subject: AtlasId): NoteWeights {
    const weights = new Map<NodeId, number>();
    const ref = graph.refById.get(subject);
    if (ref === undefined) return weights;
    for (const [member, count] of indexCoChange(graph.atlas).rows.get(ref) ?? []) {
      weights.set(idOf(graph, member), count);
    }
    return weights;
  },
  noteProse(facts: NoteFacts): NoteProse {
    const count = facts.proved.length;
    const names = facts.proved.map((member) => member.label).join(', ');
    const claim =
      `You proved ${counted(count, facts.noun)} that ` +
      `${plural(count, 'changes', 'change')} with ${facts.subjectLabel} — ${names} — ` +
      `the strongest sharing ${facts.farthest} ${plural(facts.farthest, 'commit', 'commits')}.`;
    const revealed =
      facts.population > count
        ? `It has changed with ${counted(facts.population, facts.populationNoun)} in all — the other ${facts.population - count} revealed to you, never proved.`
        : null;
    return { claim, revealed };
  },
  /**
   * Nothing. This reveal names co-changed *pairs* and the count behind them,
   * never a commit — so it cannot state an atom of a commit-membership key.
   * (The reverse direction is real and measured: two Archaeology reveals imply
   * a co-change pair. ADR-0019 records why that one is inference rather than
   * disclosure, and therefore not declared here.)
   */
  discloses: disclosesNothing,
  /** Its candidates are files, and a hint about a relation between files is
   * this verb's own question rather than a shortcut past it. ADR-0022. */
  decidedBy: decidedByNothing,
};

export type { CoChangeIndex, CoChangeRow } from './cochange.js';
export { indexCoChange, rankCompanions } from './cochange.js';
export type { DistractorChoice, StrategyId } from './distractors.js';
export { TARGET_MIX, mixOf, quotas, selectDistractors } from './distractors.js';
export type { GenerationReport, GenerationResult, SkipReason } from './generate.js';
export { generateCompanion, generateWithReport } from './generate.js';
export { revealOf } from './reveal.js';
