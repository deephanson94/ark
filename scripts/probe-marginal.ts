/**
 * PHASE 2/3/4 — the **marginal** ceiling of each candidate fix.
 *
 * §2 found the taint is not merely concentrated, it is **overdetermined**: on typeorm `computed`
 * poisons 99.6% of tainted subjects and `dottedSegment` poisons 99.4%, because both sit in the same
 * hub cluster. So "this cause poisons N subjects" is NOT a fix's ceiling — the fix's ceiling is how
 * many subjects it un-taints *given the other causes stay*, which is the subjects poisoned by it and
 * by nothing else.
 *
 * This re-runs `taintedRefs`'s reverse walk with one cause's sites deleted and counts the
 * difference. That is the counterfactual stated exactly: it holds every other cause, the graph, the
 * deck cap and the generator fixed, and moves one knob (CLAUDE.md — *say what your counterfactual
 * holds fixed, and check that it holds it*).
 *
 * It also reports the **union** ceiling: every candidate cause fixed at once, which is the most any
 * resolver work of any kind could possibly buy.
 *
 *   npx tsx scripts/probe-marginal.ts /tmp/ark-corpus <repo>...
 */
import { writeFileSync, mkdirSync, existsSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { buildIndex, indexOptions } from '../src/indexer/build.js';
import { buildGraph, nodeAt } from '../src/atlas/graph.js';
import type { Graph } from '../src/atlas/graph.js';
import type { NodeRef } from '../src/atlas/schema.js';
import { normalizeJoin } from '../src/indexer/resolve.js';

const corpus = process.argv[2] ?? '/tmp/ark-corpus';
const repos = process.argv.slice(3);
const out = '/tmp/ark-marginal';
mkdirSync(out, { recursive: true });

const KNOWN = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json']);
const TRY = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

type Cause =
  | 'computed' | 'workspaceSelfReference' | 'dottedSegment' | 'rootSelfPath'
  | 'siblingManifestDep' | 'missingFromTree' | 'undeclaredBare' | 'absolute' | 'other';

/** Causes a resolver change could plausibly address. `computed` and `missingFromTree` cannot be. */
const FIXABLE: readonly Cause[] = ['workspaceSelfReference', 'dottedSegment', 'rootSelfPath', 'siblingManifestDep'];

const dirnameOf = (p: string): string => (p.lastIndexOf('/') === -1 ? '' : p.slice(0, p.lastIndexOf('/')));
function extensionOf(path: string): string {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  return dot <= slash + 1 ? '' : path.slice(dot);
}
const packageNameOf = (s: string): string =>
  s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : (s.split('/')[0] ?? s);
const unwrap = (s: string): string => /^(?:require|import)\('(.*)'\)$/.exec(s)?.[1] ?? s;

/**
 * `taintedRefs`, but only from the given sources. Same reverse breadth-first search
 * `src/atlas/graph.ts` runs; reproduced here so a source can be withheld.
 */
function taintFrom(graph: Graph, sources: ReadonlySet<NodeRef>): Set<NodeRef> {
  const tainted = new Set<NodeRef>(sources);
  let frontier = [...sources];
  while (frontier.length > 0) {
    const next: NodeRef[] = [];
    for (const ref of frontier) {
      for (const edge of graph.in[ref] ?? []) {
        if (tainted.has(edge.from)) continue;
        tainted.add(edge.from);
        next.push(edge.from);
      }
    }
    frontier = next;
  }
  return tainted;
}

for (const repo of repos) {
  const root = join(corpus, repo);
  const { atlas } = await buildIndex(indexOptions(root));
  const graph = buildGraph(atlas);

  const blastSubjects = new Set<NodeRef>();
  for (let ref = 0; ref < atlas.nodes.length; ref += 1) {
    if ((graph.in[ref] ?? []).length > 0) blastSubjects.add(ref);
  }

  const declaredAnywhere = new Set<string>();
  const workspaceNames = new Set<string>();
  for (const m of execFileSync('bash', ['-c',
    `cd ${JSON.stringify(root)} && git ls-files '*package.json' | grep -v node_modules | head -400`],
    { encoding: 'utf8' }).trim().split('\n').filter(Boolean)) {
    try {
      const j = JSON.parse(readFileSync(join(root, m), 'utf8')) as Record<string, unknown>;
      if (typeof j['name'] === 'string') workspaceNames.add(j['name']);
      for (const f of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        const d = j[f];
        if (typeof d === 'object' && d !== null) for (const k of Object.keys(d)) declaredAnywhere.add(k);
      }
    } catch { /* ignore */ }
  }
  const onDisk = (p: string): boolean => {
    try { return existsSync(join(root, p)) && statSync(join(root, p)).isFile(); } catch { return false; }
  };

  function classify(fromPath: string, raw: string): Cause {
    if (raw.includes('<expression>')) return 'computed';
    const spec = unwrap(raw);
    if (spec.startsWith('/')) return 'absolute';
    if (spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..') {
      const base = normalizeJoin(dirnameOf(fromPath), spec);
      if (base === null) return 'other';
      // The repo root. `candidatesFor('')` builds `/index.ts` — a leading slash that can never
      // match a repo-relative node key. ADR-0026's cobra defect, in the ES resolver.
      if (base === '') {
        for (const e of TRY) if (onDisk(`index${e}`)) return 'rootSelfPath';
        return 'missingFromTree';
      }
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

  // Every unsound node, and the set of causes that make it unsound.
  const causesOf = new Map<NodeRef, Set<Cause>>();
  for (let ref = 0; ref < atlas.nodes.length; ref += 1) {
    const node = nodeAt(graph, ref);
    const probable = (graph.out[ref] ?? []).some((e) => e.confidence !== 'certain');
    if (node.unresolved.length === 0 && !probable) continue;
    const cs = new Set<Cause>();
    for (const spec of node.unresolved) cs.add(classify(node.path, spec));
    if (probable) cs.add('other');
    causesOf.set(ref, cs);
  }

  const allSources = new Set(causesOf.keys());
  const baseline = taintFrom(graph, allSources);
  const baselineSubjects = [...baseline].filter((r) => blastSubjects.has(r)).length;

  /** Sources that survive when `removed` causes are fixed. A node with two causes survives one fix. */
  const survivors = (removed: ReadonlySet<Cause>): Set<NodeRef> => {
    const s = new Set<NodeRef>();
    for (const [ref, cs] of causesOf) {
      if ([...cs].some((c) => !removed.has(c))) s.add(ref);
    }
    return s;
  };

  const scoreOf = (removed: ReadonlySet<Cause>): number =>
    [...taintFrom(graph, survivors(removed))].filter((r) => blastSubjects.has(r)).length;

  const rows = FIXABLE.map((cause) => {
    const after = scoreOf(new Set([cause]));
    return { cause, taintedAfter: after, subjectsFreed: baselineSubjects - after };
  }).sort((a, b) => b.subjectsFreed - a.subjectsFreed);

  const allFixable = scoreOf(new Set(FIXABLE));
  // The absolute ceiling: every cause of every kind gone, including the ones no resolver can fix.
  const perfect = 0;

  const report = {
    repo, sha: atlas.repo.head,
    blastSubjects: blastSubjects.size,
    taintedBaseline: baselineSubjects,
    boardsToday: 0,
    marginal: rows,
    allFixableTogether: { taintedAfter: allFixable, subjectsFreed: baselineSubjects - allFixable },
    perfectResolution: { taintedAfter: perfect, subjectsFreed: baselineSubjects },
  };
  writeFileSync(join(out, `${repo}.json`), JSON.stringify(report, null, 2));

  console.log(`\n### ${repo} \`${(atlas.repo.head ?? '').slice(0, 8)}\` — ${baselineSubjects} of ${blastSubjects.size} blast subjects tainted today`);
  console.log('\n| fix | subjects still tainted after | **subjects freed** | as % of all subjects |');
  console.log('|---|---|---|---|');
  for (const r of rows) {
    console.log(`| \`${r.cause}\` alone | ${r.taintedAfter} | **${r.subjectsFreed}** | ${((r.subjectsFreed / blastSubjects.size) * 100).toFixed(1)}% |`);
  }
  console.log(`| **all four together** | ${allFixable} | **${baselineSubjects - allFixable}** | ${(((baselineSubjects - allFixable) / blastSubjects.size) * 100).toFixed(1)}% |`);
  console.log(`| *perfect resolution (unbuildable — needs running the code)* | 0 | *${baselineSubjects}* | *${((baselineSubjects / blastSubjects.size) * 100).toFixed(1)}%* |`);
}
