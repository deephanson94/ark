/**
 * PHASE 3 — candidate A: resolving workspace self-references, bounded before it is built.
 *
 * `resolve.ts` refuses a specifier naming a package the repo itself defines, and states a reason:
 * *"a package's entry point is its `exports` or `main`, and in a monorepo those name **built** output
 * that is gitignored and not on the map."*
 *
 * That reason is **repo-dependent**, which nothing had checked. apollo-client's root `exports` map is
 * `{".": "./src/core/index.ts"}` — source, on disk, build-free. rxjs's is `./dist/esm/index.js` and
 * vue-core's is `./dist/*.esm-bundler.js`, where the comment is exactly right.
 *
 * So this probe asks the question the marginal ceiling cannot: **of the workspace specifiers whose
 * resolution would free a subject, how many can be resolved to an on-disk source file at all?**
 *
 * The rule scored here, in priority order, per specifier `P/S` where `P` is a workspace package
 * whose manifest sits at directory `D`:
 *   1. the `exports` entry for `.` or `./S`, if it lands on an indexed file
 *   2. `D/S` through the normal candidate walk (index files, extension append)
 *   3. `D/src/S`
 * Anything else stays unresolved, exactly as today.
 *
 *   npx tsx scripts/probe-workspace.ts /tmp/ark-corpus <repo>...
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { buildIndex, indexOptions } from '../src/indexer/build.js';
import { buildGraph, nodeAt } from '../src/atlas/graph.js';
import type { NodeRef } from '../src/atlas/schema.js';
import { normalizeJoin } from '../src/indexer/resolve.js';

const corpus = process.argv[2] ?? '/tmp/ark-corpus';
const repos = process.argv.slice(3);
const out = '/tmp/ark-workspace';
mkdirSync(out, { recursive: true });

const TRY = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'];
const unwrap = (s: string): string => /^(?:require|import)\('(.*)'\)$/.exec(s)?.[1] ?? s;
const packageNameOf = (s: string): string =>
  s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : (s.split('/')[0] ?? s);

/** The `exports` field flattened to `subpath → target`, following condition objects. */
function exportsMap(value: unknown): Map<string, string> {
  const map = new Map<string, string>();
  const target = (x: unknown): string | null => {
    if (typeof x === 'string') return x;
    if (typeof x === 'object' && x !== null && !Array.isArray(x)) {
      const rec = x as Record<string, unknown>;
      for (const k of ['import', 'module', 'default', 'require', 'types', 'node']) {
        if (k in rec) { const t = target(rec[k]); if (t !== null) return t; }
      }
    }
    return null;
  };
  if (typeof value === 'string') { map.set('.', value); return map; }
  if (typeof value !== 'object' || value === null) return map;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!k.startsWith('.')) { const t = target(value); if (t !== null) map.set('.', t); break; }
    const t = target(v);
    if (t !== null) map.set(k, t);
  }
  return map;
}

for (const repo of repos) {
  const root = join(corpus, repo);
  const { atlas } = await buildIndex(indexOptions(root));
  const graph = buildGraph(atlas);

  const indexed = new Set(atlas.nodes.map((n) => n.path));

  // workspace package name → { dir, exports }
  const pkgs = new Map<string, { dir: string; exports: Map<string, string> }>();
  for (const m of execFileSync('bash', ['-c',
    `cd ${JSON.stringify(root)} && git ls-files '*package.json' | grep -v node_modules | head -400`],
    { encoding: 'utf8' }).trim().split('\n').filter(Boolean)) {
    try {
      const j = JSON.parse(readFileSync(join(root, m), 'utf8')) as Record<string, unknown>;
      const name = j['name'];
      if (typeof name !== 'string') continue;
      const dir = m.includes('/') ? m.slice(0, m.lastIndexOf('/')) : '';
      // First manifest wins on a duplicate name, in git's fixed order — deterministic.
      if (!pkgs.has(name)) pkgs.set(name, { dir, exports: exportsMap(j['exports']) });
    } catch { /* ignore */ }
  }

  /** `resolve.ts`'s `pick`, restricted to indexed files, so a hit is a real node. */
  function pick(base: string): string | null {
    if (indexed.has(base)) return base;
    for (const e of TRY) if (indexed.has(base + e)) return base + e;
    for (const e of TRY) if (indexed.has(`${base}/index${e}`)) return `${base}/index${e}`;
    return null;
  }

  let workspaceSpecifiers = 0;
  let resolvedByExports = 0;
  let resolvedByDir = 0;
  let resolvedBySrc = 0;
  let stillUnresolved = 0;
  const unresolvedSamples: string[] = [];
  const resolvedSamples: string[] = [];
  /** Nodes that would have every one of their workspace specifiers resolved. */
  const fullyFixed = new Set<NodeRef>();
  const partiallyFixed = new Set<NodeRef>();

  for (let ref = 0; ref < atlas.nodes.length; ref += 1) {
    const node = nodeAt(graph, ref);
    let mine = 0;
    let done = 0;
    for (const raw of node.unresolved) {
      if (raw.includes('<expression>')) continue;
      const spec = unwrap(raw);
      const pkg = packageNameOf(spec);
      const entry = pkgs.get(pkg);
      if (entry === undefined) continue;
      mine += 1;
      workspaceSpecifiers += 1;
      const sub = spec.length > pkg.length ? `.${spec.slice(pkg.length)}` : '.';

      const viaExports = entry.exports.get(sub);
      if (viaExports !== undefined) {
        const base = normalizeJoin(entry.dir, viaExports);
        const hit = base === null ? null : pick(base);
        if (hit !== null) {
          resolvedByExports += 1; done += 1;
          if (resolvedSamples.length < 3) resolvedSamples.push(`${spec} —exports→ ${hit}`);
          continue;
        }
      }
      const viaDir = pick(normalizeJoin(entry.dir, sub === '.' ? '' : sub.slice(2)) ?? '');
      if (viaDir !== null) {
        resolvedByDir += 1; done += 1;
        if (resolvedSamples.length < 3) resolvedSamples.push(`${spec} —dir→ ${viaDir}`);
        continue;
      }
      const viaSrc = pick(normalizeJoin(`${entry.dir}/src`, sub === '.' ? '' : sub.slice(2)) ?? '');
      if (viaSrc !== null) {
        resolvedBySrc += 1; done += 1;
        if (resolvedSamples.length < 3) resolvedSamples.push(`${spec} —src→ ${viaSrc}`);
        continue;
      }
      stillUnresolved += 1;
      if (unresolvedSamples.length < 4) unresolvedSamples.push(`${node.path} → ${spec}`);
    }
    if (mine > 0 && done === mine) fullyFixed.add(ref);
    else if (done > 0) partiallyFixed.add(ref);
  }

  const report = {
    repo, sha: atlas.repo.head, workspaceSpecifiers,
    resolvedByExports, resolvedByDir, resolvedBySrc, stillUnresolved,
    resolvedShare: workspaceSpecifiers === 0 ? 0 : (workspaceSpecifiers - stillUnresolved) / workspaceSpecifiers,
    nodesFullyFixed: fullyFixed.size, nodesPartiallyFixed: partiallyFixed.size,
    resolvedSamples, unresolvedSamples,
  };
  writeFileSync(join(out, `${repo}.json`), JSON.stringify(report, null, 2));

  console.log(`\n### ${repo} \`${(atlas.repo.head ?? '').slice(0, 8)}\``);
  console.log(`workspace specifiers: ${workspaceSpecifiers}`);
  console.log(`  via exports map : ${resolvedByExports}`);
  console.log(`  via package dir : ${resolvedByDir}`);
  console.log(`  via dir/src     : ${resolvedBySrc}`);
  console.log(`  STILL unresolved: ${stillUnresolved}   (${((1 - report.resolvedShare) * 100).toFixed(1)}%)`);
  console.log(`nodes whose workspace specifiers all resolve: ${fullyFixed.size}; partially: ${partiallyFixed.size}`);
  for (const s of resolvedSamples) console.log(`  ok   ${s}`);
  for (const s of unresolvedSamples) console.log(`  MISS ${s}`);
}
