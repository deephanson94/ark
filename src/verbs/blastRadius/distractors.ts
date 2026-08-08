/**
 * Distractor generation — NORTH-STAR §8.3.
 *
 * "A multiple-choice question is exactly as good as its wrong answers." This
 * file is the reason §8.3 calls distractors a subsystem rather than a helper
 * function: everything else in the verb is a graph query, and this is the part
 * that decides whether the question teaches anything.
 *
 * Four strategies, in §8.3's order of value, at a target mix of 40/25/20/15:
 *
 *   graphAdjacent  structurally near, but the arrow does not reach the subject.
 *                  The flagship is the subject's own **dependencies** — with no
 *                  depth bound there is no "distance n±1" boundary to probe, so
 *                  ADR-0008 §4 reinterprets this strategy as "near but not a
 *                  dependent", and the sharpest version of that is a file the
 *                  subject imports. Confusing "imports" with "is imported by"
 *                  is a real tier-2 mistake and worth teaching.
 *   treeSibling    same directory, no import. Punishes "same folder = coupled".
 *   nameSimilar    `parse.ts` vs `parse-config.util.ts`, or the same basename in
 *                  another directory. Punishes pattern-matching on filenames.
 *   coChange       changes with the subject but does not import it. §8.3 calls
 *                  these the best distractors, because getting one wrong is
 *                  itself the lesson.
 *
 * `distant` is the fifth label and is not a strategy — it is what we fall back
 * to when the four run dry, ranked by undirected graph distance so the least
 * bad option comes first. It is labelled rather than hidden so the generator
 * can report how much of a choice set was padding; see `mixOf`.
 *
 * Every function here is pure and every ordering is total, tie-broken on node
 * id. Nothing may consult `Math.random()` — same repo, same choice set, forever.
 *
 * **On cost.** The generator asks for a choice set once per subject, so
 * anything this file does per *node* is done V² times overall. Splitting paths
 * and tokenising filenames inside those loops cost 8 s of a 10 s index budget
 * on a 2,000-file fixture. `analyse()` does that work once, and the directory
 * and token indexes turn "scan every node" into "look up the few that could
 * match" — which is also why the strategies take a `limit`: none of them has
 * any reason to rank a thousand candidates for a twenty-slot board.
 */

import type { Graph, NodeRef } from '../../atlas/index.js';
import { byteCompare } from '../../atlas/index.js';
import { directoryOf, jaccard, nameTokens, sharedPrefix } from '../paths.js';

// Re-exported because this module's public surface predates `../paths.ts` and
// the callers that import them from here are not wrong to.
export { directoryOf, nameSimilarity, nameTokens, sharedSegments } from '../paths.js';

export type StrategyId = 'graphAdjacent' | 'treeSibling' | 'nameSimilar' | 'coChange' | 'distant';

/** §8.3's starting ratio. "Tune from playtest" — so it lives in one place. */
export const TARGET_MIX: readonly (readonly [Exclude<StrategyId, 'distant'>, number])[] = [
  ['graphAdjacent', 0.4],
  ['treeSibling', 0.25],
  ['nameSimilar', 0.2],
  ['coChange', 0.15],
];

/** How far "structurally near" reaches, ignoring edge direction. */
const NEAR_HOPS = 2;

export interface DistractorChoice {
  readonly ref: NodeRef;
  readonly strategy: StrategyId;
}

interface NodeFacts {
  readonly id: string;
  readonly path: string;
  readonly dir: string;
  readonly segments: readonly string[];
  readonly tokens: readonly string[];
  readonly inDegree: number;
}

/**
 * Everything the strategies need to know about a node, computed once per atlas.
 * Plus two inverted indexes, so "which files share a directory prefix with this
 * one" and "which files share a name token" are lookups rather than scans.
 */
export interface Corpus {
  readonly facts: readonly NodeFacts[];
  readonly byDirPrefix: ReadonlyMap<string, readonly NodeRef[]>;
  readonly byToken: ReadonlyMap<string, readonly NodeRef[]>;
}

export function analyse(graph: Graph): Corpus {
  const facts: NodeFacts[] = [];
  const byDirPrefix = new Map<string, NodeRef[]>();
  const byToken = new Map<string, NodeRef[]>();

  for (const [ref, node] of graph.atlas.nodes.entries()) {
    const dir = directoryOf(node.path);
    const segments = dir === '' ? [] : dir.split('/');
    const tokens = nameTokens(node.path);
    facts.push({
      id: node.id,
      path: node.path,
      dir,
      segments,
      tokens,
      inDegree: (graph.in[ref] ?? []).length,
    });

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

  return { facts, byDirPrefix, byToken };
}

export interface DistractorContext {
  readonly graph: Graph;
  readonly corpus: Corpus;
  readonly subject: NodeRef;
  /**
   * Every node that may be offered as a wrong answer. The caller has already
   * removed the subject and **every dependent at any depth** — that exclusion
   * is the generator's invariant (ADR-0008), and this module must be able to
   * assume it, because nothing here re-checks reachability.
   */
  readonly pool: ReadonlySet<NodeRef>;
  /** Commits in which the subject and this node changed together. */
  readonly coChange: ReadonlyMap<NodeRef, number>;
}

// ---------------------------------------------------------------------------
// path and name analysis
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// the four strategies
// ---------------------------------------------------------------------------

type Strategy = (context: DistractorContext, limit: number) => readonly NodeRef[];

function factOf(context: DistractorContext, ref: NodeRef): NodeFacts {
  const fact = context.corpus.facts[ref];
  if (fact === undefined) throw new RangeError(`no node at index ${ref}`);
  return fact;
}

function byId(context: DistractorContext): (a: NodeRef, b: NodeRef) => number {
  return (a, b) => byteCompare(factOf(context, a).id, factOf(context, b).id);
}

/**
 * BFS ignoring edge direction. `reach()` in the atlas module is directed on
 * purpose — truth depends on the direction — but "structurally near" does not:
 * a file that imports the same module the subject imports is a neighbour in
 * every sense that matters to a player, and no directed query finds it.
 */
export function undirectedDistances(
  graph: Graph,
  start: NodeRef,
  maxHops: number,
): Map<NodeRef, number> {
  const seen = new Map<NodeRef, number>();
  let frontier: NodeRef[] = [start];
  for (let hop = 1; hop <= maxHops && frontier.length > 0; hop++) {
    const next: NodeRef[] = [];
    for (const ref of frontier) {
      for (const edge of graph.out[ref] ?? []) {
        if (edge.to !== start && !seen.has(edge.to)) {
          seen.set(edge.to, hop);
          next.push(edge.to);
        }
      }
      for (const edge of graph.in[ref] ?? []) {
        if (edge.from !== start && !seen.has(edge.from)) {
          seen.set(edge.from, hop);
          next.push(edge.from);
        }
      }
    }
    frontier = next;
  }
  return seen;
}

/**
 * Near in the graph, but the arrow does not reach the subject.
 *
 * Ordered in three tiers, best first:
 *   1. what the subject imports directly — the flagship (ADR-0008 §4);
 *   2. what it imports transitively, nearest first;
 *   3. anything else within `NEAR_HOPS` ignoring direction, which catches the
 *      "we import the same things" cousins that no directed query finds.
 *
 * The outward walk stops as soon as it has `limit` eligible nodes in hand. It
 * cannot skip a better one by doing so: the walk is breadth-first, and the tier
 * order *is* the walk order.
 */
const graphAdjacent: Strategy = (context, limit) => {
  const { graph, subject, pool } = context;
  const compare = byId(context);
  const ranked: NodeRef[] = [];
  const seen = new Set<NodeRef>([subject]);

  // Breadth-first order *is* the tier order — level 1 is what the subject
  // imports directly, level 2 what it imports through those, and so on — so the
  // only ordering decision left is inside a level.
  const level = (found: NodeRef[]): void => {
    found.sort(
      (a, b) => factOf(context, b).inDegree - factOf(context, a).inDegree || compare(a, b),
    );
    for (const ref of found) ranked.push(ref);
  };

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
    }
    level(eligible);
    frontier = next;
  }

  if (ranked.length < limit) {
    const cousins = new Map<number, NodeRef[]>();
    for (const [ref, hops] of undirectedDistances(graph, subject, NEAR_HOPS)) {
      if (!pool.has(ref) || seen.has(ref)) continue;
      seen.add(ref);
      const bucket = cousins.get(hops);
      if (bucket === undefined) cousins.set(hops, [ref]);
      else bucket.push(ref);
    }
    for (const hops of [...cousins.keys()].sort((a, b) => a - b)) {
      level(cousins.get(hops) ?? []);
    }
  }

  return ranked;
};

/** Same directory first, then outward through shared path prefix. */
const treeSibling: Strategy = (context, limit) => {
  const subjectFacts = factOf(context, context.subject);
  const compare = byId(context);
  const ranked: NodeRef[] = [];
  const seen = new Set<NodeRef>();

  for (let depth = subjectFacts.segments.length; depth >= 1 && ranked.length < limit; depth--) {
    const prefix = subjectFacts.segments.slice(0, depth).join('/');
    const level: NodeRef[] = [];
    for (const ref of context.corpus.byDirPrefix.get(prefix) ?? []) {
      if (ref === context.subject || seen.has(ref) || !context.pool.has(ref)) continue;
      seen.add(ref);
      level.push(ref);
    }
    // Deepest shared prefix wins; inside a level, the nearer directory does.
    level.sort(
      (a, b) =>
        sharedPrefix(subjectFacts.segments, factOf(context, b).segments) -
          sharedPrefix(subjectFacts.segments, factOf(context, a).segments) || compare(a, b),
    );
    for (const ref of level) ranked.push(ref);
  }

  // A file sharing no path segment at all is not a sibling in any useful sense;
  // `distant` picks it up if the choice set still needs filling.
  return ranked;
};

/** Confusable filenames — including the same basename in another directory. */
const nameSimilar: Strategy = (context, limit) => {
  const subjectFacts = factOf(context, context.subject);
  const compare = byId(context);
  const scored = new Map<NodeRef, number>();
  for (const token of new Set(subjectFacts.tokens)) {
    for (const ref of context.corpus.byToken.get(token) ?? []) {
      if (ref === context.subject || scored.has(ref) || !context.pool.has(ref)) continue;
      scored.set(ref, jaccard(subjectFacts.tokens, factOf(context, ref).tokens));
    }
  }
  return [...scored.keys()]
    .sort((a, b) => (scored.get(b) ?? 0) - (scored.get(a) ?? 0) || compare(a, b))
    .slice(0, limit);
};

/**
 * Historically coupled, structurally not.
 *
 * §8.3 calls these the best distractors and it is right: a file that has
 * changed with the subject fourteen times and does not import it is a fact
 * about the codebase the player should know, and being wrong about it is more
 * useful than being right about a file picked at random.
 */
const coChangeStrategy: Strategy = (context, limit) => {
  const compare = byId(context);
  const ranked: NodeRef[] = [];
  for (const [ref] of context.coChange) if (context.pool.has(ref)) ranked.push(ref);
  return ranked
    .sort((a, b) => (context.coChange.get(b) ?? 0) - (context.coChange.get(a) ?? 0) || compare(a, b))
    .slice(0, limit);
};

const STRATEGIES: Readonly<Record<Exclude<StrategyId, 'distant'>, Strategy>> = {
  graphAdjacent,
  treeSibling,
  nameSimilar,
  coChange: coChangeStrategy,
};

// ---------------------------------------------------------------------------
// allocation
// ---------------------------------------------------------------------------

/**
 * Split `count` across the strategies by `TARGET_MIX`, giving the remainder to
 * whichever strategies were rounded down hardest. Ties go to §8.3's declared
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
 * Three passes. The first honours the target mix. The second hands unspent
 * quota back in §8.3's order of value, so a repo with no git history spends its
 * co-change budget on graph-adjacency rather than losing it. The third is
 * `distant`: whatever is left, nearest first — padding, labelled as padding.
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
    const hops = undirectedDistances(context.graph, context.subject, Number.POSITIVE_INFINITY);
    const compare = byId(context);
    const rest: NodeRef[] = [];
    for (const ref of context.pool) if (!taken.has(ref)) rest.push(ref);
    rest.sort(
      (a, b) =>
        (hops.get(a) ?? Number.POSITIVE_INFINITY) - (hops.get(b) ?? Number.POSITIVE_INFINITY) ||
        factOf(context, b).inDegree - factOf(context, a).inDegree ||
        compare(a, b),
    );
    for (const ref of rest) {
      if (chosen.length >= count) break;
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
