/**
 * Region detection — the derived clusters the map is coloured by.
 *
 * Regions come from the import graph, not the directory tree (pillar 4: a node
 * is never placed for aesthetic or filing reasons). Clustering is **`louvain.ts`
 * at γ = 1**, made deterministic by construction rather than by seeding.
 *
 * **It was label propagation until ADR-0041**, with a high-degree connector
 * hold-out bolted on to stop one barrel swallowing the map, and a small-region
 * absorption pass bolted on to repair what the hold-out stranded. Two patches to
 * an algorithm with no objective function, exactly as `CLAUDE.md` predicted, and
 * the third one would have been the fragmentation fix — so it was replaced
 * instead. The measured failure was two-sided: hono got **57 regions for 425
 * nodes** while hugo put **78.9% of its linked nodes in one region** at a
 * modularity of 0.089. Louvain lands every measured repo at 9–22 regions and
 * raises modularity on all eight.
 *
 * Adopting it moved every node on every map, because regions reach
 * `computeLayout` through `groupByRef`. That is a **layout epoch**, which
 * NORTH-STAR §7 reserves to the owner; it was licensed on 2026-08-13 and no
 * session may take one on its own initiative.
 *
 * `absorbSmallRegions` **survived** the replacement and is not vestigial:
 * Louvain ships communities below `MIN_REGION` on hono (2), graphql-js (2) and
 * kysely (1), measured. Files with no import edges are the honest exception —
 * topology says nothing about a standalone markdown file, so those, and
 * components still below the floor, aggregate into coarse `terrain` regions,
 * one per top-level path segment (ADR-0010).
 */

import { byteCompare } from '../atlas/index.js';
import { louvain } from './louvain.js';

export interface RegionEdge {
  readonly from: number;
  readonly to: number;
}

export interface DetectedRegion {
  readonly id: string;
  readonly label: string;
  /**
   * `topology` — a cluster the import graph actually produced.
   * `terrain`  — a bag of files the graph has nothing to say about.
   *
   * The distinction is the honest one and pillar 4 requires it: a derived
   * cluster is a claim about structure, and a pile of edgeless files is not.
   * Conflating them is how 1,142 unconnected files came to found 500 regions
   * on vite and turned the legend into a wall (ADR-0010).
   */
  readonly kind: 'topology' | 'terrain';
  /** Node indices, ascending. */
  readonly members: readonly number[];
}

/** Regions smaller than this are folded into their strongest neighbour. */
const MIN_REGION = 3;

export function detectRegions(
  paths: readonly string[],
  edges: readonly RegionEdge[],
): readonly DetectedRegion[] {
  const count = paths.length;
  if (count === 0) return [];

  const neighbours: number[][] = paths.map(() => []);
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    neighbours[edge.from]?.push(edge.to);
    neighbours[edge.to]?.push(edge.from);
  }
  for (const list of neighbours) list.sort((a, b) => a - b);

  const degrees = neighbours.map((list) => list.length);

  // ---- clustering (ADR-0041) --------------------------------------------
  // Louvain runs over the **linked subgraph only**. An edgeless node is terrain
  // by ADR-0010 and would otherwise found a singleton community, which is the
  // failure that rule exists to prevent.
  const labels = new Int32Array(count);
  for (let i = 0; i < count; i++) labels[i] = i;

  const slotOf = new Int32Array(count).fill(-1);
  const nodeOf: number[] = [];
  for (let i = 0; i < count; i++) {
    if ((neighbours[i] ?? []).length === 0) continue;
    slotOf[i] = nodeOf.length;
    nodeOf.push(i);
  }
  const louvainEdges: { from: number; to: number }[] = [];
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    const a = slotOf[edge.from] ?? -1;
    const b = slotOf[edge.to] ?? -1;
    if (a < 0 || b < 0 || a === b) continue;
    louvainEdges.push({ from: a, to: b });
  }
  const communities = louvain(nodeOf.length, louvainEdges, {
    resolution: 1,
    maxSweeps: 32,
    maxLevels: 16,
  }).labels;
  // Three kinds of label share this array and **must not collide**: a node's
  // own index (what an edgeless node still carries at this point), a community,
  // and a terrain lump. Communities are offset past the node indices; terrain
  // ids are then handed out from `terrainBase`.
  //
  // This is the bug that shipped in the first wiring of this change and was
  // *not* caught by `test:determinism` — a wrong partition is a deterministic
  // one. Terrain used to start at `count`, which is exactly where communities
  // start, so a community and a terrain lump merged silently: ark came out with
  // **one** topology region and prometheus with none.
  //
  // `terrainBase` is therefore derived from the largest label actually present
  // rather than from arithmetic about how communities happen to be numbered.
  // `count + nodeOf.length` would be correct today and would quietly stop being
  // correct the moment `louvain` returned anything but a dense `0..k-1`.
  for (let slot = 0; slot < nodeOf.length; slot++) {
    labels[nodeOf[slot] ?? 0] = count + (communities[slot] ?? 0);
  }
  let highest = count - 1;
  for (let i = 0; i < count; i++) highest = Math.max(highest, labels[i] ?? 0);
  const terrainBase = highest + 1;

  absorbSmallRegions(labels, neighbours, count);

  // ---- terrain ----------------------------------------------------------
  //
  // Files the graph has nothing to say about, plus components too small to be
  // worth a region, aggregate by **top-level path segment**.
  //
  // The old rule grouped edgeless files by their exact directory, which is a
  // finer claim than the data supports and which manufactured ~500 regions on
  // vite's playground alone. The granularity here is pinned by the curriculum,
  // not by taste: this fallback exists to serve tier 1, and the tier-1 question
  // is literally "what are the top-level regions?" (ADR-0010 decision 1.)
  const terrainLabels = new Map<string, number>();
  /** Label id → the top-level segment it stands for. Names them directly. */
  const terrainName = new Map<number, string>();
  const terrain = new Set<number>();
  let nextSynthetic = terrainBase;
  const terrainLabelFor = (path: string): number => {
    const slash = path.indexOf('/');
    const top = slash === -1 ? '' : path.slice(0, slash);
    let label = terrainLabels.get(top);
    if (label === undefined) {
      label = nextSynthetic++;
      terrainLabels.set(top, label);
      // Named here rather than by `nameFor`, whose "directory of the busiest
      // file" fallback is meaningless when every member has degree zero — it
      // labelled vite's 841-file `playground` terrain
      // `playground/dynamic-import-inline/src/foo`, which is a true path and a
      // false claim about what the region is.
      terrainName.set(label, top === '' ? 'root' : top);
      terrain.add(label);
    }
    return label;
  };

  for (let i = 0; i < count; i++) {
    if ((neighbours[i] ?? []).length > 0) continue;
    labels[i] = terrainLabelFor(paths[i] ?? '');
  }

  // Islands below the floor fold into terrain too. Their internal edges still
  // draw, so "these two talk only to each other" stays visible on the map —
  // they just stop costing a legend entry and a palette slot.
  const connectedSizes = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    if ((neighbours[i] ?? []).length === 0) continue;
    const label = labels[i] ?? i;
    connectedSizes.set(label, (connectedSizes.get(label) ?? 0) + 1);
  }
  for (let i = 0; i < count; i++) {
    if ((neighbours[i] ?? []).length === 0) continue;
    const label = labels[i] ?? i;
    if ((connectedSizes.get(label) ?? 0) >= MIN_REGION) continue;
    labels[i] = terrainLabelFor(paths[i] ?? '');
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < count; i++) {
    const label = labels[i] ?? i;
    const bucket = groups.get(label);
    if (bucket === undefined) groups.set(label, [i]);
    else bucket.push(i);
  }

  const orderedEntries = [...groups.entries()].sort(([, a], [, b]) =>
    byteCompare(paths[a[0] ?? 0] ?? '', paths[b[0] ?? 0] ?? ''),
  );
  const ordered = orderedEntries.map(([, members]) => members);
  const labelOf = orderedEntries.map(([label]) => label);

  // Name in two passes. A directory name is the most useful label available,
  // but four distinct communities inside `src/indexer` all called "src/indexer"
  // tell you nothing — so any name claimed by more than one region is refined
  // with that region's busiest file. "src/indexer/scan" says where you are.
  const preliminary = ordered.map((members, index) => {
    const own = labelOf[index] ?? -1;
    return terrainName.get(own) ?? nameFor(members, paths, degrees);
  });
  const taken = new Map<string, number>();
  for (const name of preliminary) taken.set(name, (taken.get(name) ?? 0) + 1);

  const used = new Set<string>();
  const usedLabels = new Set<string>();
  const regions: DetectedRegion[] = [];
  for (const [index, members] of ordered.entries()) {
    const preferred = preliminary[index] ?? 'root';
    const isTerrain = terrain.has(labelOf[index] ?? -1);
    // Terrain never refines. Refinement names a region after its busiest file,
    // which is meaningless when every member has degree zero — and when a
    // terrain lump and a real cluster both wanted `packages`, refining *both*
    // gave the terrain one a 364-file region called
    // `packages/vite/src/node/ssr/runtime/__tests__/fixtures/cyclic/entry-cyclic`.
    // The terrain keeps the plain top-level name; the cluster refines around it.
    let label =
      !isTerrain && (taken.get(preferred) ?? 0) > 1
        ? `${preferred}/${hubSuffix(paths[hubOf(members, paths, degrees)] ?? '', preferred)}`
        : preferred;
    // The legend prints labels, not ids, so two regions sharing a label makes
    // the legend say two different colours are the same place — a false claim
    // about the map, which pillar 4 does not allow it to make for tidiness or
    // any other reason. Refinement already disambiguates by hub file; this is
    // the backstop for when even that collides.
    if (usedLabels.has(label)) {
      const base = label;
      for (let suffix = 2; usedLabels.has(label); suffix++) label = `${base} (${suffix})`;
    }
    usedLabels.add(label);
    const base = slugify(label);
    let id = base;
    for (let suffix = 2; used.has(id); suffix++) id = `${base}-${suffix}`;
    used.add(id);
    regions.push({ id, label, kind: isTerrain ? 'terrain' : 'topology', members });
  }
  regions.sort((a, b) => byteCompare(a.id, b.id));
  return regions;
}

/** The busiest file in a region — most edges, ties broken by path. */
function hubOf(
  members: readonly number[],
  paths: readonly string[],
  degrees: readonly number[],
): number {
  let hub = members[0] ?? 0;
  for (const member of members) {
    const better =
      (degrees[member] ?? 0) > (degrees[hub] ?? 0) ||
      ((degrees[member] ?? 0) === (degrees[hub] ?? 0) &&
        byteCompare(paths[member] ?? '', paths[hub] ?? '') < 0);
    if (better) hub = member;
  }
  return hub;
}

/**
 * How to say which community inside `preferred` this is, given its busiest
 * file. The hub's path *below* the shared name, not just its stem — two regions
 * under `src/verbs` whose hubs are both called `index.ts` would otherwise both
 * refine to `src/verbs/index`, which is how a legend ends up naming two
 * different colours the same thing.
 */
function hubSuffix(hubPath: string, preferred: string): string {
  const prefix = `${preferred}/`;
  const relative = hubPath.startsWith(prefix) ? hubPath.slice(prefix.length) : hubPath;
  const slash = relative.lastIndexOf('/');
  const directory = slash === -1 ? '' : `${relative.slice(0, slash)}/`;
  return `${directory}${stemOf(relative)}`;
}

/** `src/indexer/scan.ts` → `scan`. */
function stemOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.indexOf('.');
  return dot <= 0 ? name : name.slice(0, dot);
}

/**
 * Fold undersized regions into their strongest neighbour.
 *
 * **This was written for a defect that no longer exists and is kept because it
 * still fires.** Under label propagation, holding connectors out of the vote
 * left a file whose only links ran through a barrel with nobody to vote for, so
 * it kept its initial label and became a region of one — 7 regions became 22 on
 * this repo, seven of them called `src/indexer`. ADR-0041 removed that
 * mechanism, which makes "do we still need this?" a question needing a count
 * rather than an assumption. Counted: Louvain ships communities below the floor
 * on **hono (2), graphql-js (2) and kysely (1)**, and on none of ark, django,
 * flask, hugo or prometheus. It is live machinery.
 *
 * Modularity has no floor on community size, so the reason to have one is the
 * map rather than the maths: a two-file region costs a legend row and a palette
 * slot to say less than the edge between them already says.
 *
 * Any region below the floor is merged into whichever region it shares the most
 * edges with. Smallest first, so the merges cascade rather than fight, and ties
 * broken by lowest label to stay deterministic.
 *
 * Regions of unlinked files are untouched: they have no edges to be absorbed
 * by, and "these files are connected to nothing" is a true thing to show.
 */
function absorbSmallRegions(
  labels: Int32Array,
  neighbours: readonly (readonly number[])[],
  count: number,
): void {
  // Regions with no outward edges cannot be merged; remember them so the loop
  // does not keep reconsidering the same island forever.
  const stranded = new Set<number>();

  for (let guard = 0; guard < count; guard++) {
    const sizes = new Map<number, number>();
    for (let i = 0; i < count; i++) {
      if ((neighbours[i] ?? []).length === 0) continue;
      const label = labels[i] ?? i;
      sizes.set(label, (sizes.get(label) ?? 0) + 1);
    }

    let smallest: number | null = null;
    for (const label of [...sizes.keys()].sort((a, b) => a - b)) {
      if (stranded.has(label)) continue;
      const size = sizes.get(label) ?? 0;
      if (size >= MIN_REGION) continue;
      if (smallest === null || size < (sizes.get(smallest) ?? 0)) smallest = label;
    }
    if (smallest === null) return;

    const outward = new Map<number, number>();
    for (let i = 0; i < count; i++) {
      if ((labels[i] ?? i) !== smallest) continue;
      for (const neighbour of neighbours[i] ?? []) {
        const label = labels[neighbour] ?? neighbour;
        if (label === smallest) continue;
        outward.set(label, (outward.get(label) ?? 0) + 1);
      }
    }

    let target: number | null = null;
    let best = 0;
    for (const label of [...outward.keys()].sort((a, b) => a - b)) {
      const weight = outward.get(label) ?? 0;
      if (weight > best) {
        target = label;
        best = weight;
      }
    }

    if (target === null) {
      // An island. "These files talk only to each other" is a true thing to
      // show, so leave it alone rather than inventing a home for it.
      stranded.add(smallest);
      continue;
    }

    for (let i = 0; i < count; i++) {
      if ((labels[i] ?? i) === smallest) labels[i] = target;
    }
  }
}

/**
 * What to call a region.
 *
 * The deepest directory every member shares, when there is one — that is the
 * most informative name available and it is free. When members span
 * directories the shared prefix collapses to the repo root, which named three
 * different regions "root" on this repo and told you nothing. In that case fall
 * back to the directory of the region's busiest file: a cluster is best
 * described by the thing at the middle of it.
 */
function nameFor(
  members: readonly number[],
  paths: readonly string[],
  degrees: readonly number[],
): string {
  const shared = commonDirectory(members.map((index) => paths[index] ?? ''));
  if (shared !== '') return shared;
  const directory = dirnameOf(paths[hubOf(members, paths, degrees)] ?? '');
  return directory === '' ? 'root' : directory;
}

function dirnameOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/** The deepest directory every member shares. `''` for the repo root. */
export function commonDirectory(paths: readonly string[]): string {
  const first = paths[0];
  if (first === undefined) return '';
  let prefix = dirnameOf(first).split('/').filter((part) => part.length > 0);
  for (const path of paths.slice(1)) {
    const parts = dirnameOf(path).split('/').filter((part) => part.length > 0);
    let shared = 0;
    while (shared < prefix.length && shared < parts.length && prefix[shared] === parts[shared]) {
      shared++;
    }
    prefix = prefix.slice(0, shared);
    if (prefix.length === 0) break;
  }
  return prefix.join('/');
}

function slugify(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length === 0 ? 'root' : slug;
}
