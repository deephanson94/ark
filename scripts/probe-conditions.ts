/**
 * Does `exports` condition order matter, and which order lands on source?
 *
 * `config.ts` walks conditions in a **fixed** order (`import, module, default, require, node,
 * types`); Node walks the object's **insertion** order and takes the first active one. A review
 * flagged the divergence with a witness — 10 of vue-core's 22 manifests — and called it benign,
 * which is a claim nobody had measured.
 *
 * What matters for ark is not fidelity to Node. It is **which target lands on a file that is on the
 * map**, because arm 1 of the workspace block only returns a hit when it does, and otherwise falls
 * through to the source mirror. So this counts, per workspace package in the corpus:
 *
 *   agree          both orders name the same target
 *   differ         they do not, and then: which of them is indexed?
 *
 *   npx tsx scripts/probe-conditions.ts /tmp/ark-corpus <repo>...
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { buildIndex, indexOptions } from '../src/indexer/build.js';
import { normalizeJoin } from '../src/indexer/resolve.js';

const corpus = process.argv[2] ?? '/tmp/ark-corpus';
const repos = process.argv.slice(3);

const FIXED = ['import', 'module', 'default', 'require', 'node', 'types'];
/** Never a runtime target: a declaration file is not the module. Node never picks it either. */
const NOT_RUNTIME = new Set(['types']);

function pickFixed(value: unknown, depth = 0): string | null {
  if (depth > 4) return null;
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const key of FIXED) {
    if (!(key in record)) continue;
    const hit = pickFixed(record[key], depth + 1);
    if (hit !== null) return hit;
  }
  return null;
}

/** Node's rule: the object's own key order, first applicable wins, `types` never applicable. */
function pickInsertion(value: unknown, depth = 0): string | null {
  if (depth > 4) return null;
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const [key, raw] of Object.entries(record)) {
    if (NOT_RUNTIME.has(key)) continue;
    const hit = pickInsertion(raw, depth + 1);
    if (hit !== null) return hit;
  }
  // `types` only as a last resort, matching what `config.ts` already does.
  for (const [key, raw] of Object.entries(record)) {
    if (!NOT_RUNTIME.has(key)) continue;
    const hit = pickInsertion(raw, depth + 1);
    if (hit !== null) return hit;
  }
  return null;
}

const TRY = ['', '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'];

console.log('| repo | subpaths with conditions | agree | **differ** | fixed indexed | **insertion indexed** |');
console.log('|---|---|---|---|---|---|');

for (const repo of repos) {
  const root = join(corpus, repo);
  const { atlas } = await buildIndex(indexOptions(root));
  const indexed = new Set(atlas.nodes.map((node) => node.path));
  const lands = (dir: string, target: string | null): boolean => {
    if (target === null) return false;
    const base = normalizeJoin(dir, target);
    if (base === null) return false;
    return TRY.some((e) => indexed.has(base + e)) || TRY.some((e) => indexed.has(`${base}/index${e}`));
  };

  let withConditions = 0;
  let agree = 0;
  let differ = 0;
  let fixedIndexed = 0;
  let insertionIndexed = 0;
  const samples: string[] = [];

  let manifests: string[] = [];
  try {
    manifests = execFileSync('bash', ['-c',
      `cd ${JSON.stringify(root)} && git ls-files '*package.json' | grep -v node_modules`],
      { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  } catch { /* no manifests */ }

  for (const manifest of manifests) {
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(readFileSync(join(root, manifest), 'utf8')) as Record<string, unknown>; }
    catch { continue; }
    const dir = manifest.includes('/') ? manifest.slice(0, manifest.lastIndexOf('/')) : '';
    const exports = parsed['exports'];
    if (typeof exports !== 'object' || exports === null) continue;
    for (const [subpath, raw] of Object.entries(exports as Record<string, unknown>)) {
      if (typeof raw === 'string') continue; // no conditions to disagree about
      withConditions += 1;
      const a = pickFixed(raw);
      const b = pickInsertion(raw);
      if (a === b) { agree += 1; continue; }
      differ += 1;
      const ai = lands(dir, a);
      const bi = lands(dir, b);
      if (ai) fixedIndexed += 1;
      if (bi) insertionIndexed += 1;
      if (samples.length < 3) {
        samples.push(`${dir || '.'} ${subpath}: fixed=${a}${ai ? ' [indexed]' : ''} vs insertion=${b}${bi ? ' [indexed]' : ''}`);
      }
    }
  }

  console.log(
    `| ${repo} | ${withConditions} | ${agree} | **${differ}** | ${fixedIndexed} | **${insertionIndexed}** |`,
  );
  for (const sample of samples) console.log(`|   ↳ | \`${sample}\` | | | | |`);
}
