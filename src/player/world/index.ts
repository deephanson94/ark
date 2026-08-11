/**
 * The walkable world as a mode: the state a walk needs, and nothing else.
 *
 * The shell owns the atlas, the deck and the console; this owns a position, a
 * heading and which keys are down. It never decides what a board says, which
 * verb is asking, or who may see what — the same seam that kept ADR-0014's
 * leaks out of `draw.ts` keeps them out of here.
 */

import type { NodeRef } from '../../atlas/index.js';
import type { Viewport } from '../camera.js';
import type { Box } from '../labels.js';
import type { Fog } from '../fog.js';
import type { Scene, SceneNode } from '../scene.js';
import type { Eye } from './camera.js';
import { follow } from './camera.js';
import type { Tower, World } from './build.js';
import { buildWorld, near } from './build.js';
import type { Hero, Walk } from './hero.js';
import { HERO_RADIUS, STILL, step } from './hero.js';
import { drawMinimap } from './minimap.js';
import type { Focus, WorldFrameStats } from './render.js';
import { drawWorldFrame } from './render.js';

/**
 * Third-person rig: behind and well above, tipped down onto the streets.
 *
 * **The first rig was a chest-height cinematic camera and it did not work.** At
 * 6.5 units up and 16 back, a dense quarter fills the frame with the inside of
 * one wall: the screenshots showed a red slab across the middle, labels floating
 * over nothing, and the hero clipped off the bottom edge. Ark's layout is dense
 * by measurement (ADR-0032 §3.1 — a median 12–19 units between files), so a
 * camera *in* the street sees a street and nothing else.
 *
 * Standing further back and looking down puts the **ground plan** in frame, and
 * the ground plan is where the import graph is drawn. It is still egocentric —
 * the body is on screen, the view turns with it, and everything is a perspective
 * projection with things shrinking as they recede — but it can see a
 * neighbourhood rather than a wall. `docs/prior-art.md` §2's finding is that 3D
 * wins from *outside* a structure and loses from inside it; this is as far
 * inside as legibility allows, which is a compromise and is named as one.
 */
const EYE_DISTANCE = 46;
/** Never closer than this, or the body fills the screen in a tight alley. */
const EYE_MIN_DISTANCE = 18;
/** How far clear of a wall the eye keeps. */
const EYE_CLEARANCE = 1.4;
const EYE_HEIGHT = 33;
export const EYE_PITCH = -0.52;
const FOV = 1.05;

/** How close you must be to a tower's edge for its board to be openable. */
export const INTERACT_RANGE = 14;
/**
 * How close counts as having looked at a building.
 *
 * Wider than `INTERACT_RANGE`, because seeing a name and answering a question
 * are different acts and the first should be cheaper. Narrow enough that a walk
 * across the map does not survey the map: at 46 u/s a straight crossing of this
 * repo touches a fraction of it, which is the point — the fog is a record of
 * where you have actually been.
 */
export const SURVEY_RANGE = 22;

/** Longest step integrated at once, so a backgrounded tab does not teleport. */
const MAX_STEP_SECONDS = 0.05;

export interface WorldDraw {
  readonly viewport: Viewport;
  /** Where the DOM panels stand, so labels are not drawn underneath them. */
  readonly chrome: readonly Box[];
  /**
   * Where the guide is sending the player, if anywhere.
   *
   * `null` for a node the shell could not place; the world then points at the
   * chronicle, because a placeless subject is answered there and nowhere else
   * (ADR-0033 decision 2). Handed in already resolved — the world never asks
   * what a challenge is about, only where the shell says to go.
   */
  readonly target: SceneNode | null;
  /** True when the guide's next board has no place of its own. */
  readonly targetIsPlaceless: boolean;
  readonly fog: Fog;
  readonly questions: ReadonlySet<NodeRef>;
  /** Whether any commit-subject board is still unanswered. */
  readonly chronicleLit: boolean;
}

export interface WorldStats extends WorldFrameStats {
  readonly litOnMinimap: number;
}

export interface WorldMode {
  isActive(): boolean;
  /** Enter, standing at `at` if given, otherwise at the world's spawn point. */
  enter(scene: Scene, at: SceneNode | null): void;
  exit(): void;
  /** True if the key was the world's to handle. */
  keyDown(key: string): boolean;
  keyUp(key: string): boolean;
  /**
   * Drop every held key.
   *
   * A modal takes the keyboard, and a key that was down when it opened is still
   * down when it closes — so the hero kept walking, sliding and *surveying*
   * behind the challenge panel, measured at 51 → 65 surveyed during one
   * mouse-only grade. The shell's first attempt released on the next
   * **keydown**, which never comes when the whole grade is clicks.
   */
  releaseAll(): void;
  /** Integrate to `nowMs`. True if anything changed and the frame is dirty. */
  advance(nowMs: number): boolean;
  draw(context: CanvasRenderingContext2D, input: WorldDraw): WorldStats;
  /** What the interact key would open right now. */
  focus(
    questions: ReadonlySet<NodeRef>,
    chronicleLit: boolean,
    target?: SceneNode | null,
  ): Focus | null;
  /**
   * Nodes the hero is standing close enough to have *looked at*.
   *
   * The flat map surveys a node when you click it; walking up to a building is
   * the same act with legs, and without it the world is a city of unnamed
   * shapes — fog withholds a label until a node is surveyed, which is right and
   * which makes an unexplored world unnavigable rather than mysterious. The
   * shell decides what to do with these; this only says who is within reach.
   */
  surveyable(): readonly SceneNode[];
  hero(): Hero | null;
  /** Metres, for the HUD. Null when there is nothing to walk to. */
  distanceTo(node: SceneNode): number | null;
}

export function createWorldMode(): WorldMode {
  let world: World | null = null;
  let hero: Hero | null = null;
  let lastMs: number | null = null;
  const held = new Set<string>();

  const walkFromKeys = (): Walk => {
    if (held.size === 0) return STILL;
    const down = (...keys: string[]): boolean => keys.some((key) => held.has(key));
    const forward = (down('w', 'arrowup') ? 1 : 0) - (down('s', 'arrowdown') ? 1 : 0);
    const strafe = (down('d') ? 1 : 0) - (down('a') ? 1 : 0);
    const turn = (down('arrowright', 'e') ? 1 : 0) - (down('arrowleft', 'q') ? 1 : 0);
    return { forward, strafe, turn, running: down('shift') };
  };

  /**
   * The eye, pulled in when a building stands between it and the hero.
   *
   * Without this the camera walks *through* the city: in a dense quarter the
   * boom's far end is inside a neighbouring tower, so the frame is filled by
   * the inside face of a wall and the hero is not visible at all. Measured on
   * this repo, the pull-in fires constantly in the `src/` cluster, which is
   * where every interesting file is.
   *
   * The test is against the footprint circles rather than the drawn boxes: a
   * circle is what `hero.ts` collides with, and a camera that used a different
   * shape from the body would clip on one and not the other.
   *
   * (The doc block below belongs to `waypointOf`; this one to `eyeOf`, further
   * down. Two comments that had drifted apart from their functions.)
   */

  /**
   * Where the guide is sending you, as a place on the ground.
   *
   * A placeless subject points at the chronicle rather than at nothing — which
   * also teaches where the chronicle is, since it is the one landmark a player
   * has no other reason to walk to.
   */
  const waypointOf = (input: WorldDraw): { x: number; y: number; label: string } | null => {
    if (world === null) return null;
    if (input.target !== null) {
      return { x: input.target.x, y: input.target.y, label: input.target.label };
    }
    if (input.targetIsPlaceless && input.chronicleLit) {
      return { x: world.chronicle.x, y: world.chronicle.y, label: 'the chronicle' };
    }
    return null;
  };

  const eyeOf = (at: Hero): Eye => {
    const back = { x: -Math.sin(at.facing), y: Math.cos(at.facing) };
    let distance = EYE_DISTANCE;
    if (world !== null) {
      // `near` already widens by each tower's own footprint, so the boom's
      // length is the whole reach.
      for (const tower of near(world, at.x, at.y, EYE_DISTANCE + EYE_CLEARANCE)) {
        // Where the boom enters this tower's circle, if it does.
        const ox = at.x - tower.node.x;
        const oy = at.y - tower.node.y;
        const radius = tower.footprint + EYE_CLEARANCE;
        const b = ox * back.x + oy * back.y;
        const c = ox * ox + oy * oy - radius * radius;
        if (c < 0) continue; // the hero is already inside it; the boom cannot help
        const discriminant = b * b - c;
        if (discriminant <= 0) continue;
        const hit = -b - Math.sqrt(discriminant);
        if (hit > 0 && hit < distance) distance = hit;
      }
    }
    return follow(at, Math.max(EYE_MIN_DISTANCE, distance), EYE_HEIGHT, EYE_PITCH, FOV);
  };

  const focusOf = (
    questions: ReadonlySet<NodeRef>,
    chronicleLit: boolean,
    target: SceneNode | null = null,
  ): Focus | null => {
    if (world === null || hero === null) return null;
    if (chronicleLit) {
      const distance =
        Math.hypot(world.chronicle.x - hero.x, world.chronicle.y - hero.y) - world.chronicle.radius;
      if (distance <= INTERACT_RANGE) return { kind: 'chronicle' };
    }
    let best: { tower: Tower; distance: number } | null = null;
    for (const tower of near(world, hero.x, hero.y, INTERACT_RANGE + HERO_RADIUS)) {
      if (!questions.has(tower.ref)) continue;
      // **The place the guide sent you wins any tie of proximity.** A playtest
      // walked to the building the guide named and was offered its neighbour,
      // because nearest-wins is blind to why you came — which quietly breaks
      // the one promise the guide makes.
      if (target !== null && tower.ref === target.ref) return { kind: 'tower', tower };
      const distance = Math.hypot(tower.node.x - hero.x, tower.node.y - hero.y) - tower.footprint;
      if (best === null || distance < best.distance) best = { tower, distance };
    }
    return best === null ? null : { kind: 'tower', tower: best.tower };
  };

  return {
    isActive: () => world !== null && hero !== null,

    enter(scene, at) {
      world = buildWorld(scene);
      // Arriving *at* a node is ADR-0032 §3.4's fast travel: the flat map picks
      // where to go and the walk starts there, because walking across django to
      // reach a specific file is commuting rather than exploration. Standing
      // clear of the tower rather than inside it — a spawn inside a footprint
      // would be resolved by the collision push on the first frame, which reads
      // as being shoved.
      if (at !== null) {
        const clearance = at.radius + HERO_RADIUS + 7;
        hero = { x: at.x, y: at.y + clearance, facing: 0 };
      } else {
        hero = { x: world.spawn.x, y: world.spawn.y, facing: world.spawn.facing };
      }
      lastMs = null;
      held.clear();
    },

    exit() {
      world = null;
      hero = null;
      lastMs = null;
      held.clear();
    },

    keyDown(key) {
      if (world === null) return false;
      const lower = key.toLowerCase();
      if (!WORLD_KEYS.has(lower)) return false;
      held.add(lower);
      return true;
    },

    releaseAll() {
      held.clear();
    },

    keyUp(key) {
      if (world === null) return false;
      const lower = key.toLowerCase();
      if (!WORLD_KEYS.has(lower)) return false;
      held.delete(lower);
      return true;
    },

    advance(nowMs) {
      if (world === null || hero === null) return false;
      const previous = lastMs;
      lastMs = nowMs;
      if (previous === null) return true;
      const seconds = Math.min(MAX_STEP_SECONDS, Math.max(0, (nowMs - previous) / 1000));
      const walk = walkFromKeys();
      if (walk.forward === 0 && walk.strafe === 0 && walk.turn === 0) return false;
      // Only the towers that could possibly be touched this step. The O(n) trap
      // a 3,035-node repo would find for us otherwise.
      const reach = HERO_RADIUS + 40;
      hero = step(hero, walk, seconds, near(world, hero.x, hero.y, reach).map(asObstacle));
      hero = withinShore(hero, world);
      return true;
    },

    draw(context, input) {
      if (world === null || hero === null) {
        return { towersDrawn: 0, roadsDrawn: 0, labelsDrawn: 0, beaconsDrawn: 0, litOnMinimap: 0 };
      }
      const stats = drawWorldFrame(context, {
        world,
        eye: eyeOf(hero),
        hero,
        viewport: input.viewport,
        fog: input.fog,
        questions: input.questions,
        chronicleLit: input.chronicleLit,
        focus: focusOf(input.questions, input.chronicleLit, input.target),
        chrome: input.chrome,
        waypoint: waypointOf(input),
      });
      const litOnMinimap = drawMinimap(context, {
        world,
        hero,
        viewport: input.viewport,
        fog: input.fog,
        questions: input.questions,
        waypoint: waypointOf(input),
        fovRadians: FOV,
      });
      return { ...stats, litOnMinimap };
    },

    focus: focusOf,

    surveyable() {
      if (world === null || hero === null) return [];
      return near(world, hero.x, hero.y, SURVEY_RANGE).map((tower) => tower.node);
    },

    hero: () => hero,

    distanceTo(node) {
      if (hero === null) return null;
      return Math.hypot(node.x - hero.x, node.y - hero.y);
    },
  };
}

const WORLD_KEYS = new Set([
  'w',
  'a',
  's',
  'd',
  'q',
  'e',
  'shift',
  'arrowup',
  'arrowdown',
  'arrowleft',
  'arrowright',
]);

/**
 * How far past the outermost file you may walk before the world stops you.
 *
 * There is nothing out there. A playtest walked for twelve seconds and reached
 * `0 towers · 0 roads · 0 labels · 0 beacons` — an unbounded grey plane with no
 * wall, no message and no way back, which is a worse failure than a wall
 * because it looks like the product is broken rather than finished. The atlas
 * has edges because the layout does; the world should have the same ones.
 *
 * A clamp rather than a fence: you slide along the edge instead of stopping
 * dead, the same way you slide along a building.
 */
const SHORE = 140;

function withinShore(hero: Hero, world: World): Hero {
  const { bounds } = world;
  // The chronicle stands outside the north edge, so the shore has to reach it
  // or the one landmark that is not a file would be unreachable.
  const north = Math.min(bounds.minY, world.chronicle.y - world.chronicle.radius) - SHORE;
  const x = Math.min(bounds.maxX + SHORE, Math.max(bounds.minX - SHORE, hero.x));
  const y = Math.min(bounds.maxY + SHORE, Math.max(north, hero.y));
  return x === hero.x && y === hero.y ? hero : { ...hero, x, y };
}

function asObstacle(tower: Tower): { x: number; y: number; radius: number } {
  return { x: tower.node.x, y: tower.node.y, radius: tower.footprint };
}

export { drawMinimap, minimapBox } from './minimap.js';
export type { Focus } from './render.js';
