/**
 * PHASE 1 — is Blast Radius starved on real repositories, and where?
 *
 * Indexes every repo in a corpus directory through ark's **own** `buildIndex`,
 * so every number below is the instrument that decides the deck rather than a
 * re-derivation of it (CLAUDE.md: *"check that you are measuring it with the
 * instrument that decided it"*).
 *
 * Writes one JSON row per repo to `<out>/<repo>.json` and prints a table.
 *
 *   npx tsx scripts/probe-supply.ts /tmp/ark-corpus /tmp/ark-supply
 */
import { mkdirSync, writeFileSync, readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { buildIndex, indexOptions } from '../src/indexer/build.js';
import { buildGraph, reach, taintedRefs } from '../src/atlas/graph.js';
import { sourceCoverage } from '../src/atlas/coverage.js';

const corpus = process.argv[2] ?? '/tmp/ark-corpus';
const out = process.argv[3] ?? '/tmp/ark-supply';
const only = process.argv[4];
mkdirSync(out, { recursive: true });

function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[m] ?? 0) : (((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2);
}

export interface SupplyRow {
  repo: string;
  sha: string;
  shallow: boolean;
  commits: number;
  langs: string[];
  nodes: number;
  files: number;
  edges: number;
  edgesPerNode: number;
  /** Import sites, split ADR-0003's three ways. */
  sites: { internal: number; external: number; unresolved: number };
  resolutionRate: number;
  unresolvedTruncated: number;
  /** Dependency-closure size per node (the walk guardrail 4 runs). */
  closure: { mean: number; median: number; max: number };
  /** Nodes whose dependency closure carries an unresolved import or probable edge. */
  taintedNodes: number;
  taintedShare: number;
  /** Nodes with ≥ 1 dependent — what Blast Radius could ask about. */
  blastSubjects: number;
  /** …of those, how many are tainted (guardrail 4 refuses them). */
  blastSubjectsTainted: number;
  deckRefused: boolean;
  mappedShare: number;
  verbs: Record<string, { generated: number; considered: number; skipped: Record<string, number> }>;
  totalChallenges: number;
  unprovableNodes: number;
  indexMs: number;
}

async function measure(repo: string): Promise<SupplyRow> {
  const root = join(corpus, repo);
  const git = (...args: string[]): string =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim();

  const started = Date.now();
  const { atlas, generation } = await buildIndex(indexOptions(root));
  const indexMs = Date.now() - started;

  const graph = buildGraph(atlas);
  const tainted = taintedRefs(graph);

  let internal = 0;
  for (const edge of atlas.edges) internal += edge.weight;
  let external = 0;
  let unresolved = 0;
  let files = 0;
  for (const node of atlas.nodes) {
    external += node.externals.length;
    unresolved += node.unresolved.length;
    files += node.fileCount;
  }
  const sites = internal + external + unresolved;

  const closures: number[] = [];
  let blastSubjects = 0;
  let blastSubjectsTainted = 0;
  for (let ref = 0; ref < atlas.nodes.length; ref += 1) {
    closures.push(reach(graph, ref, 'dependencies', Infinity).size);
    if ((graph.in[ref] ?? []).length > 0) {
      blastSubjects += 1;
      if (tainted.has(ref)) blastSubjectsTainted += 1;
    }
  }

  const coverage = sourceCoverage(atlas);
  const verbs: SupplyRow['verbs'] = {};
  if (generation !== null) {
    for (const [name, result] of Object.entries(generation)) {
      const skipped: Record<string, number> = {};
      for (const [reason, n] of result.report.skipped) skipped[reason] = n;
      verbs[name] = {
        generated: result.report.generated,
        // Placement's report names this `commitsConsidered` — its subject is a commit (ADR-0018).
        // Reading only `subjectsConsidered` silently reported 0 for that verb on all 19 repos.
        considered:
          'subjectsConsidered' in result.report
            ? result.report.subjectsConsidered
            : 'commitsConsidered' in result.report
              ? result.report.commitsConsidered
              : 0,
        skipped,
      };
    }
  }

  const truncation = atlas.report.truncations.find((t) => t.what === 'unresolved');

  return {
    repo,
    sha: git('rev-parse', 'HEAD'),
    shallow: git('rev-parse', '--is-shallow-repository') === 'true',
    commits: Number(git('rev-list', '--count', 'HEAD')),
    langs: [...atlas.repo.languages],
    nodes: atlas.nodes.length,
    files,
    edges: atlas.edges.length,
    edgesPerNode: atlas.nodes.length === 0 ? 0 : atlas.edges.length / atlas.nodes.length,
    sites: { internal, external, unresolved },
    resolutionRate: sites === 0 ? 1 : 1 - unresolved / sites,
    unresolvedTruncated: truncation?.dropped ?? 0,
    closure: {
      mean: closures.length === 0 ? 0 : closures.reduce((a, b) => a + b, 0) / closures.length,
      median: median(closures),
      max: closures.length === 0 ? 0 : Math.max(...closures),
    },
    taintedNodes: tainted.size,
    taintedShare: atlas.nodes.length === 0 ? 0 : tainted.size / atlas.nodes.length,
    blastSubjects,
    blastSubjectsTainted,
    deckRefused: coverage.deckRefused,
    mappedShare: coverage.mapped + coverage.unreadable === 0
      ? 1
      : coverage.mapped / (coverage.mapped + coverage.unreadable),
    verbs,
    totalChallenges: atlas.challenges.length,
    unprovableNodes: generation?.blastRadius.report.unprovableNodes ?? 0,
    indexMs,
  };
}

const repos = (only ? [only] : readdirSync(corpus)).filter((r) => existsSync(join(corpus, r, '.git')));
const rows: SupplyRow[] = [];
for (const repo of repos.sort()) {
  const cached = join(out, `${repo}.json`);
  if (existsSync(cached) && process.env['REFRESH'] !== '1') {
    rows.push(JSON.parse(readFileSync(cached, 'utf8')) as SupplyRow);
    process.stderr.write(`cached ${repo}\n`);
    continue;
  }
  try {
    const row = await measure(repo);
    writeFileSync(cached, JSON.stringify(row, null, 2));
    rows.push(row);
    process.stderr.write(`done   ${repo}  ${row.indexMs} ms\n`);
  } catch (error) {
    process.stderr.write(`FAIL   ${repo}: ${String(error)}\n`);
  }
}

const pad = (s: string | number, n: number): string => String(s).padStart(n);
console.log(
  ['repo'.padEnd(22), pad('nodes', 6), pad('edges', 7), pad('res%', 6), pad('clos~', 7), pad('closμ', 7),
   pad('taint%', 7), pad('subj', 6), pad('blast', 6), pad('deck', 6), pad('map%', 6)].join(' '),
);
for (const r of rows) {
  console.log(
    [
      r.repo.padEnd(22),
      pad(r.nodes, 6),
      pad(r.edges, 7),
      pad((r.resolutionRate * 100).toFixed(1), 6),
      pad(r.closure.median.toFixed(1), 7),
      pad(r.closure.mean.toFixed(1), 7),
      pad((r.blastSubjects === 0 ? 0 : (r.blastSubjectsTainted / r.blastSubjects) * 100).toFixed(1), 7),
      pad(r.blastSubjects, 6),
      pad(r.verbs['blastRadius']?.generated ?? 0, 6),
      pad(r.totalChallenges, 6),
      pad((r.mappedShare * 100).toFixed(1), 6),
    ].join(' '),
  );
}
writeFileSync(join(out, '_all.json'), JSON.stringify(rows, null, 2));
