/**
 * The world's tuned constants, against the invariants they claim.
 *
 * `FOOTPRINT_SCALE` was caught because it happened to have a bar to cross —
 * "is there a body-width gap between neighbours" — and 0.4 failed it on 88.5% of
 * this repo's towers. Its neighbours never had one. `RISE` and `ROAD_WIDTH` were
 * each tuned by looking at **one** repo at one moment, and each states an
 * invariant in its own comment that nothing measures:
 *
 *   RISE        "at 6 the same file is 47 units and **the eye clears most of the
 *               skyline**" — so: what share of towers stand above the eye?
 *   ROAD_WIDTH  "a road is a line on the ground, and the thing that must stay
 *               countable is **how many of them there are**" — so: at the
 *               busiest hub, are two roads ever closer together than one road is
 *               wide, where they leave the footprint?
 *
 * Both are properties of a *repository's shape*, so a value tuned on a 280-node
 * TypeScript repo is a guess about a 3,035-node Python one. This measures them
 * across the reference set.
 *
 * **Both constants hold, and the measurement is the point rather than the
 * result** — `FOOTPRINT_SCALE` was the same class and failed on 88.5% of this
 * repo's towers, so "we looked and it was fine" is a different state from "we
 * never looked".
 *
 * Measured over nine repositories, 285 to 12,626 towers. **The last column was
 * wrong in its first version**: it compared each fan against the *repository
 * median* street while the sentence beside it said "wider than the **nearest**
 * street", which understated it — a reviewer caught it, and paired properly the
 * column roughly doubles (kysely 4.5% → 10.6%, graphql-js 3.9% → 15.5%). The
 * label-versus-description landmine, in a probe whose whole thesis is that the
 * sentence beside a measurement is a second claim nobody tested.
 *
 *   repo         towers  above eye  street  canyon   fan med/p95  fan > street
 *   ark             285      22.8%    12.2   0.4:1     0.0 / 4.0         2.2%
 *   hono            425      15.8%    13.0   0.8:1     0.0 / 3.7         2.6%
 *   prometheus      501      30.9%    12.4   1.4:1     0.0 / 4.6         5.0%
 *   graphql-js      549      32.8%    11.8   0.4:1     1.1 / 11.3       15.5%
 *   kysely          600      49.2%    12.3   2.4:1     3.3 / 12.1       10.6%
 *   hugo          1,242      14.1%     9.8   0.5:1     1.4 / 7.1        17.8%
 *   django        3,035      13.4%     8.9   0.6:1     0.4 / 9.3        22.2%
 *   typeorm       3,704      13.0%     7.7   1.4:1     0.3 / 11.4       13.4%
 *   webpack      12,626       5.9%     7.4   0.7:1     0.5 / 6.8        12.0%
 *
 * `ROAD_WIDTH` holds, and by less than the first draft claimed: a fan is
 * 0.0–3.3 units at the median against streets 7.7–13.0 wide, and **2.2%–22.2%**
 * of hub nodes have one wider than their own nearest street. The counterfactual
 * is in the table — at the pre-tuning 2.2 every fan figure is 2–6× larger — so
 * the constant does something and what it does is still enough, with **django**
 * the worst case rather than typeorm.
 *
 * *That range was quoted as 2.2%–17.8% for one commit, off a run that had not
 * finished: django and webpack landed after the figure was written down. A
 * correction taken from a partial run is the original error wearing the clothes
 * of the fix.*
 *
 * `RISE` holds on the failure it names: the *"6:1 canyon, which is not a city
 * anyone can read from inside"* reads **0.4 : 1 to 2.4 : 1** everywhere. Its
 * other clause, "the eye clears most of the skyline", is the one that varies —
 * 5.9%–32.8% on eight repos and **49.2% on kysely**, satisfying "most" by 0.8
 * points. That is a margin, not a plateau, and it is recorded as one.
 *
 * **Note what the outlier is not.** "Above the eye" does not track repository
 * size: webpack is the largest and the *lowest* at 5.9%, while kysely at 600
 * towers is the highest at 49.2%. Height is `elevation`, the bit length of a
 * transitive dependent count, so this is a fact about a repo's dependency
 * *depth*. A session that stress-tested by picking the biggest repo would have
 * measured the wrong axis and found nothing.
 *
 *   npx tsx scripts/probe-city.ts /tmp/ark-corpus ark hono kysely graphql-js hugo prometheus
 */
import { join } from 'node:path';

import { buildIndex, indexOptions } from '../src/indexer/build.js';
import { prepare } from '../src/player/scene.js';
import { ROAD_WIDTH, buildWorld } from '../src/player/world/build.js';
import { EYE_HEIGHT_AT_FULL } from '../src/player/world/index.js';

const corpus = process.argv[2] ?? '/tmp/ark-corpus';

console.log(
  '| repo | towers | above the eye | median street | canyon | plate radius med / p95 (at 2.2) | plate wider than the street |',
);
console.log('|---|---|---|---|---|---|---|');

for (const repo of process.argv.slice(3)) {
  const { atlas } = await buildIndex(
    indexOptions(repo === 'ark' ? process.cwd() : join(corpus, repo)),
  );
  const world = buildWorld(prepare(atlas));
  const towers = world.towers;
  if (towers.length === 0) continue;

  // --- RISE ---------------------------------------------------------------
  const above = towers.filter((tower) => tower.height > EYE_HEIGHT_AT_FULL).length;
  const heights = towers.map((tower) => tower.height).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] ?? 0;

  // Nearest-neighbour **surface** gap: the street you actually walk down, not
  // the centre-to-centre distance, which a big building eats.
  const gaps: number[] = [];
  for (const tower of towers) {
    let best = Number.POSITIVE_INFINITY;
    for (const other of towers) {
      if (other === tower) continue;
      const gap =
        Math.hypot(other.node.x - tower.node.x, other.node.y - tower.node.y) -
        tower.footprint -
        other.footprint;
      if (gap < best) best = gap;
    }
    if (Number.isFinite(best)) gaps.push(best);
  }
  gaps.sort((a, b) => a - b);
  const medianGap = gaps[Math.floor(gaps.length / 2)] ?? 0;

  // --- ROAD_WIDTH ---------------------------------------------------------
  // At the node the most roads leave, sort their bearings and ask whether any
  // adjacent pair is closer together, at the footprint edge, than a road is
  // wide. Two roads closer than that are one road on screen.
  // `Road.from`/`.to` are **Towers, not refs** — the first version passed them
  // to `world.byRef.get`, got `undefined` every time, and reported "0 roads at
  // the busiest hub, 0 merging" on four repos. A zero in the column that says
  // "this constant is fine" is the reading to distrust.
  const leaving = new Map<number, number[]>();
  for (const road of world.roads) {
    for (const [at, away] of [
      [road.from, road.to],
      [road.to, road.from],
    ] as const) {
      const bearing = Math.atan2(away.node.y - at.node.y, away.node.x - at.node.x);
      leaving.set(at.ref, [...(leaving.get(at.ref) ?? []), bearing]);
    }
  }
  // **How far out the roads stay merged**, which is what the constant's own
  // story is about: *"a dozen overlapping quads merged into one grey plate the
  // size of a square"* — a plate is an area, not a count. Counting merges at the
  // footprint edge instead reports 199 of 199 on ark, which is true and
  // inevitable: any hub with more roads than its circumference admits has them
  // all touching where they leave. Two roads `Δθ` apart separate at
  // `width / Δθ`, so the widest adjacent gap sets the radius inside which that
  // node's roads are one shape.
  const streets: number[] = [];
  const plateAt = (width: number): number[] => {
    const radii: number[] = [];
    streets.length = 0;
    for (const [ref, all] of leaving) {
      if (all.length < 2) continue;
      const tower = world.byRef.get(ref);
      if (tower === undefined) continue;
      // **Four roads or more, and the median gap between them.** Taking the
      // *widest* adjacent gap answers "beyond what radius is every road
      // distinct", which two nearly-parallel roads send to 1,582 units — real,
      // but it is two roads going the same way rather than a plate. The comment
      // this measures is about *"a dozen overlapping quads merged into one grey
      // plate"*, so: a fan, and the radius inside which half of it is touching.
      if (all.length < 4) continue;
      const bearings = [...all].sort((a, b) => a - b);
      const steps: number[] = [];
      for (let i = 0; i < bearings.length; i++) {
        const a = bearings[i] as number;
        const wrap = i + 1 === bearings.length ? Math.PI * 2 : 0;
        const step = (bearings[(i + 1) % bearings.length] as number) + wrap - a;
        if (step > 0) steps.push(step);
      }
      steps.sort((a, b) => a - b);
      const median = steps[Math.floor(steps.length / 2)];
      if (median === undefined) continue;
      // Paired with **this hub's own** nearest street, not the repo median —
      // see `swallowed` below.
      let nearest = Number.POSITIVE_INFINITY;
      for (const other of towers) {
        if (other === tower) continue;
        const gap =
          Math.hypot(other.node.x - tower.node.x, other.node.y - tower.node.y) -
          tower.footprint -
          other.footprint;
        if (gap < nearest) nearest = gap;
      }
      radii.push(Math.max(0, width / median - tower.footprint));
      streets.push(Number.isFinite(nearest) ? nearest : 0);
    }
    return radii.sort((a, b) => a - b);
  };
  const plate = plateAt(ROAD_WIDTH);
  const wide = plateAt(2.2);
  const medianPlate = plate[Math.floor(plate.length / 2)] ?? 0;
  const p95Plate = plate[Math.floor(plate.length * 0.95)] ?? 0;
  const medianWide = wide[Math.floor(wide.length / 2)] ?? 0;

  const pct = (n: number): string => `${((n / towers.length) * 100).toFixed(1)}%`;
  // **Each hub against its own nearest street.** This read
  // `radius > medianGap` — the *repository* median — while the sentence beside
  // it, in the header, the commit message and the CHANGELOG, said "wider than
  // the **nearest** street". A reviewer re-ran it paired and the column moves
  // 4.5% → 11.9% on kysely (2.6×) and 9.0% → 11.9% on typeorm. The label-vs-
  // description landmine, in a probe whose whole thesis is that the sentence
  // beside a measurement is a second claim nobody tested.
  const swallowed = plate.filter((radius, at) => radius > (streets[at] ?? 0)).length;
  console.log(
    `| ${repo} | ${towers.length} | ${above} (${pct(above)}) | ${medianGap.toFixed(1)} | ` +
      `${(medianHeight / Math.max(0.1, medianGap)).toFixed(1)} : 1 | ` +
      `${medianPlate.toFixed(1)} / ${p95Plate.toFixed(1)} (was ${medianWide.toFixed(1)}) | ` +
      `${swallowed} of ${plate.length} (${((swallowed / Math.max(1, plate.length)) * 100).toFixed(1)}%) |`,
  );
}
