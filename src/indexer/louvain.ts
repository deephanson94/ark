/**
 * Deterministic Louvain, with Leiden's connectivity guarantee.
 *
 * This is how `regions.ts` clusters. It replaced label propagation, its
 * connector hold-out and its small-region side effects under the **layout epoch
 * the owner licensed on 2026-08-13** ([ADR-0041](../../docs/decisions/0041-the-legend-was-most-of-the-complaint-and-louvain-is-the-rest.md)).
 * Regions feed `computeLayout` through `groupByRef`, so adopting this moved
 * every node on every map — which NORTH-STAR §7 reserves to the owner, and
 * which no session may do on its own initiative.
 *
 * ## Determinism
 *
 * Same discipline as `src/indexer/layout.ts`, for the same reason — the
 * determinism test is this project's canary:
 *
 *  - **No `Math.random`.** Textbook Louvain and textbook Leiden both randomise
 *    the visit order (Leiden also samples its refinement); here the visit order
 *    is ascending node index at every level, and the refinement is greedy.
 *  - **Ties break to the lowest community id**, never to insertion order.
 *  - **Only `+ - * /`.** `Math.pow`/`exp`/`log` are implementation-defined to
 *    within an ulp, so a partition built on them can differ between engines.
 *  - **Every accumulation runs in index order**, so the floating-point sums are
 *    associativity-stable across runs. Maps are only ever read through a sorted
 *    key list.
 *
 * ## Leiden, and what is borrowed from it
 *
 * Louvain's known defect is that a community can come out internally
 * disconnected — the node that held it together gets moved away in a later
 * pass and nothing notices. Leiden fixes that with a refinement phase that is
 * randomised in its published form. `splitDisconnected` below gets the same
 * guarantee deterministically and in twenty lines: after the levels settle,
 * every community is checked for connectivity and a disconnected one is split
 * into its components. Measured on eight repos, this fires on 0 communities —
 * see the ADR; it is kept because *"a path that never executes is worse than no
 * path"* only applies to a path claiming a behaviour, and this one is the
 * cheapest possible proof of a property the alternative cannot state.
 */

export interface Edge {
  readonly from: number;
  readonly to: number;
}

export interface LouvainOptions {
  /**
   * Resolution γ. Higher splits more; lower merges more. 1.0 is the textbook
   * modularity this optimises, and is *not* assumed to be the right granularity
   * for a map — see the ADR's §4, where the same γ that is right for hono is
   * measured against hugo.
   */
  readonly resolution: number;
  /** Local-moving sweeps per level, before giving up on convergence. */
  readonly maxSweeps: number;
  /** Aggregation levels. Each one coarsens; stop when a level moves nothing. */
  readonly maxLevels: number;
}

export const DEFAULT_LOUVAIN: LouvainOptions = {
  resolution: 1,
  maxSweeps: 32,
  maxLevels: 16,
};

interface Weighted {
  /** `adjacency[i]` = ascending list of `[neighbour, weight]`. */
  readonly adjacency: readonly (readonly (readonly [number, number])[])[];
  /** Self-loop weight per node, from edges collapsed by aggregation. */
  readonly selfLoops: readonly number[];
  readonly degrees: readonly number[];
  /** Total edge weight, counting each undirected edge once. */
  readonly totalWeight: number;
}

/**
 * Largest value in a list, or `floor` if it is empty.
 *
 * **Not `Math.max(...list)`.** Spreading an array passes one *argument* per
 * element, and engines cap that at ~65k–125k — so the idiom throws
 * `RangeError: Maximum call stack size exceeded` on a repo big enough to need
 * it. NORTH-STAR risk #2 is explicitly about 10k-file monorepos, and every use
 * of this in Louvain is over one entry per node.
 */
function largest(list: readonly number[], floor: number): number {
  let best = floor;
  for (const value of list) if (value > best) best = value;
  return best;
}

/** Build the undirected weighted graph, parallel edges summed, self-loops dropped. */
function weightedFrom(count: number, edges: readonly Edge[]): Weighted {
  const buckets: Map<number, number>[] = Array.from({ length: count }, () => new Map());
  let totalWeight = 0;
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    if (edge.from < 0 || edge.from >= count || edge.to < 0 || edge.to >= count) continue;
    totalWeight += 1;
    const a = buckets[edge.from];
    const b = buckets[edge.to];
    if (a !== undefined) a.set(edge.to, (a.get(edge.to) ?? 0) + 1);
    if (b !== undefined) b.set(edge.from, (b.get(edge.from) ?? 0) + 1);
  }
  const adjacency = buckets.map((bucket) => {
    const list: [number, number][] = [];
    for (const key of [...bucket.keys()].sort((x, y) => x - y)) list.push([key, bucket.get(key) ?? 0]);
    return list;
  });
  const degrees = adjacency.map((list) => list.reduce((sum, [, weight]) => sum + weight, 0));
  return { adjacency, selfLoops: new Array<number>(count).fill(0), degrees, totalWeight };
}

/**
 * One level of local moving. Returns the community of each node, relabelled to
 * a dense ascending range so the next level's ids are stable.
 */
function localMoving(graph: Weighted, resolution: number, maxSweeps: number): number[] {
  const count = graph.adjacency.length;
  const community = Array.from({ length: count }, (_, i) => i);
  const total = graph.degrees.map((degree, i) => degree + 2 * (graph.selfLoops[i] ?? 0));
  const communityTotal = [...total];
  const m2 = 2 * graph.totalWeight;
  if (m2 === 0) return community.map(() => 0);

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let moved = false;
    // Ascending node index, every sweep, on every machine. This is the line
    // that textbook Louvain randomises.
    for (let node = 0; node < count; node++) {
      const own = community[node] ?? node;
      const selfTotal = total[node] ?? 0;

      const links = new Map<number, number>();
      for (const [neighbour, weight] of graph.adjacency[node] ?? []) {
        const target = community[neighbour] ?? neighbour;
        links.set(target, (links.get(target) ?? 0) + weight);
      }

      // Take the node out of its own community before scoring, so staying is
      // scored on the same footing as moving.
      communityTotal[own] = (communityTotal[own] ?? 0) - selfTotal;

      let best = own;
      let bestGain = (links.get(own) ?? 0) - (resolution * selfTotal * (communityTotal[own] ?? 0)) / m2;
      for (const candidate of [...links.keys()].sort((a, b) => a - b)) {
        if (candidate === own) continue;
        const gain =
          (links.get(candidate) ?? 0) -
          (resolution * selfTotal * (communityTotal[candidate] ?? 0)) / m2;
        // Strictly greater, so an equal-gain candidate never displaces one with
        // a lower id — the ascending sort above is what makes that a rule.
        if (gain > bestGain) {
          best = candidate;
          bestGain = gain;
        }
      }

      communityTotal[best] = (communityTotal[best] ?? 0) + selfTotal;
      if (best !== own) {
        community[node] = best;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return densify(community);
}

/** Relabel to `0..k-1` in ascending order of first appearance by node index. */
function densify(labels: readonly number[]): number[] {
  const dense = new Map<number, number>();
  const out: number[] = [];
  for (const label of labels) {
    let mapped = dense.get(label);
    if (mapped === undefined) {
      mapped = dense.size;
      dense.set(label, mapped);
    }
    out.push(mapped);
  }
  return out;
}

/** Collapse each community into one node. */
function aggregate(graph: Weighted, community: readonly number[]): Weighted {
  const count = largest(community, 0) + 1;
  const buckets: Map<number, number>[] = Array.from({ length: count }, () => new Map());
  const selfLoops = new Array<number>(count).fill(0);

  for (let node = 0; node < graph.adjacency.length; node++) {
    const from = community[node] ?? 0;
    selfLoops[from] = (selfLoops[from] ?? 0) + (graph.selfLoops[node] ?? 0);
    for (const [neighbour, weight] of graph.adjacency[node] ?? []) {
      const to = community[neighbour] ?? 0;
      if (from === to) {
        // Each internal edge is seen twice, once from each endpoint.
        selfLoops[from] = (selfLoops[from] ?? 0) + weight / 2;
        continue;
      }
      const bucket = buckets[from];
      if (bucket !== undefined) bucket.set(to, (bucket.get(to) ?? 0) + weight);
    }
  }

  const adjacency = buckets.map((bucket) => {
    const list: [number, number][] = [];
    for (const key of [...bucket.keys()].sort((a, b) => a - b)) list.push([key, bucket.get(key) ?? 0]);
    return list;
  });
  const degrees = adjacency.map((list) => list.reduce((sum, [, weight]) => sum + weight, 0));
  return { adjacency, selfLoops, degrees, totalWeight: graph.totalWeight };
}

/**
 * Leiden's guarantee, deterministically: no community is internally
 * disconnected. Components are discovered by ascending node index and BFS over
 * the ascending adjacency, so the split is reproducible.
 */
export function splitDisconnected(
  labels: readonly number[],
  adjacency: readonly (readonly (readonly [number, number])[])[],
): { labels: number[]; splits: number } {
  const out = [...labels];
  const seen = new Array<boolean>(labels.length).fill(false);
  let nextLabel = largest(labels, -1) + 1;
  /** Labels whose first component has already been walked. */
  const claimed = new Set<number>();
  let splits = 0;

  for (let start = 0; start < labels.length; start++) {
    if (seen[start] === true) continue;
    const own = labels[start] ?? 0;
    const component: number[] = [start];
    seen[start] = true;
    for (let head = 0; head < component.length; head++) {
      const node = component[head] ?? 0;
      for (const [neighbour] of adjacency[node] ?? []) {
        if (seen[neighbour] === true) continue;
        if ((labels[neighbour] ?? -1) !== own) continue;
        seen[neighbour] = true;
        component.push(neighbour);
      }
    }
    // Ascending `start` means the first component reached for a label is the
    // one holding its lowest node index, on every run. It keeps the label;
    // every later component of the same label is a split.
    if (claimed.has(own)) {
      const fresh = nextLabel++;
      for (const node of component) out[node] = fresh;
      splits++;
    } else {
      claimed.add(own);
    }
  }
  return { labels: densify(out), splits };
}

export interface LouvainResult {
  /**
   * The partition Louvain settles on — the **coarsest** level, which is the
   * standard output and the one maximising modularity at this γ. `levels[0]`
   * is the finest and is a different (finer) answer, not a worse one.
   */
  readonly labels: readonly number[];
  /** One entry per aggregation level, coarsest last. `levels[0]` is finest. */
  readonly levels: readonly (readonly number[])[];
  readonly splits: number;
}

/**
 * Deterministic Louvain. `levels[i]` is the partition after `i + 1` rounds of
 * aggregation, each coarser than the last — which is the property that makes
 * this interesting for semantic zoom, and which label propagation cannot offer
 * at all.
 */
export function louvain(
  count: number,
  edges: readonly Edge[],
  options: LouvainOptions = DEFAULT_LOUVAIN,
): LouvainResult {
  if (count === 0) return { labels: [], levels: [], splits: 0 };
  const base = weightedFrom(count, edges);
  if (base.totalWeight === 0) {
    return { labels: new Array<number>(count).fill(0), levels: [], splits: 0 };
  }

  let graph = base;
  let mapping = Array.from({ length: count }, (_, i) => i);
  const levels: number[][] = [];

  for (let level = 0; level < options.maxLevels; level++) {
    const community = localMoving(graph, options.resolution, options.maxSweeps);
    const distinct = largest(community, 0) + 1;
    if (distinct === graph.adjacency.length) break;
    mapping = mapping.map((label) => community[label] ?? 0);
    levels.push([...mapping]);
    graph = aggregate(graph, community);
    if (graph.adjacency.length <= 1) break;
  }

  const settled = levels[levels.length - 1] ?? Array.from({ length: count }, (_, i) => i);
  const repaired = splitDisconnected(settled, base.adjacency);
  return { labels: repaired.labels, levels, splits: repaired.splits };
}

/** Modularity of a partition at resolution γ, on the same undirected graph. */
export function modularityOf(
  labels: readonly number[],
  count: number,
  edges: readonly Edge[],
  resolution = 1,
): number {
  const graph = weightedFrom(count, edges);
  const m2 = 2 * graph.totalWeight;
  if (m2 === 0) return 0;
  const internal = new Map<number, number>();
  const total = new Map<number, number>();
  for (let node = 0; node < count; node++) {
    const own = labels[node] ?? 0;
    total.set(own, (total.get(own) ?? 0) + (graph.degrees[node] ?? 0));
    for (const [neighbour, weight] of graph.adjacency[node] ?? []) {
      if ((labels[neighbour] ?? -1) === own) internal.set(own, (internal.get(own) ?? 0) + weight);
    }
  }
  let q = 0;
  for (const key of [...total.keys()].sort((a, b) => a - b)) {
    q += (internal.get(key) ?? 0) / m2 - (resolution * ((total.get(key) ?? 0) / m2) * ((total.get(key) ?? 0) / m2));
  }
  return q;
}
