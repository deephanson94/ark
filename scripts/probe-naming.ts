/**
 * Throwaway probe: is it the *region* that is unnameable, or the *rule*?
 *
 * The existing rule names a region after the deepest directory all its members
 * share, falling back to the directory of its busiest file. That rule can only
 * ever describe a region that is a subtree. Louvain's coarse regions frequently
 * are not — django's 170-node "forms" region is `tests/forms_tests/field_tests`
 * + `tests/forms_tests/widget_tests` + `django/forms`, which a human names in
 * one word and `commonDirectory` collapses to the repo root.
 *
 * So this scores two naming rules against the same regions, with the same
 * metric (F1 over the mapped node set, NORTH-STAR §8.2):
 *
 *   subtree  the best directory prefix — what the shipped rule can express
 *   segment  the best *path segment* at any depth — "forms", "migrations",
 *            "gis", "jsx". Still purely derived from paths; no authored content
 *            and nothing repo-specific, so pillar 2 is untouched.
 *
 * Reporting both is the point: if `segment` wins on the same partition, the
 * unnameability is a property of the naming rule and is separately fixable —
 * which is a materially cheaper decision than replacing the clustering.
 *
 * NOT part of the suite. `npx tsx scripts/probe-naming.ts <dumpdir> [gamma]`
 */

import process from 'node:process';

import { louvain } from '../src/indexer/louvain.js';
import { bestDirectory } from './probe-nameable.js';
import { loadDumps } from './probe-region-stats.js';

const NAMEABLE = 0.7;

function prefixesOf(path: string): string[] {
  const parts = path.split('/');
  const out = [''];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'));
  return out;
}

/** Path segments of a path, with file extensions and `_test`-style noise kept. */
function segmentsOf(path: string): string[] {
  const parts = path.split('/');
  const file = parts.pop() ?? '';
  const stem = file.includes('.') ? file.slice(0, file.indexOf('.')) : file;
  return [...parts, stem].filter((part) => part.length > 0);
}

export interface NameScore {
  readonly name: string;
  readonly f1: number;
}

/**
 * The best single path segment describing a region, scored by F1 against every
 * mapped node whose path contains that segment.
 */
export function bestSegment(
  members: readonly number[],
  segmentIndex: ReadonlyMap<string, number>,
  memberSegments: ReadonlyMap<string, number>,
): NameScore {
  let best: NameScore = { name: '', f1: 0 };
  // Ascending segment, so an equal-F1 tie resolves identically on every run.
  for (const segment of [...memberSegments.keys()].sort()) {
    const overlap = memberSegments.get(segment) ?? 0;
    const across = segmentIndex.get(segment) ?? 0;
    if (across === 0) continue;
    const precision = overlap / across;
    const recall = overlap / Math.max(1, members.length);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    if (f1 > best.f1) best = { name: segment, f1 };
  }
  return best;
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  const gamma = Number.parseFloat(process.argv[3] ?? '1');
  if (dir === undefined) {
    console.error('usage: probe-naming <dumpdir> [gamma]');
    process.exit(1);
  }
  const dumps = await loadDumps(dir);

  console.log(`## Is it the region or the rule? (Louvain γ = ${gamma}, bar F1 >= ${NAMEABLE})\n`);
  console.log(
    'repo         regs │ subtree: nameable  meanF1  nodes% │ segment: nameable  meanF1  nodes%',
  );
  const examples: string[] = [];
  for (const dump of dumps) {
    const paths = dump.nodeRegion.map(([path]) => path);
    const filesUnder = new Map<string, number>();
    for (const path of paths) {
      for (const prefix of prefixesOf(path)) filesUnder.set(prefix, (filesUnder.get(prefix) ?? 0) + 1);
    }
    // How many mapped nodes carry each segment anywhere in their path — the
    // denominator of precision, counted over the map rather than over disk.
    const segmentIndex = new Map<string, number>();
    for (const path of paths) {
      for (const segment of new Set(segmentsOf(path))) {
        segmentIndex.set(segment, (segmentIndex.get(segment) ?? 0) + 1);
      }
    }

    const degree = new Array<number>(dump.nodes).fill(0);
    for (const [from, to] of dump.edgeList) {
      if (from === to) continue;
      degree[from] = (degree[from] ?? 0) + 1;
      degree[to] = (degree[to] ?? 0) + 1;
    }
    const linked = new Array<number>(dump.nodes).fill(-1);
    const backwards: number[] = [];
    for (let i = 0; i < dump.nodes; i++) {
      if ((degree[i] ?? 0) > 0) {
        linked[i] = backwards.length;
        backwards.push(i);
      }
    }
    const edges: { from: number; to: number }[] = [];
    for (const [from, to] of dump.edgeList) {
      const a = linked[from] ?? -1;
      const b = linked[to] ?? -1;
      if (a < 0 || b < 0 || a === b) continue;
      edges.push({ from: a, to: b });
    }
    if (backwards.length === 0) continue;

    const result = louvain(backwards.length, edges, { resolution: gamma, maxSweeps: 32, maxLevels: 16 });
    const members = new Map<number, number[]>();
    for (let slot = 0; slot < backwards.length; slot++) {
      const label = result.labels[slot] ?? 0;
      const node = backwards[slot] ?? 0;
      const bucket = members.get(label);
      if (bucket === undefined) members.set(label, [node]);
      else bucket.push(node);
    }

    let subtreeNameable = 0;
    let segmentNameable = 0;
    let subtreeSum = 0;
    let segmentSum = 0;
    let subtreeNodes = 0;
    let segmentNodes = 0;
    const rows: { size: number; sub: string; subF1: number; seg: string; segF1: number }[] = [];
    for (const list of members.values()) {
      const memberSegments = new Map<string, number>();
      for (const node of list) {
        for (const segment of new Set(segmentsOf(paths[node] ?? ''))) {
          memberSegments.set(segment, (memberSegments.get(segment) ?? 0) + 1);
        }
      }
      const subtree = bestDirectory(list, paths, filesUnder);
      const segment = bestSegment(list, segmentIndex, memberSegments);
      subtreeSum += subtree.f1;
      segmentSum += segment.f1;
      if (subtree.f1 >= NAMEABLE) {
        subtreeNameable++;
        subtreeNodes += list.length;
      }
      if (segment.f1 >= NAMEABLE) {
        segmentNameable++;
        segmentNodes += list.length;
      }
      rows.push({
        size: list.length,
        sub: subtree.directory === '' ? '(root)' : subtree.directory,
        subF1: subtree.f1,
        seg: segment.name,
        segF1: segment.f1,
      });
    }

    const count = members.size;
    console.log(
      [
        dump.repo.padEnd(11),
        String(count).padStart(4),
        '│',
        `${subtreeNameable}/${count}`.padStart(17),
        (subtreeSum / count).toFixed(3).padStart(7),
        `${((subtreeNodes / backwards.length) * 100).toFixed(0)}%`.padStart(7),
        '│',
        `${segmentNameable}/${count}`.padStart(17),
        (segmentSum / count).toFixed(3).padStart(7),
        `${((segmentNodes / backwards.length) * 100).toFixed(0)}%`.padStart(7),
      ].join(' '),
    );

    if (dump.repo === 'ark' || dump.repo === 'django' || dump.repo === 'hono') {
      examples.push(`\n  ${dump.repo}:`);
      for (const row of rows.sort((a, b) => b.size - a.size).slice(0, 8)) {
        examples.push(
          `    ${String(row.size).padStart(4)}  subtree ${row.sub.padEnd(30)} ${row.subF1.toFixed(2)}` +
            `   segment ${row.seg.padEnd(18)} ${row.segF1.toFixed(2)}`,
        );
      }
    }
  }
  console.log(`\nnodes%  share of linked nodes in a region the rule can name at F1 >= ${NAMEABLE}`);
  console.log('\nThe same regions, named both ways:');
  console.log(examples.join('\n'));
}

await main();
