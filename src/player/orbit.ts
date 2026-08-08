/**
 * The orbit view — the same atlas, seen from outside and turned.
 *
 * ## Why this exists, and why it is not a walk
 *
 * `docs/prior-art.md` §2 is the reason this rung is shaped the way it is. The
 * empirical literature on 3D does **not** split on dimension; it splits on
 * *viewpoint*. Every result where 3D beat 2D came from giving the viewer motion
 * parallax over a structure they stayed **outside** of — and the strongest of
 * them is about this product's exact task, path tracing in a node-link graph:
 * ~55 comprehensible nodes in 2D against ~160 with parallax (Ware & Franck
 * 1996), replicated in 2005, and again in a **preregistered** 2023 study that
 * beat a 2D baseline carrying edge routing *and* interactive highlighting.
 * Parallax carried more of that effect than stereo, which is why this needs a
 * mouse and not a headset.
 *
 * Every result where 3D *lost* came from putting the viewer inside: spatial
 * memory for item locations degraded monotonically with dimensional freedom
 * (Cockburn & McKenzie, n=69, in physical environments too), and traversing a
 * virtual building was the worst of map / real navigation / VE. So orbiting is
 * not a stepping stone toward the real thing — on the evidence it *is* the
 * intervention, and ADR-0009's P4 keeps the avatar behind the Trace verb.
 *
 * ## What it draws
 *
 * A file is a column standing on the flat map: its footing is exactly its 2D
 * `layout`, and its height is ADR-0013's `elevation`. **X and Y are untouched**
 * — ADR-0009's invariant — so looking straight down reproduces the flat map,
 * and every map anyone has already learned still holds.
 *
 * ## Canvas, not WebGL, and not a dependency
 *
 * Columns standing on a plane never interpenetrate, so painter's order is
 * *exact*: sort by distance from the camera and draw far to near. That is a
 * sort and some strokes — the same work the flat map already does — and it
 * spends none of the three-runtime-dependency budget. WebGL earns its place
 * when per-frame reprojection of thousands of prisms at arbitrary pitch stops
 * fitting in a frame; measure before buying it, per ADR-0009's P1′.
 *
 * Runtime trigonometry is fine here and would not be in the indexer:
 * ADR-0006 forbids transcendentals in **layout** because the atlas must be
 * byte-identical across machines. Nothing here reaches the atlas.
 */

import type { Camera, Point, Viewport } from './camera.js';
import type { SceneNode } from './scene.js';

/**
 * How far the eye is tipped, and how tall a layer stands.
 *
 * **Which way the eye is facing is not here — it is `camera.bearing`.** This
 * interface carried a `yaw` of its own until the flat map learned to turn, and
 * then there were two headings for one world: pressing `o` would have snapped
 * the view back to whatever the orbit remembered, and the same concept would
 * have been implemented in two places, which is the shape of nearly every
 * defect this repo has had to fix twice. Turning and tipping are now separate
 * verbs on separate records: `rotate()` on the camera, `tip()` here.
 */
export interface Orbit {
  /**
   * Radians, 0..π/2. π/2 is straight down — which reproduces the flat map
   * exactly *at the same bearing*, and is deliberately reachable: ADR-0009's D1
   * says the overview survives, and the cheapest way to keep that promise is to
   * make the flat map a *position* of this camera rather than a different mode.
   */
  readonly pitch: number;
  /** World units of height per elevation layer. */
  readonly rise: number;
}

export const DEFAULT_ORBIT: Orbit = { pitch: 1.05, rise: 26 };

/** Straight down. `project` then equals `worldToScreen`, to the pixel. */
export const OVERHEAD: Orbit = { pitch: Math.PI / 2, rise: 0 };

const MIN_PITCH = 0.18;
const MAX_PITCH = Math.PI / 2;

/** Tip the eye toward the horizon or back toward overhead. */
export function tip(orbit: Orbit, dPitch: number): Orbit {
  return { ...orbit, pitch: Math.min(MAX_PITCH, Math.max(MIN_PITCH, orbit.pitch + dPitch)) };
}

/**
 * A node's footing and its top, in screen space.
 *
 * The camera's bearing rotates about the map's centre, then pitch foreshortens
 * the away-axis and height lifts against it. At `pitch = π/2` the sine is 1 and
 * the cosine 0, so the away-axis is unforeshortened and height contributes
 * nothing — the flat map, exactly, at whatever bearing the camera holds.
 */
export interface Column {
  readonly node: SceneNode;
  readonly base: Point;
  readonly top: Point;
  /**
   * Position along the view axis after the turn. **Larger is *nearer* the eye** —
   * it projects lower on the screen, which is what "closer" means in a tipped
   * view — so ascending `depth` is far-to-near, which is the order to draw in.
   * (This comment said the opposite until a review caught it; the code and the
   * sort were always right, and the next reader of this file will be writing an
   * inverse projection from these words.)
   */
  readonly depth: number;
}

export function project(
  camera: Camera,
  viewport: Viewport,
  orbit: Orbit,
  node: { readonly x: number; readonly y: number; readonly elevation: number },
): { base: Point; top: Point; depth: number } {
  const cos = Math.cos(camera.bearing);
  const sin = Math.sin(camera.bearing);
  const dx = node.x - camera.x;
  const dy = node.y - camera.y;
  // Rotate about the camera's centre so turning does not slide the map away.
  const right = dx * cos - dy * sin;
  const away = dx * sin + dy * cos;
  const lift = node.elevation * orbit.rise;

  const screenX = right * camera.scale + viewport.width / 2;
  // Headroom. Columns rise *up* the screen, so a tipped view needs room above
  // the ground plane or the tallest files — the ones the view exists to show —
  // clip off the top edge. It is proportional to `cos(pitch)`, which is the same
  // factor the lift itself uses: the more you tip, the taller things stand and
  // the more room they need. At overhead `cos` is 0, so the bias vanishes and
  // the flat-map equality holds exactly.
  const headroom = viewport.height * 0.18 * Math.cos(orbit.pitch);
  const flattened =
    away * Math.sin(orbit.pitch) * camera.scale + viewport.height / 2 + headroom;
  return {
    base: { x: screenX, y: flattened },
    top: { x: screenX, y: flattened - lift * Math.cos(orbit.pitch) * camera.scale },
    depth: away,
  };
}

/**
 * Columns in draw order: furthest first.
 *
 * Ties break on node id via the caller's stable input order, so two files at
 * the same distance are drawn the same way on every machine and every frame —
 * a flicker between two orderings would read as a rendering bug and is exactly
 * the kind of nondeterminism this project treats as a defect.
 */
export interface Projected {
  /** On-screen columns, furthest first. What gets drawn. */
  readonly ordered: Column[];
  /** **Every** node's column, on screen or not. What edges are looked up in. */
  readonly byRef: Map<number, Column>;
}

/**
 * Project every node, but sort and return for drawing only the ones on screen.
 *
 * The flat map has culled in screen space through its own projection since
 * ADR-0017; this is the orbit borrowing it, which is what CLAUDE.md has had
 * queued as the obvious next step. A column occupies from its `top` to its
 * `base` at `x ± reach`, so the test is that box against the viewport.
 *
 * **The map keeps everything and only the draw list is cut**, which is the
 * whole subtlety. Edges are looked up by ref, and an edge from an on-screen
 * column to an off-screen one is a line the player can see most of — dropping
 * it because one endpoint was culled would delete visible ink, which is what a
 * naive cull does. `visibleEdges` makes the same distinction on the flat map
 * ("at least one endpoint on screen") and it is worth restating because the two
 * views hold their projections differently.
 *
 * The saving is the sort and the per-column draw, which is where the cost is:
 * projection is O(n) arithmetic either way.
 */
export function projectAll(
  nodes: readonly SceneNode[],
  camera: Camera,
  viewport: Viewport,
  orbit: Orbit,
  padding = 0,
): Projected {
  const byRef = new Map<number, Column>();
  const ordered: Column[] = [];
  for (const node of nodes) {
    const { base, top, depth } = project(camera, viewport, orbit, node);
    const column = { node, base, top, depth };
    byRef.set(node.ref, column);
    const reach = node.radius * camera.scale + padding;
    if (base.x + reach < 0 || base.x - reach > viewport.width) continue;
    // `top` is above `base` by construction, so the column's vertical extent is
    // exactly `[top.y, base.y]`.
    if (base.y + reach < 0 || top.y - reach > viewport.height) continue;
    ordered.push(column);
  }
  ordered.sort((a, b) => a.depth - b.depth || (a.node.id < b.node.id ? -1 : 1));
  return { ordered, byRef };
}


/**
 * Which column the pointer is on.
 *
 * **This is the inverse of the view, and it exists because its absence was a
 * real defect rather than a rough edge.** Rung 2 shipped with the flat map's
 * `screenToWorld` still driving hover and click while the screen showed
 * rotated, foreshortened, lifted positions — so the inspector described one
 * file while the cursor sat on another, and clicking wrote **the wrong node**
 * into the player's saved `surveyed` set. A stored falsehood keyed to the repo,
 * surviving reload, in the one structure whose whole claim is that it records
 * only what you actually did.
 *
 * Hit-testing happens in screen space against the column *tops*, not by
 * inverting the projection into world space. That is deliberate: the top disc
 * is the thing the player can see and aim at, and an inverse would have to pick
 * a height to invert *at* — the ground gives one answer, the roof another, and
 * neither is where the eye was pointed. Nearest-to-the-eye wins a tie, which is
 * exactly the painter's order read backwards: the column drawn last is the one
 * on top.
 */
export function pickColumn(
  nodes: readonly SceneNode[],
  camera: Camera,
  viewport: Viewport,
  orbit: Orbit,
  point: Point,
): SceneNode | null {
  let best: Column | null = null;
  // Culled, and that is not a corner cut: the pointer is on screen by
  // construction, so a column that is not cannot be under it.
  for (const column of projectAll(nodes, camera, viewport, orbit).ordered) {
    const reach = Math.max(column.node.radius * camera.scale, 8);
    const dx = column.top.x - point.x;
    const dy = column.top.y - point.y;
    if (dx * dx + dy * dy > reach * reach) continue;
    // `ordered` is far-to-near, so simply keeping the last match takes the
    // nearest — the one whose disc is actually on top of the others.
    best = column;
  }
  return best?.node ?? null;
}
