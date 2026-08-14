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
import type { Box } from '../labels.js';
import type { Fog } from '../fog.js';
import { visibilityOf } from '../fog.js';
import { INK, regionColor, regionSilhouette, regionWash } from '../palette.js';
import type { Eye, ViewPoint } from './camera.js';
import { clipToNear, focalOf, projectView, toView } from './camera.js';
import type { Arch, Chronicle, Road, Tower, World } from './build.js';
import { ARCH_LINTEL, ARCH_PILLAR, ARCH_SPAN, ROAD_WIDTH } from './build.js';
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
  /**
   * Where the guide is sending the player.
   *
   * Drawn as a marker over the place when it is on screen and as an arrow at
   * the screen's edge when it is not, with the distance either way. It carries
   * **no fact the flat map does not already draw** — every unanswered subject
   * wears a ring there, and the guide names this one in the panel — so it is a
   * navigation aid rather than a disclosure.
   */
  readonly waypoint: { readonly x: number; readonly y: number; readonly label: string } | null;
  /**
   * Screen rectangles of the DOM panels standing over the canvas.
   *
   * The same fact `draw.ts` takes for the same reason: the renderer cannot see
   * siblings of the canvas, so a label placed under the HUD is drawn, counted,
   * and invisible. The world's first pass did not take it and put `cli.ts`
   * underneath the repo name.
   */
  readonly chrome: readonly Box[];
}

export type Focus = { readonly kind: 'tower'; readonly tower: Tower } | { readonly kind: 'chronicle' };

export interface WorldFrameStats {
  readonly towersDrawn: number;
  readonly roadsDrawn: number;
  readonly labelsDrawn: number;
  /** Beacons stroked. Measured, for the same reason `peaksDrawn` is on the map. */
  readonly beaconsDrawn: number;
  /**
   * Distant towers drawn as silhouettes. Measured because this is the whole of
   * risk #4's mitigation in this view, and a path that never fires is worse
   * than no path — the e2e reads it.
   */
  readonly skylineDrawn: number;
  /**
   * District arches in the frame. Counted for the same reason `skylineDrawn` is:
   * an arch that never draws looks exactly like a repo with no districts.
   */
  readonly archesDrawn: number;
}

/**
 * How far out the world is drawn.
 *
 * Everything beyond it is fog rather than emptiness, which is honest — the
 * player genuinely cannot see the far side of a city from the street — and is
 * what keeps django's 10,162 roads from being 10,162 quads a frame.
 */
export const VIEW_DISTANCE = 620;
/**
 * How far out a tower is drawn as a **silhouette** — no faces, no roof, no
 * label, no beacon, one flat shape against the haze.
 *
 * NORTH-STAR risk #4's mitigation is *"always show the silhouette of unexplored
 * regions — you can see there's something there, just not what"*, and the flat
 * map has obeyed it since M1 (`regionSilhouette`). The world did not: past
 * `VIEW_DISTANCE` there was **nothing at all**, so crossing between clusters
 * meant seconds of unlit void with `0 towers · 0 roads` in the HUD. A playtest
 * called that the single biggest experiential problem and it is the exact
 * failure risk #4 names — an empty screen reading as "the tool is hiding things
 * from me" rather than as "there is a district over there".
 *
 * Wide enough to cover every repo measured (ADR-0032 §3.1: ark's span is 475,
 * hono's 763, django's diagonal 1,517), because a skyline that stops is worse
 * than no skyline: it draws an edge to a world that has none.
 *
 * **Counted before being trusted, because a path that never fires is worse than
 * no path.** Sampled over 121 standing positions across the walkable area:
 * a mean of **10 silhouettes on ark and 112 on hono** — so this is a real layer
 * on a repo twice the bootstrap's size and nearly dead on the bootstrap itself,
 * whose entire 488-unit span fits inside one view distance. Recorded rather than
 * quietly shipped.
 *
 * The same sampling refuted the reason it was built: **no standing position on
 * either repo has nothing in full view** (0 of 121, both repos). The playtest's
 * `0 towers · 0 roads` frames were the *frustum*, not the distance cull — it had
 * run to the shore and was facing away from the map. Which is honest: there is
 * nothing out there. `withinShore` is tighter now so there is less of it.
 */
export const SILHOUETTE_DISTANCE = 2400;
/** Roads longer than this are cut into pieces, for painter's order and for fog. */
const ROAD_CHOP = 34;

const LABEL_FONT = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
const DISTRICT_FONT = '600 13px ui-monospace, SFMono-Regular, Menlo, monospace';

/**
 * One collision pass, two kinds of name.
 *
 * A district name and a file name compete for the same pixels, so they have to
 * be placed by the same rule — two passes would let a district's name land on
 * top of the file name of the tower it is standing beside.
 */
interface LabelCandidate {
  readonly text: string;
  readonly at: Point;
  readonly ppu: number;
  readonly tint: string;
  /** District names are placed first and drawn larger. */
  readonly district: boolean;
}
/**
 * Sky, horizon and ground.
 *
 * The first palette put a near-black ground under near-black sky, and `fadeAt`
 * then blended distant towers toward *black* rather than toward air — so
 * distance read as "unlit" instead of as "far". Fog needs something to fade
 * into. The horizon band is the lightest thing in the scene for that reason,
 * and the ground is a shade above the sky's top so the plane reads as a
 * surface catching light rather than as a hole.
 */
const SKY_TOP = '#0a1018';
const SKY_HORIZON = '#31405a';
const GROUND = '#161d28';
const GROUND_FAR = '#222c3b';

/**
 * Paint order among primitives at the same depth.
 *
 * Explicit, because the first version tie-broke on `kind.localeCompare`, which
 * is alphabetical and therefore meaningless: it would have painted a district
 * wash *over* the roads drawn on it. Order is a claim about layering and wants
 * to be written down as one.
 */
const RANK = { wash: 0, road: 1, chronicle: 2, arch: 3, tower: 4, hero: 5 } as const;

type Prim =
  /**
   * A district's colour, on the ground, under everything.
   *
   * The one piece of ground ink that is not an edge — and it is still derived:
   * a disc centred on a real node, in that node's region hue, at low alpha, so
   * overlapping members of one region reinforce into a coloured quarter and the
   * boundary between two regions is where their washes stop overlapping. It
   * asserts nothing a region does not already assert (`Region` comes from label
   * propagation over the same graph), and it is what makes *where am I* an
   * answerable question at street level. Without it a walker sees grey ground
   * and coloured walls, and the flat map's principal legibility device — colour
   * as neighbourhood — does not survive the trip into the world.
   */
  | { kind: 'wash'; depth: number; tower: Tower; fade: number }
  | { kind: 'road'; depth: number; a: ViewPoint; b: ViewPoint; fade: number; dashed: boolean }
  | { kind: 'tower'; depth: number; tower: Tower; fade: number }
  | { kind: 'chronicle'; depth: number; fade: number }
  /**
   * A district's name, standing in the district (ADR-0044).
   *
   * Sorted like an object rather than drawn over everything, because it *is*
   * one — a marker painted on top of the buildings in front of it would read as
   * chrome, and the claim it makes is that the district is **here**, which only
   * survives if the thing is somewhere.
   */
  | { kind: 'arch'; depth: number; arch: Arch; fade: number }
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
  const distant: { tower: Tower; distance: number }[] = [];
  for (const tower of world.towers) {
    const dx = tower.node.x - eye.x;
    const dy = tower.node.y - eye.y;
    const distance = Math.hypot(dx, dy);
    if (distance > VIEW_DISTANCE + tower.footprint) {
      if (distance <= SILHOUETTE_DISTANCE) distant.push({ tower, distance });
      continue;
    }
    const centre = toView(eye, tower.node.x, tower.node.y, tower.height / 2);
    if (centre.forward <= 0) {
      // Behind the eye — but a wide tower straddling the eye plane still shows
      // an edge, so only reject when the whole footprint is behind.
      if (centre.forward < -tower.footprint * 2) continue;
    }
    const fade = fadeAt(distance);
    // **Sorted by the tower's nearest point, not its centre.** A wide tower's
    // near face stands a whole footprint closer than its middle, so keying on
    // the centre paints roads that pass *in front of* the face underneath it —
    // pale lines running across a building, which is what the second visual
    // pass showed. Painter's order over objects of different sizes has to use
    // the nearest extent or the big ones sort as if they were thin.
    const depth = centre.forward - tower.footprint;
    prims.push({ kind: 'wash', depth: centre.forward, tower, fade });
    prims.push({ kind: 'tower', depth, tower, fade });
    towersDrawn++;
  }

  // Arches carry further than buildings on purpose: a district's name is what
  // risk #4 asks for — *"always show the silhouette of unexplored regions"* — and
  // a name you can only read once you are standing under it answers nothing about
  // where to go next.
  let archesDrawn = 0;
  for (const arch of world.arches) {
    const distance = Math.hypot(arch.x - eye.x, arch.y - eye.y);
    if (distance > VIEW_DISTANCE * 2) continue;
    const centre = toView(eye, arch.x, arch.y, arch.height / 2);
    if (centre.forward <= -ARCH_SPAN * 2) continue;
    prims.push({
      kind: 'arch',
      depth: centre.forward - ARCH_SPAN,
      arch,
      fade: Math.max(0.3, fadeAt(distance)),
    });
    archesDrawn += 1;
  }

  const chronicleDistance = Math.hypot(world.chronicle.x - eye.x, world.chronicle.y - eye.y);
  if (chronicleDistance <= VIEW_DISTANCE * 1.6) {
    const centre = toView(eye, world.chronicle.x, world.chronicle.y, world.chronicle.height / 2);
    if (centre.forward > -world.chronicle.radius * 2) {
      prims.push({ kind: 'chronicle', depth: centre.forward, fade: fadeAt(chronicleDistance) });
    }
  }

  // The skyline, before everything near it. Far-to-near among themselves, and
  // all of them behind every full-detail tower — which is exact, because
  // "distant" here *means* further than any of them.
  distant.sort((a, b) => b.distance - a.distance);
  let skylineDrawn = 0;
  for (const far of distant) skylineDrawn += drawSilhouette(context, far.tower, eye, viewport) ? 1 : 0;

  const heroView = toView(eye, hero.x, hero.y, 0);
  if (heroView.forward > 0) prims.push({ kind: 'hero', depth: heroView.forward });

  // Far to near. The tie-break keeps two primitives at identical depth in a
  // fixed order, so a frame never flickers between two equally-valid paintings.
  prims.sort((a, b) => b.depth - a.depth || RANK[a.kind] - RANK[b.kind]);

  let beaconsDrawn = 0;
  const labelled: LabelCandidate[] = [];
  for (const arch of world.arches) {
    const head = projectPoint(eye, viewport, arch.x, arch.y, arch.height + ARCH_LINTEL + 6);
    if (head === null) continue;
    if (Math.hypot(arch.x - eye.x, arch.y - eye.y) > VIEW_DISTANCE * 2) continue;
    labelled.push({
      text: arch.region.label,
      at: head.point,
      ppu: head.ppu,
      tint: regionColor(arch.region.index, 0.95),
      district: true,
    });
  }

  for (const prim of prims) {
    if (prim.kind === 'wash') {
      drawWash(context, prim.tower, eye, viewport, prim.fade);
      continue;
    }
    if (prim.kind === 'road') {
      strokeRoad(context, prim, viewport, eye);
      continue;
    }
    if (prim.kind === 'chronicle') {
      drawChronicle(context, world.chronicle, eye, viewport, prim.fade, chronicleLit);
      if (chronicleLit) beaconsDrawn++;
      continue;
    }
    if (prim.kind === 'arch') {
      drawArch(context, prim.arch, eye, viewport, prim.fade);
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
    // Not the waypoint's own target: its pill already names it, and drawing
    // both stacked two identical file names on top of each other.
    const isWaypoint =
      input.waypoint !== null &&
      input.waypoint.x === tower.node.x &&
      input.waypoint.y === tower.node.y;
    if (head !== null && state !== 'silhouette' && prim.fade > 0.25 && !isWaypoint) {
      labelled.push({
        text: tower.node.label,
        at: head.point,
        ppu: head.ppu,
        tint: lit ? INK.question : INK.text,
        district: false,
      });
    }
  }

  const labelsDrawn = drawLabels(context, labelled, viewport, input.chrome);
  if (input.waypoint !== null) drawWaypoint(context, input.waypoint, eye, viewport, hero);

  return { towersDrawn, roadsDrawn, labelsDrawn, beaconsDrawn, skylineDrawn, archesDrawn };
}

/**
 * A far tower: one flat shape, in its region's silhouette tint.
 *
 * Two projections and a rectangle, not eight and five faces — this runs over
 * every node in the atlas at django's 3,035, and the detail would be
 * sub-pixel anyway. The *tint* is the point: risk #4 wants you to see that
 * there is a district over there, and the flat map has said which one by hue
 * since M1. Fog is respected exactly as it is up close, because a silhouette is
 * what an unsurveyed node looks like at any distance.
 */
function drawSilhouette(
  context: CanvasRenderingContext2D,
  tower: Tower,
  eye: Eye,
  viewport: Viewport,
): boolean {
  const foot = projectPoint(eye, viewport, tower.node.x, tower.node.y, 0);
  const head = projectPoint(eye, viewport, tower.node.x, tower.node.y, tower.height);
  if (foot === null || head === null) return false;
  if (foot.point.x < -40 || foot.point.x > viewport.width + 40) return false;
  const half = Math.max(0.5, tower.footprint * foot.ppu);
  context.globalAlpha = 0.5;
  context.fillStyle = regionSilhouette(tower.node.regionIndex, 1);
  context.fillRect(foot.point.x - half, head.point.y, half * 2, foot.point.y - head.point.y);
  context.globalAlpha = 1;
  return true;
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
  const top = Math.max(0, Math.min(viewport.height, horizon));

  const sky = context.createLinearGradient(0, 0, 0, Math.max(1, top));
  sky.addColorStop(0, SKY_TOP);
  sky.addColorStop(1, SKY_HORIZON);
  context.fillStyle = sky;
  context.fillRect(0, 0, viewport.width, top);

  // The ground is graded from the horizon down: far ground is nearly the sky's
  // colour and near ground is darker, which is the cue that says *this plane
  // recedes* on a surface with no texture of its own to shrink.
  const floor = context.createLinearGradient(0, top, 0, viewport.height);
  floor.addColorStop(0, GROUND_FAR);
  floor.addColorStop(1, GROUND);
  context.fillStyle = floor;
  context.fillRect(0, top, viewport.width, viewport.height - top);

  // A glow sitting on the horizon line itself, so the two planes meet in air
  // rather than at a hard seam.
  const haze = context.createLinearGradient(0, top - 90, 0, top + 130);
  haze.addColorStop(0, 'rgba(74, 96, 132, 0)');
  haze.addColorStop(0.42, 'rgba(74, 96, 132, 0.55)');
  haze.addColorStop(1, 'rgba(74, 96, 132, 0)');
  context.fillStyle = haze;
  context.fillRect(0, top - 90, viewport.width, 220);
}

/** 1 near, 0 at the view distance. Everything multiplies its alpha by this. */
function fadeAt(distance: number): number {
  const start = VIEW_DISTANCE * 0.45;
  if (distance <= start) return 1;
  return Math.max(0, 1 - (distance - start) / (VIEW_DISTANCE - start));
}

/**
 * A district's colour pooled on the ground under one file.
 *
 * A ground circle under perspective is an ellipse, and the honest way to draw
 * one is to project points around it rather than to place a screen-space
 * ellipse — the second is right only when the camera looks straight down, which
 * is the one angle this view never uses. Ten points is enough that the edge
 * reads as curved and few enough to run over every visible tower every frame.
 */
const WASH_POINTS = 10;
const WASH_RADIUS = 30;

function drawWash(
  context: CanvasRenderingContext2D,
  tower: Tower,
  eye: Eye,
  viewport: Viewport,
  fade: number,
): void {
  const ring: ViewPoint[] = [];
  for (let i = 0; i < WASH_POINTS; i++) {
    const angle = (i / WASH_POINTS) * Math.PI * 2;
    ring.push(
      toView(
        eye,
        tower.node.x + Math.cos(angle) * WASH_RADIUS,
        tower.node.y + Math.sin(angle) * WASH_RADIUS,
        0,
      ),
    );
  }
  const clipped = clipRing(ring, viewport, eye);
  if (clipped === null) return;
  tracePolygon(context, clipped);
  context.fillStyle = regionWash(tower.node.regionIndex, 1);
  context.globalAlpha = fade * 0.16;
  context.fill();
  context.globalAlpha = 1;
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
  // Quiet on purpose. A road is ground, and at this density a bright one reads
  // as a scratch across whatever building happens to stand behind it.
  context.fillStyle = prim.dashed ? 'rgba(176, 198, 230, 0.16)' : 'rgba(198, 220, 250, 0.30)';
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
  return 0.30 + 0.72 * Math.abs(dx / span);
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
  return clipRing([a, b, c, d], viewport, eye);
}

/** The same, for a convex ring of any length. */
function clipRing(input: readonly ViewPoint[], viewport: Viewport, eye: Eye): Point[] | null {
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

/**
 * A district's gateway: four pillars and the four beams that join them.
 *
 * In the **region's own hue**, which is the piece of work this does that no
 * other surface can. The world has carried region colour since it shipped — the
 * ground wash and every tower body — and has never said what any of those
 * colours *mean*. The flat map answers that with a legend the world does not
 * have; naming the district in its own colour is the legend, standing in the
 * place it describes.
 *
 * The middle is left open on purpose. A slab across the top is a roof, and a
 * roof at 26 units hides the skyline behind it from anyone standing near — the
 * one thing risk #4 asks the world to keep showing.
 */
function drawArch(
  context: CanvasRenderingContext2D,
  arch: Arch,
  eye: Eye,
  viewport: Viewport,
  fade: number,
): void {
  const boxes: { cx: number; cy: number; hx: number; hy: number; z0: number; z1: number }[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      boxes.push({
        cx: arch.x + sx * ARCH_SPAN,
        cy: arch.y + sy * ARCH_SPAN,
        hx: ARCH_PILLAR,
        hy: ARCH_PILLAR,
        z0: 0,
        z1: arch.height,
      });
    }
  }
  const reach = ARCH_SPAN + ARCH_PILLAR;
  for (const side of [-1, 1]) {
    boxes.push({ cx: arch.x, cy: arch.y + side * ARCH_SPAN, hx: reach, hy: ARCH_PILLAR, z0: arch.height, z1: arch.height + ARCH_LINTEL });
    boxes.push({ cx: arch.x + side * ARCH_SPAN, cy: arch.y, hx: ARCH_PILLAR, hy: reach, z0: arch.height, z1: arch.height + ARCH_LINTEL });
  }

  const colour = regionColor(arch.region.index, 1);
  context.globalAlpha = fade;
  const ordered = boxes
    .map((box) => ({ box, depth: toView(eye, box.cx, box.cy, (box.z0 + box.z1) / 2).forward }))
    .sort((a, b) => b.depth - a.depth);
  for (const { box } of ordered) {
    const corners: [number, number][] = [
      [box.cx - box.hx, box.cy - box.hy],
      [box.cx + box.hx, box.cy - box.hy],
      [box.cx + box.hx, box.cy + box.hy],
      [box.cx - box.hx, box.cy + box.hy],
    ];
    const base = corners.map(([cx, cy]) => toView(eye, cx, cy, box.z0));
    const top = corners.map(([cx, cy]) => toView(eye, cx, cy, box.z1));
    const sides = [0, 1, 2, 3]
      .map((i) => ({ i, j: (i + 1) % 4 }))
      .map(({ i, j }) => ({ i, j, depth: ((base[i] as ViewPoint).forward + (base[j] as ViewPoint).forward) / 2 }))
      .sort((p, q) => q.depth - p.depth);
    for (const side of sides) {
      const b0 = base[side.i] as ViewPoint;
      const b1 = base[side.j] as ViewPoint;
      const quad = clipQuad(b0, b1, top[side.j] as ViewPoint, top[side.i] as ViewPoint, viewport, eye);
      if (quad === null) continue;
      tracePolygon(context, quad);
      context.fillStyle = shade(colour, faceShade(b0, b1));
      context.fill();
    }
    const cap = clipQuad(top[0] as ViewPoint, top[1] as ViewPoint, top[2] as ViewPoint, top[3] as ViewPoint, viewport, eye);
    if (cap !== null) {
      tracePolygon(context, cap);
      context.fillStyle = colour;
      context.fill();
    }
  }
  context.globalAlpha = 1;
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
  context.fillStyle = 'rgba(0, 0, 0, 0.5)';
  context.beginPath();
  context.ellipse(foot.point.x, foot.point.y, HERO_RADIUS * ppu * 1.5, HERO_RADIUS * ppu * 0.6, 0, 0, Math.PI * 2);
  context.fill();
  // A ring on the ground at the body's own radius: the one mark that says
  // *this is you* at any distance, and it doubles as the collision footprint
  // made visible, so what you can squeeze through is legible rather than felt.
  context.strokeStyle = 'rgba(255, 236, 190, 0.85)';
  context.lineWidth = Math.max(1, ppu * 0.16);
  context.beginPath();
  context.ellipse(foot.point.x, foot.point.y, HERO_RADIUS * ppu, HERO_RADIUS * ppu * 0.4, 0, 0, Math.PI * 2);
  context.stroke();

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
  candidates: LabelCandidate[],
  viewport: Viewport,
  chrome: readonly Box[],
): number {
  context.textAlign = 'center';
  context.textBaseline = 'bottom';
  const placed: { x: number; y: number; half: number }[] = [];
  let drawn = 0;
  // **District names first, whatever their distance.** Sorting the whole list by
  // apparent size would drop a district's name behind the file names of the very
  // buildings it stands among — and a name that only survives when nothing is in
  // front of it is not a landmark. File names then take the remaining room by
  // nearest-first, exactly as before.
  const ordered = [...candidates].sort(
    (a, b) => Number(b.district) - Number(a.district) || b.ppu - a.ppu,
  );
  for (const candidate of ordered) {
    if (drawn >= 22) break;
    const { at } = candidate;
    if (at.x < 0 || at.x > viewport.width) continue;
    if (!candidate.district && (at.y < 0 || at.y > viewport.height)) continue;
    const text = candidate.text;
    context.font = candidate.district ? DISTRICT_FONT : LABEL_FONT;
    const half = context.measureText(text).width / 2 + 4;
    // **A district name is pinned into view rather than dropped.** An arch
    // clears its district's tallest roof, so standing under one puts its head
    // far above the screen — exactly when knowing which district you are in is
    // most useful. Dropping it there would make the label appear only at middle
    // distance, which is the same defect the first fixed-height arch had, moved
    // from the geometry into the text.
    const y = candidate.district
      ? Math.min(viewport.height - 24, Math.max(24, at.y - 8))
      : at.y - 8;
    if (
      chrome.some(
        (box) =>
          at.x + half > box.left &&
          at.x - half < box.left + box.width &&
          y > box.top &&
          y - 15 < box.top + box.height,
      )
    ) {
      continue;
    }
    const clash = placed.some(
      (other) => Math.abs(other.y - y) < 15 && Math.abs(other.x - at.x) < other.half + half,
    );
    if (clash) continue;
    placed.push({ x: at.x, y, half });
    context.fillStyle = 'rgba(6, 9, 14, 0.72)';
    context.fillRect(at.x - half, y - 13, half * 2, 15);
    context.fillStyle = candidate.tint;
    context.fillText(text, at.x, y);
    // A pinned name says *that way*, not *here*, and without the chevron a row
    // of them along the top edge reads as chrome — a tab bar the player has no
    // reason to connect to anything in the world.
    if (candidate.district && y !== at.y - 8) {
      const up = at.y - 8 < y;
      const tip = up ? y - 19 : y + 10;
      const base = up ? y - 15 : y + 6;
      context.beginPath();
      context.moveTo(at.x, tip);
      context.lineTo(at.x - 4, base);
      context.lineTo(at.x + 4, base);
      context.closePath();
      context.fill();
    }
    drawn++;
  }
  context.font = LABEL_FONT;
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  return drawn;
}

/**
 * The way to the next question.
 *
 * The playtest's flattest complaint was not a bug: you cannot tell where to go.
 * The flat map answers that at a glance and the world could not answer it at
 * all — so a walker's only strategy was to wander until a beacon appeared,
 * which is the opposite of the deliberate route the guide already computes.
 *
 * On screen it is a chevron over the place; off screen it is an arrow pinned to
 * the edge in the right direction. Both carry the distance, because "which way"
 * without "how far" still leaves you guessing whether to commit.
 */
function drawWaypoint(
  context: CanvasRenderingContext2D,
  waypoint: { x: number; y: number; label: string },
  eye: Eye,
  viewport: Viewport,
  hero: Hero,
): void {
  const paces = Math.round(Math.hypot(waypoint.x - hero.x, waypoint.y - hero.y));
  const text = `${waypoint.label} · ${paces}`;
  context.save();
  context.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
  context.textAlign = 'center';

  const overhead = projectPoint(eye, viewport, waypoint.x, waypoint.y, 34);
  const onScreen =
    overhead !== null &&
    overhead.point.x > 40 &&
    overhead.point.x < viewport.width - 40 &&
    overhead.point.y > 40 &&
    overhead.point.y < viewport.height - 40;

  if (onScreen && overhead !== null) {
    const { x, y } = overhead.point;
    context.fillStyle = 'rgba(255, 214, 130, 0.92)';
    context.beginPath();
    context.moveTo(x, y + 12);
    context.lineTo(x - 9, y - 6);
    context.lineTo(x + 9, y - 6);
    context.closePath();
    context.fill();
    labelPill(context, text, x, y - 12);
    context.restore();
    return;
  }

  // Off screen: an arrow on the edge, pointing the way. The bearing is computed
  // in **view space** so it stays correct when the target is behind the eye —
  // the case a screen-space angle gets exactly backwards, and the case that
  // matters most, because a target behind you is when you most need telling.
  const view = toView(eye, waypoint.x, waypoint.y, 0);
  const angle = Math.atan2(view.right, Math.max(view.forward, 0.001));
  const clamped = Math.max(-1.35, Math.min(1.35, angle));
  const x = viewport.width / 2 + Math.tan(clamped) * (viewport.width * 0.34);
  const y = view.forward > 0 ? 74 : viewport.height - 132;
  const pointingDown = view.forward <= 0;
  context.fillStyle = 'rgba(255, 214, 130, 0.92)';
  context.beginPath();
  context.moveTo(x, pointingDown ? y + 13 : y - 13);
  context.lineTo(x - 10, pointingDown ? y - 6 : y + 6);
  context.lineTo(x + 10, pointingDown ? y - 6 : y + 6);
  context.closePath();
  context.fill();
  labelPill(context, text, x, pointingDown ? y - 12 : y + 30);
  context.restore();
}

function labelPill(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
): void {
  const half = context.measureText(text).width / 2 + 7;
  context.fillStyle = 'rgba(6, 9, 14, 0.82)';
  context.fillRect(x - half, y - 14, half * 2, 17);
  context.fillStyle = 'rgba(255, 226, 168, 0.95)';
  context.fillText(text, x, y);
}
