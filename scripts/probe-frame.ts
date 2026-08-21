/**
 * What is actually in the frame when you arrive in the world.
 *
 * `scripts/probe-spawn.ts` measures the opposite failure — the target filling
 * the whole frame — and reports **2.9% on both repos** since the standoff was
 * fixed. The complaint that outlived it is the other end: *"I pressed g and
 * there was nothing there"*. CLAUDE.md records the diagnosis and the correction:
 * 121 sampled positions had something in **full view** on both repos, so the
 * empty frames were the **frustum**, not the cull — and the honest response to
 * "there is nothing out there" was less out there, not scenery.
 *
 * Nobody has ever measured the frustum. This does, through the shipped renderer
 * rather than through a reimplementation of its geometry, so the number is what
 * the player sees: `drawWorldFrame` against a no-op context, at every position
 * the product can actually put you in.
 *
 * **What this retires is the *cull* and the *frustum*, not the rig item.** That
 * distinction was got wrong once already and a reviewer caught it: the rig item
 * is defined in `SPAWN_STANDOFF`'s own comment as the **opposite** failure — the
 * target *filling* the frame — and `scripts/probe-spawn.ts`, its actual
 * instrument, reads **11 of ark's 243 spawns (4.5%) at ≥90% of frame height,
 * worst `schema.ts` at 122%**, and 11 of hono's 381 (2.9%). An empty-frame
 * measurement cannot speak to that, and "count the clauses in the thing you are
 * re-opening" is this repo's own rule for exactly this.
 *
 * Measured through the shipped renderer at every position the product can put
 * you in (at `4ab4861`, on the working tree — see the caveat below):
 *
 *   ark   245 board spawns · median 182 towers, min 22 · **0 empty**
 *   hono  381 board spawns · median 291 towers, min 5  · **0 empty**
 *
 * **These figures move with every commit**, because ark indexes itself and the
 * probe runs against the working tree — the first version of this header quoted
 * 242 / 205 / 25 with no commit named, and a reviewer read 245 / 182 / 22 on the
 * next tree. Re-run rather than quote; the invariant (`0 empty`) is the part
 * that holds.
 *
 * and the shore — what `g` shows with nothing selected — carries 272 / 324
 * towers, 12 / 101 silhouettes, 6 / 11 district arches and ~2,255 roads. There
 * is no framing defect.
 *
 * The obvious follow-up looked like one and is not: **1–2 labels in a frame of
 * 205 towers**. That is fog. A tower is a label candidate only when
 * `visibilityOf` is not `silhouette`, and NORTH-STAR risk #4 asks for precisely
 * that — *"you can see there's something there, just not what"*. Under a fully
 * surveyed map the same positions read **22**, which is `drawLabels`' own cap.
 * So the anonymity is the mechanic, and the third explanation for one playtest
 * report ("the cull", "the frustum", "the labels") is the third to fail
 * measurement.
 *
 *   npx tsx scripts/probe-frame.ts /tmp/ark-corpus ark hono
 */
import { join } from 'node:path';

import { buildIndex, indexOptions } from '../src/indexer/build.js';
import { prepare } from '../src/player/scene.js';
import { buildWorld } from '../src/player/world/build.js';
import { FOV_VERTICAL, rigFor, spawnFacing } from '../src/player/world/index.js';
import { follow } from '../src/player/world/camera.js';
import { drawWorldFrame } from '../src/player/world/render.js';
import type { Hero } from '../src/player/world/hero.js';

/** Enough of a 2D context for the renderer to run and report. */
function stubContext(): CanvasRenderingContext2D {
  const noop = (): void => {};
  const target: Record<string, unknown> = {
    measureText: (text: string) => ({ width: text.length * 7 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    canvas: { width: 1440, height: 900 },
  };
  return new Proxy(target, {
    get: (object, key) => (key in object ? object[key as string] : noop),
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
}

const corpus = process.argv[2] ?? '/tmp/ark-corpus';
const viewport = { width: 1440, height: 900 };

console.log('| repo | position | towers | skyline | arches | roads |');
console.log('|---|---|---|---|---|---|');

for (const repo of process.argv.slice(3)) {
  const { atlas } = await buildIndex(
    indexOptions(repo === 'ark' ? process.cwd() : join(corpus, repo)),
  );
  const scene = prepare(atlas);
  const world = buildWorld(scene);
  const subjects = new Set<string>();
  for (const challenge of atlas.challenges) {
    subjects.add(challenge.subject);
    for (const id of challenge.candidates) subjects.add(id);
  }

  // **Two fogs, because an empty one measures the fog rather than the frame.**
  // A tower is a label candidate only when `visibilityOf` is not `silhouette`,
  // and NORTH-STAR risk #4 asks for exactly that — *"you can see there's
  // something there, just not what"*. So a median of 1 label under an empty fog
  // is the design working, and the question is whether it stays there once a
  // player has surveyed most of the map.
  const everything = new Set(scene.nodes.map((node) => node.id));
  const shoot = (hero: Hero, surveyed: ReadonlySet<string> = new Set()) => {
    const rig = rigFor(world, hero);
    // **`follow`, not a hand-rolled eye.** The first version built one from
    // `{x, y, z, facing, pitch}` — no `yaw`, no `fov` — so every projection ran
    // on `NaN`, `centre.forward <= 0` was false for every tower, and the probe
    // reported **0 empty frames on both repos** while measuring nothing about
    // the frustum at all. It errs in the direction that says "no defect here",
    // which is the one that gets believed. The tell was `roadsDrawn: 0` at every
    // position against the e2e's 2,249.
    const eye = follow(hero, rig.distance, rig.height, rig.pitch, FOV_VERTICAL);
    return drawWorldFrame(stubContext(), {
      world,
      eye,
      hero,
      viewport,
      fog: { surveyed, understood: new Set() },
      questions: new Set(),
      chronicleLit: false,
      focus: null,
      waypoint: null,
      chrome: [],
    } as never);
  };

  // **The plant.** `towersDrawn` rejects anything behind the eye, so turning the
  // hero around must empty the frame. If it does not, the projection is not
  // being read and every row below is decoration.
  const middle = { x: 0, y: 0 };
  for (const tower of world.towers) {
    middle.x += tower.node.x / world.towers.length;
    middle.y += tower.node.y / world.towers.length;
  }
  const atShore = { x: world.spawn.x, y: world.spawn.y };
  // `follow` puts the eye *behind* the hero, so forward is `(sin f, −cos f)` —
  // which makes the bearing to a point `atan2(dx, −dy)`. The first version wrote
  // `atan2(−dx, dy)`, off by exactly π, and the plant said so on its first run
  // by reporting 0 towers in the direction of the city.
  const toward = Math.atan2(middle.x - atShore.x, -(middle.y - atShore.y));
  const facingIn = shoot({ ...atShore, facing: toward });
  const facingOut = shoot({ ...atShore, facing: toward + Math.PI });
  if (facingIn.towersDrawn <= facingOut.towersDrawn || facingIn.roadsDrawn === 0) {
    console.log(
      `| ${repo} | **INSTRUMENT DEAD** | facing the city ${facingIn.towersDrawn} towers / ` +
        `${facingIn.roadsDrawn} roads, facing away ${facingOut.towersDrawn} | | | |`,
    );
    continue;
  }
  console.log(
    `| ${repo} | plant: turn around | ${facingIn.towersDrawn} → ${facingOut.towersDrawn} | | | |`,
  );

  // The shore: what `g` shows with nothing selected.
  const shore = shoot({ x: world.spawn.x, y: world.spawn.y, facing: world.spawn.facing });
  console.log(
    `| ${repo} | shore (no selection) | ${shore.towersDrawn} | ${shore.skylineDrawn} | ${shore.archesDrawn} | ${shore.roadsDrawn} |`,
  );

  // Every position the guide can send you to.
  let empty = 0;
  let thin = 0;
  const counts: number[] = [];
  const labels: number[] = [];
  const lit: number[] = [];
  for (const node of scene.nodes) {
    if (!subjects.has(node.id)) continue;
    const stats = shoot(spawnFacing(world, node));
    counts.push(stats.towersDrawn);
    labels.push(stats.labelsDrawn);
    lit.push(shoot(spawnFacing(world, node), everything).labelsDrawn);
    if (stats.towersDrawn + stats.skylineDrawn === 0) empty += 1;
    if (stats.towersDrawn + stats.skylineDrawn <= 2) thin += 1;
  }
  counts.sort((a, b) => a - b);
  labels.sort((a, b) => a - b);
  lit.sort((a, b) => a - b);
  const median = counts[Math.floor(counts.length / 2)] ?? 0;
  const medianLabels = labels[Math.floor(labels.length / 2)] ?? 0;
  console.log(
    `| ${repo} | ${counts.length} board spawns | median ${median}, min ${counts[0] ?? 0} | ` +
      `**${empty} empty**, ${thin} with ≤2 | | |`,
  );
  // **How much of that frame is identifiable.** "There was nothing there" is a
  // report about a picture, and a picture of two hundred anonymous boxes is a
  // candidate for it that neither the cull nor the frustum explains. The flat
  // map has this exact history: ADR-0041's typography pass exists because
  // "a name that names six things is not a label" was the map's central promise
  // failing at the zoom you go to for names.
  const medianLit = lit[Math.floor(lit.length / 2)] ?? 0;
  console.log(
    `| ${repo} | named in frame | arrival median **${medianLabels}** of ${median} towers | ` +
      `fully surveyed median **${medianLit}** | max ${lit[lit.length - 1] ?? 0} | |`,
  );
}
