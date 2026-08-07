/**
 * Canvas rendering.
 *
 * The only module that touches a drawing context. Everything it needs has
 * already been decided by the pure modules — what is on screen, what is
 * labelled, what the fog says about each node. This file just puts ink down.
 *
 * Draw order is back to front: fog wash, edges, highlighted edges, nodes,
 * region labels, node labels. Edges under nodes, always — a hairball of lines
 * over the discs makes the discs unreadable, and the discs are the thing you
 * are meant to remember the position of.
 */

import type { NodeRef } from '../atlas/index.js';
import type { Camera, Viewport } from './camera.js';
import { visibleBounds, worldToScreen } from './camera.js';
import type { Fog } from './fog.js';
import { visibilityOf } from './fog.js';
import type { LabelCandidate, PlacedLabel } from './labels.js';
import { placeLabels } from './labels.js';
import { INK, regionColor, regionSilhouette, regionWash } from './palette.js';
import type { Orbit } from './orbit.js';
import { columns } from './orbit.js';
import type { Radius, Scene, SceneNode, SceneRegion } from './scene.js';
import { visibleEdges, visibleNodes } from './scene.js';
import { levelFor, styleFor } from './zoom.js';

export interface FrameInput {
  readonly scene: Scene;
  readonly camera: Camera;
  readonly viewport: Viewport;
  readonly fog: Fog;
  readonly hovered: SceneNode | null;
  readonly selected: SceneNode | null;
  readonly radius: Radius | null;
  /** Nodes carrying a question the player has not passed yet. */
  readonly questions: ReadonlySet<NodeRef>;
  /**
   * The peaks — `fog.landmarks()`'s pick, by ADR-0013 elevation. Drawn as
   * always-visible summits and always labelled, at every zoom level.
   */
  readonly peaks: ReadonlySet<NodeRef>;
}

export interface FrameStats {
  readonly nodesDrawn: number;
  readonly edgesDrawn: number;
  readonly labelsDrawn: number;
  readonly level: string;
  /** Peaks actually drawn this frame. A measured value, for the liveness test. */
  readonly peaksDrawn: number;
}

const LABEL_FONT = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
/** Tall enough for the label and its file count, which are drawn as a pair. */
const REGION_LINE_HEIGHT = 34;
const REGION_LABEL_PADDING = 10;

const REGION_FONT = '600 15px ui-sans-serif, system-ui, sans-serif';

export function drawFrame(context: CanvasRenderingContext2D, input: FrameInput): FrameStats {
  const { scene, camera, viewport, fog, hovered, selected, radius, questions, peaks } = input;
  const level = levelFor(camera.scale);
  const style = styleFor(level);

  context.save();
  context.fillStyle = INK.ground;
  context.fillRect(0, 0, viewport.width, viewport.height);

  const bounds = visibleBounds(camera, viewport, 120);
  const nodes = visibleNodes(scene, bounds, camera.scale);
  const onScreen = new Set(nodes.map((node) => node.ref));
  const edges = style.showEdges ? visibleEdges(scene, onScreen) : [];

  const inRadius = radius?.dependents ?? null;
  const project = (node: SceneNode): { x: number; y: number } =>
    worldToScreen(camera, viewport, node);

  // ---- edges ------------------------------------------------------------
  context.lineWidth = Math.max(0.5, 0.9 * Math.min(1, camera.scale));
  for (const edge of edges) {
    const from = scene.nodes[edge.from];
    const to = scene.nodes[edge.to];
    if (from === undefined || to === undefined) continue;
    const highlighted =
      radius !== null &&
      (inRadius?.has(edge.from) === true || edge.from === radius.subject) &&
      (inRadius?.has(edge.to) === true || edge.to === radius.subject);

    const a = project(from);
    const b = project(to);
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.strokeStyle = highlighted ? INK.edgeHighlight : INK.edge;
    context.globalAlpha = highlighted ? 1 : style.edgeAlpha;
    // A `probable` edge is one the indexer had to guess between two viable
    // targets. Dashing it puts the confidence model on the map rather than
    // burying it in the schema.
    context.setLineDash(edge.confidence === 'probable' ? [3, 3] : []);
    context.stroke();
  }
  context.setLineDash([]);
  context.globalAlpha = 1;

  // ---- nodes ------------------------------------------------------------
  for (const node of nodes) {
    const point = project(node);
    const drawn = Math.max(1.4, node.radius * camera.scale * style.nodeScale);
    const state = visibilityOf(fog, node.id);
    const dimmed = radius !== null && node.ref !== radius.subject && inRadius?.has(node.ref) !== true;

    context.beginPath();
    context.arc(point.x, point.y, drawn, 0, Math.PI * 2);

    if (state === 'silhouette') {
      // Shape, position and neighbourhood visible; identity withheld. Risk #4:
      // you can always see that there is something there.
      context.fillStyle = regionSilhouette(node.regionIndex, 1);
      context.globalAlpha = dimmed ? 0.45 : 1;
      context.fill();
    } else {
      context.fillStyle = regionWash(node.regionIndex, 1);
      context.globalAlpha = dimmed ? 0.4 : 1;
      context.fill();
      context.strokeStyle = regionColor(node.regionIndex, 1);
      context.lineWidth = state === 'understood' ? 2.5 : 1.4;
      context.stroke();
    }
    context.globalAlpha = 1;
  }

  // ---- summits ----------------------------------------------------------
  //
  // ADR-0013: `elevation` is how many files transitively depend on this one, and
  // the map was previously silent about it — measured on this repo, cone size
  // correlates with disc radius at rho −0.19. So the load-bearing files get a
  // summit: concentric rings, one per layer above the ground, drawn *behind*
  // nothing and visible at every zoom.
  //
  // Rings rather than a hypsometric tint or contour lines, and that was a
  // review's correction. Contours need a *field*, and an atlas has points —
  // interpolating height into the empty space between files asserts terrain
  // where no file exists, which is inventing geography, which pillar 4 loses. A
  // tint has no free channel either: fill already carries region hue, fog state
  // and dimming. `docs/prior-art.md` §4.3.5 is the positive argument — globally
  // visible **landmarks** beat terrain texture for spatial learning, measurably
  // and three weeks later.
  //
  // Drawn even when the node is a silhouette. That is risk #4's own mitigation
  // read literally: you can always see *that* there is a mountain there. Its
  // name is still withheld until you have surveyed it, which the label pass
  // below enforces.
  let peaksDrawn = 0;
  for (const node of nodes) {
    if (!peaks.has(node.ref) || node.elevation <= 0) continue;
    const point = project(node);
    const drawn = Math.max(1.4, node.radius * camera.scale * style.nodeScale);
    // One ring per layer, capped: twelve rings is a target, not a summit.
    const rings = Math.min(4, node.elevation);
    context.strokeStyle = regionColor(node.regionIndex, 1);
    for (let ring = 1; ring <= rings; ring++) {
      context.globalAlpha = 0.5 - ring * 0.08;
      context.lineWidth = 1;
      context.beginPath();
      context.arc(point.x, point.y, drawn + ring * 4, 0, Math.PI * 2);
      context.stroke();
    }
    context.globalAlpha = 1;
    peaksDrawn++;
  }

  // ---- question rings ---------------------------------------------------
  // §4's loop is "pick a landmark", and a landmark you cannot see is not one.
  // A node carrying an unanswered question wears a broken accent ring: legible
  // at a glance across the whole map, and gone the moment you pass it, so the
  // map doubles as the progress display.
  if (questions.size > 0) {
    context.strokeStyle = INK.question;
    context.lineWidth = 1.6;
    context.setLineDash([2.5, 3.5]);
    for (const node of nodes) {
      if (!questions.has(node.ref)) continue;
      const point = project(node);
      const drawn = Math.max(1.4, node.radius * camera.scale * style.nodeScale);
      context.beginPath();
      context.arc(point.x, point.y, drawn + 3.5, 0, Math.PI * 2);
      context.stroke();
    }
    context.setLineDash([]);
  }

  // ---- subject and hover rings -----------------------------------------
  for (const node of [selected, hovered]) {
    if (node === null) continue;
    const point = project(node);
    const drawn = Math.max(1.4, node.radius * camera.scale * style.nodeScale);
    context.beginPath();
    context.arc(point.x, point.y, drawn + 5, 0, Math.PI * 2);
    context.strokeStyle = node === selected ? INK.text : INK.edgeHighlight;
    context.lineWidth = 1.5;
    context.stroke();
  }

  // ---- region labels ----------------------------------------------------
  //
  // Through the same collision pass node labels use. Drawing them raw was a
  // rendering bug independent of how good region detection is: on a 2,000-file
  // repo it printed 771 overlapping labels and the map became a solid smear.
  // Ranking by member count means territory zoom shows the big regions and
  // zooming in gives the small ones room — which is what `zoom.ts` promises and
  // what no numeric cap can reproduce.
  let labelsDrawn = 0;
  let placedRegions: readonly PlacedLabel[] = [];
  if (style.showRegionLabels) {
    context.font = REGION_FONT;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const byText = new Map<string, SceneRegion>();
    const candidates = scene.regions.map((region) => {
      byText.set(region.label, region);
      const point = worldToScreen(camera, viewport, region);
      return {
        text: region.label,
        x: point.x,
        y: point.y,
        offset: -REGION_LINE_HEIGHT / 2,
        priority: region.nodeCount,
      };
    });
    placedRegions = placeLabels(candidates, (text) => context.measureText(text).width, {
      budget: Number.POSITIVE_INFINITY,
      padding: REGION_LABEL_PADDING,
      lineHeight: REGION_LINE_HEIGHT,
      width: viewport.width,
      height: viewport.height,
    });
    for (const label of placedRegions) {
      const region = byText.get(label.text);
      if (region === undefined) continue;
      context.fillStyle = regionColor(region.index, 0.85);
      context.font = REGION_FONT;
      context.fillText(label.text, label.x, label.y - REGION_LINE_HEIGHT / 2);
      context.fillStyle = INK.textDim;
      context.font = LABEL_FONT;
      context.fillText(`${region.nodeCount} files`, label.x, label.y + REGION_LINE_HEIGHT / 2);
      labelsDrawn++;
    }
    context.font = REGION_FONT;
  }

  // ---- node labels ------------------------------------------------------
  if (style.showNodeLabels) {
    context.font = LABEL_FONT;
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';
    const candidates: LabelCandidate[] = [];
    for (const node of nodes) {
      // A name you have not surveyed is exactly what the fog is withholding.
      if (visibilityOf(fog, node.id) === 'silhouette') continue;
      const point = project(node);
      candidates.push({
        text: node.label,
        x: point.x,
        y: point.y,
        offset: Math.max(1.4, node.radius * camera.scale * style.nodeScale) + 2,
        // Elevation first, so the label that survives a crowded frame is the
        // one on the most load-bearing file. In-degree remains the tiebreak: it
        // is a fine proxy everywhere except the chokepoints, which is exactly
        // where elevation is doing the work.
        priority: node.elevation * 1000 + node.dependentCount * 10 + node.radius,
      });
    }
    const placed = placeLabels(candidates, (text) => context.measureText(text).width, {
      lineHeight: 14,
      padding: 3,
      budget: style.nodeLabelBudget,
      width: viewport.width,
      height: viewport.height,
      // Region labels went down first and keep their space.
      occupied: placedRegions,
    });
    for (const label of placed) {
      context.fillStyle = INK.text;
      context.fillText(label.text, label.x, label.y - 3);
    }
    labelsDrawn += placed.length;
  }

  context.restore();
  return { nodesDrawn: nodes.length, edgesDrawn: edges.length, labelsDrawn, level, peaksDrawn };
}


/**
 * The orbit frame: the same scene, standing up and turned.
 *
 * Deliberately a *second function* rather than a mode inside `drawFrame`. The
 * flat map is the thing the whole product rests on and it is measured, tested
 * and screenshot on every run; threading a projection through it would put the
 * overview one bad conditional away from breaking. This shares the scene, the
 * fog, the palette and the label placer, and nothing else.
 *
 * Edges are drawn **between the tops of columns**, not along the ground. That
 * is the point of the whole view: path tracing in a node-link graph is the task
 * 3D-with-parallax measurably wins at (`docs/prior-art.md` §2), and a wire
 * between two roofs is a path you can follow with your eye as the world turns.
 */
export function drawOrbitFrame(
  context: CanvasRenderingContext2D,
  input: FrameInput,
  orbit: Orbit,
): FrameStats {
  const { scene, camera, viewport, fog, hovered, selected, radius, questions, peaks } = input;
  const level = levelFor(camera.scale);
  const style = styleFor(level);

  context.save();
  context.fillStyle = INK.ground;
  context.fillRect(0, 0, viewport.width, viewport.height);

  // Every node, every frame: there is no view-frustum cull here yet, and that
  // is a measured omission rather than an oversight — at this repo's scale the
  // sort dominates. It is the first thing to add when `npm run raster` says so.
  const ordered = columns(scene.nodes, camera, viewport, orbit);
  const screenOf = new Map(ordered.map((column) => [column.node.ref, column]));
  const highlighted = radius?.dependents ?? null;

  // ---- wires ------------------------------------------------------------
  context.lineWidth = Math.max(0.5, 0.8 * Math.min(1, camera.scale));
  let edgesDrawn = 0;
  for (const edge of scene.edges) {
    const from = screenOf.get(edge.from);
    const to = screenOf.get(edge.to);
    if (from === undefined || to === undefined) continue;
    const lit =
      radius !== null &&
      (highlighted?.has(edge.from) === true || edge.from === radius.subject) &&
      (highlighted?.has(edge.to) === true || edge.to === radius.subject);
    context.beginPath();
    context.moveTo(from.top.x, from.top.y);
    context.lineTo(to.top.x, to.top.y);
    context.strokeStyle = lit ? INK.edgeHighlight : INK.edge;
    context.globalAlpha = lit ? 1 : style.edgeAlpha * 0.7;
    context.setLineDash(edge.confidence === 'probable' ? [3, 3] : []);
    context.stroke();
    edgesDrawn++;
  }
  context.setLineDash([]);
  context.globalAlpha = 1;

  // ---- columns, far to near ---------------------------------------------
  let peaksDrawn = 0;
  for (const column of ordered) {
    const { node, base, top } = column;
    const state = visibilityOf(fog, node.id);
    const drawn = Math.max(1.4, node.radius * camera.scale * style.nodeScale);
    const dimmed = radius !== null && node.ref !== radius.subject && highlighted?.has(node.ref) !== true;

    if (node.elevation > 0) {
      // The stalk. Its length *is* the claim: how many files depend on this one.
      context.beginPath();
      context.moveTo(base.x, base.y);
      context.lineTo(top.x, top.y);
      context.strokeStyle = state === 'silhouette' ? regionSilhouette(node.regionIndex, 1) : regionColor(node.regionIndex, 1);
      context.globalAlpha = dimmed ? 0.25 : 0.55;
      context.lineWidth = Math.max(1, drawn * 0.5);
      context.stroke();
      // A footing, so a tall column still reads as standing *somewhere* — the
      // whole reason X,Y are preserved is that the ground plan is the memory.
      context.globalAlpha = dimmed ? 0.15 : 0.3;
      context.beginPath();
      context.ellipse(base.x, base.y, drawn, Math.max(0.6, drawn * Math.cos(orbit.pitch)), 0, 0, Math.PI * 2);
      context.fillStyle = regionWash(node.regionIndex, 1);
      context.fill();
    }

    context.globalAlpha = dimmed ? 0.45 : 1;
    context.beginPath();
    context.arc(top.x, top.y, drawn, 0, Math.PI * 2);
    if (state === 'silhouette') {
      context.fillStyle = regionSilhouette(node.regionIndex, 1);
      context.fill();
    } else {
      context.fillStyle = regionWash(node.regionIndex, 1);
      context.fill();
      context.strokeStyle = regionColor(node.regionIndex, 1);
      context.lineWidth = state === 'understood' ? 2.5 : 1.4;
      context.stroke();
    }
    context.globalAlpha = 1;

    if (questions.has(node.ref)) {
      context.strokeStyle = INK.question;
      context.lineWidth = 1.6;
      context.setLineDash([2.5, 3.5]);
      context.beginPath();
      context.arc(top.x, top.y, drawn + 3.5, 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);
    }
    if (peaks.has(node.ref) && node.elevation > 0) peaksDrawn++;
    if (node === selected || node === hovered) {
      context.beginPath();
      context.arc(top.x, top.y, drawn + 5, 0, Math.PI * 2);
      context.strokeStyle = node === selected ? INK.text : INK.edgeHighlight;
      context.lineWidth = 1.5;
      context.stroke();
    }
  }

  // ---- labels, on the summits only --------------------------------------
  //
  // Only peaks are named here, and that is `docs/prior-art.md` §4.3.5 applied:
  // a few globally visible landmarks outperform terrain texture for spatial
  // learning. A turning world with every name on it is a smear.
  context.font = LABEL_FONT;
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  const candidates: LabelCandidate[] = [];
  for (const column of ordered) {
    if (!peaks.has(column.node.ref)) continue;
    if (visibilityOf(fog, column.node.id) === 'silhouette') continue;
    candidates.push({
      text: column.node.label,
      x: column.top.x,
      y: column.top.y,
      offset: Math.max(1.4, column.node.radius * camera.scale * style.nodeScale) + 2,
      priority: column.node.elevation * 1000 + column.node.dependentCount,
    });
  }
  const placed = placeLabels(candidates, (text) => context.measureText(text).width, {
    lineHeight: 14,
    padding: 3,
    budget: Number.POSITIVE_INFINITY,
    width: viewport.width,
    height: viewport.height,
  });
  for (const label of placed) {
    context.fillStyle = INK.text;
    context.fillText(label.text, label.x, label.y - 3);
  }

  context.restore();
  return {
    nodesDrawn: ordered.length,
    edgesDrawn,
    labelsDrawn: placed.length,
    level,
    peaksDrawn,
  };
}
