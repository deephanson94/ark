/**
 * How often *the walk's own entry points* put the camera inside a building.
 *
 * `scripts/probe-eye.ts` samples a uniform grid over the walkable ground and
 * reports ~1 bad position in 11,880. That number is true and it measures a
 * population the product never puts a player in. Pressing `g` does not drop you
 * on an arbitrary square: `enter` calls `standingClearOf(selected)` and the
 * guide pre-selects a *challenge subject*, which is a tall, load-bearing, and
 * therefore centrally-clustered tower. So the shipped spawn set is a small,
 * adversarial subset of the grid — and seven of ten cold playtesters opened on
 * a flat wall filling the frame.
 *
 * This measures that set: for every node a board can be about, stand where
 * `enter` would stand and ask whether the resolved eye is inside some tower's
 * drawn square below its roof — the same test `probe-eye.ts` applies, over the
 * positions that actually occur.
 *
 *   npx tsx scripts/probe-spawn.ts /tmp/ark-corpus <repo>...
 */
import { join } from 'node:path';

import { buildIndex, indexOptions } from '../src/indexer/build.js';
import { prepare } from '../src/player/scene.js';
import { buildWorld } from '../src/player/world/build.js';
import { FOV_VERTICAL, rigFor, spawnFacing } from '../src/player/world/index.js';

const corpus = process.argv[2] ?? '/tmp/ark-corpus';

console.log('| repo | spawns | target fills >=90% of frame height | median share | worst |');
console.log('|---|---|---|---|---|');

for (const repo of process.argv.slice(3)) {
  const { atlas } = await buildIndex(
    indexOptions(repo === 'ark' ? process.cwd() : join(corpus, repo)),
  );
  const scene = prepare(atlas);
  const world = buildWorld(scene);

  // Every node a challenge can be about — the set `g` can be entered on.
  const subjects = new Set<string>();
  for (const challenge of atlas.challenges) {
    subjects.add(challenge.subject);
    for (const id of challenge.candidates) subjects.add(id);
  }

  let spawns = 0;
  let filled = 0;
  let worstShare = 0;
  let worstName = '';
  const shares: number[] = [];

  for (const node of scene.nodes) {
    if (!subjects.has(node.id)) continue;
    const hero = spawnFacing(world, node);
    const rig = rigFor(world, hero);
    const tower = world.byRef.get(node.ref);
    if (tower === undefined) continue;
    const eye = {
      x: hero.x - Math.sin(hero.facing) * rig.distance,
      y: hero.y + Math.cos(hero.facing) * rig.distance,
      z: rig.height,
    };
    // Horizontal distance from the eye to the near face of the target.
    const d = Math.max(
      1,
      Math.hypot(eye.x - tower.node.x, eye.y - tower.node.y) - tower.footprint,
    );
    // The vertical angle the target subtends, as a share of the vertical FOV.
    // This is the quantity the complaint is about: "a flat wall filling the
    // frame, no horizon, no sky".
    const top = Math.atan2(tower.height - eye.z, d);
    const base = Math.atan2(-eye.z, d);
    const share = (top - base) / FOV_VERTICAL;
    spawns += 1;
    shares.push(share);
    if (share >= 0.9) filled += 1;
    if (share > worstShare) {
      worstShare = share;
      worstName = tower.node.label;
    }
  }

  shares.sort((a, b) => a - b);
  const median = shares.length === 0 ? 0 : (shares[Math.floor(shares.length / 2)] ?? 0);
  const pct = spawns === 0 ? 0 : (filled / spawns) * 100;
  console.log(
    `| ${repo} | ${spawns} | ${filled} (${pct.toFixed(1)}%) | ${(median * 100).toFixed(0)}% | ${worstName} ${(worstShare * 100).toFixed(0)}% |`,
  );
}
