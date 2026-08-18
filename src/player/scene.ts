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
    label: '',
    x: node.layout[0],
    y: node.layout[1],
    radius: radiusFor(node.loc),
    regionIndex: regionIndexById.get(node.region) ?? 0,
    dependentCount: new Set((graph.in[ref] ?? []).map((edge) => edge.from)).size,
    elevation: node.elevation,
  }));

  /**
   * **A name that names six things is not a label.** `shortLabel` takes the
   * basename, and a street-zoom frame of this repo showed **six discs all
   * reading `index.ts`** — a cold playtester named it, and it is the map's
   * central promise failing at the one zoom where you go to read names.
   *
   * So a basename shared with another node keeps one directory of context:
   * `verbs/index.ts` against `atlas/index.ts`. Only where it is ambiguous, so
   * the common case stays short, and only one segment, because the point is to
   * separate them rather than to print the path — which the inspector does.
   *
   * Computed once here rather than per frame: it is a property of the atlas.
   */
  const seen = new Map<string, number>();
  for (const node of nodes) {
    const base = shortLabel(node.path);
    seen.set(base, (seen.get(base) ?? 0) + 1);
  }
  for (const [ref, node] of nodes.entries()) {
    const path = atlas.nodes[ref]?.path ?? '';
    const base = shortLabel(path);
    if ((seen.get(base) ?? 0) < 2) {
      nodes[ref] = { ...node, label: base };
      continue;
    }
    const cut = path.lastIndexOf('/');
    const parent = cut === -1 ? '' : path.slice(0, cut);
    const dir = parent.slice(parent.lastIndexOf('/') + 1);
    nodes[ref] = { ...node, label: dir === '' ? base : `${dir}/${base}` };
  }

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
  /** Files in this region some question can reach — the completion denominator. */
  readonly answerable: number;
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
/**
 * `answerable` counts the region's files **some question can reach**, which is
 * the only honest denominator for a completion tally — and it is not
 * `nodeCount`. The legend printed `n/nodeCount`, so its `is-done` state was
 * unreachable for **all six** of this repo's topology regions (43 of 59, 8 of
 * 23, 2 of 3, 35 of 42, 29 of 34, 34 of 44), while the medal shelf printed
 * `n/answerable` for the same numerator — two panels stating contradictory
 * tallies of one population, which is the defect ADR-0019's reveal and its own
 * field note had on 21 of 26 boards. One denominator, both surfaces.
 *
 * Defaulted to `nodeCount` only where a caller has no atlas to derive it from
 * (a fixture); the shell always passes it.
 */
export function legendRows(
  scene: Pick<Scene, 'regions'>,
  answerable: ReadonlyMap<number, number> = new Map(),
): readonly LegendRow[] {
  const rows: LegendRow[] = scene.regions
    .filter((region) => region.kind !== 'terrain')
    .map((region) => ({
      index: region.index,
      label: region.label,
      nodeCount: region.nodeCount,
      // **0, not `nodeCount`, when the map has no entry.** A region with nothing
      // provable would otherwise claim a denominator of its whole size — a bar
      // no player can ever reach, which is exactly what `medals.ts`'s `gradeOf`
      // guards against one panel over. `src/indexer` on this repo has 3 files
      // and 0 provable ones, so it read `0/3` forever. It is invisible today
      // only because the tally hides while the numerator is 0, and "wrong but
      // currently unrenderable" is how a defect survives a milestone.
      answerable: answerable.get(region.index) ?? 0,
      kind: region.kind,
      // The **text** keeps the node count: it describes the region's size, which
      // is a different question from how much of it can be answered.
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
      // **Terrain carries questions, and this said it did not.** The claim was
      // *"terrain carries no questions, so its denominator is 0 and its tally
      // never renders"* — the first clause is false and the third does not
      // follow from it. A terrain node has no import edges, so Blast Radius
      // cannot reach it; the three history verbs can and do, which is the whole
      // reason Companion exists (`README`: it *"reaches the edgeless files the
      // import graph structurally cannot"*). Measured on this repo, **40 of 66
      // terrain files are provable**, and a half-clear proved 8 of them — which
      // the tally rendered as **`8/0`**, because it only hides at a numerator of
      // zero. ADR-0010 says a terrain lump is not a *neighbourhood*; it does not
      // say the files in it cannot be learned, and summing here is the same act
      // as summing `nodeCount` directly above.
      // **One lookup, where `nodeCount` above is a sum.** Every terrain region
      // carries `index === TERRAIN_INDEX` (that is the whole point of the
      // constant), and `answerableByRegion` keys off `node.regionIndex` — so the
      // four areas share one bucket and summing over them counts it four times:
      // the first version of this line read `8/160` over a terrain of 66 files.
      // `nodeCount` is different because `region.nodeCount` really is per-area.
      answerable: answerable.get(TERRAIN_INDEX) ?? 0,
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
 * How many of each region's files the player has proved something about.
 *
 * Indexed the same way the palette is, so `TERRAIN_INDEX` collects every
 * terrain area into one bucket exactly as the legend's own row does.
 *
 * **Reads `understood`, and the legend's wording had to be corrected to match
 * it.** That set is *"you proved you knew something about it, by being graded"*
 * — which includes a file you picked correctly in **someone else's** question,
 * not only a file whose own board you passed. A legend row saying *"you proved
 * its question"* was therefore false of every member-promoted node, and it
 * shipped for one commit before this function made me read `deriveFog`.
 */
/**
 * How many of each region's nodes some question can reach.
 *
 * The completion denominator, shared by the legend's tallies, the medal shelf and
 * the map's region wash. `nodeCount` is the wrong number for this and was used by
 * the legend for a milestone: **all six** of this repo's topology regions have
 * fewer answerable files than nodes (43 of 59, 8 of 23, 2 of 3, 35 of 42, 29 of
 * 34, 34 of 44), so a tally against the node count could never read complete.
 */
export function answerableByRegion(
  scene: Pick<Scene, 'nodes'>,
  provable: ReadonlySet<NodeId>,
): ReadonlyMap<number, number> {
  const counts = new Map<number, number>();
  for (const node of scene.nodes) {
    if (!provable.has(node.id)) continue;
    counts.set(node.regionIndex, (counts.get(node.regionIndex) ?? 0) + 1);
  }
  return counts;
}

/**
 * How much of each region is cleared, `0..1` by palette index.
 *
 * The channel the map's region wash brightens on — five rounds of playtests said
 * the arc they felt was the map lighting up, and four asked for the region tally
 * to move onto it. A region with nothing answerable is absent rather than 0, so a
 * caller cannot brighten ground that can never be cleared.
 */
export function clearedByRegion(
  scene: Pick<Scene, 'nodes'>,
  counted: ReadonlySet<NodeId>,
  answerable: ReadonlyMap<number, number>,
): ReadonlyMap<number, number> {
  const done = countByRegion(scene, counted);
  const out = new Map<number, number>();
  for (const [index, total] of answerable) {
    if (total <= 0) continue;
    out.set(index, Math.min(1, (done.get(index) ?? 0) / total));
  }
  return out;
}

/**
 * How many of each region's nodes are in `counted`.
 *
 * **The set is the caller's choice and that is now load-bearing.** The parameter
 * was named `understood`, and the shell passed `fog.understood` — the strict
 * proved register — while the medal shelf counted the *answered* population,
 * because scoring an arc on the proved register locks a player who fails a
 * board's first attempt out of it permanently (see `answeredNodes`). Two
 * surfaces, one population, two numbers: on any retried board the legend read
 * `2/37` beside a medal reading `3/37`. Both were internally right, which is the
 * shape that had ADR-0019's reveal disagreeing with its own field note on 21 of
 * 26 boards. The shell passes one set to all three readers now.
 */
export function countByRegion(
  scene: Pick<Scene, 'nodes'>,
  counted: ReadonlySet<NodeId>,
): ReadonlyMap<number, number> {
  const counts = new Map<number, number>();
  for (const node of scene.nodes) {
    if (!counted.has(node.id)) continue;
    counts.set(node.regionIndex, (counts.get(node.regionIndex) ?? 0) + 1);
  }
  return counts;
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
