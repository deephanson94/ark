/**
 * A perspective camera, which is the thing the orbit deliberately is not.
 *
 * ## Why this is a second projector rather than a mode of the first
 *
 * `orbit.ts` is **orthographic**: `right * camera.scale`, `away * sin(pitch) *
 * scale`, no divide. That is exactly right for what it does — looking straight
 * down reproduces the flat map to the pixel, which is ADR-0009's D1 promise and
 * is only expressible without a perspective divide.
 *
 * It is also why ADR-0032 §9.3 sent that document's stage A back. An
 * orthographic grazing view draws every tower at **identical width regardless
 * of distance**, so it renders a field of poles whatever the layout is: the test
 * that was meant to falsify "ark's map does not read as a place at eye level"
 * could have failed for a reason that had nothing to do with the map. The one
 * cue that makes a place read as a place from inside it — things get smaller as
 * they recede — is the divide, and orthographic has no divide to make.
 *
 * So there are two projectors, on purpose, and `MIN_PITCH` stays where it is.
 * `tests/unit/world.test.ts` asserts the difference directly: doubling the
 * distance halves the on-screen size here, and changes it by nothing there.
 *
 * ## Conventions
 *
 * World X and Y are the atlas's `layout`, untouched — ADR-0009's invariant, and
 * the reason a map learned in 2D is still worth something at eye level. Z is up,
 * `elevation * rise`, the same derivation ADR-0013 froze.
 *
 * `yaw` 0 faces **−Y**, which is up on the flat map, so a player who enters the
 * world is facing the direction the map calls north. `pitch` is positive looking
 * up.
 *
 * Pure: no canvas, no DOM, no state. Everything here is a function of its
 * arguments.
 */

import type { Point, Viewport } from '../camera.js';

export interface Eye {
  readonly x: number;
  readonly y: number;
  /** Height above the ground plane. */
  readonly z: number;
  /** Radians. 0 faces −Y (north on the flat map). */
  readonly yaw: number;
  /**
   * Radians. **Positive looks up; the third-person rig therefore runs
   * negative.**
   *
   * Nothing asserted this until a session convinced itself the sign was
   * inverted, "fixed" it, and reddened its own new test — `toView` and
   * `horizonY` had agreed with each other and with this comment the whole time.
   * The type is `number` and a wrong sign is a legal camera, so the mistake was
   * only ever visible in a picture or in an assertion. There are assertions now
   * (`tests/unit/world.test.ts`), in both halves: where a ground point lands,
   * and where the horizon sits.
   */
  readonly pitch: number;
  /** Vertical field of view, radians. */
  readonly fov: number;
}

/**
 * Nothing nearer than this is drawn.
 *
 * A segment crossing it must be **clipped, not dropped** — see `clipToNear`.
 * Dropping is the tempting one-liner and it deletes the road you are standing
 * on at exactly the moment you are standing on it.
 */
export const NEAR = 1.2;

/** A point in the camera's space: right, forward, up. Forward > 0 is in front. */
export interface ViewPoint {
  readonly right: number;
  readonly forward: number;
  readonly up: number;
}

/** World → camera space. No divide yet, so this is safe for points behind. */
export function toView(eye: Eye, x: number, y: number, z: number): ViewPoint {
  const dx = x - eye.x;
  const dy = y - eye.y;
  const dz = z - eye.z;
  const cos = Math.cos(eye.yaw);
  const sin = Math.sin(eye.yaw);
  // **These two lines are `hero.ts`'s basis, and they must stay that way.**
  // A heading names one pair of axes: forward `(sin ψ, −cos ψ)` and right
  // `(cos ψ, sin ψ)`, and this is the projection of `d` onto each. The first
  // version wrote a *different* rotation that happens to coincide when
  // `dx · sin ψ = 0` — heading 0° or 180°, or a point straight down the Y axis
  // — which is where every assertion about this camera had been written. At any
  // other heading the hero walked out of its own view: at 90° a point ten units
  // ahead computed as ten behind, so the figure vanished and the city swung away
  // as you approached it. Two bases for one heading, which is the shape of
  // nearly every defect this repo has had to fix twice.
  const right = dx * cos + dy * sin;
  const flat = dx * sin - dy * cos;
  const cp = Math.cos(eye.pitch);
  const sp = Math.sin(eye.pitch);
  return { right, forward: flat * cp + dz * sp, up: dz * cp - flat * sp };
}

/** Half the viewport height, in the units the divide expects. */
export function focalOf(viewport: Viewport, eye: Eye): number {
  return viewport.height / 2 / Math.tan(eye.fov / 2);
}

export interface Projection {
  readonly point: Point;
  /** Distance along the view axis. Larger is further. */
  readonly depth: number;
  /**
   * Pixels per world unit **at this depth**. The whole reason this module
   * exists: it falls as `1/depth`, where the orbit's equivalent is a constant.
   */
  readonly ppu: number;
}

/**
 * Project a world point. `null` when it is at or behind the near plane —
 * callers that draw *segments* must clip rather than test each end.
 */
export function project(
  eye: Eye,
  viewport: Viewport,
  x: number,
  y: number,
  z: number,
): Projection | null {
  const view = toView(eye, x, y, z);
  if (view.forward <= NEAR) return null;
  const focal = focalOf(viewport, eye);
  const ppu = focal / view.forward;
  return {
    point: {
      x: viewport.width / 2 + view.right * ppu,
      y: viewport.height / 2 - view.up * ppu,
    },
    depth: view.forward,
    ppu,
  };
}

/** Project a point already in view space. Assumes `forward > NEAR`. */
export function projectView(view: ViewPoint, viewport: Viewport, eye: Eye): Projection {
  const ppu = focalOf(viewport, eye) / view.forward;
  return {
    point: {
      x: viewport.width / 2 + view.right * ppu,
      y: viewport.height / 2 - view.up * ppu,
    },
    depth: view.forward,
    ppu,
  };
}

/**
 * The part of a view-space segment in front of the near plane, or `null`.
 *
 * Clipping happens in **view space**, before the divide, because after the
 * divide the information needed to clip is exactly the information the divide
 * destroyed: a point behind the camera divides by a negative number and lands
 * on screen, mirrored, as though it were in front. That is the classic
 * projected-geometry wrap, and on a ground plane covered in roads it is not a
 * subtle artifact — a road running under your feet reappears across the sky.
 */
export function clipToNear(a: ViewPoint, b: ViewPoint): { a: ViewPoint; b: ViewPoint } | null {
  const aIn = a.forward > NEAR;
  const bIn = b.forward > NEAR;
  if (!aIn && !bIn) return null;
  if (aIn && bIn) return { a, b };
  const t = (NEAR - a.forward) / (b.forward - a.forward);
  const cut: ViewPoint = {
    right: a.right + (b.right - a.right) * t,
    forward: NEAR,
    up: a.up + (b.up - a.up) * t,
  };
  return aIn ? { a, b: cut } : { a: cut, b };
}

/** Where the eye sits for a third-person follow: behind and above the hero. */
export function follow(
  at: { readonly x: number; readonly y: number; readonly facing: number },
  distance: number,
  height: number,
  pitch: number,
  fov: number,
): Eye {
  // Behind means the opposite of the way the hero faces, so the eye trails on
  // the +Y side when the hero faces −Y.
  const back = { x: -Math.sin(at.facing), y: Math.cos(at.facing) };
  return {
    x: at.x + back.x * distance,
    y: at.y + back.y * distance,
    z: height,
    yaw: at.facing,
    pitch,
    fov,
  };
}
