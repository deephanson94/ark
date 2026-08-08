/**
 * Archaeology's wrong answers — NORTH-STAR §8.3, pointed at a commit board.
 *
 * §8.3's four strategies are written for a board of **files**: siblings in the
 * tree, names similar to the subject's, nodes at graph distance n±1. The board
 * here is a list of *commits*, which have no directory, no filename and no
 * position in the import graph — so, as in Placement, every strategy needs
 * re-anchoring, and the re-anchoring is the same move in each case: **a commit
 * inherits the neighbourhood of the files it touched.**
 *
 *   neighbour    it changed a file the subject imports or is imported by, and
 *                left the subject alone. §8.3's graph-adjacent strategy, and the
 *                lesson is the one Blast Radius spends a whole tier on running
 *                the other way: a change next door is not a change here.
 *   sibling      it changed a file in the subject's own directory. Punishes
 *                "the folder moved together", §8.3's tree-sibling case.
 *   mentions     its **message names the subject** and its diff does not. The
 *                mirror of Placement's `mentioned`, and the sharpest wrong
 *                answer this verb has: a message says what someone meant to do.
 *   companion    it changed a file that co-changes with the subject. §8.3 calls
 *                these the *best* distractors, "because getting them wrong is
 *                itself a lesson" — here the lesson is that a coupling is
 *                statistical, and the two files did not move together *this*
 *                time.
 *
 * `distant` is the fifth label and is not a strategy: it is what fills a board
 * when the others run dry, labelled rather than hidden so `mixOf` can report how
 * much of a choice set was padding.
 *
 * ## The padding is spread across the window, and that is not an aesthetic
 *
 * Placement pads busiest-first, because a file nobody has touched is an
 * implausible answer to "which files changed". The analogous rank here would be
 * *widest-first*, and it must not be used: commit width is the leak
 * `broadKnown` exists to gate (ADR-0019 decision 6), and padding by width would
 * quietly move the number that gate was measured at.
 *
 * Date order is the other obvious candidate and is worse. `truth` is spread over
 * the subject's touching commits in date order, so it always contains the oldest
 * one; padding that skewed *recent* would leave the oldest rows on the board
 * entirely correct, handing `oldestK` the board. So the padding is **spread
 * evenly across the same window the key spans** — the completion of decision 5's
 * pool filter, which already guarantees every candidate is contemporary.
 *
 * ## Cost
 *
 * Every strategy below is a lookup into `corpus.ts`'s inverted indexes. Nothing
 * here walks the commit list, tokenises a path or splits a directory — see that
 * file's header for the two occasions this repo has paid for doing so inside a
 * per-subject loop.
 */

import type { Graph, NodeRef } from '../../atlas/index.js';
import { byteCompare } from '../../atlas/index.js';
import type { Corpus } from '../companion/distractors.js';
import { spread } from '../sample.js';
import type { CommitIndex, TraceCorpus } from './corpus.js';

export type StrategyId = 'neighbour' | 'sibling' | 'mentions' | 'companion' | 'distant';

/**
 * §8.3's ratio, re-weighted for this board.
 *
 * `neighbour` leads at §8.3's own 40% for graph-adjacency. `sibling` takes the
 * 25% §8.3 gives tree-siblings. `mentions` takes the 20% §8.3 spends on
 * name-similarity, because on a commit board the name confusion *is* the message
 * naming a file. `companion` keeps §8.3's 15% for the historically-coupled case.
 *
 * Unspent quota is handed back in declared order and then padded, so a strategy
 * with no supply costs the board nothing — which matters here because three of
 * the four can be empty on an edgeless file.
 */
export const TARGET_MIX: readonly (readonly [Exclude<StrategyId, 'distant'>, number])[] = [
  ['neighbour', 0.4],
  ['sibling', 0.25],
  ['mentions', 0.2],
  ['companion', 0.15],
];

export interface DistractorChoice {
  readonly index: CommitIndex;
  readonly strategy: StrategyId;
}

export interface DistractorContext {
  readonly graph: Graph;
  readonly corpus: Corpus;
  readonly trace: TraceCorpus;
  /** The subject file. */
  readonly subject: NodeRef;
  /** The subject's own name tokens — what a message would have to say. */
  readonly words: ReadonlySet<string>;
  /**
   * Every commit that may be offered as a wrong answer: eligible, dated inside
   * the subject's `[firstSeen, lastSeen]`, and **certified not to have touched
   * the subject**.
   *
   * The caller builds this from the *unfiltered* toucher list. That is
   * load-bearing and ADR-0019 records the near-miss: the probe that first
   * measured decision 7 filtered the touchers *before* computing membership, so
   * every commit the disclosure rule excluded fell into this pool — a board
   * offering a commit that really did touch the file and marking it wrong. A
   * wrong answer key, inside the counterfactual that was about to justify the
   * rule.
   */
  readonly pool: ReadonlySet<CommitIndex>;
}

type Strategy = (context: DistractorContext, limit: number) => readonly CommitIndex[];

function shaOf(context: DistractorContext, index: CommitIndex): string {
  return context.trace.commits[index]?.sha ?? '';
}

/**
 * Rank by how many of `anchors` a commit touched, then by sha.
 *
 * "Touched three of this file's importers" is a more convincing wrong answer
 * than "touched one", and the count is free once the incidence index exists.
 */
function rankByOverlap(
  context: DistractorContext,
  anchors: Iterable<NodeRef>,
  limit: number,
): CommitIndex[] {
  const hits = new Map<CommitIndex, number>();
  for (const ref of anchors) {
    for (const index of context.trace.touching[ref] ?? []) {
      if (!context.pool.has(index)) continue;
      hits.set(index, (hits.get(index) ?? 0) + 1);
    }
  }
  return [...hits.keys()]
    .sort(
      (a, b) =>
        (hits.get(b) ?? 0) - (hits.get(a) ?? 0) ||
        byteCompare(shaOf(context, a), shaOf(context, b)),
    )
    .slice(0, limit);
}

/** Changed a file the subject imports or is imported by. */
const neighbour: Strategy = (context, limit) => {
  const { graph, subject } = context;
  const adjacent = new Set<NodeRef>();
  for (const edge of graph.out[subject] ?? []) adjacent.add(edge.to);
  for (const edge of graph.in[subject] ?? []) adjacent.add(edge.from);
  return rankByOverlap(context, adjacent, limit);
};

/**
 * Changed a file in the subject's own directory.
 *
 * The deepest bucket only, not the widening walk Companion and Placement make:
 * one directory up on a repo with a flat `src/` is most of the codebase, which
 * makes "sibling" mean nothing. Where the deepest bucket is thin, the quota is
 * handed back and another strategy uses it.
 */
const sibling: Strategy = (context, limit) => {
  const segments = context.corpus.facts[context.subject]?.segments ?? [];
  const home = segments.join('/');
  const neighbours = (context.corpus.byDirPrefix.get(home) ?? []).filter(
    (ref) => ref !== context.subject,
  );
  return rankByOverlap(context, neighbours, limit);
};

/**
 * Names the subject in its message, and did not change it.
 *
 * Supply is genuinely thin — it needs a message to name a file it did not touch
 * — so `TARGET_MIX` asks for little of it and the report says how much it
 * actually produced.
 */
const mentions: Strategy = (context, limit) => {
  const found = new Set<CommitIndex>();
  for (const word of context.words) {
    for (const index of context.trace.byMessageToken.get(word) ?? []) {
      if (context.pool.has(index)) found.add(index);
    }
  }
  return [...found]
    .sort((a, b) => byteCompare(shaOf(context, a), shaOf(context, b)))
    .slice(0, limit);
};

/** Changed a file that usually moves with the subject — and not the subject. */
const companion: Strategy = (context, limit) =>
  rankByOverlap(context, context.trace.partners[context.subject] ?? [], limit);

const STRATEGIES: Readonly<Record<Exclude<StrategyId, 'distant'>, Strategy>> = {
  neighbour,
  sibling,
  mentions,
  companion,
};

/**
 * Split `count` across the strategies by `TARGET_MIX`, giving the remainder to
 * whichever were rounded down hardest. Ties go to the declared order, so the
 * split is a pure function of `count`.
 */
export function quotas(count: number): Map<Exclude<StrategyId, 'distant'>, number> {
  const exact = TARGET_MIX.map(([id, share], index) => ({ id, index, want: count * share }));
  const allocated = new Map(exact.map((entry) => [entry.id, Math.floor(entry.want)]));
  let assigned = 0;
  for (const value of allocated.values()) assigned += value;
  const remainder = [...exact].sort(
    (a, b) => b.want - Math.floor(b.want) - (a.want - Math.floor(a.want)) || a.index - b.index,
  );
  for (let i = 0; assigned < count; i++, assigned++) {
    const entry = remainder[i % remainder.length];
    if (entry === undefined) break;
    allocated.set(entry.id, (allocated.get(entry.id) ?? 0) + 1);
  }
  return allocated;
}

/**
 * Choose up to `count` wrong answers.
 *
 * Three passes, the same shape all three sibling verbs use: honour the target
 * mix, hand unspent quota back in declared order, then pad.
 */
export function selectDistractors(
  context: DistractorContext,
  count: number,
): readonly DistractorChoice[] {
  if (count <= 0) return [];
  const supply = new Map<Exclude<StrategyId, 'distant'>, readonly CommitIndex[]>();
  const cursor = new Map<Exclude<StrategyId, 'distant'>, number>();
  for (const [id] of TARGET_MIX) {
    supply.set(id, STRATEGIES[id](context, count));
    cursor.set(id, 0);
  }

  const chosen: DistractorChoice[] = [];
  const taken = new Set<CommitIndex>();

  const takeFrom = (id: Exclude<StrategyId, 'distant'>): boolean => {
    const items = supply.get(id) ?? [];
    let at = cursor.get(id) ?? 0;
    while (at < items.length) {
      const index = items[at];
      at++;
      if (index === undefined || taken.has(index)) continue;
      cursor.set(id, at);
      taken.add(index);
      chosen.push({ index, strategy: id });
      return true;
    }
    cursor.set(id, at);
    return false;
  };

  const allocation = quotas(count);
  for (const [id] of TARGET_MIX) {
    const want = allocation.get(id) ?? 0;
    for (let i = 0; i < want && chosen.length < count; i++) {
      if (!takeFrom(id)) break;
    }
  }

  let progressed = true;
  while (chosen.length < count && progressed) {
    progressed = false;
    for (const [id] of TARGET_MIX) {
      if (chosen.length >= count) break;
      if (takeFrom(id)) progressed = true;
    }
  }

  if (chosen.length < count) {
    // Padding, labelled as padding, and **spread evenly across the window**
    // rather than ranked. See the header: a width rank would move the number
    // `broadKnown` was measured at, and a date rank would hand `oldestK` the
    // board, because the key always contains the oldest toucher.
    const remaining = context.trace.byDate.filter(
      (index) => context.pool.has(index) && !taken.has(index),
    );
    for (const index of spread(remaining, count - chosen.length)) {
      taken.add(index);
      chosen.push({ index, strategy: 'distant' });
    }
  }

  return chosen;
}

/** How many wrong answers each strategy actually produced. For reporting. */
export function mixOf(choices: readonly DistractorChoice[]): Map<StrategyId, number> {
  const counts = new Map<StrategyId, number>();
  for (const [id] of TARGET_MIX) counts.set(id, 0);
  counts.set('distant', 0);
  for (const choice of choices) counts.set(choice.strategy, (counts.get(choice.strategy) ?? 0) + 1);
  return counts;
}
