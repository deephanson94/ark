/**
 * Throwaway probe: measure region clustering quality across reference repos.
 *
 * Indexes each repo once and dumps `regions.json` per repo into the out dir, so
 * every later question is answered off the dump rather than by re-indexing.
 *
 * NOT part of the suite. `npx tsx scripts/probe-regions.ts <outdir> <name>=<path> ...`
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

import { buildAtlas, indexOptions } from '../src/indexer/build.js';

async function main(): Promise<void> {
  const [outDir, ...specs] = process.argv.slice(2);
  if (outDir === undefined || specs.length === 0) {
    console.error('usage: probe-regions <outdir> <name>=<path> ...');
    process.exit(1);
  }
  await mkdir(outDir, { recursive: true });

  for (const spec of specs) {
    const eq = spec.indexOf('=');
    const name = spec.slice(0, eq);
    const path = spec.slice(eq + 1);
    const started = Date.now();
    const atlas = await buildAtlas(indexOptions(path));
    const ms = Date.now() - started;

    const indexByRegion = new Map<string, number>();
    for (const [index, region] of atlas.regions.entries()) indexByRegion.set(region.id, index);

    const dump = {
      repo: name,
      head: atlas.repo.head,
      nodes: atlas.nodes.length,
      edges: atlas.edges.length,
      indexMs: ms,
      challenges: atlas.challenges.length,
      regions: atlas.regions.map((region) => ({
        id: region.id,
        label: region.label,
        kind: region.kind,
        nodeCount: region.nodeCount,
        index: indexByRegion.get(region.id) ?? -1,
      })),
      // node → region, so modularity can be recomputed off the dump.
      // **The path, not the id** — `node.id` is a content hash (`n:006a6fce…`),
      // so a probe reading it as a path measures nothing and says so quietly.
      nodeRegion: atlas.nodes.map((node) => [node.path, node.region] as const),
      nodeKind: atlas.nodes.map((node) => node.kind),
      edgeList: atlas.edges.map((edge) => [edge.from, edge.to] as const),
    };
    await writeFile(join(outDir, `${name}.json`), JSON.stringify(dump), 'utf8');
    console.log(
      `${name.padEnd(14)} ${String(atlas.nodes.length).padStart(5)} nodes  ` +
        `${String(atlas.edges.length).padStart(6)} edges  ` +
        `${String(atlas.regions.length).padStart(4)} regions  ${ms} ms`,
    );
  }
}

await main();
