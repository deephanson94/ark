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
import { worldToScreen } from './camera.js';
import type { Fog } from './fog.js';
import { visibilityOf } from './fog.js';
import type { LabelCandidate, PlacedLabel } from './labels.js';
import { placeLabels } from './labels.js';
import { INK, regionColor, regionSilhouette, regionWash } from './palette.js';
import type { Column, Orbit } from './orbit.js';
import { columns } from './orbit.js';
import type { Radius, Scene, SceneNode, SceneRegion } from './scene.js';
import type { Tie, Ties } from './ties.js';
import { tieWidth, tiesAt } from './ties.js';
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
  /**
   * Co-change wires the player has earned the right to see (`ties.ts`).
   *
   * Handed in already filtered, like everything else here — this module draws
   * what it is given and never decides who may see what. That property is what
   * kept the three ADR-0014 leaks out of `draw.ts` and into the modules that
   * actually know which verb is asking.
   */
  readonly ties: Ties;
  /** Whose wires draw bright rather than at rest. */
  readonly tieFocus: NodeRef | null;
}

export interface FrameStats {
  readonly nodesDrawn: number;
  readonly edgesDrawn: number;
  readonly labelsDrawn: number;
  readonly level: string;
  /** Peaks actually drawn this frame. A measured value, for the liveness test. */
  readonly peaksDrawn: number;
  /**
   * Wires actually stroked this frame. Measured for the same reason
   * `peaksDrawn` is: CLAUDE.md's landmine says a path that never executes is
   * worse than no path, and the only way to know this one fires is to count it
   * on a real repo rather than to assert it in a fixture.
   */
  readonly tiesDrawn: number;
}

const LABEL_FONT = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
/** Tall enough for the label and its file count, which are drawn as a pair. */
const REGION_LINE_HEIGHT = 34;
const REGION_LABEL_PADDING = 10;

const REGION_FONT = '600 15px ui-sans-serif, system-ui, sans-serif';

/**
 * How far a history wire bows off the straight line, as a fraction of its span.
 *
 * Shallow on purpose. Enough that the eye separates an arc from an import line
 * instantly — including where the two connect the same pair, which is the case
 * that carries the lesson — and not so much that a wire wanders across nodes it
 * has nothing to do with. Curvature is the channel; distance is not.
 */
const TIE_BOW = 0.16;

export function drawFrame(context: CanvasRenderingContext2D, input: FrameInput): FrameStats {
  const { scene, camera, viewport, fog, hovered, selected, radius, questions, peaks, ties, tieFocus } =
    input;
  const level = levelFor(camera.scale);
  const style = styleFor(level);

  context.save();
  context.fillStyle = INK.ground;
  context.fillRect(0, 0, viewport.width, viewport.height);

  const nodes = visibleNodes(scene, camera, viewport, 120);
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

  // ---- history wires ----------------------------------------------------
  //
  // The co-change relation, drawn as shallow arcs so it separates from the
  // straight import lines *before* colour registers — which matters because
  // many companions also import each other, and a straight wire would hide
  // underneath the import edge exactly where the lesson is ("coupled twice
  // over", `companion/reveal.ts`'s `whyYes`).
  //
  // Drawn at **every** zoom level, unlike imports. There are at most a few
  // dozen, they are earned rather than structural, and the long cross-region
  // wires — the ones that say "these two move together and nothing connects
  // them" — are exactly what territory zoom is for.
  //
  // `a < b` in every `Tie`, so the bow direction is a property of the pair and
  // a wire does not flip sides between frames.
  let tiesDrawn = 0;
  const focused = tiesAt(ties, tieFocus);
  const bright = new Set(focused);
  const arc = (tie: Tie, colour: string): void => {
    const from = scene.nodes[tie.a];
    const to = scene.nodes[tie.b];
    if (from === undefined || to === undefined) return;
    // **No endpoint cull.** The obvious `!onScreen(a) && !onScreen(b) → skip`
    // is wrong for this relation in the case that matters most: at street zoom
    // a long cross-region wire has *both* ends off screen exactly when you are
    // standing between them, so the one wire you most want to see is the one
    // that disappears. Import edges can afford that cull because they are short
    // and there are a few hundred; wires are bounded by the *deck* — at most one
    // per key member per passed board — rather than by the repo.
    //
    // That bound is loose on a large repo and worth stating: svelte carries 508
    // Companion boards, so a full clear there is on the order of a thousand
    // curves stroked every frame, in a renderer already measured under its
    // 50 fps budget. If `npm run raster` is ever run on real hardware
    // (ADR-0009's P1′), measure a cleared deck, not an empty one.
    const a = project(from);
    const b = project(to);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    context.beginPath();
    context.moveTo(a.x, a.y);
    // Control point: the midpoint pushed perpendicular by a fixed fraction of
    // the span, so curvature reads the same at every distance.
    context.quadraticCurveTo(
      (a.x + b.x) / 2 - dy * TIE_BOW,
      (a.y + b.y) / 2 + dx * TIE_BOW,
      b.x,
      b.y,
    );
    context.strokeStyle = colour;
    context.lineWidth = tieWidth(tie.count) * Math.min(1, Math.max(0.45, camera.scale));
    context.stroke();
    tiesDrawn += 1;
  };
  // Rest first, focus over it. The two states differ by alpha *inside* the
  // colour (`INK.tieRest` against `INK.tie`), not by `globalAlpha`, so a wire
  // never inherits a leftover alpha from the edge pass above.
  for (const tie of ties.all) if (!bright.has(tie)) arc(tie, INK.tieRest);
  for (const tie of focused) arc(tie, INK.tie);
  context.lineWidth = 1;

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
  return {
    nodesDrawn: nodes.length,
    edgesDrawn: edges.length,
    labelsDrawn,
    level,
    peaksDrawn,
    tiesDrawn,
  };
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

  // **`ties` is deliberately not destructured, and the orbit draws no history
  // wires this session.** Stated rather than omitted, because an omission looks
  // identical to an oversight.
  //
  // The honest reason is smaller than "the geometry does not exist". The arc is
  // built in *screen* space — project both ends, bow perpendicular to the
  // projected segment — so it transfers to the orbit unchanged, and the wires
  // section already draws straight import edges between column tops with a
  // deliberate under/over split. What is undecided is only **which anchor**
  // (top, like the import wires, or base, where the footing is) and how a wire
  // occludes against the columns it crosses. Top-to-top is the obvious
  // candidate and this is a rung, not a blocker.
  //
  // The cost is player-visible and is recorded in ADR-0016: Companion's summary
  // promises wires "drawn once both files' questions are answered", and a
  // player one keystroke into the orbit sees earned ink gone and the HUD read
  // `0 wires`. `tiesDrawn: 0` is therefore accurate rather than a stub — but
  // accurate about an absence the player has not been told to expect.
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
  //
  // Split in two, above and below the columns, and the split is the whole
  // point. Path tracing along edges is the *measured* win this view exists for
  // (`docs/prior-art.md` §2), so the edges of the radius under inspection are
  // drawn **after** the columns, where nothing can occlude them. Everything
  // else goes underneath.
  //
  // Drawing them all underneath — as the first version did — put an occlusion
  // cue in direct contradiction with the parallax cue: a wire between the two
  // nearest columns vanished behind any far column that happened to overlap it.
  // Conflicting depth information is worse than none.
  let edgesDrawn = 0;
  const lit: { from: Column; to: Column }[] = [];
  context.lineWidth = Math.max(0.6, Math.min(1.4, camera.scale));
  for (const edge of scene.edges) {
    const from = screenOf.get(edge.from);
    const to = screenOf.get(edge.to);
    if (from === undefined || to === undefined) continue;
    edgesDrawn++;
    if (
      radius !== null &&
      (highlighted?.has(edge.from) === true || edge.from === radius.subject) &&
      (highlighted?.has(edge.to) === true || edge.to === radius.subject)
    ) {
      lit.push({ from, to });
      continue;
    }
    context.beginPath();
    context.moveTo(from.top.x, from.top.y);
    context.lineTo(to.top.x, to.top.y);
    context.strokeStyle = INK.edge;
    context.globalAlpha = radius === null ? 0.5 : 0.16;
    context.setLineDash(edge.confidence === 'probable' ? [3, 3] : []);
    context.stroke();
  }
  context.setLineDash([]);
  context.globalAlpha = 1;

  // ---- columns, far to near ---------------------------------------------
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
      // Opaque and full-width. The stalk's *length* is the only claim this view
      // makes — how many files depend on this one — and the first version gave
      // it 0.55 alpha at half width while the LOC-sized disc stayed opaque on
      // top, so the salient channel described the wrong quantity and the scene
      // read as "the flat map with faint sticks".
      context.globalAlpha = dimmed ? 0.3 : 0.9;
      context.lineWidth = Math.max(1.5, drawn * 1.1);
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

    if (node === selected || node === hovered) {
      context.beginPath();
      context.arc(top.x, top.y, drawn + 5, 0, Math.PI * 2);
      context.strokeStyle = node === selected ? INK.text : INK.edgeHighlight;
      context.lineWidth = 1.5;
      context.stroke();
    }
  }

  // ---- the traced radius, over everything -------------------------------
  //
  // The one thing in this view that must never be occluded.
  if (lit.length > 0) {
    context.strokeStyle = INK.edgeHighlight;
    context.lineWidth = Math.max(1.2, Math.min(2.4, camera.scale * 1.6));
    for (const { from, to } of lit) {
      context.beginPath();
      context.moveTo(from.top.x, from.top.y);
      context.lineTo(to.top.x, to.top.y);
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
    tiesDrawn: 0,
    labelsDrawn: placed.length,
    level,
    // **Named peaks**, not "peaks I looped past". The flat map draws summit
    // rings and counts those; this view draws no ring, so the only thing it can
    // honestly report is how many summits it managed to *name*. Counting
    // membership in the peak set instead would have reported 13 while drawing
    // nothing peak-specific at all — a "how many X" with no gate that X
    // happened, which is the landmine this field exists to satisfy.
    peaksDrawn: placed.length,
  };
}
