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

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const outIndex = argv.findIndex((arg) => arg === '--out' || arg === '-o');
  const out = outIndex === -1 ? null : argv[outIndex + 1];

  const atlas = await buildAtlas(indexOptions(ROOT));
  const text = serializeAtlas(atlas);
  const digest = createHash('sha256').update(text, 'utf8').digest('hex');

  // Node and edge counts travel with the hash so that a mismatch says *what*
  // differs, not just that something did.
  const line = `${digest} ${Buffer.byteLength(text)} ${atlas.nodes.length} ${atlas.edges.length}`;
  process.stdout.write(`${line}\n`);
  if (out !== undefined && out !== null) await writeFile(out, `${line}\n`, 'utf8');
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
