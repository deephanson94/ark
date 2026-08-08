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
import { NORTH, rotate } from '../../src/player/camera.js';
import { DEFAULT_ORBIT, OVERHEAD, columns, pickColumn, project, tip } from '../../src/player/orbit.js';

const camera: Camera = { x: 40, y: -15, scale: 1.7, bearing: NORTH };
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
  it('reproduces the flat map exactly when looking straight down, at any heading', () => {
    // ADR-0009's invariant, as an equality rather than a promise — and since
    // the flat map learned to turn, at *every* heading rather than only at
    // north. This is the assertion that earns the single shared bearing: the
    // two views cannot disagree about which way the world is facing, because
    // there is one number and looking straight down is the same picture.
    for (const bearing of [0, 0.9, Math.PI / 2, -2.5]) {
      const turned = rotate(camera, bearing);
      for (const point of [node(0, 0, 0), node(120, -80, 6), node(-33.5, 12.25, 3)]) {
        const flat = worldToScreen(turned, viewport, point);
        const { base, top } = project(turned, viewport, OVERHEAD, point);
        expect(base.x).toBeCloseTo(flat.x, 10);
        expect(base.y).toBeCloseTo(flat.y, 10);
        // ...and height contributes nothing from overhead, however tall.
        expect(top.x).toBeCloseTo(flat.x, 10);
        expect(top.y).toBeCloseTo(flat.y, 10);
      }
    }
  });

  it('flattens a tall column from overhead even when the rise is non-zero', () => {
    // The assertion above looked like it covered this and did not: `OVERHEAD`
    // sets `rise: 0`, so "height contributes nothing" was testing 0 × anything.
    // A mutation deleting the `cos(pitch)` factor from the lift survived the
    // whole file. This is the state a player actually reaches — drag the pitch
    // to the clamp and `rise` is still 26.
    const straightDown = { pitch: Math.PI / 2, rise: 26 };
    const tall = node(30, -20, 9);
    const { base, top } = project(camera, viewport, straightDown, tall);
    expect(top.y).toBeCloseTo(base.y, 6);
    expect(top.y).toBeCloseTo(worldToScreen(camera, viewport, tall).y, 6);
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
    // The liveness of the whole rung in one line: if the bearing changes
    // nothing, the parallax the evidence rests on does not exist.
    const still = project(camera, viewport, DEFAULT_ORBIT, node(120, 40, 3));
    const turned = project(rotate(camera, 0.6), viewport, DEFAULT_ORBIT, node(120, 40, 3));
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
    const at = (bearing: number): { x: number; y: number } =>
      project(rotate(camera, bearing), viewport, DEFAULT_ORBIT, centre).base;
    const reference = at(0);
    expect(reference.x).toBeCloseTo(viewport.width / 2, 8);
    for (const bearing of [0.4, 1.9, -2.2]) {
      expect(at(bearing).x).toBeCloseTo(reference.x, 8);
      expect(at(bearing).y).toBeCloseTo(reference.y, 8);
    }
    // ...and from directly overhead it is the viewport middle exactly, which is
    // the flat-map equality the first assertion in this file rests on.
    expect(project(camera, viewport, OVERHEAD, centre).base.y).toBeCloseTo(viewport.height / 2, 8);
  });
});

describe('tip', () => {
  it('clamps pitch so the camera never goes under the map', () => {
    let orbit = DEFAULT_ORBIT;
    for (let i = 0; i < 50; i++) orbit = tip(orbit, -1);
    expect(orbit.pitch).toBeGreaterThan(0);
    for (let i = 0; i < 50; i++) orbit = tip(orbit, 1);
    expect(orbit.pitch).toBeLessThanOrEqual(Math.PI / 2);
  });

  it('has nothing to say about which way the eye faces', () => {
    // The orbit carried its own `yaw` until the flat map learned to turn. Two
    // headings for one world would mean `o` snapping the view back to whatever
    // this record remembered — a rule living twice, which is the shape of most
    // of the defects this project has had to fix. Turning is the camera's.
    expect(Object.keys(tip(DEFAULT_ORBIT, 0.1))).toEqual(['pitch', 'rise']);
  });
});

describe('columns', () => {
  it('draws far to near, so nearer columns cover further ones', () => {
    // Painter's algorithm is *exact* here because columns stand on a plane and
    // never interpenetrate — which is the reason this view needs no depth
    // buffer and therefore no WebGL yet.
    const near = node(0, 90, 2, 'n:00000000000a');
    const far = node(0, -90, 2, 'n:00000000000b');
    const drawn = columns([near, far], { x: 0, y: 0, scale: 1, bearing: NORTH }, viewport, DEFAULT_ORBIT);
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


describe('pickColumn', () => {
  const orbit = DEFAULT_ORBIT;

  it('finds the column whose top the pointer is on', () => {
    const target = node(50, 20, 4, 'n:00000000000a');
    const { top } = project(camera, viewport, orbit, target);
    expect(pickColumn([target], camera, viewport, orbit, top)?.id).toBe('n:00000000000a');
  });

  it('does not hit the footing of a tall column — you click what you see', () => {
    // The defect this function replaced, in one assertion. The flat inverse
    // resolves the pointer to a *ground* position, so aiming at a tall column's
    // base used to select it; the disc the player can actually see and aim at
    // is the top. A pointer on the base of a raised column hits nothing.
    const tall = node(50, 20, 6, 'n:00000000000a');
    const { base, top } = project(camera, viewport, orbit, tall);
    expect(base.y).not.toBeCloseTo(top.y, 1);
    expect(pickColumn([tall], camera, viewport, orbit, base)).toBeNull();
  });

  it('picks the nearest column when two overlap, not whichever came first', () => {
    // Painter's order read backwards: the column drawn last is on top, so it is
    // the one the click belongs to.
    //
    // The overlap is **constructed, not hoped for**. A tall near column and a
    // short far one land on the same pixel exactly when
    // `Δy · sin(pitch) = Δelevation · rise · cos(pitch)`, i.e.
    // `Δy = Δelevation · rise / tan(pitch)`. The first draft of this test
    // hedged with a conditional instead and therefore asserted nothing — a
    // mutation reversing the tie-break survived it.
    const centred: Camera = { x: 0, y: 0, scale: 1, bearing: NORTH };
    const gap = (4 * orbit.rise) / Math.tan(orbit.pitch);
    const far = node(0, 0, 0, 'n:00000000000b');
    const near = node(0, gap, 4, 'n:00000000000a');
    const farTop = project(centred, viewport, orbit, far).top;
    const nearTop = project(centred, viewport, orbit, near).top;
    // The premise: they really do coincide, or the assertion below is vacuous.
    expect(Math.hypot(nearTop.x - farTop.x, nearTop.y - farTop.y)).toBeLessThan(0.001);
    expect(pickColumn([far, near], centred, viewport, orbit, farTop)?.id).toBe('n:00000000000a');
    // ...and the input order must not decide it either.
    expect(pickColumn([near, far], centred, viewport, orbit, farTop)?.id).toBe('n:00000000000a');
  });

  it('returns null on empty space, rather than the closest thing anywhere', () => {
    const only = node(0, 0, 3);
    const { top } = project(camera, viewport, orbit, only);
    expect(pickColumn([only], camera, viewport, orbit, { x: top.x + 400, y: top.y + 300 })).toBeNull();
  });

  it('agrees with the flat map when the camera is overhead', () => {
    // The two pickers must not disagree at the position where the two views are
    // the same picture, or `o` would change what a click means.
    const straightDown = { pitch: Math.PI / 2, rise: 26 };
    const target = node(12, -7, 5, 'n:00000000000a');
    const flat = worldToScreen(camera, viewport, target);
    expect(pickColumn([target], camera, viewport, straightDown, flat)?.id).toBe('n:00000000000a');
  });
});
