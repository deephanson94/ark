/**
 * Throwaway probe: interleaved index timing, two trees, one repo.
 *
 * ADR-0038 closed django's index budget at **4.44 ms/file against a 5.00 hard
 * ceiling** and recorded the method that makes that number real: *interleaved*
 * rounds, because this container's ±25% spread reads as a result otherwise and
 * an un-interleaved run produced 23.1 s and 26.5 s outliers. A single run of
 * each tree is not a comparison.
 *
 * So: alternate A, B, A, B, … and take the median of each. Both trees index the
 * same repo with the same Node.
 *
 * NOT part of the suite.
 * `npx tsx scripts/probe-interleave.ts <treeA> <treeB> <repo> [rounds]`
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

const run = promisify(execFile);

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

const [treeA, treeB, repo, roundsArg] = process.argv.slice(2);
if (treeA === undefined || treeB === undefined || repo === undefined) {
  console.error('usage: probe-interleave <treeA> <treeB> <repo> [rounds]');
  process.exit(1);
}
const rounds = Number.parseInt(roundsArg ?? '3', 10);

const out = await mkdtemp(join(tmpdir(), 'ark-interleave-'));
const timings: Record<string, number[]> = { A: [], B: [] };
try {
  for (let round = 0; round < rounds; round++) {
    for (const [name, tree] of [['A', treeA], ['B', treeB]] as const) {
      const started = process.hrtime.bigint();
      await run(
        process.execPath,
        ['--import', 'tsx', join(tree, 'src/indexer/cli.ts'), repo, '--out', join(out, 'a.json'), '--quiet'],
        { cwd: tree, maxBuffer: 256 * 1024 * 1024 },
      );
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      timings[name]?.push(ms);
      console.log(`round ${round + 1} ${name} ${tree.split('/').pop()}: ${ms.toFixed(0)} ms`);
    }
  }
} finally {
  await rm(out, { recursive: true, force: true });
}

const a = median(timings['A'] ?? []);
const b = median(timings['B'] ?? []);
console.log(`\nmedian A (${treeA}): ${a.toFixed(0)} ms`);
console.log(`median B (${treeB}): ${b.toFixed(0)} ms`);
console.log(`difference: ${(b - a).toFixed(0)} ms (${(((b - a) / a) * 100).toFixed(1)}%)`);
console.log(`spread A ${Math.min(...(timings['A'] ?? [])).toFixed(0)}–${Math.max(...(timings['A'] ?? [])).toFixed(0)} ms, ` +
  `B ${Math.min(...(timings['B'] ?? [])).toFixed(0)}–${Math.max(...(timings['B'] ?? [])).toFixed(0)} ms`);
