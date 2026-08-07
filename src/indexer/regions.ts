/**
 * Region detection — the derived clusters the map is coloured by.
 *
 * Regions come from the import graph, not the directory tree (pillar 4: a node
 * is never placed for aesthetic or filing reasons). Label propagation is used
 * because it is linear, needs no parameter tuning, and — with a fixed visiting
 * order and ties broken by lowest label — is fully deterministic.
 *
 * The complication, learned by looking at the map: a codebase with a barrel
 * module has one node that everything imports, and plain label propagation
 * happily concludes that the whole repo is a single community. On this repo
 * that put 36 of 64 files in one region, which is technically a connected
 * component and useless as a map.
 *
 * So high-degree **connectors** are held out of the vote. A file that everything
 * imports tells you nothing about which neighbourhood anything is in — it is a
 * bridge, not a resident. Propagation runs over the rest, and the connectors are
 * then placed in whichever region most of their neighbours ended up in. This is
 * still purely topological; it just stops one hub from swallowing the map.
 *
 * Files with no import edges are the honest exception. Topology says nothing
 * about a standalone markdown file, so those — and components too small to be
 * worth a region — aggregate into coarse `terrain` regions, one per top-level
 * path segment. They stay on the map and out of the legend's way (ADR-0010).
 */

import { byteCompare } from '../atlas/index.js';

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

const MAX_PASSES = 20;
/** A node is a connector at this multiple of the median degree, or above. */
const CONNECTOR_MULTIPLE = 3;
const CONNECTOR_FLOOR = 5;
/** Regions smaller than this are folded into their strongest neighbour. */
const MIN_REGION = 3;

function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

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
  const linked = degrees.filter((degree) => degree > 0);
  const connectorCutoff = Math.max(CONNECTOR_FLOOR, medianOf(linked) * CONNECTOR_MULTIPLE);
  const isConnector = degrees.map((degree) => degree >= connectorCutoff);

  const labels = new Int32Array(count);
  for (let i = 0; i < count; i++) labels[i] = i;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false;
    for (let i = 0; i < count; i++) {
      if (isConnector[i] === true) continue;
      const list = neighbours[i];
      if (list === undefined || list.length === 0) continue;

      const tally = new Map<number, number>();
      for (const neighbour of list) {
        // Connectors do not get a vote: they are adjacent to everything, so
        // their label would win everywhere and mean nothing.
        if (isConnector[neighbour] === true) continue;
        const label = labels[neighbour] ?? neighbour;
        tally.set(label, (tally.get(label) ?? 0) + 1);
      }
      if (tally.size === 0) continue;

      let best = labels[i] ?? i;
      let bestCount = tally.get(best) ?? 0;
      // Iterate in ascending label order so ties resolve the same way on every
      // run, whatever order the map happened to be filled in.
      for (const label of [...tally.keys()].sort((a, b) => a - b)) {
        const votes = tally.get(label) ?? 0;
        if (votes > bestCount || (votes === bestCount && label < best)) {
          best = label;
          bestCount = votes;
        }
      }
      if (best !== labels[i]) {
        labels[i] = best;
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Connectors join whichever region most of their neighbours settled in.
  for (let i = 0; i < count; i++) {
    if (isConnector[i] !== true) continue;
    const tally = new Map<number, number>();
    for (const neighbour of neighbours[i] ?? []) {
      if (isConnector[neighbour] === true) continue;
      const label = labels[neighbour] ?? neighbour;
      tally.set(label, (tally.get(label) ?? 0) + 1);
    }
    let best = labels[i] ?? i;
    let bestCount = 0;
    for (const label of [...tally.keys()].sort((a, b) => a - b)) {
      const votes = tally.get(label) ?? 0;
      if (votes > bestCount) {
        best = label;
        bestCount = votes;
      }
    }
    labels[i] = best;
  }

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
  let nextSynthetic = count;
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
 * Holding connectors out of the vote fixes the one-giant-blob failure and
 * causes the opposite one: a file whose only links run through a barrel has no
 * one left to vote for, keeps its own initial label, and becomes a region of
 * one. On this repo that turned 7 regions into 22, seven of which were called
 * `src/indexer`.
 *
 * So any region below the floor is merged into whichever region it shares the
 * most edges with — connectors included, since here they are exactly the
 * evidence of where a stranded file belongs. Smallest first, so the merges
 * cascade rather than fight, and ties broken by lowest label to stay
 * deterministic.
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
