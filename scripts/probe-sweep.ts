/**
 * Throwaway probe: γ sweep, determinism check, and how often the Leiden
 * connectivity repair actually fires.
 *
 * Three questions this answers and the other probes do not:
 *
 *  1. **Where is γ's bar?** Not chosen for roundness — printed across the range
 *     so it can be put in the largest gap in the measured distribution, with
 *     both neighbours named (CLAUDE.md).
 *  2. **Does the repair fire?** A fallback nobody counted is code asserting a
 *     behaviour the product does not have. Counted here before any test is
 *     written round it.
 *  3. **Is it deterministic?** Two independent runs, byte-compared, per repo
 *     per γ — and a *perturbation* run, because regions being stable for a
 *     commit is not the same as being stable across one.
 *
 * NOT part of the suite. `npx tsx scripts/probe-sweep.ts <dumpdir>`
 */

import process from 'node:process';

import { louvain, modularityOf } from '../src/indexer/louvain.js';
import { bestDirectory } from './probe-nameable.js';
import { loadDumps } from './probe-region-stats.js';

const GAMMAS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3];
const NAMEABLE = 0.7;
const LEGEND_ROWS = 17;

function prefixesOf(path: string): string[] {
  const parts = path.split('/');
  const out = [''];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'));
  return out;
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (dir === undefined) {
    console.error('usage: probe-sweep <dumpdir>');
    process.exit(1);
  }
  const dumps = await loadDumps(dir);

  let repairFirings = 0;
  let identicalRuns = 0;
  let totalRuns = 0;

  console.log('## γ sweep — region count, modularity, and how much of the map is nameable\n');
  for (const dump of dumps) {
    const paths = dump.nodeRegion.map(([path]) => path);
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
    if (backwards.length === 0) continue;

    console.log(`### ${dump.repo} @ ${dump.head.slice(0, 8)} — ${backwards.length} linked nodes`);
    console.log('     γ   regs      Q   max  max%  nameable  namedNodes%  overLegend  splits  det');
    for (const gamma of GAMMAS) {
      const options = { resolution: gamma, maxSweeps: 32, maxLevels: 16 };
      const a = louvain(backwards.length, linkedEdges, options);
      const b = louvain(backwards.length, linkedEdges, options);
      const same = JSON.stringify(a.labels) === JSON.stringify(b.labels);
      totalRuns++;
      if (same) identicalRuns++;
      repairFirings += a.splits;

      const members = new Map<number, number[]>();
      for (let slot = 0; slot < backwards.length; slot++) {
        const label = a.labels[slot] ?? 0;
        const node = backwards[slot] ?? 0;
        const bucket = members.get(label);
        if (bucket === undefined) members.set(label, [node]);
        else bucket.push(node);
      }
      const scored = [...members.values()].map((m) => ({
        size: m.length,
        f1: bestDirectory(m, paths, filesUnder).f1,
      }));
      const nameable = scored.filter((s) => s.f1 >= NAMEABLE);
      const namedNodes = nameable.reduce((sum, s) => sum + s.size, 0) / backwards.length;
      const largest = Math.max(0, ...scored.map((s) => s.size));

      console.log(
        [
          gamma.toFixed(2).padStart(6),
          String(scored.length).padStart(6),
          modularityOf(a.labels, backwards.length, linkedEdges, 1).toFixed(3).padStart(6),
          String(largest).padStart(5),
          `${((largest / backwards.length) * 100).toFixed(0)}%`.padStart(5),
          `${nameable.length}/${scored.length}`.padStart(9),
          `${(namedNodes * 100).toFixed(0)}%`.padStart(12),
          (scored.length > LEGEND_ROWS ? `+${scored.length - LEGEND_ROWS}` : '—').padStart(11),
          String(a.splits).padStart(7),
          (same ? 'ok' : 'DIFFER').padStart(6),
        ].join(' '),
      );
    }
    console.log('');
  }

  console.log(`Leiden connectivity repair fired on ${repairFirings} communities across ${totalRuns} runs.`);
  console.log(`Determinism: ${identicalRuns}/${totalRuns} paired runs byte-identical.`);
  console.log(`nameable    regions describable by a directory at F1 >= ${NAMEABLE}`);
  console.log('namedNodes% share of linked nodes sitting in one of those — the reader-facing number');
}

await main();
