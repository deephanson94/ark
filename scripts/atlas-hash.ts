/**
 * `tsx scripts/atlas-hash.ts --out <file>` — index this repo and print a
 * fingerprint of the resulting atlas.
 *
 * This exists for one job that `test:determinism` structurally cannot do.
 * That script runs both passes on the same machine, so it proves the indexer
 * is deterministic *here*. It says nothing about whether two different
 * machines agree — and ADR-0006 makes exactly that claim, on the strength of
 * the layout using only IEEE-754-exact arithmetic.
 *
 * CI runs this on Linux, macOS and Windows and compares the fingerprints. That
 * turns the claim into a check.
 */

import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { serializeAtlas } from '../src/atlas/index.js';
import { buildAtlas, indexOptions } from '../src/indexer/build.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function flag(argv: readonly string[], ...names: readonly string[]): string | null {
  const index = argv.findIndex((arg) => names.includes(arg));
  return index === -1 ? null : (argv[index + 1] ?? null);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const out = flag(argv, '--out', '-o');
  const atlasOut = flag(argv, '--atlas');

  const atlas = await buildAtlas(indexOptions(ROOT));
  const text = serializeAtlas(atlas);
  const digest = createHash('sha256').update(text, 'utf8').digest('hex');

  // Counts travel with the hash so a mismatch narrows itself before anyone
  // opens a log: same nodes and edges but different bytes means the *graph*
  // agreed and something else did not.
  const line = [
    digest,
    Buffer.byteLength(text),
    atlas.nodes.length,
    atlas.edges.length,
    atlas.history.commitsRetained,
    atlas.repo.head?.slice(0, 12) ?? 'none',
  ].join(' ');

  process.stdout.write(`${line}\n`);
  if (out !== null) await writeFile(out, `${line}\n`, 'utf8');
  // The atlas itself, so a mismatch can be diffed rather than theorised about.
  if (atlasOut !== null) await writeFile(atlasOut, text, 'utf8');
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
