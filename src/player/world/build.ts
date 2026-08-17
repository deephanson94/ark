/**
 * The world, folded out of the atlas. Nothing here is invented.
 *
 * ## The roads are the edges, and that is ADR-0033's whole argument
 *
 * ADR-0032 decided the ground was a featureless plane — *"it carries no
 * information, and that is the point"* — on the reasoning that any field
 * pressed into terrain would be invented geography wearing a derived label.
 * §9.1 is why that was wrong: the model it produced named towers, colour,
 * arches, badges and fog and **never an import edge**, so the only topology a
 * walker could read was *proximity*, which is a spring-embedder artifact and is
 * precisely the fallacy the `treeSibling` distractor class exists to punish.
 * Pillar 4 says geography **is** topology; that world was geography minus it.
 *
 * A road is an edge. Same two endpoints, same coordinates, no smoothing, no
 * routing, no bundling — the thing you walk along is the import, which makes
 * the plane carry exactly as much information as the flat map's edge layer and
 * not one claim more.
 *
 * ## Footprint is `radiusFor(loc)` times a constant, and both halves matter
 *
 * ADR-0032 §3.3 wanted a cap keyed to **local** nearest-neighbour spacing so
 * towers never weld into a wall. §9.7 refused it: that makes rendered size a
 * function of neighbourhood crowding, so two files of equal `loc` render at
 * different sizes and the flat map's size channel stops being monotone — the
 * world and the map would disagree about which file is bigger.
 *
 * The first build then used `radiusFor(loc)` unchanged, and **that is not
 * walkable**. Measured: with an unscaled footprint, **88.5% of this repo's
 * towers and 52.2% of hono's have no body-width gap to their nearest
 * neighbour** — the city is one solid mass with the camera inside it, which is
 * what the first screenshots showed. `radiusFor` is a *glyph* radius the flat
 * map draws at whatever screen scale it likes; taking it as ground area was the
 * unexamined step.
 *
 * A **uniform** scalar fixes it and keeps §9.7 exactly: equal `loc` still gives
 * equal size, greater `loc` still gives greater size, and the ordering the size
 * channel actually claims is untouched.
 *
 * **0.25, and the 0.4 it replaces was a two-repo reading.** That value came with
 * its neighbours named and a claim that "below 0.4 the curve is flat on both",
 * which is true of ark and hono and of nothing else. `scripts/probe-walkable.ts`
 * over five, at `212b988`:
 *
 * ```
 * repo         nodes    1.00  0.40  0.30  0.25  0.20  0.15
 * ark            274   89.8% 12.4%  2.2%  0.0%  0.0%  0.0%
 * hono           425   60.2%  8.9%  2.1%  0.5%  0.0%  0.0%
 * graphql        549   63.4% 18.4% 10.2%  4.7%  1.1%  0.0%
 * kysely         600   56.8%  7.0%  2.8%  1.3%  1.3%  0.5%
 * prometheus     501   71.9% 17.2% 10.0%  4.2%  1.2%  0.0%
 * ```
 *
 * At the shipped 0.4, **graphql-js and prometheus stand at 17–18% blocked** —
 * the defect this scalar exists to fix, live on two of five reference repos and
 * invisible because the only test of it indexes ark. 0.25 holds every measured
 * repo under 5%; its neighbours are 0.3, which leaves two of them in double
 * figures, and 0.2, which buys 3.5 points at the cost of buildings half the
 * width they are drawn at today — and BASE_HEIGHT's comment is about a street
 * having *walls*.
 *
 * Note how the old number went stale, because it is the reason this constant
 * needs re-measuring rather than trusting: ark's own reading moved **3.3% →
 * 12.4%** at an unchanged 0.4, purely because the repo grew from 250-odd nodes
 * to 274 in the same layout bounds. A footprint constant on a self-indexing repo
 * has a timer on it, and the atlas test's 0.15 bar was the thing counting down.
 */

import type { NodeRef } from '../../atlas/index.js';
import type { Bounds } from '../camera.js';
import type { Scene, SceneEdge, SceneNode, SceneRegion } from '../scene.js';

/**
 * World units of height per elevation layer (ADR-0013).
 *
 * **A rendering constant, like the orbit's own `rise`, and it had to come
 * down.** ADR-0013 froze what elevation *means* — one layer up is twice as
 * depended-upon — not how many world units a layer is worth. At 14, ark's
 * tallest file stood 105 units over streets a measured 12–19 units wide: a
 * 6:1 canyon, which is not a city anyone can read from inside. At 6 the same
 * file is 47 units and the eye clears most of the skyline. The *ordering* is
 * untouched, which is the only thing the height channel claims — the same
 * argument the footprint scalar rests on, one axis over.
 */
export const RISE = 6;
/**
 * Minimum tower height.
 *
 * 57% of this repo's files sit at elevation 0 (ADR-0032 §3.1), so this is the
 * height of *most of the city* and not an edge case. Tall enough that a street
 * has walls and the eye can read a block; low enough that the elevation-1 step
 * above it is unmistakable, because that step is the claim ADR-0013 makes.
 */
export const BASE_HEIGHT = 5;
/**
 * How wide a road is drawn.
 *
 * Narrow. The first value was 2.2 and at a hub — where a dozen edges converge —
 * a dozen overlapping quads merged into one grey plate the size of a square,
 * which reads as pavement rather than as twelve dependencies. A road is a line
 * on the ground, and the thing that must stay countable is how many of them
 * there are.
 */
export const ROAD_WIDTH = 1.1;
/**
 * Ground area per unit of the map's glyph radius. See the header — this is the
 * constant that makes the city walkable without touching what size *means*.
 */
export const FOOTPRINT_SCALE = 0.25;

export interface Tower {
  readonly ref: NodeRef;
  readonly node: SceneNode;
  /** Half-width of the square footprint, in world units. */
  readonly footprint: number;
  readonly height: number;
}

export interface Road {
  readonly from: Tower;
  readonly to: Tower;
  readonly edge: SceneEdge;
  /** World length. Cached because road chopping needs it every frame. */
  readonly length: number;
}

/**
 * Where a commit-subject board is answered.
 *
 * ADR-0032 §9.2: a "lit stone" is a node with an open board, and **Placement's
 * subject is a commit** — no node, no `layout`, nowhere to stand. That is 25%
 * of ark's deck and 77% of django's, so a world that serves only nodes serves a
 * quarter to three quarters of nothing.
 *
 * The tempting fix — put the commit's marker among the files it touched — is a
 * **wrong answer key rendered as scenery**: a commit's file set *is* Placement's
 * answer key, so walking up to it would be the board's own truth drawn on the
 * ground. So the chronicle is one landmark, in one place, and its position is a
 * function of the map's bounds and of nothing else. It says *commits are
 * answered here* and says nothing whatever about which files any of them
 * touched.
 *
 * The honest cost, stated: commit boards have *a* place, not *their own* place.
 * A player learns where the chronicle is, not where a commit is, because a
 * commit is not anywhere.
 */
export interface Chronicle {
  readonly x: number;
  readonly y: number;
  readonly height: number;
  readonly radius: number;
}

/**
 * A named district marker, standing on ground that belongs to the district.
 *
 * ## Why this is not simply `Region.centroid`
 *
 * ADR-0032 §3.2 wanted *"a named arch marking a district"* and §9.6 refused it,
 * with **two** measurements, not one:
 *
 *  1. for **118 of django's 175 regions** the node nearest the centroid belonged
 *     to a *different* region — the arch would stand in someone else's street;
 *  2. **24 django centroids sat within 3 units of a node**, i.e. inside a
 *     monolith.
 *
 * *"Marking a district needs a derivation that is a place, not an average."*
 *
 * The first concern died with the partition it was measured on: under ADR-0041's
 * clustering the nearest node belongs to the region on **100 of 100** centroids
 * across six repos (`scripts/probe-centroids.ts`). The second is **live** — **20
 * of the 61 topology centroids** on those repos land inside a tower's drawn
 * footprint — and it is what this type answers. A mean of member positions is not
 * a place; the **nearest clear ground to that mean that stands in a member's
 * street** is one, and it is still a pure function of the layout.
 *
 * Both of §9.6's conditions are one predicate here (`standable`), deliberately:
 * a rule that satisfied one and not the other is exactly how the first of them
 * came to be checked and the second forgotten for a milestone. The cost is
 * stated rather than absorbed: **142 of 147 districts are marked** across twelve
 * repos, and the five that are not — django's `around django/core/__init__.py` at
 * 67 files, three typeorm test directories, one rxjs region — have no ground
 * inside their own extent that clears every building *and* stands a whole
 * arch-width inside their own territory.
 *
 * ## Four pillars, not two
 *
 * §3.2's word is *arch*, and a two-pillar arch has a **facing**. Nothing in the
 * atlas supplies one — a region is a set of nodes, not a direction — so orienting
 * it would be invented geography, which is the objection §9.1 already sustained
 * against the featureless plane. Four pillars on the world axes read the same
 * from every approach and claim no direction, and they are axis-aligned for the
 * same reason every tower is.
 */
export interface Arch {
  readonly region: SceneRegion;
  readonly x: number;
  readonly y: number;
  /** World units from `region.centroid`. 0 when the mean was already standable. */
  readonly nudge: number;
  /**
   * Pillar height — **the district's own tallest roof plus a clearance**, not a
   * constant.
   *
   * A fixed 26 units put the first version below the skyline it was meant to
   * name: the screenshots showed a gateway swallowed by the buildings around it,
   * visible only from the two streets that happened to point at it. Risk #4 asks
   * the world to show *"the silhouette of unexplored regions"*, and a name you
   * can only read from underneath answers nothing about where to go.
   *
   * Deriving it from the members keeps ADR-0013 intact — the arch is not a
   * height claim, it is the height of the claims it stands among, so it moves
   * with them and never reorders them.
   */
  readonly height: number;
}

export interface World {
  readonly towers: readonly Tower[];
  readonly byRef: ReadonlyMap<NodeRef, Tower>;
  readonly roads: readonly Road[];
  readonly arches: readonly Arch[];
  readonly chronicle: Chronicle;
  readonly spawn: { readonly x: number; readonly y: number; readonly facing: number };
  readonly bounds: Bounds;
}

const CHRONICLE_HEIGHT = 58;
const CHRONICLE_RADIUS = 7;
/** How far outside the map's edge the chronicle and the spawn point stand. */
const OUTSKIRTS = 90;

/** Half the distance between opposite pillars. */
export const ARCH_SPAN = 4.5;
/** Half-width of one pillar. */
export const ARCH_PILLAR = 1.1;
/** How far the lintel clears the district's tallest roof. See `Arch.height`. */
export const ARCH_CLEARANCE = 14;
/** What a district with no towers taller than the ground would get. */
export const ARCH_MIN_HEIGHT = 26;
export const ARCH_LINTEL = 2.2;
/** Half-width of the square the whole structure occupies. */
export const ARCH_HALF = ARCH_SPAN + ARCH_PILLAR;

/**
 * How finely the outward search samples, in world units.
 *
 * Both radially and **along each ring** — the first version used a fixed 16
 * samples per ring, which is 0.4 units apart at radius 1 and 28 units apart at
 * radius 46, so the search grew blind exactly where it was working hardest and
 * overshot every gap narrower than a building. django's worst arch moved 72
 * units under that rule and 46 under this one; graphql-js's went 50 → 17.
 */
const SEARCH_STEP = 1;
const MIN_RINGS = 8;

export function buildWorld(scene: Scene): World {
  const towers: Tower[] = [];
  const byRef = new Map<NodeRef, Tower>();
  for (const node of scene.nodes) {
    const tower: Tower = {
      ref: node.ref,
      node,
      footprint: node.radius * FOOTPRINT_SCALE,
      height: BASE_HEIGHT + node.elevation * RISE,
    };
    towers.push(tower);
    byRef.set(node.ref, tower);
  }

  const roads: Road[] = [];
  for (const edge of scene.edges) {
    const from = byRef.get(edge.from);
    const to = byRef.get(edge.to);
    if (from === undefined || to === undefined) continue;
    const length = Math.hypot(to.node.x - from.node.x, to.node.y - from.node.y);
    // A self-edge has no direction to lay a road along. The atlas should not
    // contain one; if it ever does, silently drawing a zero-length quad would
    // be a NaN in the middle of the ground plane.
    if (length < 1e-6) continue;
    roads.push({ from, to, edge, length });
  }

  const arches = placeArches(scene.regions, towers);

  const bounds = scene.bounds;
  const midX = (bounds.minX + bounds.maxX) / 2;
  const chronicle: Chronicle = {
    x: midX,
    y: bounds.minY - OUTSKIRTS,
    height: CHRONICLE_HEIGHT,
    radius: CHRONICLE_RADIUS,
  };

  // You arrive from outside, north of the map, facing into it — NORTH-STAR's
  // *"a cartographer arriving at a shore that already exists"*, and a spawn
  // that is a function of the bounds claims nothing about any file. Standing
  // beside the chronicle also means the first thing in view is the one landmark
  // that is always interactable, whatever the deck holds.
  const spawn = { x: midX + OUTSKIRTS * 0.55, y: bounds.minY - OUTSKIRTS * 0.8, facing: Math.PI };

  return { towers, byRef, roads, arches, chronicle, spawn, bounds };
}

/**
 * One arch per **topology** region, on the nearest standable ground to its mean.
 *
 * Terrain regions get none, and that is ADR-0010's rule rather than a shortcut:
 * a terrain lump is *"files the graph has nothing to say about"*, drawn in one
 * shared grey precisely so the map does not claim they are a neighbourhood. An
 * arch reading `docs` would make exactly that claim, in the world, at eye level.
 * On this repo that is 4 of 9 regions holding 60 of 246 files — a real absence,
 * and the honest one.
 */
export function placeArches(
  regions: readonly SceneRegion[],
  towers: readonly Tower[],
): Arch[] {
  const arches: Arch[] = [];
  const hood = neighbourhoodOf(towers);
  for (const region of regions) {
    if (region.kind !== 'topology') continue;
    const limit = spreadOf(region, towers);
    const at = standingPlace(region, hood, limit);
    if (at === null) continue;
    let tallest = 0;
    for (const tower of towers) {
      if (tower.node.regionIndex === region.index) tallest = Math.max(tallest, tower.height);
    }
    arches.push({
      region,
      x: at.x,
      y: at.y,
      nudge: at.nudge,
      height: Math.max(ARCH_MIN_HEIGHT, tallest + ARCH_CLEARANCE),
    });
  }
  return arches;
}

/**
 * How far the district reaches from its own mean — the search's bound.
 *
 * A fixed radius would be a constant with nothing behind it, and this repo's
 * landmine about thresholds named for their English applies to distances too:
 * an arch 40 units out is nothing on django and off the edge of a small
 * district. The district's own extent is the honest limit, because ground
 * further out than its furthest member is not in it. So *"no standable ground
 * inside this district"* is what an unmarked region means, rather than *"the
 * search gave up"*.
 */
function spreadOf(region: SceneRegion, towers: readonly Tower[]): number {
  let furthest = 0;
  for (const tower of towers) {
    if (tower.node.regionIndex !== region.index) continue;
    furthest = Math.max(furthest, Math.hypot(tower.node.x - region.x, tower.node.y - region.y));
  }
  return furthest;
}

/**
 * The first standable point on an outward lattice from the centroid.
 *
 * Deterministic by construction — a fixed radius sequence, a fixed angle
 * sequence, first hit wins — because two sessions of the same repo must put the
 * same arch in the same place for the same reason `layout` is computed in the
 * indexer.
 */
function standingPlace(
  region: SceneRegion,
  hood: Neighbourhood,
  limit: number,
): { x: number; y: number; nudge: number } | null {
  if (standable(region, region.x, region.y, hood)) {
    return { x: region.x, y: region.y, nudge: 0 };
  }
  for (let radius = SEARCH_STEP; radius <= limit; radius += SEARCH_STEP) {
    const rings = Math.max(MIN_RINGS, Math.ceil((2 * Math.PI * radius) / SEARCH_STEP));
    for (let ring = 0; ring < rings; ring += 1) {
      const theta = (ring / rings) * Math.PI * 2;
      const x = region.x + radius * Math.cos(theta);
      const y = region.y + radius * Math.sin(theta);
      if (standable(region, x, y, hood)) return { x, y, nudge: radius };
    }
  }
  return null;
}

/**
 * The towers, in square buckets, so `standable` is not a scan of the city.
 *
 * The search takes O(limit²) samples and `standable` asks two nearest-neighbour
 * questions of each — which as a linear scan cost **830 ms on typeorm** against
 * a 5 ms world build, on every press of `g`. It is a grid rather than a radius
 * filter because the sound radius is the problem: a candidate's *nearest* tower
 * can be much further out than anything that could overlap it, so pruning on the
 * overlap bound alone would let a non-member vanish and a member be declared
 * nearest — §9.6's first concern, reintroduced by an optimisation.
 *
 * Square buckets and the **Chebyshev** metric are the same shape, which is what
 * makes the ring bound below exact rather than conservative.
 */
interface Neighbourhood {
  readonly cell: number;
  readonly maxFootprint: number;
  readonly buckets: ReadonlyMap<string, readonly Tower[]>;
  readonly rings: number;
}

function neighbourhoodOf(towers: readonly Tower[]): Neighbourhood {
  let maxFootprint = 0;
  for (const tower of towers) maxFootprint = Math.max(maxFootprint, tower.footprint);
  const cell = Math.max(8, (maxFootprint + ARCH_HALF) * 2);
  const buckets = new Map<string, Tower[]>();
  let minGx = Infinity;
  let maxGx = -Infinity;
  let minGy = Infinity;
  let maxGy = -Infinity;
  for (const tower of towers) {
    const gx = Math.floor(tower.node.x / cell);
    const gy = Math.floor(tower.node.y / cell);
    minGx = Math.min(minGx, gx);
    maxGx = Math.max(maxGx, gx);
    minGy = Math.min(minGy, gy);
    maxGy = Math.max(maxGy, gy);
    const bucket = buckets.get(`${gx},${gy}`);
    if (bucket === undefined) buckets.set(`${gx},${gy}`, [tower]);
    else bucket.push(tower);
  }
  // How many rings it can take to leave the occupied area entirely. The loop
  // needs a stop even when nothing bounds it from the data — a region that is
  // the only one on the map has no foreign tower, so `foreign` stays infinite
  // and no measured distance will ever end the walk.
  const rings =
    towers.length === 0 ? 0 : Math.max(maxGx - minGx, maxGy - minGy) + 2;
  return { cell, maxFootprint, buckets, rings };
}

/**
 * §9.6's two refusals, as one predicate.
 *
 * The point must be **clear of every building** (concern 2) and the nearest
 * building must be a member of this region **by a margin** (concern 1).
 *
 * There is no third clause keeping two districts out of one doorway, and the
 * absence is deliberate. It was written, and then measured: the margin makes it
 * near-unreachable. If arches for A and B stand `s` apart, each is `ARCH_HALF`
 * deeper into its own territory than the other's, and the triangle inequality
 * over this same metric gives `ARCH_HALF ≤ s` outright — so no arch can contain
 * another's centre. Measured, the closest pair over twelve repos and 142 arches
 * is **15.5 units** (typeorm) against an 11.2-unit collision width; the first six
 * read 59.3, which would have licensed a much stronger sentence than the data
 * supports. The band `[5.6, 11.2)` is reachable in principle, was not observed,
 * and would be cosmetic if reached — against a branch that has fired zero times
 * in 142 placements. ADR-0044 decision 8 keeps the three claims apart.
 *
 * The margin is the part that is not obvious, and it was found by a fixture
 * rather than reasoned out. `standingPlace` returns the *nearest* standable
 * point, so without one the arch lands exactly on the Voronoi boundary where
 * *nearest is a member* first becomes true — a claim holding by a hair. The
 * fixture put one 0.14 units inside its own district, true under the square
 * metric the rule uses and false under a Euclidean one; on hugo the thinnest
 * real margin was **0.53 units** out of a 34-unit nudge. So the rule asks for a
 * margin of the arch's own half-width: the whole structure stands in member
 * territory rather than straddling the border, which is what *"in its own
 * district's street"* has to mean if it means anything.
 */
function standable(
  region: SceneRegion,
  x: number,
  y: number,
  hood: Neighbourhood,
): boolean {
  const gx = Math.floor(x / hood.cell);
  const gy = Math.floor(y / hood.cell);
  let member = Infinity;
  let foreign = Infinity;
  for (let ring = 0; ring <= hood.rings; ring += 1) {
    // Everything in this ring or beyond sits at least `(ring − 1)·cell` away in
    // Chebyshev centre-distance, so its gap cannot beat this. Once that floor
    // clears both bests, nothing further out can change either answer.
    const floor = (ring - 1) * hood.cell - hood.maxFootprint;
    if (floor > member && floor > foreign) break;
    for (let cx = gx - ring; cx <= gx + ring; cx += 1) {
      for (let cy = gy - ring; cy <= gy + ring; cy += 1) {
        // The ring, not the block: the interior was scanned on earlier passes.
        if (ring > 0 && Math.abs(cx - gx) !== ring && Math.abs(cy - gy) !== ring) continue;
        for (const tower of hood.buckets.get(`${cx},${cy}`) ?? []) {
          // Square-to-square, because a tower is drawn as a box of half-width
          // `footprint` — `hero.ts` collides with the inscribed *circle*, which
          // is the smaller shape and would let an arch clip a corner it never
          // touches.
          const gap = Math.max(
            Math.abs(tower.node.x - x) - tower.footprint,
            Math.abs(tower.node.y - y) - tower.footprint,
          );
          if (gap < ARCH_HALF) return false;
          if (tower.node.regionIndex === region.index) member = Math.min(member, gap);
          else foreign = Math.min(foreign, gap);
        }
      }
    }
  }
  return member + ARCH_HALF <= foreign;
}

/** Towers within `reach` of a point. What collision and interaction look at. */
export function near(world: World, x: number, y: number, reach: number): Tower[] {
  const found: Tower[] = [];
  for (const tower of world.towers) {
    const dx = tower.node.x - x;
    const dy = tower.node.y - y;
    const span = reach + tower.footprint;
    if (dx * dx + dy * dy <= span * span) found.push(tower);
  }
  return found;
}
