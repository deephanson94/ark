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
 * channel actually claims is untouched. 0.4 is chosen on the measurement rather
 * than by eye, with both its neighbours named — ark reads 14.3% at 0.45 and
 * 3.3% at 0.4, hono 8.2% and 6.1%, and below 0.4 the curve is flat on both
 * (2.2% / 3.3% at 0.35), so this is the knee and not a taste.
 */

import type { NodeRef } from '../../atlas/index.js';
import type { Bounds } from '../camera.js';
import { OUTSKIRTS, chronicleAt } from '../camera.js';
import type { Scene, SceneEdge, SceneNode } from '../scene.js';

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
export const FOOTPRINT_SCALE = 0.4;

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

export interface World {
  readonly towers: readonly Tower[];
  readonly byRef: ReadonlyMap<NodeRef, Tower>;
  readonly roads: readonly Road[];
  readonly chronicle: Chronicle;
  readonly spawn: { readonly x: number; readonly y: number; readonly facing: number };
  readonly bounds: Bounds;
}

const CHRONICLE_HEIGHT = 58;
const CHRONICLE_RADIUS = 7;


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

  const bounds = scene.bounds;
  const midX = (bounds.minX + bounds.maxX) / 2;
  // **One position, shared with the flat map.** `chronicleAt` is in `camera.ts`
  // beside `Bounds` because both views need it and a second copy of the rule is
  // how the two would drift apart — a player who learns where the chronicle is
  // must find it in the same place in either view.
  const standing = chronicleAt(bounds);
  const chronicle: Chronicle = {
    x: standing.x,
    y: standing.y,
    height: CHRONICLE_HEIGHT,
    radius: CHRONICLE_RADIUS,
  };

  // You arrive from outside, north of the map, facing into it — NORTH-STAR's
  // *"a cartographer arriving at a shore that already exists"*, and a spawn
  // that is a function of the bounds claims nothing about any file. Standing
  // beside the chronicle also means the first thing in view is the one landmark
  // that is always interactable, whatever the deck holds.
  const spawn = { x: midX + OUTSKIRTS * 0.55, y: bounds.minY - OUTSKIRTS * 0.8, facing: Math.PI };

  return { towers, byRef, roads, chronicle, spawn, bounds };
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
