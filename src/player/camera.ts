/**
 * The camera: a pan/zoom transform over atlas coordinates.
 *
 * Pure — no canvas, no DOM, no listeners. Everything here is arithmetic on a
 * `{x, y, scale}` triple, which is why the interaction model is unit-testable
 * without a browser.
 *
 * Atlas coordinates come from the indexer and never change (NORTH-STAR §7:
 * same repo ⇒ same map). The camera is the only thing that moves.
 */

export interface Camera {
  /** World coordinate at the centre of the viewport. */
  readonly x: number;
  readonly y: number;
  /** Screen pixels per world unit. */
  readonly scale: number;
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 8;

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function worldToScreen(camera: Camera, viewport: Viewport, point: Point): Point {
  return {
    x: (point.x - camera.x) * camera.scale + viewport.width / 2,
    y: (point.y - camera.y) * camera.scale + viewport.height / 2,
  };
}

export function screenToWorld(camera: Camera, viewport: Viewport, point: Point): Point {
  return {
    x: (point.x - viewport.width / 2) / camera.scale + camera.x,
    y: (point.y - viewport.height / 2) / camera.scale + camera.y,
  };
}

/** Drag: move the world under the pointer by a screen-space delta. */
export function pan(camera: Camera, dx: number, dy: number): Camera {
  return { ...camera, x: camera.x - dx / camera.scale, y: camera.y - dy / camera.scale };
}

/**
 * Zoom about a fixed screen point — the world coordinate under the cursor stays
 * under the cursor. Anything else feels like the map is fighting you.
 */
export function zoomAt(
  camera: Camera,
  viewport: Viewport,
  anchor: Point,
  factor: number,
): Camera {
  const scale = clampScale(camera.scale * factor);
  if (scale === camera.scale) return camera;
  const before = screenToWorld(camera, viewport, anchor);
  const after = screenToWorld({ ...camera, scale }, viewport, anchor);
  return { x: camera.x + (before.x - after.x), y: camera.y + (before.y - after.y), scale };
}

export function boundsOf(points: readonly Point[]): Bounds {
  if (points.length === 0) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return { minX, minY, maxX, maxY };
}

/** A camera that frames `bounds` inside `viewport`, with a margin in pixels. */
export function fit(bounds: Bounds, viewport: Viewport, margin = 64): Camera {
  const width = Math.max(1e-6, bounds.maxX - bounds.minX);
  const height = Math.max(1e-6, bounds.maxY - bounds.minY);
  const usableWidth = Math.max(1, viewport.width - margin * 2);
  const usableHeight = Math.max(1, viewport.height - margin * 2);
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    scale: clampScale(Math.min(usableWidth / width, usableHeight / height)),
  };
}

/**
 * Centre the view on a point, zooming in only as far as `minScale` requires.
 *
 * Never zooms *out*: a player who has zoomed in to read a neighbourhood should
 * not be yanked back out because something across the map was suggested. The
 * floor exists so the destination arrives at a zoom level where its name is
 * actually drawn — being sent to an unlabelled dot is being sent nowhere.
 */
export function centreOn(camera: Camera, point: Point, minScale = 0): Camera {
  return { x: point.x, y: point.y, scale: clampScale(Math.max(camera.scale, minScale)) };
}

/** The world-space rectangle currently on screen, grown by `padding` px. */
export function visibleBounds(camera: Camera, viewport: Viewport, padding = 0): Bounds {
  const halfWidth = (viewport.width / 2 + padding) / camera.scale;
  const halfHeight = (viewport.height / 2 + padding) / camera.scale;
  return {
    minX: camera.x - halfWidth,
    minY: camera.y - halfHeight,
    maxX: camera.x + halfWidth,
    maxY: camera.y + halfHeight,
  };
}

export function contains(bounds: Bounds, point: Point): boolean {
  return (
    point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY
  );
}
