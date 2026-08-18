/**
 * How often the walk camera stands inside a building.
 *
 * Six of ten cold playtesters named walk mode as the thing dragging their score,
 * three of them as *the* thing, and every description is the same frame: a flat
 * wall filling most of the screen, no hero visible, a black wedge where the near
 * plane cuts the geometry. `artifacts/world-leg2.png` is that frame.
 *
 * The cause is not the spawn. It is the eye: the boom pull-in computed the right
 * distance and then `Math.max(EYE_MIN_DISTANCE, hit)` threw it away, so any
 * obstruction closer than 18 units put the camera back inside the wall it had
 * just found. This measures the consequence directly — for a standing position
 * and a facing, is the resolved eye inside some tower's drawn square, below that
 * tower's height?
 *
 * **Sampled over the walkable ground, not over approach positions.** The first
 * version sampled where `standingClearOf` puts you — deliberately clear spots,
 * 7 units south of a tower — and reported 7.0%, which does not explain six of
 * ten testers naming this as the worst frame in the product. They were
 * *walking*, and the failure is a dense quarter, so the population is every
 * place a player can stand: a grid over the map's bounds with the points inside
 * a footprint dropped, since the hero cannot stand there anyway.
 *
 *   npx tsx scripts/probe-eye.ts /tmp/ark-corpus <repo>...
 */
import { join } from 'node:path';

import { buildIndex, indexOptions } from '../src/indexer/build.js';
import { prepare } from '../src/player/scene.js';
import { buildWorld } from '../src/player/world/build.js';
import { rigFor } from '../src/player/world/index.js';
import { HERO_RADIUS } from '../src/player/world/hero.js';

const corpus = process.argv[2] ?? '/tmp/ark-corpus';
const FACINGS = 8;

console.log('| repo | positions | eye inside a building | worst tower |');
console.log('|---|---|---|---|');

for (const repo of process.argv.slice(3)) {
  const { atlas } = await buildIndex(
    indexOptions(repo === 'ark' ? process.cwd() : join(corpus, repo)),
  );
  const scene = prepare(atlas);
  const world = buildWorld(scene);

  let positions = 0;
  let buried = 0;
  const blame = new Map<string, number>();

  const { bounds } = world;
  const STEPS = 40;
  const stands: { x: number; y: number }[] = [];
  for (let ix = 0; ix <= STEPS; ix += 1) {
    for (let iy = 0; iy <= STEPS; iy += 1) {
      const x = bounds.minX + ((bounds.maxX - bounds.minX) * ix) / STEPS;
      const y = bounds.minY + ((bounds.maxY - bounds.minY) * iy) / STEPS;
      // The hero's body cannot occupy a footprint, so neither can this sample.
      const blocked = world.towers.some(
        (tower) =>
          Math.abs(x - tower.node.x) < tower.footprint + HERO_RADIUS &&
          Math.abs(y - tower.node.y) < tower.footprint + HERO_RADIUS,
      );
      if (!blocked) stands.push({ x, y });
    }
  }

  for (const stand of stands) {
    for (let i = 0; i < FACINGS; i += 1) {
      const facing = (i * 2 * Math.PI) / FACINGS;
      const at = { ...stand, facing };
      const rig = rigFor(world, at);
      const eye = {
        x: at.x - Math.sin(facing) * rig.distance,
        y: at.y + Math.cos(facing) * rig.distance,
        z: rig.height,
      };
      positions += 1;
      // Inside the *drawn* square, and below its roof — the two conditions
      // together are what fills the frame with a wall.
      for (const other of world.towers) {
        if (Math.abs(eye.x - other.node.x) > other.footprint) continue;
        if (Math.abs(eye.y - other.node.y) > other.footprint) continue;
        if (eye.z > other.height) continue;
        buried += 1;
        blame.set(other.node.path, (blame.get(other.node.path) ?? 0) + 1);
        break;
      }
    }
  }

  const worst = [...blame.entries()].sort((a, b) => b[1] - a[1])[0];
  const share = positions === 0 ? 0 : (100 * buried) / positions;
  console.log(
    `| ${repo} | ${positions} | ${buried} (${share.toFixed(1)}%) | ` +
      `${worst === undefined ? '—' : `${worst[0]} ×${worst[1]}`} |`,
  );
}
