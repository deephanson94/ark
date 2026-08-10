/**
 * Drawing the world from inside it.
 *
 * ## Painter's order over one list, not two passes
 *
 * The obvious structure is *ground first, then buildings*, and it is wrong: a
 * road running past your feet would be painted before a tower a hundred units
 * away, and the tower would then cover it. Roads and towers share one draw list
 * sorted far-to-near, which is exact for towers (convex prisms on a plane never
 * interpenetrate — `orbit.ts` makes the same argument) and approximate for
 * roads, since a long quad has one depth key and two ends. Roads are therefore
 * **chopped** into short pieces before they enter the list, which turns the
 * approximation into one small enough to be invisible.
 *
 * ## Nothing is drawn from a projected point that was never clipped
 *
 * A point behind the eye divides by a negative number and lands on screen
 * mirrored, as if it were in front. On a plane covered in roads that is not a
 * corner case: the road you are standing on has one end behind you almost
 * always. Segments are clipped in view space, before the divide
 * (`camera.clipToNear`).
 */

import type { NodeRef } from '../../atlas/index.js';
import type { Point, Viewport } from '../camera.js';
import type { Fog } from '../fog.js';
import { visibilityOf } from '../fog.js';
import { INK, regionColor, regionSilhouette, regionWash } from '../palette.js';
import type { Eye, ViewPoint } from './camera.js';
import { clipToNear, focalOf, projectView, toView } from './camera.js';
import type { Chronicle, Road, Tower, World } from './build.js';
import { ROAD_WIDTH } from './build.js';
import type { Hero } from './hero.js';
import { HERO_HEIGHT, HERO_RADIUS } from './hero.js';

export interface WorldFrameInput {
  readonly world: World;
  readonly eye: Eye;
  readonly hero: Hero;
  readonly viewport: Viewport;
  readonly fog: Fog;
  /** Nodes still carrying a question. Drawn as beacons. */
  readonly questions: ReadonlySet<NodeRef>;
  /** Whether the chronicle has commit-subject boards left to serve. */
  readonly chronicleLit: boolean;
  /** What pressing the interact key would open, if anything. */
  readonly focus: Focus | null;
}

export type Focus = { readonly kind: 'tower'; readonly tower: Tower } | { readonly kind: 'chronicle' };

export interface WorldFrameStats {
  readonly towersDrawn: number;
  readonly roadsDrawn: number;
  readonly labelsDrawn: number;
  /** Beacons stroked. Measured, for the same reason `peaksDrawn` is on the map. */
  readonly beaconsDrawn: number;
}

/**
 * How far out the world is drawn.
 *
 * Everything beyond it is fog rather than emptiness, which is honest — the
 * player genuinely cannot see the far side of a city from the street — and is
 * what keeps django's 10,162 roads from being 10,162 quads a frame.
 */
export const VIEW_DISTANCE = 620;
/** Roads longer than this are cut into pieces, for painter's order and for fog. */
const ROAD_CHOP = 34;

const LABEL_FONT = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
const SKY_TOP = '#070a10';
const SKY_HORIZON = '#141c2b';
const GROUND = '#0c1017';

type Prim =
  | { kind: 'road'; depth: number; a: ViewPoint; b: ViewPoint; fade: number; dashed: boolean }
  | { kind: 'tower'; depth: number; tower: Tower; fade: number }
  | { kind: 'chronicle'; depth: number; fade: number }
  /**
   * The hero, in the same list as everything else.
   *
   * Drawn last and unconditionally in the first version, which put the figure
   * *in front of* a building standing between it and the camera — so walking
   * behind a tower showed a person pasted onto its wall. A body is an object in
   * the world and sorts like one.
   */
  | { kind: 'hero'; depth: number };

export function drawWorldFrame(
  context: CanvasRenderingContext2D,
  input: WorldFrameInput,
): WorldFrameStats {
  const { world, eye, hero, viewport, fog, questions, chronicleLit, focus } = input;

  drawSkyAndGround(context, eye, viewport);

  const prims: Prim[] = [];
  let roadsDrawn = 0;

  for (const road of world.roads) {
    if (!withinReach(road, eye)) continue;
    roadsDrawn += pushRoad(prims, road, eye);
  }

  let towersDrawn = 0;
  for (const tower of world.towers) {
    const dx = tower.node.x - eye.x;
    const dy = tower.node.y - eye.y;
    const distance = Math.hypot(dx, dy);
    if (distance > VIEW_DISTANCE + tower.footprint) continue;
    const centre = toView(eye, tower.node.x, tower.node.y, tower.height / 2);
    if (centre.forward <= 0) {
      // Behind the eye — but a wide tower straddling the eye plane still shows
      // an edge, so only reject when the whole footprint is behind.
      if (centre.forward < -tower.footprint * 2) continue;
    }
    prims.push({ kind: 'tower', depth: centre.forward, tower, fade: fadeAt(distance) });
    towersDrawn++;
  }

  const chronicleDistance = Math.hypot(world.chronicle.x - eye.x, world.chronicle.y - eye.y);
  if (chronicleDistance <= VIEW_DISTANCE * 1.6) {
    const centre = toView(eye, world.chronicle.x, world.chronicle.y, world.chronicle.height / 2);
    if (centre.forward > -world.chronicle.radius * 2) {
      prims.push({ kind: 'chronicle', depth: centre.forward, fade: fadeAt(chronicleDistance) });
    }
  }

  const heroView = toView(eye, hero.x, hero.y, 0);
  if (heroView.forward > 0) prims.push({ kind: 'hero', depth: heroView.forward });

  // Far to near. The tie-break keeps two primitives at identical depth in a
  // fixed order, so a frame never flickers between two equally-valid paintings.
  prims.sort((a, b) => b.depth - a.depth || a.kind.localeCompare(b.kind));

  let beaconsDrawn = 0;
  const labelled: { tower: Tower; at: Point; ppu: number; lit: boolean }[] = [];

  for (const prim of prims) {
    if (prim.kind === 'road') {
      strokeRoad(context, prim, viewport, eye);
      continue;
    }
    if (prim.kind === 'chronicle') {
      drawChronicle(context, world.chronicle, eye, viewport, prim.fade, chronicleLit);
      if (chronicleLit) beaconsDrawn++;
      continue;
    }
    if (prim.kind === 'hero') {
      drawHero(context, hero, eye, viewport);
      continue;
    }
    const { tower } = prim;
    const state = visibilityOf(fog, tower.node.id);
    const lit = questions.has(tower.ref);
    const focused = focus?.kind === 'tower' && focus.tower.ref === tower.ref;
    drawTower(context, tower, eye, viewport, prim.fade, state, focused);
    if (lit) {
      beaconsDrawn += drawBeacon(context, tower, eye, viewport, prim.fade) ? 1 : 0;
    }
    const head = projectPoint(eye, viewport, tower.node.x, tower.node.y, tower.height);
    if (head !== null && state !== 'silhouette' && prim.fade > 0.25) {
      labelled.push({ tower, at: head.point, ppu: head.ppu, lit });
    }
  }

  const labelsDrawn = drawLabels(context, labelled, viewport);

  return { towersDrawn, roadsDrawn, labelsDrawn, beaconsDrawn };
}

// ---- sky and ground -------------------------------------------------------

/**
 * The horizon is where the ground plane goes to infinity, and it is computable
 * rather than chosen: as forward distance grows, `up/forward → −tan(pitch)`, so
 * the vanishing line sits `focal · tan(pitch)` below the screen's centre.
 * Deriving it means the ground and the roads drawn on it always agree about
 * where the world ends, at any pitch.
 */
export function horizonY(eye: Eye, viewport: Viewport): number {
  return viewport.height / 2 + focalOf(viewport, eye) * Math.tan(eye.pitch);
}

function drawSkyAndGround(
  context: CanvasRenderingContext2D,
  eye: Eye,
  viewport: Viewport,
): void {
  const horizon = horizonY(eye, viewport);
  const sky = context.createLinearGradient(0, 0, 0, Math.max(1, horizon));
  sky.addColorStop(0, SKY_TOP);
  sky.addColorStop(1, SKY_HORIZON);
  context.fillStyle = sky;
  context.fillRect(0, 0, viewport.width, Math.max(0, horizon));

  context.fillStyle = GROUND;
  context.fillRect(0, Math.max(0, horizon), viewport.width, viewport.height - Math.max(0, horizon));

  // A haze band at the horizon, so distance reads as distance rather than as a
  // hard cut where `VIEW_DISTANCE` bites.
  const haze = context.createLinearGradient(0, Math.max(0, horizon), 0, Math.max(0, horizon) + 120);
  haze.addColorStop(0, 'rgba(20, 28, 43, 0.95)');
  haze.addColorStop(1, 'rgba(20, 28, 43, 0)');
  context.fillStyle = haze;
  context.fillRect(0, Math.max(0, horizon), viewport.width, 120);
}

/** 1 near, 0 at the view distance. Everything multiplies its alpha by this. */
function fadeAt(distance: number): number {
  const start = VIEW_DISTANCE * 0.45;
  if (distance <= start) return 1;
  return Math.max(0, 1 - (distance - start) / (VIEW_DISTANCE - start));
}

// ---- roads ----------------------------------------------------------------

function withinReach(road: Road, eye: Eye): boolean {
  const a = Math.hypot(road.from.node.x - eye.x, road.from.node.y - eye.y);
  if (a <= VIEW_DISTANCE) return true;
  const b = Math.hypot(road.to.node.x - eye.x, road.to.node.y - eye.y);
  if (b <= VIEW_DISTANCE) return true;
  // A long road can pass close by with both ends far away — the case a naive
  // endpoint test drops, and on a force layout the long edges are the ones that
  // say the most.
  return road.length > VIEW_DISTANCE && distanceToSegment(eye, road) <= VIEW_DISTANCE;
}

function distanceToSegment(eye: Eye, road: Road): number {
  const ax = road.from.node.x;
  const ay = road.from.node.y;
  const bx = road.to.node.x;
  const by = road.to.node.y;
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((eye.x - ax) * dx + (eye.y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(ax + dx * t - eye.x, ay + dy * t - eye.y);
}

/** Chop a road into painter-sortable pieces and push the visible ones. */
function pushRoad(prims: Prim[], road: Road, eye: Eye): number {
  const pieces = Math.max(1, Math.ceil(road.length / ROAD_CHOP));
  const ax = road.from.node.x;
  const ay = road.from.node.y;
  const dx = (road.to.node.x - ax) / pieces;
  const dy = (road.to.node.y - ay) / pieces;
  const dashed = road.edge.confidence === 'probable';
  let pushed = 0;
  for (let piece = 0; piece < pieces; piece++) {
    const x0 = ax + dx * piece;
    const y0 = ay + dy * piece;
    const x1 = x0 + dx;
    const y1 = y0 + dy;
    const midDistance = Math.hypot((x0 + x1) / 2 - eye.x, (y0 + y1) / 2 - eye.y);
    if (midDistance > VIEW_DISTANCE) continue;
    const a = toView(eye, x0, y0, 0);
    const b = toView(eye, x1, y1, 0);
    const clipped = clipToNear(a, b);
    if (clipped === null) continue;
    prims.push({
      kind: 'road',
      depth: (clipped.a.forward + clipped.b.forward) / 2,
      a: clipped.a,
      b: clipped.b,
      fade: fadeAt(midDistance),
      dashed,
    });
    pushed++;
  }
  return pushed;
}

function strokeRoad(
  context: CanvasRenderingContext2D,
  prim: { a: ViewPoint; b: ViewPoint; fade: number; dashed: boolean },
  viewport: Viewport,
  eye: Eye,
): void {
  const a = projectView(prim.a, viewport, eye);
  const b = projectView(prim.b, viewport, eye);
  // Width in *pixels* differs at the two ends, which is the whole reason this
  // is a quad and not a stroke: a road narrowing as it recedes is the cue that
  // says how far away its far end is.
  const halfA = Math.max(0.4, (ROAD_WIDTH / 2) * a.ppu);
  const halfB = Math.max(0.4, (ROAD_WIDTH / 2) * b.ppu);
  const dx = b.point.x - a.point.x;
  const dy = b.point.y - a.point.y;
  const span = Math.hypot(dx, dy);
  if (span < 1e-6) return;
  const nx = -dy / span;
  const ny = dx / span;
  context.beginPath();
  context.moveTo(a.point.x + nx * halfA, a.point.y + ny * halfA);
  context.lineTo(b.point.x + nx * halfB, b.point.y + ny * halfB);
  context.lineTo(b.point.x - nx * halfB, b.point.y - ny * halfB);
  context.lineTo(a.point.x - nx * halfA, a.point.y - ny * halfA);
  context.closePath();
  context.fillStyle = prim.dashed ? 'rgba(140, 160, 190, 0.20)' : 'rgba(150, 172, 205, 0.34)';
  context.globalAlpha = prim.fade;
  context.fill();
  context.globalAlpha = 1;
}

// ---- towers ---------------------------------------------------------------

/**
 * Faces are shaded by how squarely they face the **eye**, not a sun.
 *
 * ADR-0032 §9.8 flagged a fixed light as the one piece of invented scenery that
 * would matter: a sun re-anchors a global orientation, and ADR-0017 turns the
 * flat map between challenges precisely because orientation-locked spatial
 * memory is this project's documented weakness. A view-relative term gives a
 * box its solidity — adjacent faces differ, so corners read — while anchoring
 * nothing. Turn on the spot and no direction is privileged.
 */
function faceShade(a: ViewPoint, b: ViewPoint): number {
  const dx = b.right - a.right;
  const dz = b.forward - a.forward;
  const span = Math.hypot(dx, dz);
  if (span < 1e-6) return 0.5;
  // How side-on the face is: |cross(normal, view)| collapses to this in 2D.
  return 0.34 + 0.5 * Math.abs(dx / span);
}

function drawTower(
  context: CanvasRenderingContext2D,
  tower: Tower,
  eye: Eye,
  viewport: Viewport,
  fade: number,
  state: 'silhouette' | 'surveyed' | 'understood',
  focused: boolean,
): void {
  const r = tower.footprint;
  const { x, y } = tower.node;
  const corners: [number, number][] = [
    [x - r, y - r],
    [x + r, y - r],
    [x + r, y + r],
    [x - r, y + r],
  ];
  const base = corners.map(([cx, cy]) => toView(eye, cx, cy, 0));
  const top = corners.map(([cx, cy]) => toView(eye, cx, cy, tower.height));

  const body =
    state === 'silhouette' ? regionSilhouette(tower.node.regionIndex, 1) : regionWash(tower.node.regionIndex, 1);
  const crown =
    state === 'silhouette' ? regionSilhouette(tower.node.regionIndex, 1) : regionColor(tower.node.regionIndex, 1);

  // Sides, back to front among themselves, so a box is solid from any angle.
  const sides = [0, 1, 2, 3]
    .map((i) => ({ i, j: (i + 1) % 4 }))
    .map(({ i, j }) => ({
      i,
      j,
      depth: ((base[i] as ViewPoint).forward + (base[j] as ViewPoint).forward) / 2,
    }))
    .sort((p, q) => q.depth - p.depth);

  context.globalAlpha = fade;
  for (const side of sides) {
    const b0 = base[side.i] as ViewPoint;
    const b1 = base[side.j] as ViewPoint;
    const t0 = top[side.i] as ViewPoint;
    const t1 = top[side.j] as ViewPoint;
    const quad = clipQuad(b0, b1, t1, t0, viewport, eye);
    if (quad === null) continue;
    tracePolygon(context, quad);
    context.fillStyle = shade(body, faceShade(b0, b1));
    context.fill();
  }

  // The roof. Its height is the claim — ADR-0013's elevation — so it is the
  // brightest thing on the tower and the piece the eye lands on.
  const roof = clipQuad(
    top[0] as ViewPoint,
    top[1] as ViewPoint,
    top[2] as ViewPoint,
    top[3] as ViewPoint,
    viewport,
    eye,
  );
  if (roof !== null) {
    tracePolygon(context, roof);
    context.fillStyle = crown;
    context.globalAlpha = fade * (state === 'silhouette' ? 1 : 0.92);
    context.fill();
    if (state === 'understood' || focused) {
      context.strokeStyle = focused ? INK.edgeHighlight : INK.text;
      context.lineWidth = focused ? 2.4 : 1.2;
      context.globalAlpha = fade;
      context.stroke();
    }
  }
  context.globalAlpha = 1;
}

/** Darken an `hsla(...)` string by a factor, without parsing colour spaces. */
function shade(color: string, factor: number): string {
  const match = /^hsla\(([^,]+),\s*([\d.]+)%,\s*([\d.]+)%,\s*([\d.]+)\)$/.exec(color);
  if (match === null) return color;
  const lightness = Number(match[3]) * factor;
  return `hsla(${match[1]}, ${match[2]}%, ${lightness.toFixed(1)}%, ${match[4]})`;
}

/**
 * Clip a convex quad against the near plane and project it.
 *
 * Sutherland–Hodgman against one plane, which for a convex polygon is a dozen
 * lines and is exact. Testing the four corners and bailing if any is behind —
 * the shortcut — makes every tower vanish the moment you walk up to it, which
 * is the moment you most want it drawn.
 */
function clipQuad(
  a: ViewPoint,
  b: ViewPoint,
  c: ViewPoint,
  d: ViewPoint,
  viewport: Viewport,
  eye: Eye,
): Point[] | null {
  const input = [a, b, c, d];
  const out: ViewPoint[] = [];
  for (let i = 0; i < input.length; i++) {
    const current = input[i] as ViewPoint;
    const next = input[(i + 1) % input.length] as ViewPoint;
    const clipped = clipToNear(current, next);
    if (clipped === null) continue;
    if (out.length === 0 || !samePoint(out[out.length - 1] as ViewPoint, clipped.a)) out.push(clipped.a);
    out.push(clipped.b);
  }
  if (out.length < 3) return null;
  return out.map((point) => projectView(point, viewport, eye).point);
}

function samePoint(a: ViewPoint, b: ViewPoint): boolean {
  return a.right === b.right && a.forward === b.forward && a.up === b.up;
}

/** Lay a closed path over a polygon. Callers get the indexing right once. */
function tracePolygon(context: CanvasRenderingContext2D, points: readonly Point[]): void {
  const first = points[0];
  if (first === undefined) return;
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (let k = 1; k < points.length; k++) {
    const point = points[k];
    if (point === undefined) continue;
    context.lineTo(point.x, point.y);
  }
  context.closePath();
}

function projectPoint(
  eye: Eye,
  viewport: Viewport,
  x: number,
  y: number,
  z: number,
): { point: Point; ppu: number } | null {
  const view = toView(eye, x, y, z);
  if (view.forward <= 1.2) return null;
  const projected = projectView(view, viewport, eye);
  return { point: projected.point, ppu: projected.ppu };
}

// ---- beacons, chronicle, hero, labels -------------------------------------

/**
 * A shaft of light over a tower that still carries a question.
 *
 * The map's equivalent is `INK.question`, a ring, and the colour is deliberately
 * the same one: a player who has learned what teal means on the map should not
 * have to learn it again at street level.
 */
function drawBeacon(
  context: CanvasRenderingContext2D,
  tower: Tower,
  eye: Eye,
  viewport: Viewport,
  fade: number,
): boolean {
  const foot = projectPoint(eye, viewport, tower.node.x, tower.node.y, tower.height);
  const head = projectPoint(eye, viewport, tower.node.x, tower.node.y, tower.height + 46);
  if (foot === null || head === null) return false;
  const width = Math.max(1.5, tower.footprint * foot.ppu * 0.8);
  const gradient = context.createLinearGradient(foot.point.x, foot.point.y, head.point.x, head.point.y);
  gradient.addColorStop(0, 'rgba(126, 214, 214, 0.55)');
  gradient.addColorStop(1, 'rgba(126, 214, 214, 0)');
  context.globalAlpha = fade;
  context.fillStyle = gradient;
  context.beginPath();
  context.moveTo(foot.point.x - width, foot.point.y);
  context.lineTo(foot.point.x + width, foot.point.y);
  context.lineTo(head.point.x + width * 0.35, head.point.y);
  context.lineTo(head.point.x - width * 0.35, head.point.y);
  context.closePath();
  context.fill();
  context.globalAlpha = 1;
  return true;
}

function drawChronicle(
  context: CanvasRenderingContext2D,
  chronicle: Chronicle,
  eye: Eye,
  viewport: Viewport,
  fade: number,
  lit: boolean,
): void {
  const r = chronicle.radius;
  const corners: [number, number][] = [
    [chronicle.x - r, chronicle.y - r],
    [chronicle.x + r, chronicle.y - r],
    [chronicle.x + r, chronicle.y + r],
    [chronicle.x - r, chronicle.y + r],
  ];
  const base = corners.map(([cx, cy]) => toView(eye, cx, cy, 0));
  // Tapered: the top corners pull toward the axis, so it reads as an obelisk
  // rather than as the tallest file in the repo.
  const top = corners.map(([cx, cy]) => {
    const tx = chronicle.x + (cx - chronicle.x) * 0.28;
    const ty = chronicle.y + (cy - chronicle.y) * 0.28;
    return toView(eye, tx, ty, chronicle.height);
  });
  context.globalAlpha = fade;
  const sides = [0, 1, 2, 3]
    .map((i) => ({ i, j: (i + 1) % 4 }))
    .map(({ i, j }) => ({ i, j, depth: ((base[i] as ViewPoint).forward + (base[j] as ViewPoint).forward) / 2 }))
    .sort((p, q) => q.depth - p.depth);
  for (const side of sides) {
    const quad = clipQuad(
      base[side.i] as ViewPoint,
      base[side.j] as ViewPoint,
      top[side.j] as ViewPoint,
      top[side.i] as ViewPoint,
      viewport,
      eye,
    );
    if (quad === null) continue;
    tracePolygon(context, quad);
    context.fillStyle = shade(
      lit ? 'hsla(28, 62%, 44%, 1)' : 'hsla(220, 12%, 26%, 1)',
      faceShade(base[side.i] as ViewPoint, base[side.j] as ViewPoint),
    );
    context.fill();
  }
  context.globalAlpha = 1;
  if (lit) {
    const head = projectPoint(eye, viewport, chronicle.x, chronicle.y, chronicle.height + 30);
    const foot = projectPoint(eye, viewport, chronicle.x, chronicle.y, chronicle.height);
    if (head !== null && foot !== null) {
      const gradient = context.createLinearGradient(foot.point.x, foot.point.y, head.point.x, head.point.y);
      gradient.addColorStop(0, 'rgba(240, 168, 92, 0.6)');
      gradient.addColorStop(1, 'rgba(240, 168, 92, 0)');
      context.fillStyle = gradient;
      const width = Math.max(1.5, chronicle.radius * foot.ppu * 0.5);
      context.globalAlpha = fade;
      context.beginPath();
      context.moveTo(foot.point.x - width, foot.point.y);
      context.lineTo(foot.point.x + width, foot.point.y);
      context.lineTo(head.point.x, head.point.y);
      context.closePath();
      context.fill();
      context.globalAlpha = 1;
    }
  }
}

/**
 * The figure. Third person — you can see who you are moving, which is the whole
 * difference between this and a free camera.
 */
function drawHero(
  context: CanvasRenderingContext2D,
  hero: Hero,
  eye: Eye,
  viewport: Viewport,
): void {
  const foot = projectPoint(eye, viewport, hero.x, hero.y, 0);
  const head = projectPoint(eye, viewport, hero.x, hero.y, HERO_HEIGHT);
  if (foot === null || head === null) return;
  // Everything below is in **world** units scaled by the projection, not in
  // pixels: a figure sized in pixels would stay the same on screen however far
  // the camera stood, which is the orthographic mistake in miniature.
  const ppu = foot.ppu;

  // A shadow, so the body reads as standing on the ground rather than floating
  // over it — the one cue a flat-shaded figure on a flat plane has nothing else
  // to give.
  context.fillStyle = 'rgba(0, 0, 0, 0.42)';
  context.beginPath();
  context.ellipse(foot.point.x, foot.point.y, HERO_RADIUS * ppu * 0.85, HERO_RADIUS * ppu * 0.34, 0, 0, Math.PI * 2);
  context.fill();

  const tall = foot.point.y - head.point.y;
  const headRadius = Math.max(1.2, tall * 0.14);
  const shoulders = head.point.y + headRadius * 2;
  const hips = head.point.y + tall * 0.58;
  const width = Math.max(1.6, HERO_RADIUS * ppu * 1.15);

  // Legs, so the figure has a direction and a stance rather than being a slab.
  context.strokeStyle = '#c9ab74';
  context.lineWidth = Math.max(1.2, width * 0.28);
  context.beginPath();
  context.moveTo(foot.point.x - width * 0.22, hips);
  context.lineTo(foot.point.x - width * 0.26, foot.point.y);
  context.moveTo(foot.point.x + width * 0.22, hips);
  context.lineTo(foot.point.x + width * 0.26, foot.point.y);
  context.stroke();

  context.fillStyle = '#e9cf9c';
  context.beginPath();
  context.moveTo(foot.point.x - width / 2, hips);
  context.lineTo(foot.point.x - width * 0.42, shoulders);
  context.lineTo(foot.point.x + width * 0.42, shoulders);
  context.lineTo(foot.point.x + width / 2, hips);
  context.closePath();
  context.fill();

  context.beginPath();
  context.arc(foot.point.x, head.point.y + headRadius, headRadius, 0, Math.PI * 2);
  context.fillStyle = '#fdf0d2';
  context.fill();
}

/**
 * Labels, nearest first, dropped where they would collide.
 *
 * `docs/prior-art.md`'s defect #4 is that ark is text-heavy, and a street view
 * that names every building is a wall of monospace. Nearest wins, because the
 * building in front of you is the one you are asking about.
 */
function drawLabels(
  context: CanvasRenderingContext2D,
  candidates: { tower: Tower; at: Point; ppu: number; lit: boolean }[],
  viewport: Viewport,
): number {
  context.font = LABEL_FONT;
  context.textAlign = 'center';
  context.textBaseline = 'bottom';
  const placed: { x: number; y: number; half: number }[] = [];
  let drawn = 0;
  const ordered = [...candidates].sort((a, b) => b.ppu - a.ppu);
  for (const candidate of ordered) {
    if (drawn >= 22) break;
    const { at } = candidate;
    if (at.x < 0 || at.x > viewport.width || at.y < 0 || at.y > viewport.height) continue;
    const text = candidate.tower.node.label;
    const half = context.measureText(text).width / 2 + 4;
    const y = at.y - 8;
    const clash = placed.some(
      (other) => Math.abs(other.y - y) < 15 && Math.abs(other.x - at.x) < other.half + half,
    );
    if (clash) continue;
    placed.push({ x: at.x, y, half });
    context.fillStyle = 'rgba(6, 9, 14, 0.72)';
    context.fillRect(at.x - half, y - 13, half * 2, 15);
    context.fillStyle = candidate.lit ? INK.question : INK.text;
    context.fillText(text, at.x, y);
    drawn++;
  }
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  return drawn;
}
