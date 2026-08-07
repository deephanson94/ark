import { describe, expect, it } from 'vitest';

import {
  MAX_SCALE,
  MIN_SCALE,
  boundsOf,
  contains,
  fit,
  pan,
  screenToWorld,
  visibleBounds,
  worldToScreen,
  zoomAt,
} from '../../src/player/camera.js';
import type { Camera, Viewport } from '../../src/player/camera.js';

const VIEWPORT: Viewport = { width: 800, height: 600 };
const CAMERA: Camera = { x: 10, y: -20, scale: 2 };

describe('projection', () => {
  it('puts the camera centre at the middle of the viewport', () => {
    expect(worldToScreen(CAMERA, VIEWPORT, { x: 10, y: -20 })).toEqual({ x: 400, y: 300 });
  });

  it('round-trips world → screen → world', () => {
    for (const point of [
      { x: 0, y: 0 },
      { x: 137.25, y: -84.5 },
      { x: -1000, y: 2000 },
    ]) {
      const screen = worldToScreen(CAMERA, VIEWPORT, point);
      const back = screenToWorld(CAMERA, VIEWPORT, screen);
      expect(back.x).toBeCloseTo(point.x, 9);
      expect(back.y).toBeCloseTo(point.y, 9);
    }
  });

  it('scales distances by the camera scale', () => {
    const a = worldToScreen(CAMERA, VIEWPORT, { x: 0, y: 0 });
    const b = worldToScreen(CAMERA, VIEWPORT, { x: 1, y: 0 });
    expect(b.x - a.x).toBe(2);
  });
});

describe('pan', () => {
  it('moves the world with the pointer, not against it', () => {
    // Dragging right by 100px should bring content on the left into view,
    // which means the camera centre moves left.
    const moved = pan(CAMERA, 100, 0);
    expect(moved.x).toBeLessThan(CAMERA.x);
  });

  it('moves less in world units when zoomed in', () => {
    const near = pan({ ...CAMERA, scale: 4 }, 100, 0);
    const far = pan({ ...CAMERA, scale: 1 }, 100, 0);
    expect(Math.abs(near.x - CAMERA.x)).toBeLessThan(Math.abs(far.x - CAMERA.x));
  });
});

describe('zoomAt', () => {
  it('keeps the world point under the cursor fixed', () => {
    // The one property that makes zooming feel like a map rather than a fight.
    const anchor = { x: 640, y: 120 };
    const before = screenToWorld(CAMERA, VIEWPORT, anchor);
    const zoomed = zoomAt(CAMERA, VIEWPORT, anchor, 1.8);
    const after = screenToWorld(zoomed, VIEWPORT, anchor);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
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
    const camera = fit(bounds, VIEWPORT, 0);
    expect(camera.x).toBe(0);
    expect(camera.y).toBe(0);
    // Height is the binding constraint: 600/100 = 6 vs 800/200 = 4.
    expect(camera.scale).toBe(4);
  });

  it('leaves the margin it was asked for', () => {
    const bounds = { minX: 0, minY: 0, maxX: 200, maxY: 200 };
    const camera = fit(bounds, VIEWPORT, 100);
    const corner = worldToScreen(camera, VIEWPORT, { x: 0, y: 0 });
    expect(corner.x).toBeGreaterThanOrEqual(100);
    expect(corner.y).toBeGreaterThanOrEqual(100);
  });

  it('survives a degenerate single-point atlas', () => {
    const camera = fit({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, VIEWPORT);
    expect(Number.isFinite(camera.scale)).toBe(true);
    expect(camera.scale).toBeLessThanOrEqual(MAX_SCALE);
  });
});

describe('visibleBounds', () => {
  it('covers exactly the viewport at scale 1', () => {
    const bounds = visibleBounds({ x: 0, y: 0, scale: 1 }, VIEWPORT);
    expect(bounds).toEqual({ minX: -400, minY: -300, maxX: 400, maxY: 300 });
  });

  it('shrinks as you zoom in', () => {
    const near = visibleBounds({ x: 0, y: 0, scale: 4 }, VIEWPORT);
    expect(near.maxX - near.minX).toBeLessThan(800);
  });

  it('grows by the padding it is given', () => {
    const padded = visibleBounds({ x: 0, y: 0, scale: 1 }, VIEWPORT, 50);
    expect(padded.minX).toBe(-450);
  });

  it('agrees with contains', () => {
    const bounds = visibleBounds(CAMERA, VIEWPORT);
    expect(contains(bounds, { x: CAMERA.x, y: CAMERA.y })).toBe(true);
    expect(contains(bounds, { x: 1e9, y: 0 })).toBe(false);
  });
});
