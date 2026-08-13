/**
 * Throwaway probe: are the regions **nameable**?
 *
 * "A region a human cannot name is not a region" is the claim; this is the
 * instrument. For each region, find the repository directory that best
 * describes it and score that description with F1 — the product's own set
 * metric (NORTH-STAR §8.2), so a name that covers the region but sweeps in
 * strangers is penalised exactly as a player's over-broad answer would be:
 *
 *   precision = |members under D| / |files under D|
 *   recall    = |members under D| / |members|
 *
 * A region scoring 1.000 *is* a directory. A region scoring 0.30 against its
 * own best directory cannot be named after one, and the legend row for it is
 * a label the map does not support.
 *
 * The bar is stated with its achievable range rather than chosen for
 * roundness: F1 here can reach 1.000 and its floor on a real repo is ~0.05, and
 * both the before and after distributions are printed so the bar can be moved
 * without re-running anything.
 *
 * NOT part of the suite. `npx tsx scripts/probe-nameable.ts <dumpdir> [gamma]`
 */

import process from 'node:process';

import { louvain } from '../src/indexer/louvain.js';
import type { Dump } from './probe-region-stats.js';
import { loadDumps } from './probe-region-stats.js';

/** Every directory prefix of a path, deepest last, plus the root. */
function prefixesOf(path: string): string[] {
  const parts = path.split('/');
  const out = [''];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'));
  return out;
}

export interface Named {
  readonly directory: string;
  readonly f1: number;
  readonly size: number;
}

/** The directory best describing a set of members, scored by F1. */
export function bestDirectory(
  members: readonly number[],
  paths: readonly string[],
  filesUnder: ReadonlyMap<string, number>,
): Named {
  const hits = new Map<string, number>();
  for (const member of members) {
    for (const prefix of prefixesOf(paths[member] ?? '')) {
      hits.set(prefix, (hits.get(prefix) ?? 0) + 1);
    }
  }
  let best: Named = { directory: '', f1: 0, size: members.length };
  // Ascending directory name, so an equal-F1 tie resolves the same way always.
  for (const directory of [...hits.keys()].sort()) {
    const overlap = hits.get(directory) ?? 0;
    const under = filesUnder.get(directory) ?? 0;
    if (under === 0) continue;
    const precision = overlap / under;
    const recall = overlap / Math.max(1, members.length);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    if (f1 > best.f1) best = { directory, f1, size: members.length };
  }
  return best;
}

function distribution(values: readonly number[]): string {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): string => (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0).toFixed(2);
  return `min ${at(0)}  p25 ${at(0.25)}  med ${at(0.5)}  p75 ${at(0.75)}  max ${(sorted[sorted.length - 1] ?? 0).toFixed(2)}`;
}

interface Row {
  readonly repo: string;
  readonly nowCount: number;
  readonly nowNameable: number;
  readonly nowMean: number;
  readonly louCount: number;
  readonly louNameable: number;
  readonly louMean: number;
  readonly nowValues: number[];
  readonly louValues: number[];
  readonly nowNodes: number;
  readonly louNodes: number;
}

/** A region is nameable when some directory describes it at F1 >= this. */
const NAMEABLE = 0.7;

async function main(): Promise<void> {
  const dir = process.argv[2];
  const gamma = Number.parseFloat(process.argv[3] ?? '1');
  if (dir === undefined) {
    console.error('usage: probe-nameable <dumpdir> [gamma]');
    process.exit(1);
  }
  const dumps: Dump[] = await loadDumps(dir);
  const rows: Row[] = [];

  for (const dump of dumps) {
    const paths = dump.nodeRegion.map(([path]) => path);
    // Files under each directory — the denominator of precision. Counted over
    // **mapped nodes**, not over the repo's files on disk: a name is a claim
    // about the map the player is looking at.
    const filesUnder = new Map<string, number>();
    for (const path of paths) {
      for (const prefix of prefixesOf(path)) filesUnder.set(prefix, (filesUnder.get(prefix) ?? 0) + 1);
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
    const linkedEdges: { from: number; to: number }[] = [];
    for (const [from, to] of dump.edgeList) {
      const a = linked[from];
      const b = linked[to];
      if (a === undefined || b === undefined || a < 0 || b < 0 || a === b) continue;
      linkedEdges.push({ from: a, to: b });
    }

    // Today's **topology** regions only. Terrain is not a topological claim, is
    // unchanged by any clustering decision, and would flatter both sides.
    const nowMembers = new Map<string, number[]>();
    const terrainIds = new Set(
      dump.regions.filter((region) => region.kind === 'terrain').map((region) => region.id),
    );
    for (let node = 0; node < dump.nodes; node++) {
      const region = dump.nodeRegion[node]?.[1] ?? '';
      if (terrainIds.has(region)) continue;
      const bucket = nowMembers.get(region);
      if (bucket === undefined) nowMembers.set(region, [node]);
      else bucket.push(node);
    }

    const result = louvain(backwards.length, linkedEdges, {
      resolution: gamma,
      maxSweeps: 32,
      maxLevels: 16,
    });
    const louMembers = new Map<number, number[]>();
    for (let slot = 0; slot < backwards.length; slot++) {
      const label = result.labels[slot] ?? 0;
      const node = backwards[slot] ?? 0;
      const bucket = louMembers.get(label);
      if (bucket === undefined) louMembers.set(label, [node]);
      else bucket.push(node);
    }

    const nowScored = [...nowMembers.values()].map((m) => ({
      size: m.length,
      f1: bestDirectory(m, paths, filesUnder).f1,
    }));
    const louScored = [...louMembers.values()].map((m) => ({
      size: m.length,
      f1: bestDirectory(m, paths, filesUnder).f1,
    }));
    const nowValues = nowScored.map((s) => s.f1);
    const louValues = louScored.map((s) => s.f1);
    // The reader-facing cell: how much of the *map* sits in a region a rule can
    // name. Counted over the same denominator on both sides — nodes in a
    // topology region — so terrain cannot flatter either.
    const nowTotal = nowScored.reduce((sum, s) => sum + s.size, 0);
    const louTotal = louScored.reduce((sum, s) => sum + s.size, 0);
    const nowNodes =
      nowScored.filter((s) => s.f1 >= NAMEABLE).reduce((sum, s) => sum + s.size, 0) /
      Math.max(1, nowTotal);
    const louNodes =
      louScored.filter((s) => s.f1 >= NAMEABLE).reduce((sum, s) => sum + s.size, 0) /
      Math.max(1, louTotal);

    rows.push({
      repo: dump.repo,
      nowCount: nowValues.length,
      nowNameable: nowValues.filter((v) => v >= NAMEABLE).length,
      nowMean: nowValues.reduce((s, v) => s + v, 0) / Math.max(1, nowValues.length),
      louCount: louValues.length,
      louNameable: louValues.filter((v) => v >= NAMEABLE).length,
      louMean: louValues.reduce((s, v) => s + v, 0) / Math.max(1, louValues.length),
      nowValues,
      louValues,
      nowNodes,
      louNodes,
    });
  }

  console.log(`## Are the regions nameable? (γ = ${gamma}, bar F1 >= ${NAMEABLE})\n`);
  console.log(
    'repo         │ now: regs  nameable   meanF1  nodes% │ louvain: regs  nameable   meanF1  nodes%',
  );
  for (const row of rows) {
    console.log(
      [
        row.repo.padEnd(11),
        '│',
        String(row.nowCount).padStart(9),
        `${row.nowNameable} (${((row.nowNameable / Math.max(1, row.nowCount)) * 100).toFixed(0)}%)`.padStart(10),
        row.nowMean.toFixed(3).padStart(8),
        `${(row.nowNodes * 100).toFixed(0)}%`.padStart(6),
        '│',
        String(row.louCount).padStart(12),
        `${row.louNameable} (${((row.louNameable / Math.max(1, row.louCount)) * 100).toFixed(0)}%)`.padStart(10),
        row.louMean.toFixed(3).padStart(8),
        `${(row.louNodes * 100).toFixed(0)}%`.padStart(6),
      ].join(' '),
    );
  }
  console.log('\nDistributions (topology regions only; terrain excluded from both sides):');
  for (const row of rows) {
    console.log(`  ${row.repo.padEnd(11)} now  ${distribution(row.nowValues)}`);
    console.log(`  ${''.padEnd(11)} lou  ${distribution(row.louValues)}`);
  }
}

// Guarded: `probe-sweep` imports `bestDirectory` from here, and an unguarded
// top-level call would run this whole report as a side effect of that import.
if (process.argv[1]?.includes('probe-nameable')) await main();
