/**
 * Placement's wrong answers — NORTH-STAR §8.3, pointed at a commit.
 *
 * §8.3's four strategies are written for a **file** subject: siblings *of the
 * subject*, names similar *to the subject's*, nodes at graph distance n±1 *from
 * the subject*. A commit has no directory, no filename and no position in the
 * import graph, so every one of them needs re-anchoring before it means
 * anything here. The re-anchoring is the same in each case and it is the whole
 * translation: **the subject's neighbourhood becomes the answer key's
 * neighbourhood.**
 *
 *   busy         high churn, and this commit did not touch it. The flagship,
 *                and the ordering is measured rather than argued — see below.
 *   structural   imports, or is imported by, a file the commit changed — and
 *                did not change with it. §8.3's graph-adjacent strategy, and
 *                the lesson is the sharpest this verb has: the compile-time
 *                neighbourhood of a change is not the change.
 *   treeSibling  lives in a directory the commit touched, and was not touched.
 *                Punishes "the whole folder moved", which is what a reader
 *                assumes when they see three files from one directory.
 *   nameSimilar  shares a filename token with a file the commit changed.
 *                `parse.ts` changed, `parse.test.ts` did not.
 *   mentioned    its **own name appears in the commit message**, and the commit
 *                did not touch it. This is the one strategy with no analogue in
 *                §8.3, because §8.3's subject has no prose. It exists to punish
 *                the exact reader pillar 3 forbids serving — the one who scans
 *                the message for a filename — and getting it wrong is the
 *                lesson that a commit message describes an intention, not a
 *                diff.
 *
 * `distant` is the fifth label and is not a strategy: it is what fills a board
 * when the others run dry, labelled rather than hidden so `mixOf` can report
 * how much of a choice set was padding.
 *
 * ## Why `busy` leads, and the measurement that decided it — twice
 *
 * `gate.ts` scores *"select the k busiest candidates"* and refuses any board it
 * earns a band A on. The threat is structural rather than incidental: a commit's
 * files are, almost by definition, files that get committed to, so a board with
 * no busy wrong answers separates the key from the distractors on churn alone.
 *
 * Three configurations of this file, run through the real generator:
 *
 * | | ark deck | ark `ctrlF` | hono `ctrlF` |
 * |---|---|---|---|
 * | as shipped | 36 | 1 | 119 |
 * | `busy` out of the mix, padding unchanged | 34 | 3 | 132 |
 * | no high-churn wrong answer **anywhere** on the board | 31 | 10 | 141 |
 *
 * So `busy` is worth five boards here and twenty-two refusals on hono. Real,
 * and modest.
 *
 * **A first version of this comment claimed ten times that** — "25 of 37
 * refused, a deck of 8" — from a throwaway prototype rather than from the
 * generator. The prototype's own fallback filled boards with the *lowest*-churn
 * files it could find, which manufactured the effect it then measured; the
 * shipped `distant` padding walks the churn ordering busiest-first, so
 * high-churn wrong answers reach the board even with this strategy deleted.
 * The lesson is narrower than "measure": **a counterfactual is only as good as
 * the thing it holds fixed**, and the prototype changed two knobs while naming
 * one. The middle row above exists because the obvious counterfactual — delete
 * the strategy — measures almost nothing.
 *
 * ## Cost
 *
 * The generator asks for a choice set once per commit, so anything done per
 * *node* inside a strategy happens O(commits · V) times. `blastRadius/` and
 * `companion/` both record paying for that lesson — 8 s of a 10 s budget there,
 * 29.7 s on svelte here — so the corpus and the two inverted indexes are
 * `companion/distractors.ts`'s, imported rather than rebuilt, and nothing below
 * tokenises a path.
 */

import type { Graph, NodeRef } from '../../atlas/index.js';
import { byteCompare } from '../../atlas/index.js';
import { jaccard, sharedPrefix } from '../paths.js';
import type { Corpus } from '../companion/distractors.js';

export type StrategyId =
  | 'busy'
  | 'structural'
  | 'treeSibling'
  | 'nameSimilar'
  | 'mentioned'
  | 'distant';

/**
 * §8.3's ratio, re-weighted for this verb. `busy` leads for the measured reason
 * in the header; `mentioned` is last because its supply is thin — it exists at
 * all only when the message names a file the commit did not touch, which is
 * rare and, when it happens, the best wrong answer on the board.
 */
export const TARGET_MIX: readonly (readonly [Exclude<StrategyId, 'distant'>, number])[] = [
  ['busy', 0.35],
  ['structural', 0.2],
  ['treeSibling', 0.2],
  ['nameSimilar', 0.15],
  ['mentioned', 0.1],
];

export interface DistractorChoice {
  readonly ref: NodeRef;
  readonly strategy: StrategyId;
}

export interface DistractorContext {
  readonly graph: Graph;
  readonly corpus: Corpus;
  /**
   * The answer key's members — the files this board is anchored on. **Not**
   * every file the commit touched: an unsampled member must stay off the board
   * entirely (the generator's invariant), so it is in neither `truth` nor
   * `pool` and cannot be reached through here either.
   */
  readonly anchors: readonly NodeRef[];
  /** The commit message's words, lowercased and split — `gate.ts`'s tokeniser. */
  readonly words: ReadonlySet<string>;
  /**
   * Every node that may be offered as a wrong answer. The caller has already
   * removed **every file the commit touched**, sampled or not, and every node
   * with contested lineage. Nothing here re-checks that.
   */
  readonly pool: ReadonlySet<NodeRef>;
}

type Strategy = (context: DistractorContext, limit: number) => readonly NodeRef[];

function idOf(context: DistractorContext, ref: NodeRef): string {
  return context.corpus.facts[ref]?.id ?? '';
}

function churnOf(context: DistractorContext, ref: NodeRef): number {
  return context.corpus.facts[ref]?.churn ?? 0;
}

function compareIds(context: DistractorContext): (a: NodeRef, b: NodeRef) => number {
  return (a, b) => byteCompare(idOf(context, a), idOf(context, b));
}

/**
 * Busy, and not in this commit.
 *
 * A file with zero churn is not a plausible wrong answer to "which files
 * changed" — it has never changed at all — so it is not offered here; `distant`
 * picks it up if the board still needs filling, labelled as the padding it is.
 */
const busy: Strategy = (context, limit) => {
  const ranked: NodeRef[] = [];
  for (const ref of context.corpus.byChurn) {
    if (ranked.length >= limit) break;
    if (!context.pool.has(ref) || churnOf(context, ref) <= 0) continue;
    ranked.push(ref);
  }
  return ranked;
};

/**
 * Import-adjacent to something the commit changed, and untouched by it.
 *
 * Breadth-first from **all** the anchors at once, edges in either direction,
 * so the direct ring of the whole change lands before anything two hops out.
 * Inside a ring the busiest first: a file that is both adjacent to the change
 * and frequently edited is the most convincing wrong answer this verb has.
 */
const structural: Strategy = (context, limit) => {
  const { graph, anchors, pool } = context;
  const compare = compareIds(context);
  const ranked: NodeRef[] = [];
  const seen = new Set<NodeRef>(anchors);

  let frontier: NodeRef[] = [...anchors];
  while (frontier.length > 0 && ranked.length < limit) {
    const next: NodeRef[] = [];
    const eligible: NodeRef[] = [];
    for (const ref of frontier) {
      for (const edge of graph.out[ref] ?? []) {
        if (seen.has(edge.to)) continue;
        seen.add(edge.to);
        next.push(edge.to);
        if (pool.has(edge.to)) eligible.push(edge.to);
      }
      for (const edge of graph.in[ref] ?? []) {
        if (seen.has(edge.from)) continue;
        seen.add(edge.from);
        next.push(edge.from);
        if (pool.has(edge.from)) eligible.push(edge.from);
      }
    }
    eligible.sort((a, b) => churnOf(context, b) - churnOf(context, a) || compare(a, b));
    for (const ref of eligible) ranked.push(ref);
    frontier = next;
  }
  return ranked.slice(0, limit);
};

/**
 * Lives where the change landed, and did not move with it.
 *
 * Deepest shared directory prefix first, widening outward — the same walk
 * Companion's sibling strategy makes, over the union of the anchors' homes
 * rather than one subject's.
 */
const treeSibling: Strategy = (context, limit) => {
  const { anchors, pool, corpus } = context;
  const compare = compareIds(context);
  const scored = new Map<NodeRef, number>();

  for (const anchor of anchors) {
    const segments = corpus.facts[anchor]?.segments ?? [];
    // Widening outward one segment at a time reaches files *above* the anchor's
    // own directory, which the deepest bucket alone would miss. Each candidate
    // is scored once, on the true shared depth rather than on the level it
    // happened to be found at, so a second visit from a shallower prefix has
    // nothing to add.
    const seen = new Set<NodeRef>();
    for (let depth = segments.length; depth >= 1; depth--) {
      const prefix = segments.slice(0, depth).join('/');
      for (const ref of corpus.byDirPrefix.get(prefix) ?? []) {
        if (!pool.has(ref) || seen.has(ref)) continue;
        seen.add(ref);
        const shared = sharedPrefix(segments, corpus.facts[ref]?.segments ?? []);
        // Nearest anchor wins: a file two directories from one changed file and
        // in the same directory as another is a sibling of the change.
        if (shared > (scored.get(ref) ?? 0)) scored.set(ref, shared);
      }
    }
  }

  return [...scored.keys()]
    .sort(
      (a, b) =>
        (scored.get(b) ?? 0) - (scored.get(a) ?? 0) ||
        churnOf(context, b) - churnOf(context, a) ||
        compare(a, b),
    )
    .slice(0, limit);
};

/** Confusable with something the commit changed. `parse.ts` moved, `parse.test.ts` did not. */
const nameSimilar: Strategy = (context, limit) => {
  const { anchors, pool, corpus } = context;
  const compare = compareIds(context);
  const scored = new Map<NodeRef, number>();

  for (const anchor of anchors) {
    const tokens = corpus.facts[anchor]?.tokens ?? [];
    // Only a file sharing at least one token can score above zero, so the token
    // index finds the same set a full scan would — it is not an approximation.
    for (const token of new Set(tokens)) {
      for (const ref of corpus.byToken.get(token) ?? []) {
        if (!pool.has(ref)) continue;
        const score = jaccard(tokens, corpus.facts[ref]?.tokens ?? []);
        if (score > (scored.get(ref) ?? 0)) scored.set(ref, score);
      }
    }
  }

  return [...scored.keys()]
    .sort((a, b) => (scored.get(b) ?? 0) - (scored.get(a) ?? 0) || compare(a, b))
    .slice(0, limit);
};

/**
 * Named in the message, absent from the diff.
 *
 * The one strategy §8.3 has no analogue for, and the one that punishes the
 * reading pillar 3 forbids. Supply is genuinely thin — it needs the message to
 * name a file it did not change — so `TARGET_MIX` asks for little of it and the
 * report says how much it actually produced.
 */
const mentioned: Strategy = (context, limit) => {
  const { pool, corpus, words } = context;
  const compare = compareIds(context);
  const found = new Set<NodeRef>();
  for (const word of words) {
    for (const ref of corpus.byToken.get(word) ?? []) {
      if (pool.has(ref)) found.add(ref);
    }
  }
  return [...found]
    .sort((a, b) => churnOf(context, b) - churnOf(context, a) || compare(a, b))
    .slice(0, limit);
};

const STRATEGIES: Readonly<Record<Exclude<StrategyId, 'distant'>, Strategy>> = {
  busy,
  structural,
  treeSibling,
  nameSimilar,
  mentioned,
};

/**
 * Split `count` across the strategies by `TARGET_MIX`, giving the remainder to
 * whichever strategies were rounded down hardest. Ties go to the declared
 * order, so the split is a pure function of `count`.
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
 * Three passes, the same shape both other verbs use: honour the target mix,
 * hand unspent quota back in declared order, then pad with `distant`.
 */
export function selectDistractors(
  context: DistractorContext,
  count: number,
): readonly DistractorChoice[] {
  if (count <= 0) return [];
  const supply = new Map<Exclude<StrategyId, 'distant'>, readonly NodeRef[]>();
  const cursor = new Map<Exclude<StrategyId, 'distant'>, number>();
  for (const [id] of TARGET_MIX) {
    supply.set(id, STRATEGIES[id](context, count));
    cursor.set(id, 0);
  }

  const chosen: DistractorChoice[] = [];
  const taken = new Set<NodeRef>();

  const takeFrom = (id: Exclude<StrategyId, 'distant'>): boolean => {
    const items = supply.get(id) ?? [];
    let at = cursor.get(id) ?? 0;
    while (at < items.length) {
      const ref = items[at];
      at++;
      if (ref === undefined || taken.has(ref)) continue;
      cursor.set(id, at);
      taken.add(ref);
      chosen.push({ ref, strategy: id });
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
    // Padding, labelled as padding. Busiest first — a file nobody has touched
    // is the least plausible answer to "which files changed" there is.
    for (const ref of context.corpus.byChurn) {
      if (chosen.length >= count) break;
      if (!context.pool.has(ref) || taken.has(ref)) continue;
      taken.add(ref);
      chosen.push({ ref, strategy: 'distant' });
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
