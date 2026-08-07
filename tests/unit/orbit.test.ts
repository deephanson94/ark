/**
 * The orbit projection.
 *
 * One assertion here matters more than the rest: **straight down is the flat
 * map, to the pixel.** ADR-0009's invariant is that a third dimension must be
 * additive and preserve today's X,Y, because a re-layout scrambles every map
 * anyone has learned — and the strongest possible form of that promise is that
 * the flat map is a *position of this camera* rather than a different renderer
 * that happens to agree.
 */

import { describe, expect, it } from 'vitest';

import type { Camera, Viewport } from '../../src/player/camera.js';
import { worldToScreen } from '../../src/player/camera.js';
import type { SceneNode } from '../../src/player/scene.js';
import { DEFAULT_ORBIT, OVERHEAD, columns, project, turn } from '../../src/player/orbit.js';

const camera: Camera = { x: 40, y: -15, scale: 1.7 };
const viewport: Viewport = { width: 900, height: 600 };

function node(x: number, y: number, elevation: number, id = 'n:000000000001'): SceneNode {
  return {
    ref: 0,
    id,
    path: 'src/x.ts',
    label: 'x.ts',
    x,
    y,
    radius: 4,
    regionIndex: 0,
    dependentCount: 0,
    elevation,
  };
}

describe('project', () => {
  it('reproduces the flat map exactly when looking straight down', () => {
    // ADR-0009's invariant, as an equality rather than a promise.
    for (const point of [node(0, 0, 0), node(120, -80, 6), node(-33.5, 12.25, 3)]) {
      const flat = worldToScreen(camera, viewport, point);
      const { base, top } = project(camera, viewport, OVERHEAD, point);
      expect(base.x).toBeCloseTo(flat.x, 10);
      expect(base.y).toBeCloseTo(flat.y, 10);
      // ...and height contributes nothing from overhead, however tall.
      expect(top.x).toBeCloseTo(flat.x, 10);
      expect(top.y).toBeCloseTo(flat.y, 10);
    }
  });

  it('lifts a taller file further from its own footing', () => {
    const low = project(camera, viewport, DEFAULT_ORBIT, node(10, 10, 1));
    const high = project(camera, viewport, DEFAULT_ORBIT, node(10, 10, 6));
    // Same ground position...
    expect(high.base).toEqual(low.base);
    // ...and further up the screen, which is the only claim the view makes.
    expect(high.top.y).toBeLessThan(low.top.y);
    expect(low.top.y).toBeLessThan(low.base.y);
  });

  it('foreshortens the away-axis as the camera tips down toward the horizon', () => {
    // What makes a tipped view read as tipped. Two files the same distance
    // apart north-to-south must land *closer together* on screen at a low pitch
    // than from overhead — without this the scene is a flat map with sticks on
    // it. A mutation run found nothing was checking it: the overhead test
    // passes either way, because sin(π/2) is 1.
    const near = node(0, -60, 0);
    const far = node(0, 60, 0);
    const spread = (pitch: number): number =>
      Math.abs(
        project(camera, viewport, { ...DEFAULT_ORBIT, pitch }, far).base.y -
          project(camera, viewport, { ...DEFAULT_ORBIT, pitch }, near).base.y,
      );
    expect(spread(0.3)).toBeLessThan(spread(1.0));
    expect(spread(1.0)).toBeLessThan(spread(Math.PI / 2));
    // And overhead is the un-foreshortened limit: the full world separation.
    expect(spread(Math.PI / 2)).toBeCloseTo(120 * camera.scale, 8);
  });

  it('leaves a ground-level file standing on its footing', () => {
    const flat = project(camera, viewport, DEFAULT_ORBIT, node(10, 10, 0));
    expect(flat.top).toEqual(flat.base);
  });

  it('turning moves the world', () => {
    // The liveness of the whole rung in one line: if yaw changes nothing, the
    // parallax the evidence rests on does not exist.
    const still = project(camera, viewport, DEFAULT_ORBIT, node(120, 40, 3));
    const turned = project(camera, viewport, turn(DEFAULT_ORBIT, 0.6, 0), node(120, 40, 3));
    expect(turned.base.x).not.toBeCloseTo(still.base.x, 3);
  });

  it('keeps the camera centre fixed as the world turns', () => {
    // Rotation is about the camera's centre, not the world origin — otherwise
    // turning slides whatever you were looking at off the screen.
    //
    // Stated as **independence from yaw**, not as "lands at the viewport
    // middle". The first draft asserted the latter and it failed the moment
    // headroom was added — a vertical bias that depends only on *pitch*, which
    // leaves the rotation property untouched. The test was over-specified: it
    // was pinning where the camera points as well as what turning does to it.
    const centre = node(camera.x, camera.y, 0);
    const at = (yaw: number): { x: number; y: number } =>
      project(camera, viewport, turn(DEFAULT_ORBIT, yaw, 0), centre).base;
    const reference = at(0);
    expect(reference.x).toBeCloseTo(viewport.width / 2, 8);
    for (const yaw of [0.4, 1.9, -2.2]) {
      expect(at(yaw).x).toBeCloseTo(reference.x, 8);
      expect(at(yaw).y).toBeCloseTo(reference.y, 8);
    }
    // ...and from directly overhead it is the viewport middle exactly, which is
    // the flat-map equality the first assertion in this file rests on.
    expect(project(camera, viewport, OVERHEAD, centre).base.y).toBeCloseTo(viewport.height / 2, 8);
  });
});

describe('turn', () => {
  it('clamps pitch so the camera never goes under the map', () => {
    let orbit = DEFAULT_ORBIT;
    for (let i = 0; i < 50; i++) orbit = turn(orbit, 0, -1);
    expect(orbit.pitch).toBeGreaterThan(0);
    for (let i = 0; i < 50; i++) orbit = turn(orbit, 0, 1);
    expect(orbit.pitch).toBeLessThanOrEqual(Math.PI / 2);
  });

  it('does not clamp yaw — the world turns all the way round', () => {
    expect(turn(DEFAULT_ORBIT, 100, 0).yaw).toBe(DEFAULT_ORBIT.yaw + 100);
  });
});

describe('columns', () => {
  it('draws far to near, so nearer columns cover further ones', () => {
    // Painter's algorithm is *exact* here because columns stand on a plane and
    // never interpenetrate — which is the reason this view needs no depth
    // buffer and therefore no WebGL yet.
    const near = node(0, 90, 2, 'n:00000000000a');
    const far = node(0, -90, 2, 'n:00000000000b');
    const drawn = columns([near, far], { x: 0, y: 0, scale: 1 }, viewport, DEFAULT_ORBIT);
    expect(drawn.map((c) => c.node.id)).toEqual(['n:00000000000b', 'n:00000000000a']);
    // And the nearer one really is lower on screen, which is what "nearer" means
    // in a tipped view — the assertion above would pass on a reversed sort if
    // this were not checked.
    expect(drawn[1]?.base.y).toBeGreaterThan(drawn[0]?.base.y ?? 0);
  });

  it('breaks a depth tie on id, so two machines draw the same frame', () => {
    const a = node(-10, 0, 1, 'n:00000000000a');
    const b = node(10, 0, 1, 'n:00000000000b');
    const forwards = columns([a, b], camera, viewport, DEFAULT_ORBIT).map((c) => c.node.id);
    const backwards = columns([b, a], camera, viewport, DEFAULT_ORBIT).map((c) => c.node.id);
    expect(forwards).toEqual(backwards);
  });
});
