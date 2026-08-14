/**
 * PHASE 2 — classify every unresolved specifier by cause, weighted by blast subjects poisoned.
 *
 * The weighting is the whole point. Ranking causes by how many *specifiers* they carry answers a
 * different question from ranking them by how many *subjects* they cost, and only the second one
 * decides a deck — ADR-0028 §8.1's 7 sites of 12,000 tainting 83.7% of django.
 *
 *   npx tsx scripts/probe-causes.ts /tmp/ark-corpus <repo>...
 */
import { writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { buildIndex, indexOptions } from '../src/indexer/build.js';
import { buildGraph, reach, nodeAt } from '../src/atlas/graph.js';
import type { Graph } from '../src/atlas/graph.js';
import type { NodeRef } from '../src/atlas/schema.js';
import { normalizeJoin } from '../src/indexer/resolve.js';

const corpus = process.argv[2] ?? '/tmp/ark-corpus';
const repos = process.argv.slice(3);
const out = '/tmp/ark-causes';
mkdirSync(out, { recursive: true });

/** The module extensions `resolve.ts` knows how to try. Anything else is not an extension. */
const KNOWN = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json']);
const TRY = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

type Cause =
  | 'computed'
  | 'workspaceSelfReference'
  | 'dottedSegment'
  | 'siblingManifestDep'
  | 'missingFromTree'
  | 'undeclaredBare'
  | 'absolute'
  | 'other';

function dirnameOf(path: string): string {
  const s = path.lastIndexOf('/');
  return s === -1 ? '' : path.slice(0, s);
}
function extensionOf(path: string): string {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  return dot <= slash + 1 ? '' : path.slice(dot);
}
function packageNameOf(spec: string): string {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? spec);
}

for (const repo of repos) {
  const root = join(corpus, repo);
  const { atlas } = await buildIndex(indexOptions(root));
  const graph: Graph = buildGraph(atlas);

  const blastSubjects = new Set<NodeRef>();
  for (let ref = 0; ref < atlas.nodes.length; ref += 1) {
    if ((graph.in[ref] ?? []).length > 0) blastSubjects.add(ref);
  }

  // Every package name any package.json in the repo declares, and where. Read from disk rather
  // than from the atlas, because a manifest is not a node.
  const declaredAnywhere = new Set<string>();
  const workspaceNames = new Set<string>();
  const { execFileSync } = await import('node:child_process');
  const manifests = execFileSync(
    'bash',
    ['-c', `cd ${JSON.stringify(root)} && git ls-files '*package.json' | grep -v node_modules | head -400`],
    { encoding: 'utf8' },
  ).trim().split('\n').filter(Boolean);
  const { readFileSync } = await import('node:fs');
  for (const m of manifests) {
    try {
      const j = JSON.parse(readFileSync(join(root, m), 'utf8')) as Record<string, unknown>;
      if (typeof j['name'] === 'string') workspaceNames.add(j['name']);
      for (const f of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        const d = j[f];
        if (typeof d === 'object' && d !== null) for (const k of Object.keys(d)) declaredAnywhere.add(k);
      }
    } catch { /* a malformed manifest is not this probe's problem */ }
  }

  const onDisk = (p: string): boolean => {
    try { return existsSync(join(root, p)) && statSync(join(root, p)).isFile(); } catch { return false; }
  };

  /**
   * `node.unresolved` records a CJS/dynamic site as the **whole call expression** — `scan.ts`'s
   * `raw` is `require('./x')`, not `./x` — so a classifier that reads the field verbatim files
   * every one of them under "bare specifier declared nowhere". The first run of this probe did
   * exactly that and reported vue-core's starvation as `undeclaredBare` at 99.5% when it is
   * `require('./dist/shared.cjs.js')`, a relative path to a build artifact. Unwrap first.
   */
  function unwrap(spec: string): string {
    const m = /^(?:require|import)\('(.*)'\)$/.exec(spec);
    return m?.[1] ?? spec;
  }

  function classify(fromPath: string, raw: string): Cause {
    if (raw.includes('<expression>')) return 'computed';
    const spec = unwrap(raw);
    if (spec.startsWith('/')) return 'absolute';
    if (spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..') {
      const base = normalizeJoin(dirnameOf(fromPath), spec);
      if (base === null) return 'other';
      // Would appending a module extension have found it? That is the `.interface` defect:
      // `extensionOf` sees `.interface`, calls it an extension, and skips the append loop.
      const ext = extensionOf(base);
      if (ext !== '' && !KNOWN.has(ext)) {
        for (const e of TRY) if (onDisk(base + e)) return 'dottedSegment';
        for (const e of TRY) if (onDisk(`${base}/index${e}`)) return 'dottedSegment';
      }
      return 'missingFromTree';
    }
    const pkg = packageNameOf(spec);
    if (workspaceNames.has(pkg)) return 'workspaceSelfReference';
    if (declaredAnywhere.has(pkg)) return 'siblingManifestDep';
    return 'undeclaredBare';
  }

  // Blame each cause for the subjects its carrying files poison.
  const byCause = new Map<Cause, { specifiers: number; files: Set<string>; poisoned: Set<NodeRef>; specimens: string[] }>();
  const bump = (c: Cause, path: string, spec: string, poisoned: Set<NodeRef>): void => {
    let e = byCause.get(c);
    if (e === undefined) { e = { specifiers: 0, files: new Set(), poisoned: new Set(), specimens: [] }; byCause.set(c, e); }
    e.specifiers += 1;
    e.files.add(path);
    for (const r of poisoned) e.poisoned.add(r);
    if (e.specimens.length < 4) e.specimens.push(`${path} → ${spec}`);
  };

  const allTainted = new Set<NodeRef>();
  for (let ref = 0; ref < atlas.nodes.length; ref += 1) {
    const node = nodeAt(graph, ref);
    const probable = (graph.out[ref] ?? []).filter((e) => e.confidence !== 'certain').length;
    if (node.unresolved.length === 0 && probable === 0) continue;
    const poisoned = new Set<NodeRef>();
    if (blastSubjects.has(ref)) poisoned.add(ref);
    for (const r of reach(graph, ref, 'dependents', Infinity).keys()) if (blastSubjects.has(r)) poisoned.add(r);
    for (const r of poisoned) allTainted.add(r);
    for (const spec of node.unresolved) bump(classify(node.path, spec), node.path, spec, poisoned);
    if (probable > 0) bump('other', node.path, '<probable edge>', poisoned);
  }

  const rows = [...byCause.entries()]
    .map(([cause, e]) => ({
      cause,
      specifiers: e.specifiers,
      files: e.files.size,
      subjectsPoisoned: e.poisoned.size,
      shareOfTainted: allTainted.size === 0 ? 0 : e.poisoned.size / allTainted.size,
      specimens: e.specimens,
    }))
    .sort((a, b) => b.subjectsPoisoned - a.subjectsPoisoned);

  writeFileSync(join(out, `${repo}.json`), JSON.stringify({ repo, sha: atlas.repo.head, tainted: allTainted.size, blastSubjects: blastSubjects.size, rows }, null, 2));

  console.log(`\n### ${repo} \`${(atlas.repo.head ?? '').slice(0, 8)}\` — ${allTainted.size} of ${blastSubjects.size} subjects tainted`);
  console.log('\n| cause | specifiers | files | subjects poisoned | share of taint | specimen |');
  console.log('|---|---|---|---|---|---|');
  for (const r of rows) {
    console.log(`| \`${r.cause}\` | ${r.specifiers} | ${r.files} | **${r.subjectsPoisoned}** | ${(r.shareOfTainted * 100).toFixed(1)}% | \`${r.specimens[0] ?? '—'}\` |`);
  }
}
