/**
 * Turning an atlas into something drawable.
 *
 * Everything expensive happens once, in `prepare()`: radii, region indices,
 * label text, adjacency. A frame then does culling and drawing only. The
 * interaction budget is 50 fps at 2,000 nodes (CLAUDE.md), and the way to miss
 * it is to recompute per frame what the atlas already fixed at index time.
 *
 * Pure — no canvas, no DOM. `tests/unit/scene.test.ts` exercises culling and
 * the 2,000-node cost without a browser.
 */

import type {
  Atlas,
  AtlasEdge,
  Confidence,
  EdgeKind,
  NodeId,
  NodeRef,
  RegionKind,
} from '../atlas/index.js';
import { buildGraph, dependents } from '../atlas/index.js';
import type { Graph } from '../atlas/index.js';
import type { Bounds, Camera, Viewport } from './camera.js';
import { boundsOf, worldToScreen } from './camera.js';
import { radiusFor } from './palette.js';
import { shortLabel } from './zoom.js';

export interface SceneNode {
  readonly ref: NodeRef;
  readonly id: NodeId;
  readonly path: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** Index into `atlas.regions` — drives colour. */
  readonly regionIndex: number;
  /**
   * How many **files** import this one. Ranks which labels are worth the space,
   * and is what the inspector prints under `imported by`.
   *
   * Distinct sources, not incoming edges. One file reaches another by more than
   * one kind of edge routinely — `import { x }` beside `import type { y }` from
   * the same module is an `import` and a `type` — and counting edges made this a
   * count of statements under the name of a count of files. It read as a direct
   * dependent count larger than the node's own **transitive** one on 14 of this
   * repo's 257 nodes and 14 of hono's 425, which is impossible on its face; a
   * cold playtester found it from the arithmetic, not from the code.
   */
  readonly dependentCount: number;
  /** ADR-0013: bit length of the transitive dependent count. How tall it is. */
  readonly elevation: number;
}

export interface SceneEdge {
  readonly from: NodeRef;
  readonly to: NodeRef;
  readonly kind: EdgeKind;
  readonly confidence: Confidence;
}

export interface SceneRegion {
  readonly id: string;
  readonly label: string;
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly nodeCount: number;
  readonly kind: RegionKind;
}

export interface Scene {
  readonly atlas: Atlas;
  readonly graph: Graph;
  readonly nodes: readonly SceneNode[];
  readonly edges: readonly SceneEdge[];
  readonly regions: readonly SceneRegion[];
  readonly bounds: Bounds;
}

/**
 * Terrain regions share one palette slot.
 *
 * Colour is the map's main legibility device, and a region hue is a claim that
 * these files belong together for a *topological* reason. Edgeless files have
 * no such reason, so giving each terrain lump its own hue spends the palette on
 * the one thing it cannot describe — which is how 1,142 unconnected files
 * turned vite's map into confetti. One shared wash says the true thing: this is
 * ground, not a neighbourhood (ADR-0010).
 */
export const TERRAIN_INDEX = -1;

export function prepare(atlas: Atlas): Scene {
  const graph = buildGraph(atlas);
  const regionIndexById = new Map(
    atlas.regions.map((region, index) => [region.id, region.kind === 'terrain' ? TERRAIN_INDEX : index]),
  );

  const nodes: SceneNode[] = atlas.nodes.map((node, ref) => ({
    ref,
    id: node.id,
    path: node.path,
    label: shortLabel(node.path),
    x: node.layout[0],
    y: node.layout[1],
    radius: radiusFor(node.loc),
    regionIndex: regionIndexById.get(node.region) ?? 0,
    dependentCount: new Set((graph.in[ref] ?? []).map((edge) => edge.from)).size,
    elevation: node.elevation,
  }));

  const edges: SceneEdge[] = atlas.edges.map((edge: AtlasEdge) => ({
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    confidence: edge.confidence,
  }));

  const regions: SceneRegion[] = atlas.regions.map((region, index) => ({
    id: region.id,
    label: region.label,
    index: region.kind === 'terrain' ? TERRAIN_INDEX : index,
    x: region.centroid[0],
    y: region.centroid[1],
    nodeCount: region.nodeCount,
    kind: region.kind,
  }));

  return { atlas, graph, nodes, edges, regions, bounds: boundsOf(nodes) };
}

export interface LegendRow {
  /** Palette index — `TERRAIN_INDEX` for the single terrain row. */
  readonly index: number;
  readonly label: string;
  readonly nodeCount: number;
  readonly kind: RegionKind;
  /**
   * The row exactly as it is printed.
   *
   * Here rather than in `ui.ts` because the terrain row is not a region name
   * plus a count — it is a summary of several — and templating it into the
   * regions' `${label} (${count})` produced *"terrain (4 areas) (56)"* on this
   * repo's own map. A view that formats gets to invent wording no test reads;
   * this way the sentence is asserted where the rule that builds it lives.
   */
  readonly text: string;
}

/**
 * What the legend lists, in the order it lists it.
 *
 * Pure and here rather than in `ui.ts` because the *ordering* is the part with
 * a defect history and the part worth asserting; `createLegend` is then a
 * straight render of this list and has nothing left to get wrong.
 *
 * Two rules, both from ADR-0041:
 *
 *  - **Descending size**, ties by atlas index. The rows were ordered by region
 *    id — alphabetical, so unrelated to size — and the panel clips, so *which*
 *    rows a reader lost was arbitrary: the visible 17 accounted for 36% of
 *    graphql-js and 14% of django.
 *  - **Terrain is one row, and it is last.** Every terrain region already draws
 *    the same grey (`TERRAIN_INDEX`), so a row each was the legend claiming
 *    distinctions the palette does not make — 13 identical swatches on
 *    prometheus. Last regardless of size, because terrain is ground rather than
 *    a neighbourhood: hugo's 1,003-file `docs` lump at the top would be true,
 *    useless, and would push every real region off the panel.
 */
export function legendRows(scene: Pick<Scene, 'regions'>): readonly LegendRow[] {
  const rows: LegendRow[] = scene.regions
    .filter((region) => region.kind !== 'terrain')
    .map((region) => ({
      index: region.index,
      label: region.label,
      nodeCount: region.nodeCount,
      kind: region.kind,
      text: `${region.label} (${region.nodeCount})`,
    }))
    .sort((a, b) => b.nodeCount - a.nodeCount || a.index - b.index);

  const terrain = scene.regions.filter((region) => region.kind === 'terrain');
  if (terrain.length > 0) {
    const nodeCount = terrain.reduce((sum, region) => sum + region.nodeCount, 0);
    rows.push({
      index: TERRAIN_INDEX,
      label: 'terrain',
      nodeCount,
      kind: 'terrain',
      text:
        terrain.length === 1
          ? `terrain (${nodeCount})`
          : `terrain (${nodeCount} in ${terrain.length} areas)`,
    });
  }
  return rows;
}

/**
 * Nodes whose disc lands within `padding` px of the viewport. Radius is
 * included so a large node whose centre is just off screen still draws its
 * visible edge.
 *
 * **Culls in screen space, through the same projection that draws.** It used to
 * take a world-space axis-aligned rectangle, which is the wrong shape the
 * moment the map can turn: a turned viewport is a diamond in world space, and
 * its bounding box admits far more than is on screen. Measured on a 2,000-node
 * cloud at street zoom, the box lets through **2.17× the nodes the viewport
 * actually holds at 45°** — and every heading between the axes is oblique, so
 * that would have been the normal case rather than the corner one, on a
 * renderer already measured under its frame budget.
 *
 * Growing the box was the alternative and it is strictly worse: same cull for
 * twice the drawing. This costs four multiplies a node and is exact at every
 * bearing, and it means the cull and the draw cannot disagree about where a
 * node is, because they call the same function.
 */
export function visibleNodes(
  scene: Scene,
  camera: Camera,
  viewport: Viewport,
  padding = 0,
): readonly SceneNode[] {
  const halfWidth = viewport.width / 2 + padding;
  const halfHeight = viewport.height / 2 + padding;
  const visible: SceneNode[] = [];
  for (const node of scene.nodes) {
    const point = worldToScreen(camera, viewport, node);
    const reach = node.radius * camera.scale;
    if (
      Math.abs(point.x - viewport.width / 2) - reach <= halfWidth &&
      Math.abs(point.y - viewport.height / 2) - reach <= halfHeight
    ) {
      visible.push(node);
    }
  }
  return visible;
}

/** Edges with at least one endpoint on screen. */
export function visibleEdges(
  scene: Scene,
  visible: ReadonlySet<NodeRef>,
): readonly SceneEdge[] {
  const edges: SceneEdge[] = [];
  for (const edge of scene.edges) {
    if (visible.has(edge.from) || visible.has(edge.to)) edges.push(edge);
  }
  return edges;
}

/** The node under a world-space point, or null. Topmost = smallest wins ties. */
export function pick(scene: Scene, x: number, y: number, scale: number): SceneNode | null {
  let found: SceneNode | null = null;
  for (const node of scene.nodes) {
    const reach = Math.max(node.radius, 8) / scale;
    const dx = node.x - x;
    const dy = node.y - y;
    if (dx * dx + dy * dy > reach * reach) continue;
    if (found === null || node.radius < found.radius) found = node;
  }
  return found;
}

export interface Radius {
  /** The subject itself. */
  readonly subject: NodeRef;
  /** Everything that transitively imports the subject, mapped to its distance. */
  readonly dependents: ReadonlyMap<NodeRef, number>;
  /** The bound this radius was traced to. `Infinity` for the full cone. */
  readonly maxDepth: number;
}

/**
 * The blast radius of a node: what breaks if you change it.
 *
 * **There is no default depth, and callers must say which one they mean.**
 * M1 defaulted to 3 and rendered it on hover, which — once challenges existed —
 * put the complete answer on screen milliseconds before the click that opened
 * the question, involuntarily, to a player who never chose to cheat. ADR-0008
 * decision 1 settles it: the map shows `DIRECT_ONLY` for every node, always,
 * and the full radius renders only for nodes the player has *proved* they
 * understand.
 *
 * Depth 1 is the right thing to give away, because §8.4 defines `surprise`
 * against exactly that naive guess — the map hands you the baseline, and the
 * grade measures what you know beyond it.
 */
export const DIRECT_ONLY = 1;
export const FULL_RADIUS = Number.POSITIVE_INFINITY;

export function blastRadius(scene: Scene, ref: NodeRef, maxDepth: number): Radius {
  return { subject: ref, dependents: dependents(scene.graph, ref, maxDepth), maxDepth };
}
