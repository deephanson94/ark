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
import type { LabelCandidate } from './labels.js';
import { placeLabels } from './labels.js';
import { INK, regionColor, regionSilhouette, regionWash } from './palette.js';
import type { Radius, Scene, SceneNode } from './scene.js';
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
}

export interface FrameStats {
  readonly nodesDrawn: number;
  readonly edgesDrawn: number;
  readonly labelsDrawn: number;
  readonly level: string;
}

const LABEL_FONT = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
const REGION_FONT = '600 15px ui-sans-serif, system-ui, sans-serif';

export function drawFrame(context: CanvasRenderingContext2D, input: FrameInput): FrameStats {
  const { scene, camera, viewport, fog, hovered, selected, radius, questions } = input;
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
  let labelsDrawn = 0;
  if (style.showRegionLabels) {
    context.font = REGION_FONT;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    for (const region of scene.regions) {
      const point = worldToScreen(camera, viewport, region);
      if (point.x < -80 || point.x > viewport.width + 80) continue;
      if (point.y < -40 || point.y > viewport.height + 40) continue;
      context.fillStyle = regionColor(region.index, 0.85);
      context.fillText(region.label, point.x, point.y);
      context.fillStyle = INK.textDim;
      context.font = LABEL_FONT;
      context.fillText(`${region.nodeCount} files`, point.x, point.y + 16);
      context.font = REGION_FONT;
      labelsDrawn++;
    }
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
        priority: node.dependentCount * 10 + node.radius,
      });
    }
    const placed = placeLabels(candidates, (text) => context.measureText(text).width, {
      lineHeight: 14,
      padding: 3,
      budget: style.nodeLabelBudget,
      width: viewport.width,
      height: viewport.height,
    });
    for (const label of placed) {
      context.fillStyle = INK.text;
      context.fillText(label.text, label.x, label.y - 3);
    }
    labelsDrawn += placed.length;
  }

  context.restore();
  return { nodesDrawn: nodes.length, edgesDrawn: edges.length, labelsDrawn, level };
}
