/**
 * Archaeology generation — NORTH-STAR §6.2, semantics fixed by ADR-0019.
 *
 * §6.2 asks *"This file was rewritten three times. What problem kept
 * recurring?"* and that second sentence is **not gradeable**: naming a recurring
 * problem is free text, so grading it needs either a model in the path
 * (guardrail 3) or an answer key nobody can derive (guardrail 4). The reduction
 * is **recognition instead of generation** — you cannot ask a player to *name*
 * what kept recurring, but you can ask them to *recognise* it:
 *
 *     subject   a file
 *     board     commits
 *     truth     the commits whose own recorded file list names the subject
 *
 * which is the question an experienced developer actually asks when handed a
 * file they do not understand: `git log -- that/file`. The recurring problem is
 * what the answer key **is**; the player reads it off the reveal, and nothing
 * about the grade depends on their articulating it.
 *
 * The invariant is the fourth use of one shape:
 *
 *     candidates ∩ touchedBy(subject) = truth
 *
 * Every candidate is either in the answer key, or a commit **whose own recorded
 * file list does not name the subject**. A file touched by twelve eligible
 * commits ships a six-commit key and the other six appear nowhere on the board —
 * no middle band, no boundary to guess at, exactly as ADR-0008 does with hop
 * depth, ADR-0014 with co-change count and ADR-0018 with a commit's files.
 *
 * ## Three things here are not obvious from the invariant
 *
 * **The key is spread over a date ordering** (decision 3), not the atlas's.
 * `atlas.nodes` is ordered by node id, an FNV-1a hash of the origin path, so
 * spreading over it is spreading over noise. Time is the meaningful axis for a
 * file's history: a sample spread across it is *the arc of the file's life*
 * rather than its six busiest weeks. The cost is paid rather than dodged — date
 * spreading always includes the oldest and newest toucher, which is what makes
 * `oldestK` and `endpoints` real guesses that have to be gated.
 *
 * **The pool is filtered to the subject's own `[firstSeen, lastSeen]`**
 * (decision 5). This excludes no truth member by construction — those dates are
 * the min and max over every walked commit that touched the file — and what it
 * excludes is *wrong answers from outside the file's lifetime*. The reason is
 * the sharpest trap this verb has: the inspector prints every node's first and
 * last seen, and every candidate row shows a date, so "tick every commit inside
 * the range" is free and has **recall 1.0 by construction**. Without the filter
 * that guess scored up to 0.77 on hono, with 17 boards between 0.70 and 0.78 —
 * the edge of a cliff. With it the guess selects the whole board, which is
 * ADR-0007's select-everything exploit, held below the pass threshold by the
 * sizing rule at any `candidateCount`.
 *
 * **A commit an earlier reveal has already placed here is not an answer**
 * (decision 7). Placement's reveal names the files a commit touched, and each of
 * those is the atom *"commit C touched file F"* — which is a member of F's
 * answer key, read the other way. Measured on the keys the generator actually
 * issues: **54.8% of this repo's key members (114 of 208) and 11 of its 61
 * candidate boards entirely**, against 16.4% and 1 of 142 on hono. The commit is
 * then off the board **altogether**, not merely out of the key: it *did* touch
 * the subject, so it can never be a distractor, and the invariant is what forces
 * that. `options.disclosed` is a set of opaque strings — this verb names no
 * other verb, and `build.ts` decides who ran first.
 *
 * Nothing here consults `Math.random()`; every ordering is total and tie-broken
 * on sha or node id.
 */

import type { Atlas, Challenge, NodeRef } from '../../atlas/index.js';
import { buildGraph, byteCompare, commitIdFor, nodeAt } from '../../atlas/index.js';
import type { GenerateOptions } from '../types.js';
import { DEFAULT_GENERATE_OPTIONS, maxChallengesFor } from '../types.js';
import { elevationOf, retain, spread, truthCap } from '../sample.js';
import { encodeWitness } from '../../atlas/witness.js';
import { difficultyOf, surpriseOf } from '../difficulty.js';
import { COMMIT_TRACE_HEURISTICS, gradeCommitHeuristics } from '../gate.js';
import type { CommitHeuristicId } from '../gate.js';
import { nameTokens } from '../paths.js';
import { decidedFact, touchedFact, widthFact } from '../disclosure.js';
import { commitSupply } from '../commits.js';
import { analyseCommits, messageWords } from './corpus.js';
import type { CommitIndex, TraceCorpus } from './corpus.js';
import { analyse } from '../companion/distractors.js';
import type { DistractorChoice, StrategyId } from './distractors.js';
import { mixOf, selectDistractors } from './distractors.js';

/**
 * NORTH-STAR §5 tier 5, History: *"Why is this file weird? What's churned 40
 * times and why?"*, ground truth *"log, blame, revert detection"*. This is the
 * gradeable half of it.
 *
 * Below Placement's tier 6 and above the import verbs' tier 3, so the selector
 * serves it second of three and `main.ts` orders a node's click bucket by tier
 * explicitly — the challenge ids would otherwise put `archaeology-` first
 * alphabetically and invert the curriculum on the primary path (decision 8).
 */
const TIER = 5;

/**
 * **There is no `uncertain` reason here, and its absence is measured rather than
 * assumed.** A first version refused a subject whose own rename lineage is
 * contested, mirroring Companion. That branch can never be taken: `commitSupply`
 * already refuses every commit whose file list contains a barred node, so a
 * contested file has **zero** eligible touchers and is dropped by the
 * fewer-than-two test before the check runs. Confirmed by mutation — deleting
 * the branch changed no test — and on `honojs/hono`, whose 7 contested nodes
 * ship no board either way. Guardrail 4 is honoured more strongly this way, by
 * the supply rule rather than by a second copy of it; a path that never executes
 * is code and test surface asserting a behaviour the product does not have.
 */
export type SkipReason =
  /**
   * Decision 7 took the usable touchers below two: an earlier verb's reveal has
   * already stated where these commits landed.
   *
   * There is deliberately **no `tooFewCommits`**: a file with fewer than two
   * eligible touchers is skipped before the body runs and is not *refused* —
   * having no history is a property of the repo, not a guardrail declining a
   * question, and counting it would make the report read as though most of the
   * codebase had been turned away. This reason exists so the exclusion's cost is
   * a number in the report rather than a counterfactual somebody has to re-run.
   */
  | 'disclosed'
  /** Not enough certified non-touchers inside the subject's own lifetime. */
  | 'tooFewDistractors'
  /** Pillar 3: a structure-blind heuristic passed the board. See `gate.ts`. */
  | 'ctrlF'
  /** Another file's history asks this exact answer key. */
  | 'duplicateKey'
  /** Dropped to stay inside `maxChallenges`. */
  | 'capped';

export interface GenerationReport {
  readonly subjectsConsidered: number;
  readonly generated: number;
  /** The narrowest and widest answer key shipped, in commits. */
  readonly keyRange: readonly [number, number] | null;
  /** Subjects whose full toucher list was wider than the key that shipped. */
  readonly sampled: number;
  /** True when the clone is shallow, so no question could be asked at all. */
  readonly shallow: boolean;
  /**
   * Why each *commit* was refused supply, from the shared eligibility rule.
   *
   * Reported apart from `skipped` because the units differ: this counts
   * commits, that counts subjects. Placement folds the two together, which is
   * harmless there and would be misleading here — "declined 5" would mean two
   * different things in one report.
   */
  readonly commitsRefused: readonly (readonly [string, number])[];
  /** Sorted by reason. Never silent — CLAUDE.md. */
  readonly skipped: readonly (readonly [SkipReason, number])[];
  /** How many wrong answers each strategy actually produced, repo-wide. */
  readonly distractorMix: readonly (readonly [StrategyId, number])[];
  /** What each structure-blind heuristic scored, summed for a repo-wide mean. */
  readonly heuristicMean: readonly (readonly [string, number])[];
  /** How many boards each heuristic beat. The number to quote — see `gate.ts`. */
  readonly heuristicFirings: readonly (readonly [string, number])[];
  /** Nodes no Archaeology question can ever lift the fog from. */
  readonly unprovableNodes: number;
}

export interface GenerationResult {
  readonly challenges: readonly Challenge[];
  readonly report: GenerationReport;
}

interface Built {
  readonly challenge: Challenge;
  readonly mix: readonly DistractorChoice[];
}

export function generateArchaeology(
  atlas: Atlas,
  options: GenerateOptions = DEFAULT_GENERATE_OPTIONS,
): readonly Challenge[] {
  return generateWithReport(atlas, options).challenges;
}

export function generateWithReport(
  atlas: Atlas,
  options: GenerateOptions = DEFAULT_GENERATE_OPTIONS,
): GenerationResult {
  const graph = buildGraph(atlas);
  const supply = commitSupply(atlas);
  // Node-side facts (segments, tokens) and commit-side facts (incidence, message
  // tokens, the date ordering) — both inverted once, outside the loop below.
  const corpus = analyse(graph);
  const trace = analyseCommits(graph, supply.eligible);
  const cap = truthCap(options.candidateCount);

  const skipped = new Map<SkipReason, number>();
  const note = (reason: SkipReason): void => {
    skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
  };

  const heuristicTotals = new Map<string, { sum: number; n: number }>();
  const heuristicFired = new Map<string, number>();

  // §8.4's normaliser, computed over every subject with any supply rather than
  // over the ones that ship, so difficulty describes a question's place in
  // *this repo*.
  let maxBreadth = 0;
  for (const row of trace.touching) {
    if (row.length > maxBreadth) maxBreadth = row.length;
  }

  // **How many *retained* commits touched each file, which is not the same as
  // how many *eligible* ones did.** The generator samples its key from the
  // eligible set; the reveal and the field note both describe the population,
  // and the population a player can check with `git log` is every commit the
  // atlas kept — `wide` ones included, since a wide commit really did touch the
  // file. Keeping these two counts straight is not pedantry: an adversarial
  // review found the reveal printing *"that is every commit in this window that
  // touched X"* over the eligible count while a wide toucher sat in the retained
  // record, which is a **false universal claim the player can falsify with one
  // git command** — and the field note, reading the retained count, contradicted
  // the reveal on 21 of this repo's 26 boards. Both surfaces read this now.
  const retainedTouchers = new Array<number>(atlas.nodes.length).fill(0);
  for (const commit of atlas.history.commits) {
    for (const ref of commit.files) {
      const at = retainedTouchers[ref];
      if (at !== undefined) retainedTouchers[ref] = at + 1;
    }
  }

  let considered = 0;
  const built: Built[] = [];
  for (const ref of atlas.nodes.keys()) {
    const touchers = trace.touching[ref] ?? [];
    const node = atlas.nodes[ref];
    // Not counted as considered: a file with fewer than two eligible touchers
    // has no history to ask about, which is a property of the repo rather than a
    // refusal. Counting it would make the report read as though the guardrails
    // had declined most of the codebase.
    //
    // The date guard rides along here rather than inside `build`, where it was a
    // `return 'tooFewCommits'` that **could never be taken**: two touchers imply
    // both dates, so the reason was structurally unprintable while `report.skipped`
    // documents itself as *"never silent"* and `cli.ts` had a line for it. Same
    // class as the `uncertain` branch this verb already deleted; found by the same
    // question — does this path ever run on a real repo?
    if (touchers.length < 2 || node === undefined) continue;
    const from = node.firstSeen;
    const to = node.lastSeen;
    if (from === null || to === null) continue;
    considered++;
    const entry = build(ref, touchers, from, to);
    if (typeof entry === 'string') {
      note(entry);
      continue;
    }
    built.push(entry);
  }

  function build(
    subject: NodeRef,
    touchers: readonly CommitIndex[],
    from: string,
    to: string,
  ): Built | SkipReason {
    const node = nodeAt(graph, subject);

    // **Decision 7, and the order of these two lines is the whole of ADR-0019's
    // near-miss.** `touched` is built from the *unfiltered* toucher list, so a
    // commit the disclosure rule removes is off the board entirely rather than
    // dropping into the distractor pool — where it would be a commit that
    // really did touch the file, marked wrong.
    const touched = new Set<CommitIndex>(touchers);
    const usable = touchers.filter(
      (index) =>
        !options.disclosed.has(touchedFact(commitIdFor(shaAt(trace, index)), node.id)),
    );
    if (usable.length < 2) return 'disclosed';

    const pool = new Set<CommitIndex>();
    for (let index = 0; index < trace.commits.length; index++) {
      if (touched.has(index)) continue;
      const date = trace.commits[index]?.date ?? '';
      // Decision 5's window filter. Inclusive at both ends: a commit dated
      // exactly first-seen that did *not* touch this file is a perfectly good
      // wrong answer, and excluding it would narrow the pool for nothing.
      if (byteCompare(date, from) < 0 || byteCompare(date, to) > 0) continue;
      // **ADR-0022.** Offering this commit lets the reveal say *"it touched a
      // file that usually moves with this one"*, and the map draws that seed's
      // partners beside the commit's own Placement board — which its generator
      // has already scored and declared decidable. Off the board entirely, in
      // decision 7's shape rather than as a withheld sentence: a candidate that
      // is never offered cannot signal anything by its silence, where a class
      // withheld from one row would (ADR-0020 decision 3).
      if (options.disclosed.has(decidedFact(commitIdFor(shaAt(trace, index)), node.id, 'coChange'))) {
        continue;
      }
      pool.add(index);
    }

    // Size the key down until selecting everything fails (ADR-0007).
    let size = 0;
    for (let attempt = Math.min(cap, usable.length); attempt >= 1; attempt--) {
      if (Math.min(pool.size, options.candidateCount - attempt) > 2 * attempt) {
        size = attempt;
        break;
      }
    }
    if (size === 0) return 'tooFewDistractors';

    const byDate = [...usable].sort(
      (a, b) =>
        byteCompare(trace.commits[a]?.date ?? '', trace.commits[b]?.date ?? '') ||
        byteCompare(shaAt(trace, a), shaAt(trace, b)),
    );
    const truthIndices = spread(byDate, size);

    const words = new Set(nameTokens(node.path));
    const want = Math.min(pool.size, options.candidateCount - size);
    const distractors = selectDistractors(
      { graph, corpus, trace, subject, words, pool },
      want,
    );
    const candidateIndices = [...truthIndices, ...distractors.map((choice) => choice.index)];

    const verdict = gradeCommitHeuristics(
      {
        words,
        firstSeen: from,
        lastSeen: to,
        // The player's knowledge, not the atlas's: `broadKnown` is only a guess
        // someone can make about a commit whose width a reveal has printed.
        widthKnown: (commit) => options.disclosed.has(widthFact(commit)),
      },
      candidateIndices.map((index) => recordAt(trace, index)),
      truthIndices.map((index) => recordAt(trace, index)),
      COMMIT_TRACE_HEURISTICS,
    );
    for (const [heuristic, score] of verdict.scores) {
      const totals = heuristicTotals.get(heuristic) ?? { sum: 0, n: 0 };
      totals.sum += score;
      totals.n++;
      heuristicTotals.set(heuristic, totals);
    }
    for (const heuristic of verdict.beatenBy) {
      heuristicFired.set(heuristic, (heuristicFired.get(heuristic) ?? 0) + 1);
    }
    if (!verdict.passed) return 'ctrlF';

    const idOf = (index: CommitIndex): string => commitIdFor(shaAt(trace, index));
    const truth = truthIndices.map(idOf).sort(byteCompare);
    const candidates = candidateIndices.map(idOf).sort(byteCompare);
    // Encoded here, beside the sort that fixes the alignment it depends on. A
    // second place that built a witness would be a second place it could be
    // built against an unsorted candidate list, which validates and lies.
    const witness = encodeWitness(
      candidates,
      new Map(distractors.map((choice) => [idOf(choice.index), choice.strategy])),
    );

    // §8.4's naive guess is `oldestK` — the strongest thing the board alone
    // hands over, since every row shows a date and the list is served in date
    // order. `gate.ts` scores the same guess and refuses any board it wins,
    // which is ADR-0014 decision 7's alignment holding for two of its three legs
    // (the third, the UI giveaway, is `endpoints` — a divergence ADR-0019
    // records rather than papers over).
    const naive = [...candidateIndices]
      .sort(
        (a, b) =>
          byteCompare(trace.commits[a]?.date ?? '', trace.commits[b]?.date ?? '') ||
          byteCompare(shaAt(trace, a), shaAt(trace, b)),
      )
      .slice(0, size)
      .map(idOf);

    // `reach`: how much of this file's history is **not self-describing** — the
    // share of the key whose message never names the file. A file whose commits
    // all say its name is one you can find by reading; one whose commits
    // describe the feature they were part of is the question worth asking.
    let named = 0;
    for (const index of truthIndices) {
      if (messageWords(trace.commits[index]?.subject ?? '').some((word) => words.has(word))) {
        named++;
      }
    }

    return {
      mix: distractors,
      challenge: {
        id: `archaeology-${node.id.slice(2)}`,
        verb: 'archaeology',
        tier: TIER,
        difficulty: difficultyOf({
          breadth: touchers.length,
          maxBreadth,
          reach: (size - named) / size,
          surprise: surpriseOf(truth, naive),
        }),
        subject: node.id,
        candidates,
        truth,
        witness,
        // The **retained** count, not the eligible one — see the comment on
        // `retainedTouchers`. This is what the reveal and the field note both
        // describe, and it is the number a player can check against `git log`.
        evidence: { kind: 'history', touchedBy: retainedTouchers[subject] ?? touchers.length },
      },
    };
  }

  // ADR-0012 is a **within-verb** property — `docs/atlas-format.md` §3.6 says
  // two verbs may honestly share an answer set, because they are asking
  // different questions about it — so this dedupes against Archaeology's own
  // keys and never against the other three verbs'.
  //
  // There is deliberately **no re-ask with a disjoint window**, for Placement's
  // reason: a collision means two files were touched by exactly the same
  // commits, which is a genuine fact about the repo, and a second key would ask
  // about commits this subject's own key already excluded.
  const issued = new Set<string>();
  const distinct: Built[] = [];
  for (const entry of built) {
    const key = [...entry.challenge.truth].sort(byteCompare).join('\n');
    if (issued.has(key)) {
      note('duplicateKey');
      continue;
    }
    issued.add(key);
    distinct.push(entry);
  }

  const limit = options.maxChallenges ?? maxChallengesFor(atlas.nodes.length);
  // Elevation: this verb's subject is a file, and the map draws that file's
  // height from the same number. A cap that ignored it left hono's three most
  // imported files without a board of any verb.
  const kept = retain(distinct, limit, (entry) => elevationOf(entry, graph));
  for (let i = kept.length; i < distinct.length; i++) note('capped');

  const totals = new Map<StrategyId, number>();
  for (const entry of kept) {
    for (const [strategy, count] of mixOf(entry.mix)) {
      totals.set(strategy, (totals.get(strategy) ?? 0) + count);
    }
  }

  const provable = new Set<string>();
  let narrowest = Number.POSITIVE_INFINITY;
  let widest = 0;
  let sampled = 0;
  for (const entry of kept) {
    // **The subject, and only the subject.** For the other three verbs a pass
    // un-fogs whatever files it named; an Archaeology pass proves *commits*,
    // which have no square on the map, so the one thing it lifts is the file the
    // question was about. That is the mirror image of Placement, whose subject
    // is a commit and whose members are the files — the two verbs lift fog in
    // opposite directions.
    provable.add(entry.challenge.subject);
    narrowest = Math.min(narrowest, entry.challenge.truth.length);
    widest = Math.max(widest, entry.challenge.truth.length);
    if (
      entry.challenge.evidence.kind === 'history' &&
      entry.challenge.evidence.touchedBy > entry.challenge.truth.length
    ) {
      sampled++;
    }
  }

  return {
    challenges: kept.map((entry) => entry.challenge).sort((a, b) => byteCompare(a.id, b.id)),
    report: {
      subjectsConsidered: considered,
      generated: kept.length,
      keyRange: kept.length === 0 ? null : [narrowest, widest],
      sampled,
      shallow: supply.shallow,
      commitsRefused: [...supply.refused].sort(([a], [b]) => byteCompare(a, b)),
      unprovableNodes: atlas.nodes.length - provable.size,
      skipped: [...skipped].sort(([a], [b]) => byteCompare(a, b)),
      distractorMix: [...totals].sort(([a], [b]) => byteCompare(a, b)),
      heuristicMean: [...heuristicTotals]
        .map(([id, entry]) => [id, entry.n === 0 ? 0 : entry.sum / entry.n] as const)
        .sort(([a], [b]) => byteCompare(a, b)),
      heuristicFirings: COMMIT_TRACE_HEURISTICS.map(
        (id: CommitHeuristicId) => [id, heuristicFired.get(id) ?? 0] as const,
      ),
    },
  };
}

function shaAt(trace: TraceCorpus, index: CommitIndex): string {
  return trace.commits[index]?.sha ?? '';
}

/**
 * The record the gate scores against.
 *
 * `EligibleCommit` carries everything `gradeCommitHeuristics` reads — sha, date,
 * subject line, file list — so nothing is reconstructed here.
 */
function recordAt(trace: TraceCorpus, index: CommitIndex): {
  sha: string;
  date: string;
  subject: string;
  files: readonly NodeRef[];
} {
  const commit = trace.commits[index];
  if (commit === undefined) throw new RangeError(`no eligible commit at index ${index}`);
  return commit;
}
