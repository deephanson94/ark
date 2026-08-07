/**
 * Region detection — the derived clusters the map is coloured by.
 *
 * Regions come from the import graph, not the directory tree (pillar 4: a node
 * is never placed for aesthetic or filing reasons). Label propagation is used
 * because it is linear, needs no parameter tuning, and — with a fixed visiting
 * order and ties broken by lowest label — is fully deterministic.
 *
 * Files with no import edges are the honest exception. Topology says nothing
 * about a standalone markdown file, so those fall back to grouping by
 * directory, and the region they land in is named after that directory.
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

  const labels = new Int32Array(count);
  for (let i = 0; i < count; i++) labels[i] = i;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false;
    for (let i = 0; i < count; i++) {
      const list = neighbours[i];
      if (list === undefined || list.length === 0) continue;
      const tally = new Map<number, number>();
      for (const neighbour of list) {
        const label = labels[neighbour] ?? neighbour;
        tally.set(label, (tally.get(label) ?? 0) + 1);
      }
      let best = labels[i] ?? i;
      let bestCount = tally.get(best) ?? 0;
      // Iterate the tally in ascending label order so ties resolve the same way
      // on every run, whatever order the map happened to be filled in.
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

  const used = new Set<string>();
  const regions: DetectedRegion[] = [];
  for (const members of ordered) {
    const directory = commonDirectory(members.map((index) => paths[index] ?? ''));
    const base = slugify(directory);
    let id = base;
    for (let suffix = 2; used.has(id); suffix++) id = `${base}-${suffix}`;
    used.add(id);
    // A region whose members share no directory is the repo root; say so rather
    // than hand the player an empty string.
    regions.push({ id, label: directory === '' ? base : directory, members });
  }
  regions.sort((a, b) => byteCompare(a.id, b.id));
  return regions;
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
