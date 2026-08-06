/**
 * `ark index <path>` — the indexer's command line.
 *
 * Everything it prints is a measurement, not an estimate: node and edge counts,
 * how many imports it could not resolve, what it truncated, how big the atlas
 * came out and how long it took. Those are the numbers the budgets in CLAUDE.md
 * are written against, and printing them is how a regression gets noticed.
 */

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { serializeAtlas } from '../atlas/index.js';
import type { Atlas } from '../atlas/index.js';
import { buildAtlas, indexOptions } from './build.js';

interface Args {
  readonly root: string;
  readonly out: string;
  readonly quiet: boolean;
}

const USAGE = `ark — map a repo into an atlas

usage:
  ark index <path> [--out <file>] [--quiet]

  <path>          repo to index (default: the current directory)
  --out, -o       where to write the atlas (default: <path>/atlas.json)
  --quiet, -q     print nothing but errors
`;

export function parseArgs(argv: readonly string[]): Args | null {
  const rest = argv[0] === 'index' ? argv.slice(1) : [...argv];
  let root: string | null = null;
  let out: string | null = null;
  let quiet = false;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] ?? '';
    if (arg === '--help' || arg === '-h') return null;
    if (arg === '--quiet' || arg === '-q') {
      quiet = true;
      continue;
    }
    if (arg === '--out' || arg === '-o') {
      out = rest[++i] ?? null;
      continue;
    }
    if (arg.startsWith('-')) return null;
    root ??= arg;
  }

  const rootPath = resolve(root ?? '.');
  return { root: rootPath, out: resolve(out ?? `${rootPath}/atlas.json`), quiet };
}

function summarise(atlas: Atlas, bytes: number, milliseconds: number): string {
  const unresolved = atlas.nodes.reduce((total, node) => total + node.unresolved.length, 0);
  const probable = atlas.edges.filter((edge) => edge.confidence !== 'certain').length;
  const lines = [
    `repo        ${atlas.repo.name} @ ${atlas.repo.head?.slice(0, 12) ?? 'no commits'}`,
    `nodes       ${atlas.nodes.length} files across ${atlas.regions.length} regions`,
    `edges       ${atlas.edges.length} imports (${probable} needed a guess)`,
    `unresolved  ${unresolved} import(s) we could not pin down`,
    `history     ${atlas.history.commitsRetained}/${atlas.history.commitsWalked} commits kept, ${atlas.history.coChange.length} co-change pairs`,
    `challenges  ${atlas.challenges.length}`,
    `atlas       ${(bytes / 1024).toFixed(1)} KiB in ${milliseconds} ms`,
  ];
  for (const truncation of atlas.report.truncations) {
    lines.push(`truncated   ${truncation.what}: kept ${truncation.kept}, dropped ${truncation.dropped}`);
  }
  for (const skip of atlas.report.skipped) {
    lines.push(`skipped     ${skip.count} ${skip.reason}`);
  }
  return lines.join('\n');
}

export async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args === null) {
    process.stdout.write(USAGE);
    return 0;
  }

  const started = Date.now();
  const atlas = await buildAtlas(indexOptions(args.root));
  const text = serializeAtlas(atlas);
  await writeFile(args.out, text, 'utf8');

  if (!args.quiet) {
    process.stdout.write(`${summarise(atlas, Buffer.byteLength(text), Date.now() - started)}\n`);
    process.stdout.write(`written     ${args.out}\n`);
  }
  return 0;
}

const entry = process.argv[1];
if (entry !== undefined && pathToFileURL(entry).href === import.meta.url) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
