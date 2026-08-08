/**
 * The camera: a pan/zoom/turn transform over atlas coordinates.
 *
 * Pure — no canvas, no DOM, no listeners. Everything here is arithmetic on a
 * `{x, y, scale, bearing}` record, which is why the interaction model is
 * unit-testable without a browser.
 *
 * Atlas coordinates come from the indexer and never change (NORTH-STAR §7:
 * same repo ⇒ same map). The camera is the only thing that moves — **including
 * when the map turns.** Pillar 4 is not in play here: `node.layout` is frozen
 * in the indexer and no node moves relative to any other. A bearing is the
 * viewer's orientation, in the same sense that `scale` is their distance.
 */

export interface Camera {
  /** World coordinate at the centre of the viewport. */
  readonly x: number;
  readonly y: number;
  /** Screen pixels per world unit. */
  readonly scale: number;
  /**
   * Radians clockwise. At 0 the atlas's −Y is up, which is the map every
   * previous session learned — so north-up is the arrival state and `NORTH` is
   * always one keystroke away.
   *
   * **Unbounded on purpose**, like the orbit's turn: 3π and π are the same
   * picture, but the difference between them is which way the world went to get
   * there, and an animation that wraps at 2π spins the long way round. Anything
   * that needs the angle itself normalises at the point of use.
   *
   * Why this lives on the camera rather than in the flat renderer: the orbit
   * view carried its own `yaw` until this field existed, and two headings for
   * one world is the shape of defect this repo keeps finding — a rule that
   * lives twice. `o` now changes the pitch you view the map from and nothing
   * about which way you are facing.
   */
  readonly bearing: number;
}

/** Bearing 0: the atlas laid out north-up, exactly as the indexer wrote it. */
export const NORTH = 0;

const TURN = Math.PI * 2;

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

/**
 * World → screen: turn about the camera's centre, then scale, then centre.
 *
 * The rotation is applied to *coordinates*, never to the canvas transform, and
 * that is a legibility decision rather than a stylistic one. `context.rotate`
 * would turn every label with the map, and `docs/prior-art.md` §4.3 constraint 8
 * names text readability as one of the four defects Merino et al. found
 * visualisation tools keep shipping — in a product whose nouns are file paths.
 * Rotating the projection instead means labels are simply drawn upright at
 * rotated positions, and there is no counter-rotation anywhere to forget.
 *
 * Matrix is `[[cos, −sin], [sin, cos]]`, the same one `orbit.project` uses, so
 * looking straight down in the orbit reproduces this function exactly — at any
 * bearing, not just at north. `tests/unit/orbit.test.ts` pins it.
 */
export function worldToScreen(camera: Camera, viewport: Viewport, point: Point): Point {
  const cos = Math.cos(camera.bearing);
  const sin = Math.sin(camera.bearing);
  const dx = point.x - camera.x;
  const dy = point.y - camera.y;
  return {
    x: (dx * cos - dy * sin) * camera.scale + viewport.width / 2,
    y: (dx * sin + dy * cos) * camera.scale + viewport.height / 2,
  };
}

/**
 * Screen → world. **The exact inverse of `worldToScreen`, and it has to be.**
 *
 * This is the function the orbit's scar was cut in: rung 2 shipped a rotated,
 * foreshortened view with the *flat* inverse still driving hover and click, so
 * the inspector described one file while the cursor sat on another — and the
 * click wrote that wrong file into the saved `surveyed` set, a stored falsehood
 * keyed to the repo and surviving reload. A bearing breaks an unrotated inverse
 * in precisely the same way, silently, and only for the nodes away from the
 * centre.
 */
export function screenToWorld(camera: Camera, viewport: Viewport, point: Point): Point {
  const cos = Math.cos(camera.bearing);
  const sin = Math.sin(camera.bearing);
  const sx = (point.x - viewport.width / 2) / camera.scale;
  const sy = (point.y - viewport.height / 2) / camera.scale;
  return { x: sx * cos + sy * sin + camera.x, y: -sx * sin + sy * cos + camera.y };
}

/**
 * Drag: move the world under the pointer by a screen-space delta.
 *
 * The delta arrives in *screen* pixels and has to be un-turned before it means
 * anything in world units, or the map slides off at an angle to the pointer at
 * every heading but north. The property worth holding in mind is the one the
 * test asserts: content moves by exactly the drag, on screen, at any bearing.
 */
export function pan(camera: Camera, dx: number, dy: number): Camera {
  const cos = Math.cos(camera.bearing);
  const sin = Math.sin(camera.bearing);
  return {
    ...camera,
    x: camera.x - (dx * cos + dy * sin) / camera.scale,
    y: camera.y - (-dx * sin + dy * cos) / camera.scale,
  };
}

/**
 * Turn the world about the centre of the viewport.
 *
 * Unclamped: the map turns all the way round and keeps going, so a sequence of
 * turns never has to reason about a wrap. See `Camera.bearing`.
 */
export function rotate(camera: Camera, dBearing: number): Camera {
  return { ...camera, bearing: camera.bearing + dBearing };
}

/**
 * The nearest bearing that faces north, in the direction that turns least.
 *
 * Not `0`: the camera's bearing accumulates, so snapping to literal zero from
 * 7.9 radians would unwind two and a half turns on screen. The player asked to
 * face north, not to rewind.
 */
export function facingNorth(camera: Camera): number {
  return Math.round(camera.bearing / TURN) * TURN;
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
  return { ...camera, x: camera.x + (before.x - after.x), y: camera.y + (before.y - after.y), scale };
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

/**
 * A camera that frames `bounds` inside `viewport` at `bearing`, with a margin
 * in pixels.
 *
 * **`bearing` has no default, and callers must say which one they mean.** The
 * same discipline `blastRadius` uses for its depth, for the same reason: the
 * plausible default here is north, and a `fit` that quietly resets the heading
 * would make "press f to see the whole map" undo the intervention every time it
 * was used. The type system asks the question instead.
 *
 * A turned rectangle needs a bigger box: at 45° a square wants √2 of its own
 * width. This is the extent of the rotated *bounds*, not of the rotated point
 * cloud, so it is conservative in the same direction the un-turned version
 * always was.
 */
export function fit(bounds: Bounds, viewport: Viewport, bearing: number, margin = 64): Camera {
  const cos = Math.abs(Math.cos(bearing));
  const sin = Math.abs(Math.sin(bearing));
  const spanX = Math.max(1e-6, bounds.maxX - bounds.minX);
  const spanY = Math.max(1e-6, bounds.maxY - bounds.minY);
  const width = spanX * cos + spanY * sin;
  const height = spanX * sin + spanY * cos;
  const usableWidth = Math.max(1, viewport.width - margin * 2);
  const usableHeight = Math.max(1, viewport.height - margin * 2);
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    scale: clampScale(Math.min(usableWidth / width, usableHeight / height)),
    bearing,
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
  return { ...camera, x: point.x, y: point.y, scale: clampScale(Math.max(camera.scale, minScale)) };
}

/**
 * Where the atlas's north points on screen, in degrees clockwise from up.
 *
 * **The compass reads this, and so does a test that projects a due-north point
 * and checks the two agree.** That pairing is the whole reason it is a function
 * rather than a expression in `ui.ts`: a dial whose angle is computed
 * separately from the map's is an instrument that can turn over a map that has
 * not, which is `npm run raster`'s exact failure — a confident, plausible
 * reading of something that did not happen. There is one sign convention in the
 * player and this is where it is written down.
 */
export function northDegrees(bearing: number): number {
  return (((bearing * 180) / Math.PI) % 360 + 360) % 360;
}

/**
 * The camera that faces `bearing` while holding `anchor` at the screen point
 * `at`.
 *
 * This is what makes a turn read as the world revolving around the file you
 * just proved, rather than as the map being shuffled: pick the subject's
 * current screen position as `at`, and it does not move a pixel while
 * everything else swings around it.
 *
 * Built out of `screenToWorld` rather than out of its own trigonometry, so it
 * cannot drift from the projection it is supposed to invert — the class of
 * defect that put a rotated view on screen with the flat inverse still driving
 * the clicks.
 */
export function pivotAround(
  camera: Camera,
  viewport: Viewport,
  anchor: Point,
  at: Point,
  bearing: number,
): Camera {
  const offset = screenToWorld({ x: 0, y: 0, scale: camera.scale, bearing }, viewport, at);
  return { ...camera, bearing, x: anchor.x - offset.x, y: anchor.y - offset.y };
}
