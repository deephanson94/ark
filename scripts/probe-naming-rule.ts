/**
 * Throwaway probe: how badly do today's region labels claim directories their
 * members are not in, and what would a better rule give?
 *
 * ## The defect
 *
 * `nameFor` takes the deepest directory **every** member shares, and falls back
 * to *the busiest file's directory* when there is none. Under label propagation
 * regions were mostly subtrees, so the fallback rarely fired. Louvain's regions
 * cross directories by design, so it fires constantly — and it names a region
 * after a directory holding one member. On ark, a 40-file region whose members
 * are 23 `tests/unit` files is labelled `src/atlas/index`, and **1 of its 40
 * members is under `src/atlas/`**.
 *
 * ## What is measured
 *
 * For every topology region, the share of its members under the directory its
 * label claims. A label claiming a directory holding 3% of the region is false
 * in a way a player can check with one click, which is the standard the rest of
 * this product's sentences are held to.
 *
 * Two candidate rules are scored beside it:
 *
 *   bestF1    the directory maximising F1 against the region — the metric
 *             §8.2 already grades players with. **Within a fixed region this is
 *             the right instrument**; ADR-0041 §7's finding was that it cannot
 *             compare *clusterings*, because its optimum over partitions is the
 *             folder tree. Naming one region is a different question.
 *   plurality the directory holding the most members, deepest first.
 *
 * NOT part of the suite. `npx tsx scripts/probe-naming-rule.ts <dumpdir>`
 */

import process from 'node:process';

import { loadDumps } from './probe-region-stats.js';

function prefixesOf(path: string): string[] {
  const parts = path.split('/');
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'));
  return out;
}

/**
 * The directory a label claims, or `null` when it claims none.
 *
 * A label of the form `around <path>` is the fallback: it names the region's
 * hub rather than a directory, so scoring it as a directory claim reports 0%
 * and reads as a defect. The first version of this probe did exactly that and
 * showed 30 "false" labels that were the *fix* working.
 */
function claimedDirectory(label: string, paths: readonly string[]): string | null {
  if (label.startsWith('around ')) return null;
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

function shareUnder(directory: string, members: readonly string[]): number {
  if (directory === '') return 1;
  return members.filter((path) => path.startsWith(`${directory}/`)).length / members.length;
}

interface Pick {
  readonly directory: string;
  readonly f1: number;
  readonly share: number;
}

function bestByF1(members: readonly string[], filesUnder: ReadonlyMap<string, number>): Pick {
  const hits = new Map<string, number>();
  for (const member of members) {
    for (const prefix of prefixesOf(member)) hits.set(prefix, (hits.get(prefix) ?? 0) + 1);
  }
  let best: Pick = { directory: '', f1: 0, share: 1 };
  for (const directory of [...hits.keys()].sort()) {
    const overlap = hits.get(directory) ?? 0;
    const under = filesUnder.get(directory) ?? 0;
    if (under === 0) continue;
    const precision = overlap / under;
    const recall = overlap / members.length;
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    if (f1 > best.f1) best = { directory, f1, share: recall };
  }
  return best;
}

const dir = process.argv[2];
if (dir === undefined) {
  console.error('usage: probe-naming-rule <dumpdir>');
  process.exit(1);
}

const shippedShares: number[] = [];
const bestShares: number[] = [];
const bestF1s: number[] = [];
const worst: string[] = [];

console.log('## What share of a region lives under the directory its label claims\n');
console.log('repo         regions   shipped: min   mean  <0.5  hub |  bestF1: min   mean  <0.5');
for (const dump of await loadDumps(dir)) {
  const paths = dump.nodeRegion.map(([path]) => path);
  const filesUnder = new Map<string, number>();
  for (const path of paths) {
    for (const prefix of prefixesOf(path)) filesUnder.set(prefix, (filesUnder.get(prefix) ?? 0) + 1);
  }
  const membersOf = new Map<string, string[]>();
  for (const [path, region] of dump.nodeRegion) {
    const bucket = membersOf.get(region);
    if (bucket === undefined) membersOf.set(region, [path]);
    else bucket.push(path);
  }

  const rows = dump.regions
    .filter((region) => region.kind === 'topology')
    .map((region) => {
      const members = membersOf.get(region.id) ?? [];
      const claim = claimedDirectory(region.label, members);
      const shipped = claim === null ? null : shareUnder(claim, members);
      const best = bestByF1(members, filesUnder);
      return { region, members, shipped, best };
    });
  if (rows.length === 0) continue;

  for (const row of rows) {
    if (row.shipped !== null) shippedShares.push(row.shipped);
    bestShares.push(row.best.share);
    bestF1s.push(row.best.f1);
    if (row.shipped !== null && row.shipped < 0.5) {
      worst.push(
        `  ${dump.repo.padEnd(11)} ${String(row.members.length).padStart(4)} members  ` +
          `label "${row.region.label}" → ${(row.shipped * 100).toFixed(0)}% under it` +
          `   bestF1 would say "${row.best.directory}" → ${(row.best.share * 100).toFixed(0)}%`,
      );
    }
  }

  const mean = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
  const shipped = rows.map((r) => r.shipped).filter((x): x is number => x !== null);
  const hubNamed = rows.length - shipped.length;
  const best = rows.map((r) => r.best.share);
  console.log(
    [
      dump.repo.padEnd(11),
      String(rows.length).padStart(7),
      (shipped.length === 0 ? 1 : Math.min(...shipped)).toFixed(2).padStart(14),
      (shipped.length === 0 ? 1 : mean(shipped)).toFixed(2).padStart(6),
      String(shipped.filter((s) => s < 0.5).length).padStart(5),
      String(hubNamed).padStart(4),
      ' |',
      Math.min(...best).toFixed(2).padStart(11),
      mean(best).toFixed(2).padStart(6),
      String(best.filter((s) => s < 0.5).length).padStart(5),
    ].join(' '),
  );
}

console.log(`\nRegions whose shipped label claims a directory holding under half of them (${worst.length}):`);
console.log(worst.join('\n'));

// The bar goes in the largest gap in the measured distribution, with both
// neighbours named — never at a round number chosen for its English.
const sorted = [...bestF1s].sort((a, b) => a - b);
let gap = 0;
let at = 0;
for (let i = 1; i < sorted.length; i++) {
  const width = (sorted[i] ?? 0) - (sorted[i - 1] ?? 0);
  if (width > gap) {
    gap = width;
    at = i;
  }
}
console.log(`\nbestF1 across all ${sorted.length} topology regions, sorted:`);
console.log('  ' + sorted.map((f) => f.toFixed(2)).join(' '));
console.log(
  `\nlargest gap: ${(sorted[at - 1] ?? 0).toFixed(3)} → ${(sorted[at] ?? 0).toFixed(3)}` +
    `  (width ${gap.toFixed(3)})`,
);
