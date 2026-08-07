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
import type { Bounds } from './camera.js';
import { boundsOf } from './camera.js';
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
  /** In-degree. Used to rank which labels are worth the space. */
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
    dependentCount: (graph.in[ref] ?? []).length,
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

/**
 * Nodes whose disc intersects `bounds`. Radius is included so a large node
 * whose centre is just off screen still draws its visible edge.
 */
export function visibleNodes(
  scene: Scene,
  bounds: Bounds,
  scale: number,
): readonly SceneNode[] {
  const visible: SceneNode[] = [];
  for (const node of scene.nodes) {
    const reach = node.radius / scale;
    if (
      node.x + reach >= bounds.minX &&
      node.x - reach <= bounds.maxX &&
      node.y + reach >= bounds.minY &&
      node.y - reach <= bounds.maxY
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
