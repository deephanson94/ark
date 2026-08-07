/**
 * Elevation — the third coordinate, derived from the graph.
 *
 * **Height is how many files transitively depend on this one**, quantised to
 * the bit length of that count: 0 dependents → 0, 1 → 1, 2–3 → 2, 4–7 → 3, and
 * so on. One layer up means "twice as load-bearing".
 *
 * ## Why this quantity
 *
 * NORTH-STAR §4 says a session should end with the player able to name *the
 * most-depended-upon module*, and the map cannot currently help with that at
 * all. Measured across four repos, among the nodes that actually have
 * dependents, transitive cone size correlates with what the map already draws
 * at **rho −0.19 to 0.56 against LOC** (the disc radius) and **−0.03 to 0.77
 * against direct in-degree** (the label priority). On this repo and on svelte
 * both are ≈ 0. So a file's importance is, today, invisible — and it is exactly
 * what Blast Radius grades on.
 *
 * A caution for whoever re-measures: over *all* nodes, cone-vs-in-degree looks
 * like rho 0.91–1.00 and elevation looks redundant. It is an artifact — 50–90%
 * of nodes have no dependents *and* no importers, and that one tie drives the
 * statistic. Restrict to nodes with a non-empty cone before believing it.
 *
 * ## Why quantised, and why by bit length
 *
 * `docs/prior-art.md`: Cockburn & McKenzie (CHI 2002, n=69) measured spatial
 * memory for item locations degrading **monotonically** as freedom to place
 * them in a third dimension grew — in physical environments as well as virtual
 * — and Patchworks' navigation gains came where placement was *constrained*.
 * Spatial memory is this product's core mechanic, so the third dimension gets
 * discrete layers rather than a continuous field.
 *
 * Bit length rather than a per-repo rank or percentile, for one reason that has
 * already bitten this session: **a rank is a function of every other node's
 * cone**, so adding a file anywhere can restack the whole landscape, and the
 * save is keyed to the repo rather than the commit (ADR-0011). Bit length is a
 * function of the node's own cone alone. It also means a layer number means the
 * same thing in every repo — layer 8 is 128–255 dependents, here and anywhere —
 * which a percentile can never do. No transcendentals either, so ADR-0006's
 * rule that layout uses none carries forward.
 *
 * The distribution is *lumpy* and that is the terrain, not a defect: 56% of
 * this repo, 74% of vite and 90% of svelte sit at layer 0 because nothing
 * imports them, and svelte's top layer holds 339 files that all reach ~3,000
 * others through one barrel. A plain with a plateau is what svelte is.
 */

import type { AtlasEdge } from '../atlas/index.js';

/**
 * `Math.clz32` gives this in one instruction and no transcendentals:
 * `32 - clz32(n)` is the number of significant bits. `clz32(0)` is 32, so zero
 * maps to zero without a branch.
 */
export function layerOf(dependentCount: number): number {
  return 32 - Math.clz32(Math.max(0, Math.floor(dependentCount)));
}

/**
 * How many nodes transitively depend on each node, and the layer that implies.
 *
 * One BFS per node over reversed edges. Every edge kind counts, including
 * `type` and `probable`: this is the *shape of the place*, not an answer key,
 * and a type-only import is still a real coupling a change can travel along.
 * Guardrail 4 governs what may be **asked**, not what may be **drawn** — and a
 * silhouette that omitted uncertain edges would misdraw the terrain in exactly
 * the districts the player most needs to distrust.
 */
export function computeElevations(
  nodeCount: number,
  edges: readonly AtlasEdge[],
): { readonly cones: readonly number[]; readonly layers: readonly number[] } {
  const importers: number[][] = Array.from({ length: nodeCount }, () => []);
  for (const edge of edges) importers[edge.to]?.push(edge.from);

  const cones = new Array<number>(nodeCount).fill(0);
  // One reusable stamp array instead of a Set per node: at 4,000 nodes the
  // allocation dominated, and this is called once per node.
  const seenAt = new Int32Array(nodeCount).fill(-1);
  const queue = new Int32Array(nodeCount);

  for (let start = 0; start < nodeCount; start++) {
    let head = 0;
    let tail = 0;
    let reached = 0;
    seenAt[start] = start;
    queue[tail++] = start;
    while (head < tail) {
      const node = queue[head++] ?? 0;
      for (const importer of importers[node] ?? []) {
        if (seenAt[importer] === start) continue;
        seenAt[importer] = start;
        queue[tail++] = importer;
        reached++;
      }
    }
    cones[start] = reached;
  }

  return { cones, layers: cones.map(layerOf) };
}
