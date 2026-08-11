/**
 * The walkable world's pure core (ADR-0033).
 *
 * Everything here is a function of its arguments, so none of it needs a
 * browser. What a browser is still required for is that a pixel changed, which
 * is what `test:e2e` holds.
 */

import { describe, expect, it } from 'vitest';

import { prepare } from '../../src/player/scene.js';
import type { Viewport } from '../../src/player/camera.js';
import type { Eye } from '../../src/player/world/camera.js';
import { NEAR, clipToNear, follow, project, toView } from '../../src/player/world/camera.js';
import { FOOTPRINT_SCALE, buildWorld, near } from '../../src/player/world/build.js';
import { HERO_RADIUS, WALK_SPEED, step, wrapAngle } from '../../src/player/world/hero.js';
import { DEFAULT_ORBIT, project as projectOrbit } from '../../src/player/orbit.js';
import { horizonY } from '../../src/player/world/render.js';
import { EYE_PITCH as RIG_PITCH, createWorldMode } from '../../src/player/world/index.js';
import { atlasWith } from '../fixtures/atlas.js';

const VIEW: Viewport = { width: 800, height: 600 };

function eyeAt(x: number, y: number, yaw = 0, pitch = 0): Eye {
  return { x, y, z: 20, yaw, pitch, fov: 1.05 };
}

describe('the world camera', () => {
  it('puts a point straight ahead at the centre of the screen', () => {
    // Facing 0 is −Y, so "ahead" is a smaller y.
    const projected = project(eyeAt(100, 100), VIEW, 100, 0, 20);
    expect(projected).not.toBeNull();
    expect(projected?.point.x).toBeCloseTo(VIEW.width / 2, 6);
    expect(projected?.point.y).toBeCloseTo(VIEW.height / 2, 6);
  });

  it('halves the on-screen size when the distance doubles', () => {
    // **This is the assertion ADR-0032 §9.3 sent that document back for.** An
    // orthographic projector cannot satisfy it — its scale does not depend on
    // depth at all — so a grazing view of a city renders every tower at the
    // same width regardless of distance, which is a field of poles whatever the
    // layout is. The perspective divide is the one cue that makes a place read
    // as a place from inside it, and this is that cue, measured.
    const eye = eyeAt(0, 0);
    const nearer = project(eye, VIEW, 0, -100, 20);
    const further = project(eye, VIEW, 0, -200, 20);
    expect(nearer?.ppu).toBeCloseTo((further?.ppu ?? 0) * 2, 6);
  });

  it('is the difference between this camera and the orbit', () => {
    // The control: the same two depths through the orbit's projector move a
    // column's *position* and not its size. Asserting the new behaviour without
    // asserting the old one would leave "we replaced the camera" unproven.
    const orbitCamera = { x: 0, y: 0, scale: 1, bearing: 0 };
    const a = projectOrbit(orbitCamera, VIEW, DEFAULT_ORBIT, { x: 0, y: -100, elevation: 3 });
    const b = projectOrbit(orbitCamera, VIEW, DEFAULT_ORBIT, { x: 0, y: -200, elevation: 3 });
    const heightA = Math.abs(a.base.y - a.top.y);
    const heightB = Math.abs(b.base.y - b.top.y);
    expect(heightA).toBeCloseTo(heightB, 9);
    expect(a.base.y).not.toBeCloseTo(b.base.y, 3);
  });

  it('refuses to project a point behind the eye', () => {
    // Behind means a negative divide, which lands a point on screen mirrored as
    // though it were in front. Returning null forces every caller to say what
    // it wants to happen instead.
    expect(project(eyeAt(0, 0), VIEW, 0, 100, 20)).toBeNull();
  });

  it('clips a segment that crosses the near plane instead of dropping it', () => {
    const eye = eyeAt(0, 0);
    const behind = toView(eye, 0, 40, 0);
    const ahead = toView(eye, 0, -40, 0);
    expect(behind.forward).toBeLessThan(0);
    const clipped = clipToNear(behind, ahead);
    expect(clipped).not.toBeNull();
    expect(clipped?.a.forward).toBeCloseTo(NEAR, 9);
    expect(clipped?.b).toEqual(ahead);
    // The kept end is untouched, and the cut end sits exactly on the plane —
    // so the road under your feet is drawn right up to your feet.
    expect(clipToNear(behind, behind)).toBeNull();
  });

  it('follows from behind, so the hero is between the eye and where they face', () => {
    const eye = follow({ x: 0, y: 0, facing: 0 }, 30, 20, -0.1, 1);
    // Facing 0 is −Y, so the eye trails on the +Y side.
    expect(eye.y).toBeCloseTo(30, 6);
    expect(eye.x).toBeCloseTo(0, 6);
    const hero = toView(eye, 0, 0, 0);
    expect(hero.forward).toBeGreaterThan(0);
  });

  /**
   * **The one the first suite could not see, and a playtest could.**
   *
   * `hero.ts` walks along `(sin ψ, −cos ψ)` and `toView` projected onto a
   * *different* axis. The two agree exactly when `dx · sin ψ = 0` — headings 0°
   * and 180°, or a point straight down the Y axis — and every assertion written
   * about this camera used one of those. So a turn to any other heading walked
   * the hero out of its own camera: at 90° a point ten units *ahead* computed as
   * ten units **behind**, the figure vanished, and the city swung away as you
   * walked toward it. This repo's degenerate-fixture landmine, freshly made.
   *
   * Every case below runs at a heading where the mistake does not cancel.
   */
  it('agrees with the hero about which way is forward, at every heading', () => {
    for (const degrees of [0, 30, 45, 90, 135, 180, 225, 270, 315]) {
      const facing = (degrees * Math.PI) / 180;
      // Where one second of walking forward actually takes the hero.
      const ahead = step({ x: 0, y: 0, facing }, { forward: 1, strafe: 0, turn: 0, running: false }, 1, []);
      const eye = follow({ x: 0, y: 0, facing }, 30, 20, -0.2, 1);
      const view = toView(eye, ahead.x, ahead.y, 0);
      expect(view.forward, `facing ${degrees}°: walking forward went behind the camera`).toBeGreaterThan(0);
      // And it is *straight* ahead: no sideways drift, or the camera would
      // swing as you walked a straight line.
      expect(Math.abs(view.right), `facing ${degrees}°: forward drifted sideways`).toBeLessThan(1e-6);
    }
  });

  it('puts a strafe on the camera’s right, at every heading', () => {
    for (const degrees of [0, 30, 90, 135, 200, 315]) {
      const facing = (degrees * Math.PI) / 180;
      const right = step({ x: 0, y: 0, facing }, { forward: 0, strafe: 1, turn: 0, running: false }, 1, []);
      const eye = follow({ x: 0, y: 0, facing }, 30, 20, -0.2, 1);
      const view = toView(eye, right.x, right.y, 0);
      expect(view.right, `facing ${degrees}°: strafing right went left on screen`).toBeGreaterThan(0);
    }
  });

  it('keeps the hero on screen at every heading', () => {
    // The player-visible form of the same defect: the figure rendered behind
    // its own camera and disappeared for a 70° arc either side of east and west.
    for (let degrees = 0; degrees < 360; degrees += 15) {
      const facing = (degrees * Math.PI) / 180;
      const eye = follow({ x: 120, y: -80, facing }, 46, 33, -0.52, 1.05);
      const projected = project(eye, VIEW, 120, -80, 0);
      expect(projected, `facing ${degrees}°: the hero is behind its own camera`).not.toBeNull();
    }
  });
});

describe('the hero', () => {
  it('walks forward along its facing at the stated speed', () => {
    const after = step({ x: 0, y: 0, facing: 0 }, { forward: 1, strafe: 0, turn: 0, running: false }, 1, []);
    expect(after.y).toBeCloseTo(-WALK_SPEED, 6);
    expect(after.x).toBeCloseTo(0, 6);
  });

  it('does not move faster on the diagonal', () => {
    const straight = step({ x: 0, y: 0, facing: 0 }, { forward: 1, strafe: 0, turn: 0, running: false }, 1, []);
    const diagonal = step({ x: 0, y: 0, facing: 0 }, { forward: 1, strafe: 1, turn: 0, running: false }, 1, []);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeLessThanOrEqual(
      Math.hypot(straight.x, straight.y) + 1e-9,
    );
  });

  it('slides along an obstacle rather than stopping dead', () => {
    // Walking north into a tower slightly to the west: the hero must end up
    // clear of it and still have made northward progress, because a body that
    // halts on contact makes a dense quarter unwalkable and ark's dense
    // quarters are where the interesting files are.
    const obstacle = { x: -6, y: -40, radius: 12 };
    const after = step(
      { x: 0, y: 0, facing: 0 },
      { forward: 1, strafe: 0, turn: 0, running: false },
      1,
      [obstacle],
    );
    expect(Math.hypot(after.x - obstacle.x, after.y - obstacle.y)).toBeGreaterThanOrEqual(
      obstacle.radius + HERO_RADIUS - 1e-9,
    );
    expect(after.y).toBeLessThan(0);
  });

  it('pushes out of an obstacle it somehow started inside', () => {
    const after = step(
      { x: 10, y: 10, facing: 0 },
      { forward: 0, strafe: 0, turn: 0, running: false },
      0.1,
      [{ x: 10, y: 10, radius: 8 }],
    );
    expect(Math.hypot(after.x - 10, after.y - 10)).toBeCloseTo(8 + HERO_RADIUS, 6);
  });

  it('wraps a heading into a half turn either way', () => {
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 9);
    expect(wrapAngle(-Math.PI * 3)).toBeCloseTo(Math.PI, 9);
    expect(wrapAngle(0.4)).toBeCloseTo(0.4, 9);
  });
});

describe('the world model', () => {
  const scene = prepare(
    atlasWith(
      ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/core/hub.ts', 'docs/readme.md'],
      [
        ['src/a.ts', 'src/core/hub.ts'],
        ['src/b.ts', 'src/core/hub.ts'],
        ['src/c.ts', 'src/b.ts'],
      ],
    ),
  );
  const world = buildWorld(scene);

  it('lays a road for every edge, and invents none', () => {
    // ADR-0033 decision 1. The ground carries the import graph and nothing
    // else — so this is an equality, not a lower bound: a world with extra
    // roads is inventing geography, and one with fewer is the §9.1 defect
    // (topology shown only as proximity) coming back.
    expect(world.roads).toHaveLength(scene.edges.length);
    const laid = new Set(world.roads.map((road) => `${road.from.ref}->${road.to.ref}`));
    for (const edge of scene.edges) expect(laid.has(`${edge.from}->${edge.to}`)).toBe(true);
  });

  it('stands a road exactly on its two endpoints', () => {
    for (const road of world.roads) {
      expect(road.from.node.x).toBe(scene.nodes[road.from.ref]?.x);
      expect(road.to.node.y).toBe(scene.nodes[road.to.ref]?.y);
    }
  });

  it('gives every node a tower and nothing else one', () => {
    expect(world.towers).toHaveLength(scene.nodes.length);
    for (const tower of world.towers) {
      expect(tower.node.x).toBe(scene.nodes[tower.ref]?.x);
      expect(tower.node.y).toBe(scene.nodes[tower.ref]?.y);
    }
  });

  it('sizes a footprint by loc alone, so the world and the map agree', () => {
    // ADR-0032 §9.7: a cap keyed to *local* spacing makes rendered size a
    // function of neighbourhood crowding, so two files of equal `loc` would
    // render at different sizes and the flat map's size channel would stop
    // being monotone. The scalar is **uniform**, which is the whole difference:
    // the ordering the size channel claims survives it exactly.
    for (const tower of world.towers) {
      expect(tower.footprint).toBeCloseTo(tower.node.radius * FOOTPRINT_SCALE, 9);
    }
    const sorted = [...world.towers].sort((a, b) => a.node.radius - b.node.radius);
    for (let i = 1; i < sorted.length; i++) {
      expect((sorted[i] as { footprint: number }).footprint).toBeGreaterThanOrEqual(
        (sorted[i - 1] as { footprint: number }).footprint,
      );
    }
  });

  it('stands the chronicle outside the map, on the bounds and nothing else', () => {
    // ADR-0033 decision 2. Its position must be a function of the *bounds*: a
    // commit's file set is Placement's answer key, so a marker placed among the
    // files it touched would be the board's own truth drawn on the ground.
    expect(world.chronicle.y).toBeLessThan(scene.bounds.minY);
    expect(world.chronicle.x).toBeCloseTo((scene.bounds.minX + scene.bounds.maxX) / 2, 9);
    for (const tower of world.towers) {
      const gap = Math.hypot(tower.node.x - world.chronicle.x, tower.node.y - world.chronicle.y);
      expect(gap).toBeGreaterThan(world.chronicle.radius + tower.footprint);
    }
  });

  it('spawns outside the city, clear of every tower', () => {
    for (const tower of world.towers) {
      const gap = Math.hypot(tower.node.x - world.spawn.x, tower.node.y - world.spawn.y);
      expect(gap).toBeGreaterThan(tower.footprint + HERO_RADIUS);
    }
  });

  it('finds only the towers within reach', () => {
    const first = world.towers[0];
    expect(first).toBeDefined();
    const found = near(world, first?.node.x ?? 0, first?.node.y ?? 0, 1);
    expect(found).toContain(first);
    for (const tower of world.towers) {
      const gap = Math.hypot(
        tower.node.x - (first?.node.x ?? 0),
        tower.node.y - (first?.node.y ?? 0),
      );
      expect(found.includes(tower)).toBe(gap <= 1 + tower.footprint);
    }
  });
});

describe('the pitch convention', () => {
  // Written because a session talked itself into believing the sign was
  // inverted, changed it, and broke a working camera — `toView`, `horizonY` and
  // the doc comment had all agreed. A wrong sign is a perfectly legal camera, so
  // the type system cannot see it and only a picture or an assertion can. These
  // are the assertions; the picture is `test:e2e`.
  it('looks up when pitch is positive and down when it is negative', () => {
    const ahead = (pitch: number): number =>
      project(eyeAt(0, 0, 0, pitch), VIEW, 0, -100, 0)?.point.y ?? Number.NaN;
    // A patch of ground 100 units ahead of an eye 20 units up sits below the
    // centre line when level. Tipping *down* to face it brings it up the
    // screen; tipping up pushes it further down and out of frame.
    expect(ahead(0)).toBeGreaterThan(VIEW.height / 2);
    expect(ahead(-0.5)).toBeLessThan(ahead(0));
    expect(ahead(0.5)).toBeGreaterThan(ahead(0));
  });

  it('raises the horizon up the screen as the eye tips down', () => {
    expect(horizonY(eyeAt(0, 0, 0, 0), VIEW)).toBeCloseTo(VIEW.height / 2, 6);
    expect(horizonY(eyeAt(0, 0, 0, -0.5), VIEW)).toBeLessThan(VIEW.height / 2);
    expect(horizonY(eyeAt(0, 0, 0, 0.5), VIEW)).toBeGreaterThan(VIEW.height / 2);
  });

  it('is the sign the third-person rig actually uses', () => {
    // The rig's own constant, so "we look down" is checked against the shipped
    // value rather than against a number retyped into a test.
    const eye = follow({ x: 0, y: 0, facing: 0 }, 46, 33, RIG_PITCH, 1.05);
    expect(eye.pitch).toBeLessThan(0);
    expect(horizonY(eye, VIEW)).toBeLessThan(VIEW.height / 2);
  });
});

describe('the mode holds its own state', () => {
  const scene = prepare(
    atlasWith(
      ['src/a.ts', 'src/b.ts', 'src/core/hub.ts'],
      [
        ['src/a.ts', 'src/core/hub.ts'],
        ['src/b.ts', 'src/core/hub.ts'],
      ],
    ),
  );

  it('stops walking the moment a modal takes the keyboard', () => {
    // A whole grade can be mouse-only, so releasing on the *next* keydown never
    // fires — measured in a playtest as the hero surveying 51 → 65 buildings
    // behind an open challenge panel.
    const mode = createWorldMode();
    mode.enter(scene, null);
    mode.keyDown('w');
    mode.advance(0);
    expect(mode.advance(500)).toBe(true);
    const walking = mode.hero();
    mode.releaseAll();
    expect(mode.advance(1000)).toBe(false);
    expect(mode.hero()).toEqual(walking);
  });

  it('will not let you walk off into an unmapped void', () => {
    // Twelve seconds of running reached `0 towers · 0 roads · 0 beacons` on an
    // unbounded plane, which reads as a broken product rather than a finished
    // one. The world has the atlas's edges because the layout does.
    const mode = createWorldMode();
    mode.enter(scene, null);
    mode.keyDown('s');
    mode.keyDown('shift');
    mode.advance(0);
    for (let frame = 1; frame <= 2000; frame++) mode.advance(frame * 16);
    const hero = mode.hero();
    expect(hero).not.toBeNull();
    const span = Math.max(
      scene.bounds.maxX - scene.bounds.minX,
      scene.bounds.maxY - scene.bounds.minY,
    );
    // Bounded, and bounded by something related to the map rather than by a
    // number: thirty seconds of running is far enough to leave any atlas.
    expect(Math.abs(hero?.x ?? 0)).toBeLessThan(span + 1000);
    expect(Math.abs(hero?.y ?? 0)).toBeLessThan(span + 1000);
    const world = buildWorld(scene);
    expect(hero?.y ?? 0).toBeLessThanOrEqual(world.bounds.maxY + 71);
  });
});
