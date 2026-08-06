/**
 * `npm run test:determinism` — index this repo twice, in two separate
 * processes, and require the two atlases to be byte-identical.
 *
 * This is the project's canary. It catches, in one assertion: a stray
 * `Date.now()` or `Math.random()`, an unsorted `Map`/`Set` serialisation, a
 * filesystem walk that depends on directory order, an unseeded force layout,
 * and locale-dependent git output. Every one of those breaks spatial memory of
 * a codebase across sessions, which is the mechanic the whole product rests on
 * — and every one of them is invisible in a single run.
 *
 * Two *processes*, not two calls: a module-level cache that happened to warm up
 * on the first pass would hide exactly the kind of order dependence this is
 * looking for.
 *
 * When it fails, fix the nondeterminism. Never fix it by loosening the test.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLI = join(ROOT, 'src/indexer/cli.ts');
const RUNS = 2;

async function indexTo(out: string): Promise<string> {
  await run(process.execPath, ['--import', 'tsx', CLI, ROOT, '--out', out, '--quiet'], {
    cwd: ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  return readFile(out, 'utf8');
}

/** Where the two outputs first disagree, with enough context to act on it. */
function describeDifference(first: string, second: string): string {
  const firstLines = first.split('\n');
  const secondLines = second.split('\n');
  const limit = Math.max(firstLines.length, secondLines.length);

  for (let i = 0; i < limit; i++) {
    const a = firstLines[i];
    const b = secondLines[i];
    if (a === b) continue;
    return [
      `first difference at line ${i + 1}:`,
      `  run 1: ${clip(a)}`,
      `  run 2: ${clip(b)}`,
    ].join('\n');
  }
  return `no line differs, but the byte lengths do (${first.length} vs ${second.length})`;
}

function clip(line: string | undefined): string {
  if (line === undefined) return '<missing>';
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}

async function main(): Promise<number> {
  const directory = await mkdtemp(join(tmpdir(), 'ark-determinism-'));
  try {
    const outputs: string[] = [];
    for (let run = 1; run <= RUNS; run++) {
      outputs.push(await indexTo(join(directory, `atlas-${run}.json`)));
    }

    const [first] = outputs;
    if (first === undefined) throw new Error('no atlas was produced');
    if (first.length === 0) throw new Error('the indexer produced an empty atlas');

    for (const [index, output] of outputs.entries()) {
      if (output === first) continue;
      process.stderr.write(
        [
          `determinism: run 1 and run ${index + 1} produced different atlases.`,
          describeDifference(first, output),
          '',
          'Something in the indexer depends on more than the repo contents.',
          'Usual suspects: a wall-clock timestamp, Math.random, an unsorted Map or',
          'Set, filesystem walk order, an unseeded layout, or git output that',
          'changes with locale or user config.',
          '',
        ].join('\n'),
      );
      return 1;
    }

    const bytes = Buffer.byteLength(first);
    process.stdout.write(
      `determinism: ${RUNS} independent runs produced byte-identical atlases (${(bytes / 1024).toFixed(1)} KiB)\n`,
    );
    return 0;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
  });
