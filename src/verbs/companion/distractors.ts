/**
 * Companion's wrong answers — NORTH-STAR §8.3, pointed at history instead of
 * topology.
 *
 * §8.3's four strategies are stated for Blast Radius, where the *structural*
 * relation is the answer and the *historical* one is the best distractor:
 *
 * > **Historically-coupled-but-not-structurally**: files that co-change but
 * > don't import. These are the **best** distractors, because getting them
 * > wrong is itself a lesson.
 *
 * This verb asks the mirror question, so the flagship inverts with it:
 *
 *   structural  the subject imports it, or it imports the subject — and yet
 *               they do **not** change together. §8.3's sentence read
 *               backwards, and the same lesson from the other side: an import
 *               is a compile-time fact, not a maintenance one. A stable
 *               dependency you never touch is the healthiest thing in a
 *               codebase and the most tempting wrong answer here.
 *   busy        high churn, no coupling. The naive strategy for this verb is
 *               "the files that change all the time change with everything",
 *               and this is the supply that punishes it. `gate.ts` scores the
 *               same guess and refuses the board if it wins anyway.
 *   treeSibling same directory, never co-changes. Punishes "same folder = one
 *               unit" exactly as it does for Blast Radius.
 *   nameSimilar `context.ts` vs `context.test.ts`. This is the sharpest one
 *               here, because on real repos the source/test pair usually *is*
 *               a companion — `honojs/hono` couples those two 72 times — so a
 *               name-alike that is **not** coupled is a genuine surprise.
 *
 * `distant` is the fifth label and is not a strategy: it is what fills a board
 * when the four run dry, labelled rather than hidden so `mixOf` can report how
 * much of a choice set was padding.
 *
 * Every ordering is total and tie-broken on node id. Nothing here may consult
 * `Math.random()` — same repo, same choice set, forever.
 *
 * ## On cost, which this file got wrong once
 *
 * The generator asks for a choice set once per subject, so anything done per
 * *node* inside a strategy happens V² times overall. The first version of this
 * file scanned the whole pool in three of the four strategies and called
 * `nameTokens` — a regex and two splits — on every node every time. On
 * `sveltejs/svelte` that took **29.7 s** against Blast Radius's 0.6 s and blew
 * the 10 s index budget on its own.
 *
 * `analyse()` below does that work once, and the two inverted indexes turn
 * "scan every node" into "look up the few that could match". This is the same
 * lesson `blastRadius/distractors.ts` records in its own header, learned twice
 * in the same repo — which is why it is written down again here rather than
 * left as a paragraph in the other verb.
 */

import type { Graph, NodeRef } from '../../atlas/index.js';
import { byteCompare } from '../../atlas/index.js';
import { jaccard, nameTokens, sharedPrefix, splitDir } from '../paths.js';

export type StrategyId = 'structural' | 'busy' | 'treeSibling' | 'nameSimilar' | 'distant';

/**
 * §8.3's ratio, re-weighted for this verb and for one measured reason.
 *
 * There, 40% goes to graph-adjacency because the answer *is* the graph. Here
 * the answer is history, and the two guesses that actually beat these boards
 * are "same folder" and "the busy files" — `gate.ts` refuses 13 subjects on
 * this repo, 17 on hono and 132 on svelte, almost all of them to `churn`. So
 * the budget follows the threat: `busy` is second, not last.
 */
export const TARGET_MIX: readonly (readonly [Exclude<StrategyId, 'distant'>, number])[] = [
  ['structural', 0.35],
  ['busy', 0.25],
  ['treeSibling', 0.2],
  ['nameSimilar', 0.2],
];

export interface DistractorChoice {
  readonly ref: NodeRef;
  readonly strategy: StrategyId;
}

interface NodeFacts {
  readonly id: string;
  readonly segments: readonly string[];
  readonly tokens: readonly string[];
  readonly churn: number;
}

/**
 * Everything the strategies need about a node, computed once per atlas, plus
 * two inverted indexes and one global ordering. See the header on cost.
 */
export interface Corpus {
  readonly facts: readonly NodeFacts[];
  readonly byDirPrefix: ReadonlyMap<string, readonly NodeRef[]>;
  readonly byToken: ReadonlyMap<string, readonly NodeRef[]>;
  /** Every node, churn descending then id. `busy` and `distant` walk this. */
  readonly byChurn: readonly NodeRef[];
}

export function analyse(graph: Graph): Corpus {
  const facts: NodeFacts[] = [];
  const byDirPrefix = new Map<string, NodeRef[]>();
  const byToken = new Map<string, NodeRef[]>();

  for (const [ref, node] of graph.atlas.nodes.entries()) {
    const segments = splitDir(node.path);
    const tokens = nameTokens(node.path);
    facts.push({ id: node.id, segments, tokens, churn: node.churn });

    // Registered under every prefix of its directory, `''` included, so the
    // sibling walk can widen outward one segment at a time.
    for (let depth = segments.length; depth >= 0; depth--) {
      const prefix = segments.slice(0, depth).join('/');
      const bucket = byDirPrefix.get(prefix);
      if (bucket === undefined) byDirPrefix.set(prefix, [ref]);
      else bucket.push(ref);
    }
    for (const token of new Set(tokens)) {
      const bucket = byToken.get(token);
      if (bucket === undefined) byToken.set(token, [ref]);
      else bucket.push(ref);
    }
  }

  const byChurn = graph.atlas.nodes
    .map((_, ref) => ref)
    .sort(
      (a, b) =>
        (facts[b]?.churn ?? 0) - (facts[a]?.churn ?? 0) ||
        byteCompare(facts[a]?.id ?? '', facts[b]?.id ?? ''),
    );

  return { facts, byDirPrefix, byToken, byChurn };
}

export interface DistractorContext {
  readonly graph: Graph;
  readonly corpus: Corpus;
  readonly subject: NodeRef;
  /**
   * Every node that may be offered as a wrong answer. The caller has already
   * removed the subject and **every companion the matrix knows about** — that
   * exclusion is the generator's invariant, and nothing here re-checks it.
   */
  readonly pool: ReadonlySet<NodeRef>;
}

function factOf(context: DistractorContext, ref: NodeRef): NodeFacts {
  const fact = context.corpus.facts[ref];
  if (fact === undefined) throw new RangeError(`no node at index ${ref}`);
  return fact;
}

type Strategy = (context: DistractorContext, limit: number) => readonly NodeRef[];

function compareIds(context: DistractorContext): (a: NodeRef, b: NodeRef) => number {
  return (a, b) => byteCompare(factOf(context, a).id, factOf(context, b).id);
}

/**
 * Import-adjacent, historically silent.
 *
 * Direct neighbours first — an edge either way, because "I import it" and "it
 * imports me" are equally persuasive reasons to expect shared churn and equally
 * unreliable. Then the subject's wider dependency and dependent cones, nearest
 * first, so the least-bad option leads when the direct ring runs out.
 */
const structural: Strategy = (context, limit) => {
  const { graph, subject, pool } = context;
  const compare = compareIds(context);
  const ranked: NodeRef[] = [];
  const seen = new Set<NodeRef>([subject]);

  let frontier: NodeRef[] = [subject];
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
    // Inside a ring, the busiest first: a file that is both structurally
    // adjacent and frequently edited is the single most convincing wrong
    // answer this verb can offer.
    eligible.sort((a, b) => factOf(context, b).churn - factOf(context, a).churn || compare(a, b));
    for (const ref of eligible) ranked.push(ref);
    frontier = next;
  }
  return ranked.slice(0, limit);
};

/**
 * Busy, but not this subject's companion.
 *
 * A file with zero churn is not a plausible wrong answer — it has never changed
 * with anything — so it is not offered here; `distant` will pick it up if the
 * board still needs filling, labelled as the padding it is.
 */
const busy: Strategy = (context, limit) => {
  // Walks the corpus's global churn ordering and stops at `limit`, rather than
  // collecting and sorting the whole pool for every subject.
  const ranked: NodeRef[] = [];
  for (const ref of context.corpus.byChurn) {
    if (ranked.length >= limit) break;
    if (!context.pool.has(ref) || factOf(context, ref).churn <= 0) continue;
    ranked.push(ref);
  }
  return ranked;
};

/** Same directory first, then outward through shared path prefix. */
const treeSibling: Strategy = (context, limit) => {
  const { subject, pool, corpus } = context;
  const compare = compareIds(context);
  const segments = factOf(context, subject).segments;
  const ranked: NodeRef[] = [];
  const seen = new Set<NodeRef>();

  // Deepest shared prefix first, widening outward one segment at a time — a
  // lookup per level rather than a scan of the whole pool.
  for (let depth = segments.length; depth >= 1 && ranked.length < limit; depth--) {
    const prefix = segments.slice(0, depth).join('/');
    const level: NodeRef[] = [];
    for (const ref of corpus.byDirPrefix.get(prefix) ?? []) {
      if (ref === subject || seen.has(ref) || !pool.has(ref)) continue;
      seen.add(ref);
      level.push(ref);
    }
    level.sort(
      (a, b) =>
        sharedPrefix(segments, factOf(context, b).segments) -
          sharedPrefix(segments, factOf(context, a).segments) || compare(a, b),
    );
    for (const ref of level) ranked.push(ref);
  }
  return ranked.slice(0, limit);
};

/** Confusable filenames — including the same basename in another directory. */
const nameSimilar: Strategy = (context, limit) => {
  const { subject, pool, corpus } = context;
  const compare = compareIds(context);
  const tokens = factOf(context, subject).tokens;
  const scored = new Map<NodeRef, number>();
  // Only a file sharing at least one token can score above zero, so the token
  // index is not an approximation of the scan — it finds the same set.
  for (const token of new Set(tokens)) {
    for (const ref of corpus.byToken.get(token) ?? []) {
      if (ref === subject || scored.has(ref) || !pool.has(ref)) continue;
      scored.set(ref, jaccard(tokens, factOf(context, ref).tokens));
    }
  }
  return [...scored.keys()]
    .sort((a, b) => (scored.get(b) ?? 0) - (scored.get(a) ?? 0) || compare(a, b))
    .slice(0, limit);
};

const STRATEGIES: Readonly<Record<Exclude<StrategyId, 'distant'>, Strategy>> = {
  structural,
  busy,
  treeSibling,
  nameSimilar,
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
 * Three passes, the same shape Blast Radius uses: honour the target mix, hand
 * unspent quota back in declared order, then pad with `distant` — whatever is
 * left, nearest in the directory tree first, labelled as padding.
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
    // Padding, labelled as padding. Busiest first off the precomputed ordering
    // — a file nobody has touched is the least plausible wrong answer there is.
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
