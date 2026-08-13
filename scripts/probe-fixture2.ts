/**
 * Throwaway probe: find an absorption fixture that is non-vacuous **and**
 * discriminates the rule it claims to test.
 *
 * Two separate traps, and the shipped fixture fell into the second:
 *
 *  1. Louvain must genuinely leave the pair as its own sub-`MIN_REGION`
 *     community, or absorption never runs and the test passes with the pass
 *     deleted. (The first fixture failed this.)
 *  2. The pair must have outward edges to **two different** regions in
 *     different quantities, or "merge into the region it shares the most edges
 *     with" is indistinguishable from "merge into the lowest label" / "the
 *     largest" / "the first one found". (The second fixture failed this: both
 *     its outward edges went to `core`.)
 *
 * `npx tsx scripts/probe-fixture2.ts`
 */

import { detectRegions } from '../src/indexer/regions.js';
import { louvain } from '../src/indexer/louvain.js';

function clique(dir: string, n: number): { paths: string[]; links: [string, string][] } {
  const paths = Array.from({ length: n }, (_, i) => `${dir}/${i + 1}.ts`);
  const links: [string, string][] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) links.push([paths[i] ?? '', paths[j] ?? '']);
  }
  return { paths, links };
}

/** `toCore` edges to the core clique, `toSide` to the side clique. */
function attempt(size: number, toCore: number, toSide: number): void {
  const core = clique('core', size);
  const side = clique('side', size);
  const paths = [...core.paths, ...side.paths, 'edge/1.ts', 'edge/2.ts'];
  const links: [string, string][] = [
    ...core.links,
    ...side.links,
    [core.paths[0] ?? '', side.paths[0] ?? ''],
    ['edge/1.ts', 'edge/2.ts'],
  ];
  for (let i = 0; i < toCore; i++) links.push(['edge/1.ts', core.paths[i + 1] ?? '']);
  for (let i = 0; i < toSide; i++) links.push(['edge/2.ts', side.paths[i + 1] ?? '']);

  const index = new Map(paths.map((path, i) => [path, i] as const));
  const asEdges = links.map(([from, to]) => ({ from: index.get(from) ?? 0, to: index.get(to) ?? 0 }));

  const communities = louvain(paths.length, asEdges, {
    resolution: 1,
    maxSweeps: 32,
    maxLevels: 16,
  }).labels;
  const pairAlone =
    communities[index.get('edge/1.ts') ?? 0] === communities[index.get('edge/2.ts') ?? 0] &&
    communities.filter((c) => c === communities[index.get('edge/1.ts') ?? 0]).length === 2;

  const regions = detectRegions(paths, asEdges);
  const home = regions.find((region) => region.members.some((m) => paths[m] === 'edge/1.ts'));
  const landedOn = home?.members.some((m) => (paths[m] ?? '').startsWith('side/')) === true ? 'side' : 'core';

  console.log(
    `size=${size} toCore=${toCore} toSide=${toSide}  ` +
      `louvainLeavesPairAlone=${pairAlone ? 'YES' : 'no '}  absorbedInto=${landedOn}  ` +
      `label=${home?.label ?? '(none)'}`,
  );
}

// More edges to `side` than to `core`, so "most connected" and "lowest
// label"/"first found" (both of which favour `core`, whose paths sort first)
// give different answers.
for (const size of [5, 6]) {
  for (const [toCore, toSide] of [[1, 2], [1, 3], [2, 3]] as const) attempt(size, toCore, toSide);
}
