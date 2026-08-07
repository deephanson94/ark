/**
 * Pure graph queries over an atlas. No I/O, no state — this is the layer the
 * verbs are built on and the reason the fast test suite is fast.
 *
 * The important function here is `isChallengeable`, which is guardrail 4
 * ("never generate a challenge whose ground truth is uncertain") expressed as
 * code rather than as a good intention.
 */

import type { Atlas, AtlasEdge, AtlasNode, NodeId, NodeRef } from './schema.js';

export type Direction = 'dependencies' | 'dependents';

export interface Graph {
  readonly atlas: Atlas;
  /** Edges leaving each node — what it imports. Indexed by `NodeRef`. */
  readonly out: readonly (readonly AtlasEdge[])[];
  /** Edges entering each node — what imports it. Indexed by `NodeRef`. */
  readonly in: readonly (readonly AtlasEdge[])[];
  readonly refById: ReadonlyMap<NodeId, NodeRef>;
  readonly refByPath: ReadonlyMap<string, NodeRef>;
}

export function buildGraph(atlas: Atlas): Graph {
  const out: AtlasEdge[][] = atlas.nodes.map(() => []);
  const inbound: AtlasEdge[][] = atlas.nodes.map(() => []);
  for (const edge of atlas.edges) {
    out[edge.from]?.push(edge);
    inbound[edge.to]?.push(edge);
  }
  const refById = new Map<NodeId, NodeRef>();
  const refByPath = new Map<string, NodeRef>();
  for (const [ref, node] of atlas.nodes.entries()) {
    refById.set(node.id, ref);
    refByPath.set(node.path, ref);
  }
  return { atlas, out, in: inbound, refById, refByPath };
}

export function nodeAt(graph: Graph, ref: NodeRef): AtlasNode {
  const node = graph.atlas.nodes[ref];
  if (node === undefined) throw new RangeError(`no node at index ${ref}`);
  return node;
}

export function refOf(graph: Graph, id: NodeId): NodeRef {
  const ref = graph.refById.get(id);
  if (ref === undefined) throw new RangeError(`no node with id ${id}`);
  return ref;
}

export function idOf(graph: Graph, ref: NodeRef): NodeId {
  return nodeAt(graph, ref).id;
}

/**
 * Breadth-first reachability from `start`, bounded by `maxDepth` hops.
 * Returns each reached node mapped to its distance. `start` is not included.
 *
 * Deterministic: `atlas.edges` is sorted, so the adjacency lists are too, so
 * the traversal order is fixed.
 */
export function reach(
  graph: Graph,
  start: NodeRef,
  direction: Direction,
  maxDepth: number,
): Map<NodeRef, number> {
  const adjacency = direction === 'dependents' ? graph.in : graph.out;
  const seen = new Map<NodeRef, number>();
  let frontier: NodeRef[] = [start];
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const next: NodeRef[] = [];
    for (const ref of frontier) {
      for (const edge of adjacency[ref] ?? []) {
        const neighbour = direction === 'dependents' ? edge.from : edge.to;
        if (neighbour === start || seen.has(neighbour)) continue;
        seen.set(neighbour, depth);
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return seen;
}

/**
 * Everything that transitively imports `subject` within `maxDepth` hops.
 *
 * Pass `Infinity` for the unbounded set, which is what the Blast Radius answer
 * key is (ADR-0008) — the traversal terminates when the frontier empties, and
 * `seen` makes cycles safe.
 */
export function dependents(graph: Graph, subject: NodeRef, maxDepth: number): Map<NodeRef, number> {
  return reach(graph, subject, 'dependents', maxDepth);
}

/** Everything `subject` transitively imports within `maxDepth` hops. */
export function dependencies(
  graph: Graph,
  subject: NodeRef,
  maxDepth: number,
): Map<NodeRef, number> {
  return reach(graph, subject, 'dependencies', maxDepth);
}

/**
 * For every transitive dependent of `subject`, the node it imports that sits
 * one hop closer — a shortest-path tree, pointing inward.
 *
 * This is what turns "you missed two" into "you missed the two that reach it
 * through `src/atlas/index.ts`". Appendix A: partial credit plus *derived*
 * evidence, never canned. Deterministic because `atlas.edges` is sorted, so
 * ties between equal-length routes always break the same way.
 */
export function dependentRoutes(graph: Graph, subject: NodeRef): Map<NodeRef, NodeRef> {
  const nextHop = new Map<NodeRef, NodeRef>();
  const seen = new Set<NodeRef>([subject]);
  let frontier: NodeRef[] = [subject];
  while (frontier.length > 0) {
    const next: NodeRef[] = [];
    for (const ref of frontier) {
      for (const edge of graph.in[ref] ?? []) {
        if (seen.has(edge.from)) continue;
        seen.add(edge.from);
        nextHop.set(edge.from, ref);
        next.push(edge.from);
      }
    }
    frontier = next;
  }
  return nextHop;
}

/**
 * The import chain from `from` down to the subject, both ends included.
 * Returns `[from]` alone when no route exists.
 */
export function routeTo(routes: ReadonlyMap<NodeRef, NodeRef>, from: NodeRef): NodeRef[] {
  const chain = [from];
  const guard = routes.size + 1;
  let at = from;
  for (let step = 0; step < guard; step++) {
    const next = routes.get(at);
    if (next === undefined) break;
    chain.push(next);
    at = next;
  }
  return chain;
}

export type Challengeability =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly blockers: readonly NodeRef[] };

/**
 * Guardrail 4, mechanised.
 *
 * A blast-radius answer key says "these candidates depend on the subject, the
 * rest do not". The first half is safe *over `certain` edges*: unknown imports
 * can only ever **add** reachability, so anything already traced really is a
 * dependent. The second half is the fragile one — a candidate we call a
 * distractor might actually reach the subject through an import we failed to
 * resolve.
 *
 * The `certain` qualifier is why the probable-edge scan below is not optional,
 * and why `truth ⊆ candidates` (enforced by the validator) is load-bearing
 * rather than tidy: because every truth member is also a candidate, scanning
 * the candidates covers the truth set too.
 *
 * A candidate's verdict is therefore only trustworthy if every node on its
 * outgoing side has fully resolved imports and is reached over `certain` edges.
 * Anything less and we skip the challenge; a missing challenge costs nothing, a
 * wrong answer key costs trust permanently.
 *
 * `maxDepth` exists so the caller states the reach it is claiming. Blast Radius
 * passes `Infinity`, because its truth set is unbounded (ADR-0008) — a bounded
 * check would certify a distractor that reaches the subject one hop past the
 * bound, which is exactly the wrong answer key this function exists to prevent.
 */
export function isChallengeable(
  graph: Graph,
  subject: NodeRef,
  candidates: readonly NodeRef[],
  maxDepth: number,
): Challengeability {
  const blockers: NodeRef[] = [];
  const checked = new Set<NodeRef>();

  const inspect = (ref: NodeRef): void => {
    if (checked.has(ref)) return;
    checked.add(ref);
    if (nodeAt(graph, ref).unresolved.length > 0) blockers.push(ref);
  };

  // The subject is inspected too. Its own unresolved imports cannot change who
  // depends on it, but they mean we do not fully understand the file we are
  // asking the player about — and a cycle back through one would be invisible.
  for (const candidate of [subject, ...candidates]) {
    inspect(candidate);
    for (const ref of reach(graph, candidate, 'dependencies', maxDepth).keys()) inspect(ref);
  }

  if (blockers.length > 0) {
    blockers.sort((a, b) => a - b);
    const names = blockers.slice(0, 3).map((ref) => nodeAt(graph, ref).path);
    return {
      ok: false,
      reason: `unresolved imports in ${blockers.length} reachable file(s): ${names.join(', ')}`,
      blockers,
    };
  }

  // A `probable` edge is one we had to guess between two viable targets. If the
  // guess is wrong the answer key is wrong, so it may not carry a challenge.
  const uncertainEdges: NodeRef[] = [];
  for (const ref of checked) {
    for (const edge of graph.out[ref] ?? []) {
      if (edge.confidence !== 'certain') uncertainEdges.push(edge.from);
    }
  }
  if (uncertainEdges.length > 0) {
    uncertainEdges.sort((a, b) => a - b);
    const unique = [...new Set(uncertainEdges)];
    return {
      ok: false,
      reason: `ambiguous import resolution in ${unique.length} reachable file(s)`,
      blockers: unique,
    };
  }

  return { ok: true };
}

/**
 * `isChallengeable`'s verdict for every node at once.
 *
 * A node is **tainted** when anything in its dependency closure — itself
 * included — has an unresolved import or a `probable` outgoing edge. That is
 * precisely the condition `isChallengeable` rejects on, so
 * `isChallengeable(graph, s, cs, Infinity).ok` holds exactly when none of
 * `{s, ...cs}` is tainted. `tests/unit/graph.test.ts` asserts that equivalence
 * rather than assuming it.
 *
 * Computed by one reverse breadth-first search from every unsound node: X's
 * dependency closure contains B if and only if X can reach B along import
 * edges, which is the same as B reaching X along them backwards. O(V + E) once,
 * instead of O(V · E) across a repo's worth of candidate sets.
 */
export function taintedRefs(graph: Graph): Set<NodeRef> {
  const tainted = new Set<NodeRef>();
  let frontier: NodeRef[] = [];
  for (const [ref, node] of graph.atlas.nodes.entries()) {
    const unsound =
      node.unresolved.length > 0 ||
      (graph.out[ref] ?? []).some((edge) => edge.confidence !== 'certain');
    if (unsound) {
      tainted.add(ref);
      frontier.push(ref);
    }
  }
  while (frontier.length > 0) {
    const next: NodeRef[] = [];
    for (const ref of frontier) {
      for (const edge of graph.in[ref] ?? []) {
        if (tainted.has(edge.from)) continue;
        tainted.add(edge.from);
        next.push(edge.from);
      }
    }
    frontier = next;
  }
  return tainted;
}
