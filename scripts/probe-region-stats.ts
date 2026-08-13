/**
 * Throwaway probe: read the `probe-regions` dumps and print the quality table.
 *
 * Every column is a property of the partition, never a rank — "top 2% by size"
 * fires on 2% of every repo ever indexed (CLAUDE.md), so nothing here is a
 * quantile of its own repo. Where a bar is applied it is stated with the
 * achievable range.
 *
 * NOT part of the suite. `npx tsx scripts/probe-region-stats.ts <dumpdir> [--detail]`
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

export interface Dump {
  readonly repo: string;
  readonly head: string;
  readonly nodes: number;
  readonly edges: number;
  readonly indexMs: number;
  readonly challenges: number;
  readonly regions: readonly {
    id: string;
    label: string;
    kind: 'topology' | 'terrain';
    nodeCount: number;
    index: number;
  }[];
  /** `[path, regionId]` per node, in atlas node order. */
  readonly nodeRegion: readonly (readonly [string, string])[];
  readonly nodeKind: readonly string[];
  readonly edgeList: readonly (readonly [number, number])[];
}

/**
 * Legend rows the panel can show before it clips.
 *
 * Measured, not guessed: `.legend` is `max-height: 42vh` over `.legend-item` at
 * `font-size: 12px; line-height: 1.7` (20.4 px a row) plus a 10 px pad and a
 * ~22 px title. At a 900 px viewport that is ⌊(378 − 42) / 20.4⌋ = 16, and the
 * partly-visible 17th is what a reader counts. `styles.css`.
 */
const LEGEND_ROWS = 17;
const GOLDEN_ANGLE = 137.508;

export function modularity(
  memberOf: readonly number[],
  edges: readonly (readonly [number, number])[],
): number {
  const degree = new Map<number, number>();
  const internal = new Map<number, number>();
  let m = 0;
  for (const [from, to] of edges) {
    if (from === to) continue;
    m++;
    const a = memberOf[from];
    const b = memberOf[to];
    if (a === undefined || b === undefined) continue;
    degree.set(a, (degree.get(a) ?? 0) + 1);
    degree.set(b, (degree.get(b) ?? 0) + 1);
    if (a === b) internal.set(a, (internal.get(a) ?? 0) + 1);
  }
  if (m === 0) return 0;
  let q = 0;
  for (const [community, d] of degree) {
    q += (internal.get(community) ?? 0) / m - (d / (2 * m)) ** 2;
  }
  return q;
}

/**
 * How much of a region lives under the directory its label names.
 *
 * A label is either a plain directory (`src/verbs`), a terrain top-level
 * segment (`docs`), or a *refined* one — `<directory>/<hub path below it>` —
 * which regions.ts produces when two communities both wanted the same
 * directory. In every case the directory being claimed is the deepest prefix of
 * the label that actually contains a member, so that is what the sentence on
 * the legend is asking the reader to believe.
 */
export function labelHonesty(label: string, paths: readonly string[]): number {
  if (paths.length === 0) return 1;
  if (label === 'root') {
    return paths.filter((path) => !path.includes('/')).length / paths.length;
  }
  const candidates = [label];
  for (let cut = label.lastIndexOf('/'); cut > 0; cut = label.lastIndexOf('/', cut - 1)) {
    candidates.push(label.slice(0, cut));
  }
  for (const candidate of candidates) {
    const under = paths.filter((path) => path.startsWith(`${candidate}/`)).length;
    if (under > 0) return under / paths.length;
  }
  return 0;
}

/** The directory a label claims — the deepest prefix that holds a member. */
export function claimedDirectory(label: string, paths: readonly string[]): string {
  if (label === 'root') return '';
  const candidates = [label];
  for (let cut = label.lastIndexOf('/'); cut > 0; cut = label.lastIndexOf('/', cut - 1)) {
    candidates.push(label.slice(0, cut));
  }
  for (const candidate of candidates) {
    if (paths.some((path) => path.startsWith(`${candidate}/`))) return candidate;
  }
  return label;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Smallest circular gap between the hues golden-angle spacing hands out. */
export function minHueGap(count: number): number {
  if (count < 2) return 360;
  const hues = Array.from({ length: count }, (_, i) => (i * GOLDEN_ANGLE) % 360).sort(
    (a, b) => a - b,
  );
  let smallest = 360 - ((hues[hues.length - 1] ?? 0) - (hues[0] ?? 0));
  for (let i = 1; i < hues.length; i++) smallest = Math.min(smallest, (hues[i] ?? 0) - (hues[i - 1] ?? 0));
  return smallest;
}

export interface RepoStats {
  readonly repo: string;
  readonly head: string;
  readonly nodes: number;
  readonly regions: number;
  readonly topology: number;
  readonly terrain: number;
  readonly singletons: number;
  readonly clipped: number;
  readonly clippedNodeShare: number;
  readonly medianTopology: number;
  readonly largest: number;
  readonly largestShare: number;
  readonly q: number;
  readonly top5Share: number;
  readonly misnamed: number;
  readonly refined: number;
  readonly fragmentedDirs: number;
  readonly minHueGap: number;
}

export function statsFor(dump: Dump): RepoStats {
  const pathsByRegion = new Map<string, string[]>();
  for (const [path, region] of dump.nodeRegion) {
    const bucket = pathsByRegion.get(region);
    if (bucket === undefined) pathsByRegion.set(region, [path]);
    else bucket.push(path);
  }
  const regionIndexById = new Map(dump.regions.map((region, i) => [region.id, i] as const));
  const memberOf = dump.nodeRegion.map(([, region]) => regionIndexById.get(region) ?? -1);

  const topology = dump.regions.filter((region) => region.kind === 'topology');
  const terrain = dump.regions.filter((region) => region.kind === 'terrain');
  const byIndex = [...dump.regions].sort((a, b) => a.index - b.index);
  const clippedRegions = byIndex.slice(LEGEND_ROWS);
  const clippedNodes = clippedRegions.reduce((sum, region) => sum + region.nodeCount, 0);
  const bySize = [...dump.regions].sort((a, b) => b.nodeCount - a.nodeCount);
  const top5 = bySize.slice(0, 5).reduce((sum, region) => sum + region.nodeCount, 0);

  const honesty = dump.regions.map((region) =>
    labelHonesty(region.label, pathsByRegion.get(region.id) ?? []),
  );
  // A directory is *fragmented* when the members of one source directory are
  // split across more than one region — the failure that has nothing to do with
  // a lying name: the label is honest and the region is a fragment.
  const regionsPerDirectory = new Map<string, Set<string>>();
  for (const region of dump.regions) {
    const claimed = claimedDirectory(region.label, pathsByRegion.get(region.id) ?? []);
    const bucket = regionsPerDirectory.get(claimed);
    if (bucket === undefined) regionsPerDirectory.set(claimed, new Set([region.id]));
    else bucket.add(region.id);
  }
  const fragmentedDirs = [...regionsPerDirectory.values()].filter((set) => set.size > 1).length;

  return {
    repo: dump.repo,
    head: dump.head,
    nodes: dump.nodes,
    regions: dump.regions.length,
    topology: topology.length,
    terrain: terrain.length,
    singletons: dump.regions.filter((region) => region.nodeCount === 1).length,
    clipped: clippedRegions.length,
    clippedNodeShare: clippedNodes / Math.max(1, dump.nodes),
    medianTopology: median(topology.map((region) => region.nodeCount)),
    largest: bySize[0]?.nodeCount ?? 0,
    largestShare: (bySize[0]?.nodeCount ?? 0) / Math.max(1, dump.nodes),
    q: modularity(memberOf, dump.edgeList),
    top5Share: top5 / Math.max(1, dump.nodes),
    misnamed: honesty.filter((value) => value < 0.5).length,
    refined: topology.filter((region) => {
      const paths = pathsByRegion.get(region.id) ?? [];
      return claimedDirectory(region.label, paths) !== region.label;
    }).length,
    fragmentedDirs,
    minHueGap: minHueGap(topology.length),
  };
}

export async function loadDumps(dir: string): Promise<Dump[]> {
  const order = ['ark', 'flask', 'hono', 'graphql-js', 'kysely', 'prometheus', 'hugo', 'django'];
  const files = (await readdir(dir)).filter((name) => name.endsWith('.json'));
  const dumps: Dump[] = [];
  for (const file of files) dumps.push(JSON.parse(await readFile(join(dir, file), 'utf8')) as Dump);
  dumps.sort((a, b) => order.indexOf(a.repo) - order.indexOf(b.repo));
  return dumps;
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (dir === undefined) {
    console.error('usage: probe-region-stats <dumpdir> [--detail]');
    process.exit(1);
  }
  const dumps = await loadDumps(dir);

  console.log('## Region quality, current label propagation\n');
  console.log(
    'repo         nodes  reg topo terr sngl  clip clip%  medTopo   max   max%  top5%      Q  misnm refnd fragD hueGap',
  );
  for (const dump of dumps) {
    const s = statsFor(dump);
    console.log(
      [
        s.repo.padEnd(11),
        String(s.nodes).padStart(5),
        String(s.regions).padStart(4),
        String(s.topology).padStart(4),
        String(s.terrain).padStart(4),
        String(s.singletons).padStart(4),
        String(s.clipped).padStart(5),
        `${(s.clippedNodeShare * 100).toFixed(0)}%`.padStart(5),
        String(s.medianTopology).padStart(8),
        String(s.largest).padStart(5),
        `${(s.largestShare * 100).toFixed(1)}%`.padStart(6),
        `${(s.top5Share * 100).toFixed(0)}%`.padStart(6),
        s.q.toFixed(3).padStart(6),
        String(s.misnamed).padStart(6),
        String(s.refined).padStart(5),
        String(s.fragmentedDirs).padStart(5),
        `${s.minHueGap.toFixed(1)}°`.padStart(6),
      ].join(' '),
    );
  }
  console.log(`
clip    legend rows past the ${LEGEND_ROWS} the panel can show; clip% = share of nodes in them
medTopo median size of a *topology* region (terrain excluded — it is not a claim)
top5%   share of nodes the five largest regions cover
misnm   regions whose label names a directory holding < half its members (instances)
refnd   topology regions whose label was refined past a real directory (instances)
fragD   directories split across more than one region (instances)
hueGap  smallest hue gap the golden-angle palette hands out at this topology count.
        Terrain is *not* in this figure: every terrain region shares one grey
        (scene.ts TERRAIN_INDEX = -1), so the terr column is a collision count.`);

  if (process.argv.includes('--detail')) {
    for (const dump of dumps) {
      const pathsByRegion = new Map<string, string[]>();
      for (const [path, region] of dump.nodeRegion) {
        const bucket = pathsByRegion.get(region);
        if (bucket === undefined) pathsByRegion.set(region, [path]);
        else bucket.push(path);
      }
      console.log(`\n### ${dump.repo} @ ${dump.head.slice(0, 8)} — ${dump.regions.length} regions`);
      for (const region of [...dump.regions].sort((a, b) => b.nodeCount - a.nodeCount).slice(0, 60)) {
        const paths = pathsByRegion.get(region.id) ?? [];
        console.log(
          `  ${String(region.nodeCount).padStart(4)}  ${region.kind === 'terrain' ? 'terr' : 'topo'}  ` +
            `hon=${labelHonesty(region.label, paths).toFixed(2)}  ${region.label}`,
        );
      }
    }
  }
}

if (process.argv[1]?.includes('probe-region-stats')) await main();
