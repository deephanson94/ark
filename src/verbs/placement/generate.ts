/**
 * Placement generation — NORTH-STAR §6.2, semantics fixed by ADR-0018.
 *
 * > *"Feature X was added. Which file(s) changed?"* — ground truth: the real
 * > commit.
 *
 * The algorithm is one invariant, and it is deliberately the same *shape* as the
 * other two verbs':
 *
 *     candidates ∩ files(commit) = truth
 *
 * Every candidate is either in the answer key, or a file the commit **provably
 * did not touch**. A commit with twenty files ships a six-file key and keeps the
 * other fourteen off the board entirely — no middle band, no boundary to guess
 * at, exactly as ADR-0008 does with hop depth and ADR-0014 with co-change count.
 *
 * ## What is different here, and it is the easy direction
 *
 * Both earlier verbs certify an exclusion by **absence** — from a cone, from a
 * matrix — and absence is only as trustworthy as the walk that produced it. That
 * is why Companion refuses a whole repo whose commit walk stopped short
 * (ADR-0014 decision 6) and refuses a shallow clone besides.
 *
 * Placement certifies by absence from **one commit's own recorded file list**,
 * which is a positive record and complete for every commit the atlas retained.
 * How far back the walk went cannot make it wrong. `commits.ts` carries the full
 * argument and the three refusals that *do* apply.
 *
 * ## The sample is spread across a path ordering, and the ordering is the point
 *
 * `truth` is `size` files taken at even intervals across the commit's files
 * **sorted by path**, rather than its first `size`.
 *
 * The sort is not decoration and this comment claimed it for a while without it.
 * `commit.files` holds `NodeRef`s ascending, and `atlas.nodes` is ordered by
 * **node id** — an FNV-1a hash of the origin path (`identity.ts`) — so a
 * commit's file list arrives in a deterministic *hash shuffle*, not in path
 * order. Spreading over that is spreading over noise: it is stable, and it means
 * nothing. Sorting first is what makes the sample the thing the verb is asking
 * about — a cross-section of *where* the change landed, one file from each part
 * of the tree it touched, rather than six files that happen to hash early.
 *
 * Slicing is rejected for the reason that then becomes true: over a path
 * ordering it hands every wide commit the same alphabetically-first files, which
 * on a repo whose root holds its documents is `CHANGELOG.md` and `CLAUDE.md`
 * over and over. The counts are identical either way — 36 boards on this repo
 * and 54 on hono, with the same refusal breakdown, measured by running the
 * generator both ways — so this is a choice about what the key teaches, not
 * about supply.
 *
 * Nothing here consults `Math.random()`; every ordering is total and tie-broken
 * on node id.
 */

import type { Atlas, Challenge, NodeRef } from '../../atlas/index.js';
import { buildGraph, byteCompare, commitIdFor, nodeAt } from '../../atlas/index.js';
import type { GenerateOptions } from '../types.js';
import { DEFAULT_GENERATE_OPTIONS, maxChallengesFor } from '../types.js';
import { retain, spread, truthCap } from '../sample.js';
import { encodeWitness } from '../../atlas/witness.js';
import { difficultyOf, surpriseOf } from '../difficulty.js';
import { COMMIT_HEURISTICS, gradeHeuristics, textSubject } from '../gate.js';
import { analyse } from '../companion/distractors.js';
import type { CommitSkip, EligibleCommit } from '../commits.js';
import { commitSupply } from '../commits.js';
import type { DistractorChoice, StrategyId } from './distractors.js';
import { mixOf, selectDistractors } from './distractors.js';

/**
 * NORTH-STAR §5 tier 6, Judgment: *"You need to add feature X — where does it
 * go?"*, ground truth *"the actual commit that added it"*. That is this verb,
 * asked backwards — the player is shown the change and asked where it landed —
 * and it is the first question in the deck above tier 3.
 */
const TIER = 6;


export type SkipReason =
  /** A commit touching more than `history.wideLimit` indexed files. */
  | 'wide'
  /** `maxCommitFiles` cut this commit's list, so the answer key is incomplete. */
  | 'truncated'
  /** Guardrail 4: a member with contested rename lineage. */
  | 'uncertain'
  /** Not enough certified non-members to build a choice set. */
  | 'tooFewDistractors'
  /** Pillar 3: a structure-blind heuristic passed the board. See `gate.ts`. */
  | 'ctrlF'
  /** Another commit already asks this exact answer key. */
  | 'duplicateKey'
  /** Dropped to stay inside `maxChallenges`. */
  | 'capped'
  /**
   * The clone is shallow, so its oldest commit's file list is git's diff
   * against the empty tree rather than its own change. Counted once, not once
   * per commit — it is a fact about the atlas, not about a question.
   */
  | 'shallowClone';

export interface GenerationReport {
  readonly commitsConsidered: number;
  readonly generated: number;
  /** The narrowest and widest answer key shipped, in files. */
  readonly keyRange: readonly [number, number] | null;
  /** Commits whose full file list was wider than the key that shipped. */
  readonly sampled: number;
  /** `maxCommitFiles`, recovered from the truncation report. Null if it never bit. */
  readonly fileCap: number | null;
  /** True when the clone is shallow, so no question could be asked at all. */
  readonly shallow: boolean;
  /** Nodes barred from every role by contested lineage. */
  readonly contestedNodes: number;
  /** Nodes no Placement question can ever lift the fog from. */
  readonly unprovableNodes: number;
  /** Sorted by reason. Never silent — CLAUDE.md. */
  readonly skipped: readonly (readonly [SkipReason, number])[];
  /** How many wrong answers each strategy actually produced, repo-wide. */
  readonly distractorMix: readonly (readonly [StrategyId, number])[];
  /** What each structure-blind heuristic scored, summed for a repo-wide mean. */
  readonly heuristicMean: readonly (readonly [string, number])[];
}

export interface GenerationResult {
  readonly challenges: readonly Challenge[];
  readonly report: GenerationReport;
}

interface Built {
  readonly challenge: Challenge;
  readonly mix: readonly DistractorChoice[];
}

export function generatePlacement(
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
  // Path segments, name tokens and the churn ordering, computed once. Both
  // sibling files record what doing this per subject cost; this one asks for a
  // choice set once per *commit*, which is the same trap with a different index.
  const corpus = analyse(graph);
  const cap = truthCap(options.candidateCount);

  const skipped = new Map<SkipReason, number>();
  const note = (reason: SkipReason): void => {
    skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
  };
  for (const [reason, count] of supply.refused) skipped.set(reason as SkipReason, count);

  const heuristicTotals = new Map<string, { sum: number; n: number }>();
  const idOf = (ref: NodeRef): string => nodeAt(graph, ref).id;

  // §8.4's normaliser, computed over every eligible commit rather than the ones
  // that ship, so difficulty describes a question's place in *this repo*.
  let maxBreadth = 0;
  for (const commit of supply.eligible) {
    if (commit.files.length > maxBreadth) maxBreadth = commit.files.length;
  }

  const built: Built[] = [];
  for (const commit of supply.eligible) {
    const entry = build(commit);
    if (typeof entry === 'string') {
      note(entry);
      continue;
    }
    built.push(entry);
  }

  function build(commit: EligibleCommit): Built | SkipReason {
    const touched = new Set<NodeRef>(commit.files);
    // The pool is every node the commit provably did not touch. Files it *did*
    // touch are banned whether or not they make the key — that ban is the
    // invariant, and it is what removes the boundary a player would otherwise
    // have to guess at.
    const pool = new Set<NodeRef>();
    for (const ref of atlas.nodes.keys()) {
      if (touched.has(ref) || supply.barred.has(ref)) continue;
      pool.add(ref);
    }

    // Size the key down until selecting everything fails (ADR-0007).
    let size = 0;
    for (let attempt = Math.min(cap, commit.files.length); attempt >= 1; attempt--) {
      if (Math.min(pool.size, options.candidateCount - attempt) > 2 * attempt) {
        size = attempt;
        break;
      }
    }
    if (size === 0) return 'tooFewDistractors';

    // Sorted by path *here* rather than in `commits.ts`, so that the eligible
    // record keeps the atlas's own order and only the sample is re-ordered.
    const byPath = [...commit.files].sort((a, b) =>
      byteCompare(nodeAt(graph, a).path, nodeAt(graph, b).path),
    );
    const truthRefs = spread(byPath, size);
    const words = textSubject(commit.subject, commit.date).words;
    const want = Math.min(pool.size, options.candidateCount - size);
    const distractors = selectDistractors(
      { graph, corpus, anchors: truthRefs, words, pool },
      want,
    );
    const candidateRefs = [...truthRefs, ...distractors.map((choice) => choice.ref)];

    const verdict = gradeHeuristics(
      graph,
      // The prompt shows the commit's message **and its date**, which are the
      // whole of what a structure-blind reader has to work with — the message
      // matched against filenames (`name`) and the date against the inspector's
      // `last seen` column (`recency`). Both are scored.
      textSubject(commit.subject, commit.date),
      candidateRefs,
      truthRefs,
      COMMIT_HEURISTICS,
    );
    for (const [heuristic, score] of verdict.scores) {
      const totals = heuristicTotals.get(heuristic) ?? { sum: 0, n: 0 };
      totals.sum += score;
      totals.n++;
      heuristicTotals.set(heuristic, totals);
    }
    if (!verdict.passed) return 'ctrlF';

    const truth = truthRefs.map(idOf).sort(byteCompare);
    const candidates = candidateRefs.map(idOf).sort(byteCompare);
    // Encoded here, beside the sort that fixes the alignment it depends on. A
    // second place that built a witness would be a second place it could be
    // built against an unsorted candidate list, which validates and lies.
    const witness = encodeWitness(
      candidates,
      new Map(distractors.map((choice) => [idOf(choice.ref), choice.strategy])),
    );

    // §8.4's naive guess, and it is the one the map hands over for free: the
    // inspector prints every node's commit count, so "the files that change a
    // lot are the files that changed" costs the player nothing. `gate.ts`
    // scores the same guess and refuses the board if it earns a band A — the
    // three-way alignment ADR-0008 built for Blast Radius, held for a third
    // verb: map giveaway, naive guess, gate heuristic.
    const naive = [...candidateRefs]
      .sort(
        (a, b) => nodeAt(graph, b).churn - nodeAt(graph, a).churn || byteCompare(idOf(a), idOf(b)),
      )
      .slice(0, size)
      .map(idOf);

    // `reach`: how much of this commit the import graph cannot account for. A
    // commit whose files all import one another is a change inside one module;
    // one whose files touch nothing in common is the cross-cutting change that
    // is hard to place, and that is what makes the question hard.
    let connected = 0;
    for (const ref of truthRefs) {
      const linked =
        (graph.out[ref] ?? []).some((edge) => touched.has(edge.to)) ||
        (graph.in[ref] ?? []).some((edge) => touched.has(edge.from));
      if (linked) connected++;
    }

    return {
      mix: distractors,
      challenge: {
        id: `placement-${commit.sha}`,
        verb: 'placement',
        tier: TIER,
        difficulty: difficultyOf({
          breadth: commit.files.length,
          maxBreadth,
          reach: (size - connected) / size,
          surprise: surpriseOf(truth, naive),
        }),
        subject: commitIdFor(commit.sha),
        candidates,
        truth,
        witness,
        evidence: {
          kind: 'commit',
          subject: commit.subject,
          date: commit.date,
          touched: commit.files.length,
        },
      },
    };
  }

  // ADR-0012 is a **within-verb** property — `docs/atlas-format.md` §3.6 says
  // two verbs may honestly share an answer set, because they are asking
  // different questions about it — so this dedupes against Placement's own keys
  // and never against the other two verbs'.
  //
  // There is deliberately **no re-ask with a disjoint window** here, where Blast
  // Radius has one. There, a colliding subject has a whole cone to draw a second
  // key from; here a collision means two commits touched the same files, and a
  // second window would ask about files this commit's key already excluded — a
  // different board about the same event, which is not what ADR-0012 buys.
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
  const kept = retain(distinct, limit);
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
    for (const id of entry.challenge.truth) provable.add(id);
    narrowest = Math.min(narrowest, entry.challenge.truth.length);
    widest = Math.max(widest, entry.challenge.truth.length);
    if (
      entry.challenge.evidence.kind === 'commit' &&
      entry.challenge.evidence.touched > entry.challenge.truth.length
    ) {
      sampled++;
    }
  }

  return {
    challenges: kept.map((entry) => entry.challenge).sort((a, b) => byteCompare(a.id, b.id)),
    report: {
      commitsConsidered: supply.eligible.length,
      generated: kept.length,
      keyRange: kept.length === 0 ? null : [narrowest, widest],
      sampled,
      fileCap: supply.fileCap,
      shallow: supply.shallow,
      contestedNodes: supply.barred.size,
      // **Truth members only, and the subject is deliberately not counted.**
      // For the other two verbs the subject is a node and passing its question
      // un-fogs it; a commit is not on the map and has no fog to lift, so a
      // Placement pass reveals exactly the files it proved.
      unprovableNodes: atlas.nodes.length - provable.size,
      skipped: [...skipped].sort(([a], [b]) => byteCompare(a, b)),
      distractorMix: [...totals].sort(([a], [b]) => byteCompare(a, b)),
      heuristicMean: [...heuristicTotals]
        .map(([id, entry]) => [id, entry.n === 0 ? 0 : entry.sum / entry.n] as const)
        .sort(([a], [b]) => byteCompare(a, b)),
    },
  };
}


export type { CommitSkip };
