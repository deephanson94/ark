/**
 * Companion generation — NORTH-STAR §6.2, semantics fixed by ADR-0014.
 *
 * > *"Which file changes with this one most often?"* — ground truth: the
 * > co-change matrix.
 *
 * The algorithm is one invariant, and it is deliberately the same *shape* as
 * Blast Radius's:
 *
 *     candidates ∩ companions(subject) = truth
 *
 * where `companions(subject)` is every file the matrix records changing with
 * the subject at all. Every candidate that has ever changed with the subject is
 * in the answer key; every companion not sampled into the key is **absent from
 * the choice set entirely**. That is what lets a file with eighty partners ship
 * a six-file answer key without lying, and it is ADR-0008's trick reused.
 *
 * ## Why there is no threshold, and why that is the whole design
 *
 * The obvious construction is "truth = partners at or above N, distractors =
 * partners below N". It is also wrong, for the reason ADR-0008 removed the
 * depth bound: a candidate whose true count sits one under the bar is a trap
 * for the player who *does* know the repo. They remember the two files moving
 * together, they pick it, and they are marked wrong over an integer nobody
 * could have known.
 *
 * So the band between "certified never" and "in the answer key" is not graded —
 * it is **kept off the board**. Every candidate is either
 *
 *   - in `truth`, having co-changed at least `evidence.minCount` times, or
 *   - certified by `cochange.ts` to have co-changed **at most once**.
 *
 * `minCount` is then *measured* — the weakest coupling that actually made the
 * key — rather than prescribed, which is exactly what ADR-0008 §5 did with
 * `depth`. The player is told it, and the line they are asked to draw is
 * "coupled" against "never coupled", with no knife edge anywhere on the board.
 *
 * ## What this verb refuses to ask about
 *
 * Guardrail 4, four ways:
 *
 *  - **No history, no questions.** A repo with no commits produces none, and
 *    risk #7 says tiers 1–4 must stay playable without them.
 *  - **A truncated walk.** If `maxCommitsWalked` stopped the indexer short of
 *    the repo's history, absence from the matrix proves nothing whatever and
 *    the entire repo is refused. There is no bound to derive here — this is the
 *    one loss channel the ceiling argument cannot cover.
 *  - **Contested lineage.** A file whose rename history two live paths both
 *    claimed carries counts that may belong to another file (`Lineage`), so it
 *    is barred from being a subject, an answer or a distractor.
 *  - **A matrix too truncated to certify at all.** If the pair cap bit, absence
 *    only proves a count at or below the last kept pair's, so the bar every
 *    companion must clear rises with it and `evidence.atMost` says what an
 *    exclusion is actually certified at.
 *
 * Nothing here consults `Math.random()`; every ordering is total and tie-broken
 * on node id.
 */

import type { Atlas, Challenge, NodeRef } from '../../atlas/index.js';
import { buildGraph, byteCompare, nodeAt } from '../../atlas/index.js';
import type { GenerateOptions } from '../types.js';
import { DEFAULT_GENERATE_OPTIONS, maxChallengesFor } from '../types.js';
import { difficultyOf, surpriseOf } from '../difficulty.js';
import { HISTORY_HEURISTICS, gradeHeuristics } from '../gate.js';
import type { CoChangeIndex } from './cochange.js';
import { indexCoChange, rankCompanions } from './cochange.js';
import type { DistractorChoice, StrategyId } from './distractors.js';
import { analyse, mixOf, selectDistractors } from './distractors.js';

/** NORTH-STAR §5: "what always changes alongside this file" is tier 3, Coupling. */
const TIER = 3;

/**
 * The largest answer key that still satisfies ADR-0007's 3:1 rule at a given
 * choice-set size. Shared with Blast Radius by arithmetic rather than by
 * import — the rule is ADR-0007's, not either verb's.
 */
export function truthCap(candidateCount: number): number {
  return Math.max(0, Math.floor((candidateCount - 1) / 3));
}

export type SkipReason =
  /** The matrix records nothing changing with it. */
  | 'noCompanions'
  /**
   * Guardrail 4: contested rename lineage. **Not** the truncation cases —
   * those are `windowTruncated` (whole repo) and the raised floor (which routes
   * a subject to `noCompanions`, because it has none this atlas can certify).
   * The label used to claim truncation too and no code path ever produced it
   * for that reason, which would have made the report wrong in exactly the case
   * the branch exists for.
   */
  | 'uncertain'
  /** Not enough certified non-companions to build a choice set that cannot be
   *  passed by selecting everything. */
  | 'tooFewDistractors'
  /** Dropped to stay inside `maxChallenges`. */
  | 'capped'
  /** Pillar 3: a structure-blind heuristic passed the board. See `gate.ts`. */
  | 'ctrlF'
  /** Another subject already asks this exact answer key. */
  | 'duplicateKey'
  /**
   * The commit walk stopped short of the repo's history, so absence from the
   * matrix certifies nothing and the whole repo is refused. Counted once, not
   * once per subject — it is a fact about the atlas, not about a question.
   */
  | 'windowTruncated';

export interface GenerationReport {
  readonly subjectsConsidered: number;
  readonly generated: number;
  /** The weakest and strongest coupling any shipped answer key rests on. */
  readonly minCountRange: readonly [number, number] | null;
  /** True when the pair cap forced the certification bound above 1. */
  readonly capBit: boolean;
  /** True when the commit walk was cut short, so no question could be asked. */
  readonly walkTruncated: boolean;
  /** Nodes barred from every role by contested lineage. */
  readonly contestedNodes: number;
  /** Nodes no Companion question can ever lift the fog from. */
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
  readonly subject: NodeRef;
  readonly mix: readonly DistractorChoice[];
}

export function generateCompanion(
  atlas: Atlas,
  options: GenerateOptions = DEFAULT_GENERATE_OPTIONS,
): readonly Challenge[] {
  return generateWithReport(atlas, options).challenges;
}

/**
 * Every node this verb may not touch, in any role.
 *
 * Contested lineage is the co-change equivalent of a `probable` edge, and it is
 * excluded from the *pool* as well as from subjects and answers: a distractor
 * certified "never changed with the subject" on the strength of history we know
 * is misattributed is exactly the wrong answer key guardrail 4 forbids.
 */
function barred(atlas: Atlas): Set<NodeRef> {
  const out = new Set<NodeRef>();
  for (const [ref, node] of atlas.nodes.entries()) {
    if (node.lineage === 'contested') out.add(ref);
  }
  return out;
}

export function generateWithReport(
  atlas: Atlas,
  options: GenerateOptions = DEFAULT_GENERATE_OPTIONS,
): GenerationResult {
  const graph = buildGraph(atlas);
  const index = indexCoChange(atlas);
  // Path segments, name tokens and the churn ordering, computed once. Doing
  // this inside the per-subject loop cost 29.7 s on `sveltejs/svelte`.
  const corpus = analyse(graph);
  const excluded = barred(atlas);
  const cap = truthCap(options.candidateCount);

  const skipped = new Map<SkipReason, number>();
  const note = (reason: SkipReason): void => {
    skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
  };
  const heuristicTotals = new Map<string, { sum: number; n: number }>();

  const idOf = (ref: NodeRef): string => nodeAt(graph, ref).id;

  // §8.4's normaliser, computed over every node rather than the ones that ship,
  // so difficulty describes a question's place in *this repo*.
  let maxBreadth = 0;
  for (const row of index.rows.values()) {
    let strong = 0;
    for (const count of row.values()) if (count >= index.floor) strong++;
    if (strong > maxBreadth) maxBreadth = strong;
  }

  const built: Built[] = [];
  let considered = 0;

  // Guardrail 4, at the whole-repo level: if the walk stopped short of the
  // repo's history, absence from the matrix proves nothing at all and no
  // certification is possible. See `CoChangeIndex.walkTruncated`.
  const askable = !index.walkTruncated;
  if (!askable) note('windowTruncated');

  for (const subject of askable ? atlas.nodes.keys() : []) {
    const row = index.rows.get(subject);
    if (row === undefined) {
      note('noCompanions');
      continue;
    }
    considered++;
    if (excluded.has(subject)) {
      note('uncertain');
      continue;
    }

    const ranked = rankCompanions(index, subject, idOf).filter((ref) => !excluded.has(ref));
    if (ranked.length === 0) {
      note('noCompanions');
      continue;
    }

    // The pool is everything the matrix certifies as *not* a companion. Every
    // partner the matrix knows about is banned whether or not it makes the key
    // — that ban is the invariant, and it is what removes the count boundary
    // the player would otherwise have to guess at.
    const pool = new Set<NodeRef>();
    for (const ref of atlas.nodes.keys()) {
      if (ref === subject || excluded.has(ref) || row.has(ref)) continue;
      pool.add(ref);
    }

    // Size the key down until selecting everything fails (ADR-0007).
    let size = 0;
    for (let attempt = Math.min(cap, ranked.length); attempt >= 1; attempt--) {
      if (Math.min(pool.size, options.candidateCount - attempt) > 2 * attempt) {
        size = attempt;
        break;
      }
    }
    if (size === 0) {
      note('tooFewDistractors');
      continue;
    }

    const truthRefs = ranked.slice(0, size);
    // The measured bar: the weakest coupling that made the key. Never below
    // `index.floor`, because `rankCompanions` only offers partners that clear
    // it — which is what lets every absent candidate be a certified exclusion.
    // There is deliberately **no second check** here: a re-test of a condition
    // the ranking already enforces would be a branch that can never be taken.
    let minCount = Number.POSITIVE_INFINITY;
    for (const ref of truthRefs) minCount = Math.min(minCount, row.get(ref) ?? 0);

    const want = Math.min(pool.size, options.candidateCount - size);
    const distractors = selectDistractors({ graph, corpus, subject, pool }, want);
    const candidateRefs = [...truthRefs, ...distractors.map((choice) => choice.ref)];

    const verdict = gradeHeuristics(
      graph,
      subject,
      candidateRefs,
      truthRefs,
      HISTORY_HEURISTICS,
    );
    for (const [heuristic, score] of verdict.scores) {
      const entry = heuristicTotals.get(heuristic) ?? { sum: 0, n: 0 };
      entry.sum += score;
      entry.n++;
      heuristicTotals.set(heuristic, entry);
    }
    if (!verdict.passed) {
      note('ctrlF');
      continue;
    }

    const truth = truthRefs.map(idOf).sort(byteCompare);
    const candidates = candidateRefs.map(idOf).sort(byteCompare);

    // §8.4's naive guess, and it is the one the map actually hands over: the
    // inspector prints every node's commit count, so "the busy files are the
    // coupled files" is free to any player. `gate.ts` scores the same guess and
    // refuses the board if it earns an A, which is the three-way alignment
    // ADR-0008 built for Blast Radius — map giveaway, naive guess, gate.
    const naive = [...candidateRefs]
      .sort((a, b) => nodeAt(graph, b).churn - nodeAt(graph, a).churn || byteCompare(idOf(a), idOf(b)))
      .slice(0, size)
      .map(idOf);

    // `reach`: how much of this key the import graph cannot see. A companion
    // the subject imports is half-guessable from the map; one with no edge in
    // either direction is the "secretly one module wearing two hats" case
    // NORTH-STAR §2 names, and it is what makes a question hard.
    const neighbours = new Set<NodeRef>();
    for (const edge of graph.out[subject] ?? []) neighbours.add(edge.to);
    for (const edge of graph.in[subject] ?? []) neighbours.add(edge.from);
    const hidden = truthRefs.filter((ref) => !neighbours.has(ref)).length;

    built.push({
      subject,
      mix: distractors,
      challenge: {
        id: `companion-${nodeAt(graph, subject).id.slice(2)}`,
        verb: 'companion',
        tier: TIER,
        difficulty: difficultyOf({
          breadth: ranked.length,
          maxBreadth,
          reach: hidden / size,
          surprise: surpriseOf(truth, naive),
        }),
        subject: idOf(subject),
        candidates,
        truth,
        evidence: {
          kind: 'coChange',
          minCount,
          wideLimit: index.wideLimit,
          atMost: index.floor - 1,
        },
      },
    });
  }

  // ADR-0012 is a **within-verb** property — `docs/atlas-format.md` §3.6 says
  // two verbs may honestly share an answer set, because they are asking
  // different questions about it — so this dedupes against Companion's own
  // keys and never against Blast Radius's.
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
  let low = Number.POSITIVE_INFINITY;
  let high = 0;
  for (const entry of kept) {
    provable.add(entry.challenge.subject);
    for (const id of entry.challenge.truth) provable.add(id);
    if (entry.challenge.evidence.kind === 'coChange') {
      low = Math.min(low, entry.challenge.evidence.minCount);
      high = Math.max(high, entry.challenge.evidence.minCount);
    }
  }

  return {
    challenges: kept.map((entry) => entry.challenge).sort((a, b) => byteCompare(a.id, b.id)),
    report: {
      subjectsConsidered: considered,
      generated: kept.length,
      minCountRange: kept.length === 0 ? null : [low, high],
      capBit: index.capBit,
      walkTruncated: index.walkTruncated,
      contestedNodes: excluded.size,
      unprovableNodes: atlas.nodes.length - provable.size,
      skipped: [...skipped].sort(([a], [b]) => byteCompare(a, b)),
      distractorMix: [...totals].sort(([a], [b]) => byteCompare(a, b)),
      heuristicMean: [...heuristicTotals]
        .map(([id, entry]) => [id, entry.n === 0 ? 0 : entry.sum / entry.n] as const)
        .sort(([a], [b]) => byteCompare(a, b)),
    },
  };
}

/**
 * Drop to `max` while keeping the difficulty range. Evenly spaced samples of
 * the difficulty-sorted list keep both ends and the middle, so the progression
 * curve survives the cut — the same rule Blast Radius retains under, for the
 * same reason.
 */
function retain<T extends { challenge: Challenge }>(entries: readonly T[], max: number): T[] {
  if (entries.length <= max) return [...entries];
  if (max <= 0) return [];
  const ordered = [...entries].sort(
    (a, b) =>
      a.challenge.difficulty - b.challenge.difficulty || byteCompare(a.challenge.id, b.challenge.id),
  );
  const picked = new Set<number>();
  for (let i = 0; i < max; i++) {
    picked.add(max === 1 ? 0 : Math.round((i * (ordered.length - 1)) / (max - 1)));
  }
  for (let i = 0; picked.size < max && i < ordered.length; i++) picked.add(i);
  return [...picked]
    .sort((a, b) => a - b)
    .map((index) => ordered[index])
    .filter((entry): entry is T => entry !== undefined);
}

export type { CoChangeIndex };
