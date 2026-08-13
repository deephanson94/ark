/**
 * Throwaway probe: find a fixture where Louvain genuinely leaves a
 * sub-`MIN_REGION` community, so the absorption test is not vacuous.
 *
 * Modularity's gain for moving `i` into `C` is `k_i,in − γ·k_i·Σ_tot(C)/2m`, so
 * a pair joined to a *large, dense* community by a single edge is refused: the
 * one internal edge it would gain is outweighed by that community's degree
 * mass. A pair hanging off a small cluster is absorbed by Louvain itself and
 * proves nothing — the first candidate fixture did exactly that.
 *
 * `npx tsx scripts/probe-fixture2.ts`
 */

import { louvain } from '../src/indexer/louvain.js';

function report(name: string, paths: readonly string[], links: readonly [string, string][]): void {
  const index = new Map(paths.map((path, i) => [path, i] as const));
  const result = louvain(
    paths.length,
    links.map(([from, to]) => ({ from: index.get(from) ?? 0, to: index.get(to) ?? 0 })),
    { resolution: 1, maxSweeps: 32, maxLevels: 16 },
  );
  const groups = new Map<number, string[]>();
  for (const [i, label] of result.labels.entries()) {
    const bucket = groups.get(label);
    if (bucket === undefined) groups.set(label, [paths[i] ?? '']);
    else bucket.push(paths[i] ?? '');
  }
  const small = [...groups.values()].filter((m) => m.length < 3);
  console.log(`\n${name}  — ${groups.size} communities, ${small.length} below MIN_REGION`);
  for (const [, members] of groups) console.log('  ', String(members.length).padStart(2), '=>', members.join(' '));
}

/** A dense clique of `n` nodes under `dir`. */
function clique(dir: string, n: number): { paths: string[]; links: [string, string][] } {
  const paths = Array.from({ length: n }, (_, i) => `${dir}/${i + 1}.ts`);
  const links: [string, string][] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) links.push([paths[i] ?? '', paths[j] ?? '']);
  }
  return { paths, links };
}

for (const size of [5, 6, 8]) {
  const big = clique('core', size);
  const other = clique('side', 4);
  report(
    `core clique of ${size}, side clique of 4, pair joined by one edge to each`,
    [...big.paths, ...other.paths, 'edge/1.ts', 'edge/2.ts'],
    [
      ...big.links,
      ...other.links,
      [big.paths[0] ?? '', other.paths[0] ?? ''],
      ['edge/1.ts', 'edge/2.ts'],
      ['edge/1.ts', big.paths[1] ?? ''],
      ['edge/2.ts', big.paths[2] ?? ''],
    ],
  );
}
