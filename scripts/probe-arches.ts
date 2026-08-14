/**
 * Does ADR-0032 §9.6 still refuse a district arch, and what does the shipped
 * placement rule cost?
 *
 * §9.6 refused `Region.centroid` on **two** measurements — the nearest node
 * belongs to another region (118 of django's 175), and the centroid sits inside
 * a monolith (24 of django's). `scripts/probe-centroids.ts` re-measured the
 * first under ADR-0041's clustering and found it closed. This measures the
 * second, and then measures the rule that answers it, which is the part a
 * re-measurement of the refusal cannot tell you:
 *
 *  - how many centroids are **inside a drawn footprint** (§9.6's live concern);
 *  - how far `placeArches` has to walk to find standable ground;
 *  - how many regions end up with **no arch at all**, which is the cost;
 *  - and whether the placed arch still satisfies §9.6's *first* concern, since
 *    a nudge of a dozen units is exactly how an arch walks into the next
 *    district's street.
 *
 * `standable` folds both conditions into one predicate, so the third and fourth
 * bullets are the same number read two ways — that is the point of measuring it
 * from outside rather than trusting the predicate's own shape.
 *
 *   npx tsx scripts/probe-arches.ts /tmp/ark-corpus <repo>...
 */
import { join } from 'node:path';

import { buildIndex, indexOptions } from '../src/indexer/build.js';
import { prepare } from '../src/player/scene.js';
import { buildWorld } from '../src/player/world/build.js';

const corpus = process.argv[2] ?? '/tmp/ark-corpus';
const repos = process.argv.slice(3);

console.log(
  '| repo | topology regions | centroid inside a building | arches placed | max nudge | mean nudge | worst nudge / district extent | wrong district | thinnest margin | closest pair |',
);
console.log('|---|---|---|---|---|---|---|---|---|---|');

for (const repo of repos) {
  const { atlas } = await buildIndex(indexOptions(join(corpus, repo)));
  const scene = prepare(atlas);
  const world = buildWorld(scene);
  const topology = scene.regions.filter((region) => region.kind === 'topology');

  // The gate: tower positions have to be readable, or every gap below is NaN
  // and `NaN < 0` is false, so every centroid reads "clear" and the probe
  // reports the best possible news about a rule it never evaluated. An earlier
  // draft of this measurement did exactly that, reading `.x` off the `Tower`
  // rather than off its `node`.
  const first = world.towers[0];
  if (first === undefined || !Number.isFinite(first.node.x)) {
    throw new Error(`${repo}: tower positions unreadable — the measurement below would be vacuous`);
  }

  // §9.6's concern 2, measured on the raw centroid rather than on the placement.
  let insideBuilding = 0;
  for (const region of topology) {
    const inside = world.towers.some(
      (tower) =>
        Math.max(
          Math.abs(tower.node.x - region.x) - tower.footprint,
          Math.abs(tower.node.y - region.y) - tower.footprint,
        ) < 0,
    );
    if (inside) insideBuilding += 1;
  }

  // §9.6's concern 1, measured on the *placed* arch — the question a nudge
  // raises and the raw-centroid measurement cannot answer.
  //
  // And measured **with a margin**, because "the nearest building is a member"
  // is a strict inequality and the search returns the *nearest* standable point,
  // which is exactly the Voronoi boundary where that inequality first flips. A
  // unit fixture put an arch on the line by 0.14 units — true under the square
  // metric the rule uses and false under a Euclidean one, which is what a claim
  // holding by a rounding error looks like.
  let wrongDistrict = 0;
  let thinnest = Infinity;
  for (const arch of world.arches) {
    let member = Infinity;
    let foreign = Infinity;
    for (const tower of world.towers) {
      const gap = Math.max(
        Math.abs(tower.node.x - arch.x) - tower.footprint,
        Math.abs(tower.node.y - arch.y) - tower.footprint,
      );
      if (tower.node.regionIndex === arch.region.index) member = Math.min(member, gap);
      else foreign = Math.min(foreign, gap);
    }
    if (member > foreign) wrongDistrict += 1;
    thinnest = Math.min(thinnest, foreign - member);
  }

  // Can two districts ever share a doorway? `standable` carries a check against
  // the arches already placed, and the margin rule may already make it
  // unreachable — the triangle inequality over the same metric puts any two
  // arches at least `ARCH_HALF` apart before that check is consulted. This is
  // the *fires or does not fire* question the landmine asks, on real data.
  let closestPair = Infinity;
  for (let i = 0; i < world.arches.length; i += 1) {
    for (let j = i + 1; j < world.arches.length; j += 1) {
      const a = world.arches[i] as { x: number; y: number };
      const b = world.arches[j] as { x: number; y: number };
      closestPair = Math.min(closestPair, Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)));
    }
  }

  // A nudge is only meaningful against the district it happens in: 27 units is
  // nothing across django and half of a small region on this repo. Report the
  // share of the district's own extent, which is also the search's bound.
  const shares: number[] = [];
  for (const arch of world.arches) {
    let spread = 0;
    for (const tower of world.towers) {
      if (tower.node.regionIndex !== arch.region.index) continue;
      spread = Math.max(
        spread,
        Math.hypot(tower.node.x - arch.region.x, tower.node.y - arch.region.y),
      );
    }
    shares.push(spread === 0 ? 1 : arch.nudge / spread);
  }

  const nudges = world.arches.map((arch) => arch.nudge);
  const mean = nudges.length === 0 ? 0 : nudges.reduce((a, b) => a + b, 0) / nudges.length;
  const worstShare = shares.length === 0 ? 0 : Math.max(...shares);
  console.log(
    `| ${repo} | ${topology.length} | ${insideBuilding} | ${world.arches.length} | ` +
      `${nudges.length === 0 ? 0 : Math.max(...nudges)} | ${mean.toFixed(1)} | ` +
      `${(worstShare * 100).toFixed(0)}% | ${wrongDistrict} | ${Number.isFinite(thinnest) ? thinnest.toFixed(2) : '—'} | ${Number.isFinite(closestPair) ? closestPair.toFixed(1) : '—'} |`,
  );

  const marked = new Set(world.arches.map((arch) => arch.region.id));
  for (const region of topology) {
    if (marked.has(region.id)) continue;
    console.log(`|   ↳ unmarked: \`${region.label}\` | ${region.nodeCount} files | | | | | | | | |`);
  }
}
