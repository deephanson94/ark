import { describe, expect, it } from 'vitest';

import {
  MAX_SCALE,
  MIN_SCALE,
  NORTH,
  boundsOf,
  facingNorth,
  fit,
  northDegrees,
  pan,
  pivotAround,
  rotate,
  screenToWorld,
  worldToScreen,
  zoomAt,
 sameCamera,} from '../../src/player/camera.js';
import type { Camera, Viewport } from '../../src/player/camera.js';

const VIEWPORT: Viewport = { width: 800, height: 600 };
const CAMERA: Camera = { x: 10, y: -20, scale: 2, bearing: NORTH };
/** Headings to check everything at. Deliberately not multiples of π/2. */
const BEARINGS = [0, 0.7, Math.PI / 2, 2.4, -1.1, 5.9];

describe('projection', () => {
  it('puts the camera centre at the middle of the viewport', () => {
    expect(worldToScreen(CAMERA, VIEWPORT, { x: 10, y: -20 })).toEqual({ x: 400, y: 300 });
  });

  it('round-trips world → screen → world, at every heading', () => {
    // This one is deliberately weak on its own — it passes if *both* directions
    // ignore the bearing — and it is here for the property it does pin: the
    // inverse is the exact inverse. That is the function whose absence cut the
    // orbit's scar, where the flat inverse drove hover and click over a rotated
    // view and a click wrote the wrong file into the saved `surveyed` set.
    // `turns the world` below is what proves the bearing is read at all.
    for (const bearing of BEARINGS) {
      const camera = { ...CAMERA, bearing };
      for (const point of [
        { x: 0, y: 0 },
        { x: 137.25, y: -84.5 },
        { x: -1000, y: 2000 },
      ]) {
        const screen = worldToScreen(camera, VIEWPORT, point);
        const back = screenToWorld(camera, VIEWPORT, screen);
        expect(back.x).toBeCloseTo(point.x, 9);
        expect(back.y).toBeCloseTo(point.y, 9);
      }
    }
  });

  it('scales distances by the camera scale', () => {
    const a = worldToScreen(CAMERA, VIEWPORT, { x: 0, y: 0 });
    const b = worldToScreen(CAMERA, VIEWPORT, { x: 1, y: 0 });
    expect(b.x - a.x).toBe(2);
  });
});

describe('bearing', () => {
  it('turns the world', () => {
    // The liveness of the whole feature in one assertion, and the one every
    // other test in this file passes without: if the bearing reaches no
    // coordinate, the map does not rotate and the compass is a dial spinning
    // over a still picture — which is `npm run raster`'s exact failure, an
    // instrument reading confidently about something that did not happen.
    const point = { x: 140, y: 30 };
    const still = worldToScreen(CAMERA, VIEWPORT, point);
    const turned = worldToScreen({ ...CAMERA, bearing: 0.7 }, VIEWPORT, point);
    expect(Math.hypot(turned.x - still.x, turned.y - still.y)).toBeGreaterThan(1);
  });

  it('is a rotation: every distance from the centre of the view is preserved', () => {
    // Rigidity. A rotation that also scaled would move the world too, and pass
    // the assertion above while quietly making the map a different map — which
    // pillar 4 loses, because the layout is the thing being remembered.
    const point = { x: 140, y: 30 };
    const centre = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const reference = worldToScreen(CAMERA, VIEWPORT, point);
    const radius = Math.hypot(reference.x - centre.x, reference.y - centre.y);
    for (const bearing of BEARINGS) {
      const at = worldToScreen({ ...CAMERA, bearing }, VIEWPORT, point);
      expect(Math.hypot(at.x - centre.x, at.y - centre.y)).toBeCloseTo(radius, 9);
    }
  });

  it('turns clockwise: at a quarter turn, north points right and east points down', () => {
    // **The one place the sign convention is pinned.** There are four hand-rolled
    // copies of this rotation in the player — here, the inverse, `orbit.project`
    // and the compass's CSS — and consistency tests cannot catch all four being
    // wrong together. Only an anchor can, so this states the picture in words a
    // human can check against a screenshot: bearing is clockwise.
    const quarter = { ...CAMERA, bearing: Math.PI / 2 };
    const north = worldToScreen(quarter, VIEWPORT, { x: CAMERA.x, y: CAMERA.y - 50 });
    expect(north).toEqual({ x: 400 + 100, y: 300 });
    const east = worldToScreen(quarter, VIEWPORT, { x: CAMERA.x + 50, y: CAMERA.y });
    expect(east).toEqual({ x: 400, y: 300 + 100 });
  });

  it('puts the compass needle where the map actually puts north', () => {
    // The compass computes its angle from `northDegrees` and the canvas
    // computes its picture from `worldToScreen`. If those two ever disagree the
    // dial becomes a decoy instrument — it would keep turning over a map that
    // had stopped — so they are checked against each other here.
    for (const bearing of BEARINGS) {
      const camera = { ...CAMERA, bearing };
      const up = worldToScreen(camera, VIEWPORT, { x: camera.x, y: camera.y - 100 });
      const dx = up.x - VIEWPORT.width / 2;
      const dy = up.y - VIEWPORT.height / 2;
      const needle = (northDegrees(bearing) * Math.PI) / 180;
      // A dial rotated clockwise by θ points its top marker at (sin θ, −cos θ)
      // in screen coordinates, where y runs down.
      expect(dx).toBeCloseTo(Math.hypot(dx, dy) * Math.sin(needle), 6);
      expect(dy).toBeCloseTo(-Math.hypot(dx, dy) * Math.cos(needle), 6);
    }
  });

  it('accumulates without wrapping, so an animation never spins the long way', () => {
    let camera = CAMERA;
    for (let i = 0; i < 5; i++) camera = rotate(camera, 2);
    expect(camera.bearing).toBe(10);
  });

  it('faces north by the shortest way round, not by unwinding', () => {
    for (const bearing of [0.4, 7.9, -3.1, 19]) {
      const home = facingNorth({ ...CAMERA, bearing });
      // A multiple of a full turn — the same picture as bearing 0...
      expect(Math.abs(home / (Math.PI * 2) - Math.round(home / (Math.PI * 2)))).toBeCloseTo(0, 9);
      expect(northDegrees(home)).toBeCloseTo(0, 6);
      // ...and never further than half a turn away, which is what makes the
      // animation to it read as straightening rather than as rewinding.
      expect(Math.abs(home - bearing)).toBeLessThanOrEqual(Math.PI + 1e-9);
    }
  });
});

describe('pivotAround', () => {
  it('holds one point on screen while the world turns about it', () => {
    // What makes the between-challenge turn read as the world revolving around
    // the file you just proved: its disc does not move a pixel.
    const anchor = { x: 90, y: 40 };
    const at = worldToScreen(CAMERA, VIEWPORT, anchor);
    for (const bearing of BEARINGS) {
      const turned = pivotAround(CAMERA, VIEWPORT, anchor, at, bearing);
      const after = worldToScreen(turned, VIEWPORT, anchor);
      expect(after.x).toBeCloseTo(at.x, 8);
      expect(after.y).toBeCloseTo(at.y, 8);
      expect(turned.bearing).toBe(bearing);
      expect(turned.scale).toBe(CAMERA.scale);
    }
  });

  it('moves everything else', () => {
    // Or it is not a turn at all — it is a camera that pivoted and drew the
    // same frame.
    const anchor = { x: 90, y: 40 };
    const at = worldToScreen(CAMERA, VIEWPORT, anchor);
    const elsewhere = { x: -60, y: 120 };
    const before = worldToScreen(CAMERA, VIEWPORT, elsewhere);
    const after = worldToScreen(
      pivotAround(CAMERA, VIEWPORT, anchor, at, 1.2),
      VIEWPORT,
      elsewhere,
    );
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(1);
  });
});

describe('pan', () => {
  it('moves the world with the pointer, not against it', () => {
    // Dragging right by 100px should bring content on the left into view,
    // which means the camera centre moves left.
    const moved = pan(CAMERA, 100, 0);
    expect(moved.x).toBeLessThan(CAMERA.x);
  });

  it('moves content by exactly the drag, at every heading', () => {
    // The property that makes a turned map still feel like a map. The drag
    // arrives in screen pixels; un-turning it is the whole of `pan`'s new
    // arithmetic, and without that the map slides off at an angle to the
    // pointer everywhere except north.
    const point = { x: -30, y: 75 };
    for (const bearing of BEARINGS) {
      const camera = { ...CAMERA, bearing };
      const before = worldToScreen(camera, VIEWPORT, point);
      const after = worldToScreen(pan(camera, 40, -25), VIEWPORT, point);
      expect(after.x - before.x).toBeCloseTo(40, 8);
      expect(after.y - before.y).toBeCloseTo(-25, 8);
    }
  });

  it('leaves the heading alone', () => {
    expect(pan({ ...CAMERA, bearing: 1.3 }, 10, 10).bearing).toBe(1.3);
  });

  it('moves less in world units when zoomed in', () => {
    const near = pan({ ...CAMERA, scale: 4 }, 100, 0);
    const far = pan({ ...CAMERA, scale: 1 }, 100, 0);
    expect(Math.abs(near.x - CAMERA.x)).toBeLessThan(Math.abs(far.x - CAMERA.x));
  });
});

describe('zoomAt', () => {
  it('keeps the world point under the cursor fixed, at every heading', () => {
    // The one property that makes zooming feel like a map rather than a fight.
    // Pinned at non-zero bearings because `zoomAt` is correct under rotation
    // only by construction — it is written entirely in terms of `screenToWorld`
    // — and pinned at bearing 0 alone it would stay green forever if the
    // inverse ever forgot the bearing.
    const anchor = { x: 640, y: 120 };
    for (const bearing of BEARINGS) {
      const camera = { ...CAMERA, bearing };
      const before = screenToWorld(camera, VIEWPORT, anchor);
      const zoomed = zoomAt(camera, VIEWPORT, anchor, 1.8);
      expect(zoomed.bearing).toBe(bearing);
      const after = screenToWorld(zoomed, VIEWPORT, anchor);
      expect(after.x).toBeCloseTo(before.x, 9);
      expect(after.y).toBeCloseTo(before.y, 9);
    }
  });

  it('holds the anchor across a zoom in and back out', () => {
    const anchor = { x: 100, y: 500 };
    const before = screenToWorld(CAMERA, VIEWPORT, anchor);
    const there = zoomAt(CAMERA, VIEWPORT, anchor, 2);
    const back = zoomAt(there, VIEWPORT, anchor, 0.5);
    const after = screenToWorld(back, VIEWPORT, anchor);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('clamps at both ends and stops changing there', () => {
    const wayIn = zoomAt(CAMERA, VIEWPORT, { x: 400, y: 300 }, 1e6);
    expect(wayIn.scale).toBe(MAX_SCALE);
    const wayOut = zoomAt(CAMERA, VIEWPORT, { x: 400, y: 300 }, 1e-6);
    expect(wayOut.scale).toBe(MIN_SCALE);
    expect(zoomAt(wayIn, VIEWPORT, { x: 400, y: 300 }, 2)).toBe(wayIn);
  });
});

describe('boundsOf and fit', () => {
  it('bounds a point cloud', () => {
    expect(boundsOf([{ x: -3, y: 4 }, { x: 9, y: -2 }])).toEqual({
      minX: -3,
      minY: -2,
      maxX: 9,
      maxY: 4,
    });
  });

  it('gives a usable box for an empty atlas rather than infinities', () => {
    const bounds = boundsOf([]);
    expect(Number.isFinite(bounds.minX)).toBe(true);
    expect(bounds.maxX).toBeGreaterThan(bounds.minX);
  });

  it('centres the content and fits it inside the viewport', () => {
    const bounds = { minX: -100, minY: -50, maxX: 100, maxY: 50 };
    const camera = fit(bounds, VIEWPORT, NORTH, 0);
    expect(camera.x).toBe(0);
    expect(camera.y).toBe(0);
    // Height is the binding constraint: 600/100 = 6 vs 800/200 = 4.
    expect(camera.scale).toBe(4);
  });

  it('leaves the margin it was asked for', () => {
    const bounds = { minX: 0, minY: 0, maxX: 200, maxY: 200 };
    const camera = fit(bounds, VIEWPORT, NORTH, 100);
    const corner = worldToScreen(camera, VIEWPORT, { x: 0, y: 0 });
    expect(corner.x).toBeGreaterThanOrEqual(100);
    expect(corner.y).toBeGreaterThanOrEqual(100);
  });

  it('survives a degenerate single-point atlas', () => {
    const camera = fit({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, VIEWPORT, NORTH);
    expect(Number.isFinite(camera.scale)).toBe(true);
    expect(camera.scale).toBeLessThanOrEqual(MAX_SCALE);
  });

  it('keeps the whole atlas on screen at any heading', () => {
    // `f` is the control that says "show me all of it", and a turned square
    // needs √2 of its own width. Fitting the un-turned extent would clip the
    // corners of the overview ADR-0009's D1 promises stays instantly readable —
    // silently, and only when the map is turned.
    const bounds = { minX: -100, minY: -50, maxX: 100, maxY: 50 };
    for (const bearing of BEARINGS) {
      const camera = fit(bounds, VIEWPORT, bearing, 0);
      expect(camera.bearing).toBe(bearing);
      for (const corner of [
        { x: bounds.minX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.minY },
        { x: bounds.minX, y: bounds.maxY },
        { x: bounds.maxX, y: bounds.maxY },
      ]) {
        const at = worldToScreen(camera, VIEWPORT, corner);
        expect(at.x).toBeGreaterThanOrEqual(-1e-9);
        expect(at.x).toBeLessThanOrEqual(VIEWPORT.width + 1e-9);
        expect(at.y).toBeGreaterThanOrEqual(-1e-9);
        expect(at.y).toBeLessThanOrEqual(VIEWPORT.height + 1e-9);
      }
    }
  });

  it('zooms out to make room for a turned map', () => {
    const square = { minX: -100, minY: -100, maxX: 100, maxY: 100 };
    expect(fit(square, VIEWPORT, Math.PI / 4, 0).scale).toBeLessThan(
      fit(square, VIEWPORT, NORTH, 0).scale,
    );
  });
});


/**
 * `sameCamera` is one guard with two directions, and only one of them was
 * reachable from any suite.
 *
 * `onClose` gives back the pan a board took **only if the camera is still
 * exactly where the board left it** — the e2e proves the restore happens, and
 * never moves the camera behind the open board, so mutating this to `() => true`
 * (restore always, stomping a deliberate mid-board pan) left every suite green.
 * That is the count-the-branch rule: a protective condition nothing exercises.
 */
describe('sameCamera', () => {
  const view = { x: 10, y: -4, scale: 1.5, bearing: 0.25 };

  it('is true for a view nothing has touched', () => {
    expect(sameCamera(view, { ...view })).toBe(true);
  });

  it('is false when any single field moved', () => {
    expect(sameCamera(view, { ...view, x: 10.0001 })).toBe(false);
    expect(sameCamera(view, { ...view, y: -3.9999 })).toBe(false);
    expect(sameCamera(view, { ...view, scale: 1.5001 })).toBe(false);
    expect(sameCamera(view, { ...view, bearing: 0.2501 })).toBe(false);
  });

  it('refuses a view the player has dragged', () => {
    // Through the real `pan`, not hand-written coordinates: the guard's whole
    // job is to tell a camera the *player* produced from one the board did, and
    // both are produced by this arithmetic.
    expect(sameCamera(view, pan(view, 37, 11))).toBe(false);
  });

  it('accepts a drag the player exactly reversed', () => {
    // Stated because it is the one case exact equality gets "wrong", and it is
    // harmless: pan out and back lands on the same numbers, so `onClose`
    // restores — to the view already on screen. A no-op, not a theft. The first
    // draft of this file asserted the *opposite*, on an assumption about
    // floating point that this arithmetic does not have; the assertion below is
    // what the code does.
    expect(sameCamera(view, pan(pan(view, 37, 11), -37, -11))).toBe(true);
  });
});
