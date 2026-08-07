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
 * about a standalone markdown file, so those fall back to grouping by directory.
 */

import { byteCompare } from '../atlas/index.js';

export interface RegionEdge {
  readonly from: number;
  readonly to: number;
}

export interface DetectedRegion {
  readonly id: string;
  readonly label: string;
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

  // Unconnected files: group by directory rather than pretend the graph knows.
  const directoryLabels = new Map<string, number>();
  let nextSynthetic = count;
  for (let i = 0; i < count; i++) {
    if ((neighbours[i] ?? []).length > 0) continue;
    const directory = dirnameOf(paths[i] ?? '');
    let label = directoryLabels.get(directory);
    if (label === undefined) {
      label = nextSynthetic++;
      directoryLabels.set(directory, label);
    }
    labels[i] = label;
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < count; i++) {
    const label = labels[i] ?? i;
    const bucket = groups.get(label);
    if (bucket === undefined) groups.set(label, [i]);
    else bucket.push(i);
  }

  const ordered = [...groups.values()].sort((a, b) =>
    byteCompare(paths[a[0] ?? 0] ?? '', paths[b[0] ?? 0] ?? ''),
  );

  // Name in two passes. A directory name is the most useful label available,
  // but four distinct communities inside `src/indexer` all called "src/indexer"
  // tell you nothing — so any name claimed by more than one region is refined
  // with that region's busiest file. "src/indexer/scan" says where you are.
  const preliminary = ordered.map((members) => nameFor(members, paths, degrees));
  const taken = new Map<string, number>();
  for (const name of preliminary) taken.set(name, (taken.get(name) ?? 0) + 1);

  const used = new Set<string>();
  const regions: DetectedRegion[] = [];
  for (const [index, members] of ordered.entries()) {
    const preferred = preliminary[index] ?? 'root';
    const label =
      (taken.get(preferred) ?? 0) > 1
        ? `${preferred}/${stemOf(paths[hubOf(members, paths, degrees)] ?? '')}`
        : preferred;
    const base = slugify(label);
    let id = base;
    for (let suffix = 2; used.has(id); suffix++) id = `${base}-${suffix}`;
    used.add(id);
    regions.push({ id, label, members });
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
