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
