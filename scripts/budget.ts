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

import { MAX_ATLAS_BYTES, REFERENCE_FILES } from '../src/atlas/budget.js';

/** Not shared: the CLI reports no time verdict, because it is not reproducible between runs. */
const MAX_INDEX_MS = 10_000;

import { serializeAtlas } from '../src/atlas/index.js';
import { buildAtlas, indexOptions } from '../src/indexer/build.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * The ceilings come from `src/atlas/budget.ts` rather than being restated here.
 *
 * They used to live only in this file, which `src/` cannot import — so the CLI printed the two
 * measurements they are about with no verdict attached, and a user indexing a large repo had a
 * figure and no way to read it. Defining them twice would put the fix and the check on separate
 * numbers, which is the one thing the working agreement's *never define the shape twice* is for.
 */
const MAX_PLAYER_DEPS = 3;
/**
 * A second repo to measure against, if the machine has one.
 *
 * `ARK_BUDGET_REPO=/path/to/a/big/repo npm run budget`. Everything else here
 * measures Ark — 80 files, 270 ms — which is 4% of the scale the ceilings are
 * quoted at, and that blind spot has now hidden two regressions: a 15 s
 * generation cost that scored 2.93 ms/file locally, and a 5 s manifest read
 * that only exists in a monorepo. Advisory rather than hard, because the repo
 * is not in the tree and CI will not have it.
 */
const SCALE_REPO = process.env['ARK_BUDGET_REPO'];

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

/**
 * Challenge generation at the scale the ceilings are quoted at.
 *
 * This one cannot be extrapolated from the real repo, and pretending otherwise
 * nearly shipped a ten-second regression: generation is superlinear in node
 * count — the dependent sweep is O(V·E), and the distractor strategies are asked
 * for a choice set once per subject — so `ms/file` measured on 80 files says
 * nothing about 2,000. The first version of the generator scored 2.93 ms/file
 * here, comfortably inside its per-file ceiling, and took **15.3 s** on the
 * fixture below.
 *
 * A layered graph: 2,000 files in 20 directories, each importing three files in
 * the layer beneath. Not any particular repo, but the right shape — deep cones,
 * wide fan-in, and a hub layer at the bottom.
 */
async function generationAtScale(): Promise<{ ms: number; challenges: number }> {
  const { atlasWith } = await import('../tests/fixtures/atlas.js');
  const { generateBlastRadius } = await import('../src/verbs/blastRadius/index.js');
  const layers = 20;
  const per = REFERENCE_FILES / layers;
  const name = (layer: number, index: number): string =>
    `src/l${String(layer).padStart(2, '0')}/f${String(index).padStart(3, '0')}.ts`;

  const paths: string[] = [];
  for (let layer = 0; layer < layers; layer++) {
    for (let i = 0; i < per; i++) paths.push(name(layer, i));
  }
  const links: (readonly [string, string])[] = [];
  for (let layer = 1; layer < layers; layer++) {
    for (let i = 0; i < per; i++) {
      for (let k = 0; k < 3; k++) links.push([name(layer, i), name(layer - 1, (i * 7 + k * 13) % per)]);
    }
  }

  const atlas = atlasWith(paths, links);
  const started = process.hrtime.bigint();
  const challenges = generateBlastRadius(atlas);
  return { ms: Number(process.hrtime.bigint() - started) / 1e6, challenges: challenges.length };
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
  const scale = await generationAtScale();

  let realRepo: { files: number; ms: number; name: string } | null = null;
  if (SCALE_REPO !== undefined && SCALE_REPO !== '') {
    const began = process.hrtime.bigint();
    const other = await buildAtlas(indexOptions(SCALE_REPO));
    realRepo = {
      files: other.nodes.length,
      ms: Number(process.hrtime.bigint() - began) / 1e6,
      name: other.repo.name,
    };
  }

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
    // Hard, and measured rather than projected: generation is the one indexer
    // stage whose cost does not scale linearly with file count.
    row(
      'generate @ 2000',
      `${scale.ms.toFixed(0)} ms  (${scale.challenges} challenges on a synthetic 20-layer graph)`,
      `${MAX_INDEX_MS} ms`,
      true,
      scale.ms > MAX_INDEX_MS,
    ),
    realRepo === null
      ? unmeasured(
          'index @ real repo',
          `${MAX_INDEX_MS} ms`,
          'set ARK_BUDGET_REPO to a large clone — this repo is 4% of the reference scale',
        )
      : {
          budget: 'index @ real repo',
          measured: `${realRepo.ms.toFixed(0)} ms  (${realRepo.name}, ${realRepo.files} files)`,
          ceiling: `${MAX_INDEX_MS} ms`,
          hard: false,
          status: realRepo.ms > MAX_INDEX_MS ? ('over' as const) : ('ok' as const),
        },
    row('player runtime deps', String(deps), String(MAX_PLAYER_DEPS), true, deps > MAX_PLAYER_DEPS),
    unmeasured('player first paint', '1.5 s', 'needs a browser — measured by test:e2e'),
    unmeasured(
      'map interaction',
      '≥ 50 fps @ 2000 nodes',
      'needs a browser — measured by `npm run raster` (45/33/43 fps at p95, headless software raster)',
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
