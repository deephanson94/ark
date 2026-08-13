/**
 * Throwaway probe: re-measure ADR-0032 §9.6's centroid claim under the new
 * clustering.
 *
 * That section refuses to place a region arch at `Region.centroid` because
 * *"118 of django's 175 region centroids have their nearest node in a different
 * region"* — an arch there would stand in someone else's street. ADR-0041
 * changed how many regions there are (django 175 → 22), so the figure is about
 * a partition that no longer exists and the *conclusion* needs re-checking, not
 * just the number.
 *
 * NOT part of the suite. `npx tsx scripts/probe-centroids.ts <atlas.json> ...`
 */

import { readFile } from 'node:fs/promises';
import process from 'node:process';

interface Atlas {
  readonly repo: { readonly name: string };
  readonly nodes: readonly { readonly layout: readonly [number, number]; readonly region: string }[];
  readonly regions: readonly {
    readonly id: string;
    readonly centroid: readonly [number, number];
    readonly kind: string;
  }[];
}

for (const path of process.argv.slice(2)) {
  const atlas = JSON.parse(await readFile(path, 'utf8')) as Atlas;
  let misplaced = 0;
  for (const region of atlas.regions) {
    let nearest = '';
    let best = Number.POSITIVE_INFINITY;
    for (const node of atlas.nodes) {
      const dx = node.layout[0] - region.centroid[0];
      const dy = node.layout[1] - region.centroid[1];
      const distance = dx * dx + dy * dy;
      if (distance < best) {
        best = distance;
        nearest = node.region;
      }
    }
    if (nearest !== region.id) misplaced++;
  }
  console.log(
    `${atlas.repo.name.padEnd(14)} ${String(misplaced).padStart(4)} of ${String(atlas.regions.length).padStart(4)}` +
      ` region centroids have their nearest node in a different region` +
      ` (${((misplaced / Math.max(1, atlas.regions.length)) * 100).toFixed(0)}%)`,
  );
}
