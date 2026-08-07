/**
 * `npm run budget` — measure the CLAUDE.md budgets and fail over a ceiling.
 *
 * Measured, never estimated. The point of this script is that "we're probably
 * fine" stops being an acceptable answer: every row below is a number this
 * process produced on this repo, printed next to the ceiling it has to stay
 * under.
 *
 * Two kinds of budget, treated differently on purpose:
 *
 *   hard      exceeded ⇒ exit 1.
 *   advisory  printed, never fatal. Timing on a shared CI runner is noisy, and
 *             a budget that fails at random teaches people to ignore budgets.
 *
 * The ceilings in CLAUDE.md are quoted at 2,000 files, and this repo has ~50.
 * Comparing a 28 KiB atlas against a 5 MB ceiling would pass forever and catch
 * nothing, so the size budget is also enforced *per file* — that one scales,
 * is fully deterministic, and would actually notice a regression today.
 */

import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { serializeAtlas } from '../src/atlas/index.js';
import { buildAtlas, indexOptions } from '../src/indexer/build.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The scale the CLAUDE.md ceilings are quoted at. */
const REFERENCE_FILES = 2000;
const MAX_ATLAS_BYTES = 5 * 1024 * 1024;
const MAX_INDEX_MS = 10_000;
const MAX_PLAYER_DEPS = 3;

type Status = 'ok' | 'over' | 'unmeasured';

interface Row {
  readonly budget: string;
  readonly measured: string;
  readonly ceiling: string;
  readonly hard: boolean;
  readonly status: Status;
}

function row(
  budget: string,
  measured: string,
  ceiling: string,
  hard: boolean,
  over: boolean,
): Row {
  return { budget, measured, ceiling, hard, status: over ? 'over' : 'ok' };
}

function unmeasured(budget: string, ceiling: string, why: string): Row {
  return { budget, measured: `— ${why}`, ceiling, hard: false, status: 'unmeasured' };
}

function kib(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

async function runtimeDependencyCount(): Promise<number> {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  return Object.keys(manifest.dependencies ?? {}).length;
}

async function main(): Promise<number> {
  const started = process.hrtime.bigint();
  const atlas = await buildAtlas(indexOptions(ROOT));
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  const bytes = Buffer.byteLength(serializeAtlas(atlas));
  const files = Math.max(1, atlas.nodes.length);
  const bytesPerFile = bytes / files;
  const msPerFile = elapsedMs / files;
  const projectedBytes = bytesPerFile * REFERENCE_FILES;
  const bytesPerFileCeiling = MAX_ATLAS_BYTES / REFERENCE_FILES;
  const deps = await runtimeDependencyCount();

  const rows: Row[] = [
    row('atlas size', kib(bytes), kib(MAX_ATLAS_BYTES), true, bytes > MAX_ATLAS_BYTES),
    row(
      'atlas bytes/file',
      `${bytesPerFile.toFixed(0)} B  (${files} files → ${kib(projectedBytes)} at ${REFERENCE_FILES})`,
      `${bytesPerFileCeiling.toFixed(0)} B`,
      true,
      bytesPerFile > bytesPerFileCeiling,
    ),
    row('index time', `${elapsedMs.toFixed(0)} ms`, `${MAX_INDEX_MS} ms`, true, elapsedMs > MAX_INDEX_MS),
    row(
      'index ms/file',
      `${msPerFile.toFixed(2)} ms`,
      `${(MAX_INDEX_MS / REFERENCE_FILES).toFixed(2)} ms`,
      false,
      msPerFile > MAX_INDEX_MS / REFERENCE_FILES,
    ),
    row('player runtime deps', String(deps), String(MAX_PLAYER_DEPS), true, deps > MAX_PLAYER_DEPS),
    unmeasured('player first paint', '1.5 s', 'needs a browser — measured by test:e2e'),
    unmeasured(
      'map interaction',
      '≥ 50 fps @ 2000 nodes',
      'raster cost UNMEASURED; culling only, <8 ms @ 2000 in tests/unit/scene.test.ts',
    ),
  ];

  const width = Math.max(...rows.map((entry) => entry.budget.length));
  const measuredWidth = Math.max(...rows.map((entry) => entry.measured.length));
  process.stdout.write(`budgets — measured on ${atlas.repo.name} @ ${atlas.repo.head?.slice(0, 12) ?? 'no commits'}\n\n`);
  for (const entry of rows) {
    const mark = entry.status === 'over' ? (entry.hard ? 'FAIL' : 'warn') : entry.status === 'unmeasured' ? '    ' : ' ok ';
    process.stdout.write(
      `  ${mark}  ${entry.budget.padEnd(width)}  ${entry.measured.padEnd(measuredWidth)}  ceiling ${entry.ceiling}\n`,
    );
  }

  for (const truncation of atlas.report.truncations) {
    process.stdout.write(
      `\n  note  the indexer dropped ${truncation.dropped} ${truncation.what} entries to stay in budget (kept ${truncation.kept})\n`,
    );
  }

  const breached = rows.filter((entry) => entry.hard && entry.status === 'over');
  if (breached.length > 0) {
    process.stderr.write(
      `\n${breached.length} budget(s) exceeded: ${breached.map((entry) => entry.budget).join(', ')}\n` +
        'Say so out loud in CHANGELOG.md — a silently blown budget reads as success.\n',
    );
    return 1;
  }
  process.stdout.write('\nall hard budgets within ceiling\n');
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
  });
