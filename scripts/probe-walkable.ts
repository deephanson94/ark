/**
 * **How much of the city has no gap a body can walk through?**
 *
 * `FOOTPRINT_SCALE` is a constant and the layout is not: ark indexes itself, so
 * every commit packs a few more towers into the same bounds and the blocked
 * share climbs. `tests/atlas/atlas.test.ts` records **3.3% at `1827ff93`** under
 * a 0.15 bar, which is a 4.5× margin — and the margin is a timer, exactly as
 * CLAUDE.md says. This prints the rate at several scalars so the next value is
 * chosen from a curve rather than from one repo's current reading.
 *
 *   npx tsx scripts/probe-walkable.ts [repo…]
 */
import { buildAtlas, indexOptions } from '../src/indexer/build.js';
import { prepare } from '../src/player/scene.js';
import { buildWorld, FOOTPRINT_SCALE } from '../src/player/world/build.js';
import { HERO_RADIUS } from '../src/player/world/hero.js';

const SCALARS = [1, 0.4, 0.3, 0.25, 0.2, 0.15];

async function main(): Promise<void> {
  const repos = process.argv.slice(2);
  if (repos.length === 0) repos.push(process.cwd());

  process.stdout.write(
    `repo                nodes  ${SCALARS.map((s) => s.toFixed(2).padStart(6)).join('')}\n`,
  );
  for (const repo of repos) {
    const atlas = await buildAtlas(indexOptions(repo));
    const world = buildWorld(prepare(atlas));
    const cells: string[] = [];
    for (const scalar of SCALARS) {
      // The tower's footprint is `node.radius * FOOTPRINT_SCALE`, so rescaling
      // is a ratio on the built world rather than a rebuild — same layout, same
      // ordering, one multiplier.
      const factor = scalar / FOOTPRINT_SCALE;
      let blocked = 0;
      for (const a of world.towers) {
        let clearance = Number.POSITIVE_INFINITY;
        for (const b of world.towers) {
          if (a.ref === b.ref) continue;
          const gap =
            Math.hypot(a.node.x - b.node.x, a.node.y - b.node.y) -
            a.footprint * factor -
            b.footprint * factor;
          if (gap < clearance) clearance = gap;
        }
        if (clearance < HERO_RADIUS * 2) blocked++;
      }
      cells.push(`${((100 * blocked) / world.towers.length).toFixed(1).padStart(5)}%`);
    }
    process.stdout.write(
      `${atlas.repo.name.padEnd(20)}${String(atlas.nodes.length).padStart(5)}  ${cells.join('')}\n`,
    );
  }
}

await main();
