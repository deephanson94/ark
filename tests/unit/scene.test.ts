import { describe, expect, it } from 'vitest';

import type { Camera, Viewport } from '../../src/player/camera.js';
import { NORTH } from '../../src/player/camera.js';
import type { SceneNode } from '../../src/player/scene.js';
import { TERRAIN_INDEX, blastRadius, legendRows, pick, prepare, visibleEdges, visibleNodes } from '../../src/player/scene.js';
import { DISTRICT_SCALE, STREET_SCALE, levelFor, shortLabel, styleFor } from '../../src/player/zoom.js';
import { atlasWith } from '../fixtures/atlas.js';

const ATLAS = atlasWith(
  ['a.ts', 'b.ts', 'c.ts', 'docs/readme.md'],
  [
    ['b.ts', 'a.ts'],
    ['c.ts', 'b.ts'],
  ],
);

describe('prepare', () => {
  const scene = prepare(ATLAS);
  const at = (path: string): number => scene.nodes.findIndex((node) => node.path === path);

  it('carries one scene node per atlas node, in the same order', () => {
    expect(scene.nodes.map((node) => node.path)).toEqual(ATLAS.nodes.map((node) => node.path));
  });

  it('reads positions straight from the atlas — layout is not the player’s job', () => {
    for (const [ref, node] of scene.nodes.entries()) {
      expect([node.x, node.y]).toEqual([...(ATLAS.nodes[ref]?.layout ?? [])]);
    }
  });

  it('counts dependents, which is what ranks a label', () => {
    expect(scene.nodes[at('a.ts')]?.dependentCount).toBe(1);
    expect(scene.nodes[at('docs/readme.md')]?.dependentCount).toBe(0);
  });

  it('counts the files that import it, not the edges arriving at it', () => {
    // `graph.in` holds **edges**, and one file reaches another by more than one
    // kind of edge all the time: `import { x }` beside `import type { y }` from
    // the same module is an `import` and a `type`, two true and distinct facts
    // about one pair of files. The validator refuses a repeated
    // `(from, to, kind)`, so nothing upstream was wrong — the inspector prints
    // the sum under the label `imported by`, which made it a count of *edges*
    // wearing the name of a count of *files*.
    //
    // A cold playtester caught it from the arithmetic rather than from the code:
    // `src/atlas/index.ts` printed `imported by 165` over a **transitive** cone
    // of 144, and direct dependents are a subset of transitive ones, so the pair
    // is impossible on its face. 22.7% of this repo's edges are a second kind on
    // a pair that already had one, and 14 of its 257 nodes printed a number
    // larger than their own cone — 14 of hono's 425 too
    // (`npx tsx scripts/probe-indegree.ts`, measured at `9b13cf6`).
    let seenBA = 0;
    const twoKinded = atlasWith(
      ['a.ts', 'b.ts', 'c.ts'],
      [
        ['b.ts', 'a.ts'],
        ['b.ts', 'a.ts'],
        ['c.ts', 'a.ts'],
      ],
      (node) => node,
      (edge, from, to) =>
        from === 'b.ts' && to === 'a.ts' && seenBA++ === 1 ? { ...edge, kind: 'type' } : edge,
    );
    const twice = prepare(twoKinded);
    const subject = twice.nodes.findIndex((node) => node.path === 'a.ts');
    expect(twice.nodes[subject]?.dependentCount).toBe(2);
    // The invariant the playtester actually applied: direct ≤ transitive, on
    // every node. It is what makes the number checkable without reading the
    // scanner, and it is the assertion that would have caught this.
    for (const node of twice.nodes) {
      expect(node.dependentCount).toBeLessThanOrEqual(
        blastRadius(twice, node.ref, Number.POSITIVE_INFINITY).dependents.size,
      );
    }
  });

  it('shortens labels to the filename', () => {
    expect(scene.nodes[at('docs/readme.md')]?.label).toBe('readme.md');
  });

  it('bounds every node', () => {
    for (const node of scene.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(scene.bounds.minX);
      expect(node.x).toBeLessThanOrEqual(scene.bounds.maxX);
    }
  });
});

describe('culling', () => {
  const scene = prepare(ATLAS);
  /** A viewport small enough that the fixture does not all fit in it. */
  const TIGHT: Viewport = { width: 3, height: 3 };
  const on = (node: SceneNode, bearing = NORTH): Camera => ({
    x: node.x,
    y: node.y,
    scale: 1,
    bearing,
  });

  it('keeps only what the viewport can see', () => {
    const first = scene.nodes[0];
    if (first === undefined) throw new Error('fixture has no nodes');
    const visible = visibleNodes(scene, on(first), TIGHT);
    expect(visible.length).toBeLessThan(scene.nodes.length);
    expect(visible).toContain(first);
  });

  it('keeps a node whose centre is off screen but whose edge is not', () => {
    const first = scene.nodes[0];
    if (first === undefined) throw new Error('fixture has no nodes');
    // Centred a little past the node, so its middle is outside the viewport
    // and its disc still overlaps it.
    const justPast: Camera = { x: first.x + 2 + first.radius / 2, y: first.y, scale: 1, bearing: NORTH };
    expect(visibleNodes(scene, justPast, TIGHT)).toContain(first);
  });

  it('measures a disc in pixels, not in world units', () => {
    // **Every other assertion in this block runs at scale 1, where the wrong
    // formula and the right one agree.** The old cull computed its reach as
    // `radius / scale` against a world-space box — a world radius treated as
    // pixels — which this change quietly corrected to `radius * scale` while
    // moving the test into screen space. Nothing noticed, because at scale 1
    // the two are the same number. Zoomed in, they differ by 16x.
    const first = scene.nodes[0];
    if (first === undefined) throw new Error('fixture has no nodes');
    const scale = 4;
    const reach = first.radius * scale;
    const strip: Viewport = { width: 20, height: 20 };
    // Centre the view just past the node, so its centre is off screen and only
    // the scaled disc can reach back in.
    const inside: Camera = { x: first.x + (strip.width / 2 + reach * 0.5) / scale, y: first.y, scale, bearing: NORTH };
    const outside: Camera = { x: first.x + (strip.width / 2 + reach * 2) / scale, y: first.y, scale, bearing: NORTH };
    expect(visibleNodes(scene, inside, strip)).toContain(first);
    expect(visibleNodes(scene, outside, strip)).not.toContain(first);
  });

  it('culls by where the map is turned to, not by an axis-aligned box', () => {
    // The cull runs through the same projection that draws, so a node that
    // leaves the viewport when the map turns is dropped when the map turns.
    // A world-space bounding box cannot express that — it admits the corners of
    // a diamond, measured at 2.17x the nodes actually on screen at 45 degrees
    // on a 2,000-node cloud, on a renderer already under its frame budget.
    const first = scene.nodes[0];
    if (first === undefined) throw new Error('fixture has no nodes');
    const wide: Viewport = { width: 400, height: 6 };
    const far = scene.nodes.find(
      (node) => Math.abs(node.x - first.x) > 20 && Math.abs(node.y - first.y) < 3,
    );
    if (far === undefined) throw new Error('fixture has no node off to the side');
    expect(visibleNodes(scene, on(first), wide)).toContain(far);
    expect(visibleNodes(scene, on(first, Math.PI / 2), wide)).not.toContain(far);
  });

  it('keeps an edge when either end is on screen', () => {
    const edges = visibleEdges(scene, new Set([0]));
    for (const edge of edges) expect(edge.from === 0 || edge.to === 0).toBe(true);
  });

  it('keeps everything when the viewport covers the whole atlas', () => {
    const whole: Camera = {
      x: (scene.bounds.minX + scene.bounds.maxX) / 2,
      y: (scene.bounds.minY + scene.bounds.maxY) / 2,
      scale: 1,
      bearing: NORTH,
    };
    const huge: Viewport = { width: 4000, height: 4000 };
    expect(visibleNodes(scene, whole, huge)).toHaveLength(scene.nodes.length);
  });
});

describe('pick', () => {
  const scene = prepare(ATLAS);

  it('finds the node under the point', () => {
    const target = scene.nodes[1];
    if (target === undefined) throw new Error('fixture has no second node');
    expect(pick(scene, target.x, target.y, 1)?.path).toBe(target.path);
  });

  it('finds nothing in empty space', () => {
    expect(pick(scene, 1e6, 1e6, 1)).toBeNull();
  });

  it('keeps a usable hit target when zoomed far out', () => {
    const target = scene.nodes[0];
    if (target === undefined) throw new Error('fixture has no nodes');
    // At scale 0.1 the disc is a couple of pixels; the pick radius has to grow
    // in world units or small files become unclickable.
    expect(pick(scene, target.x + 20, target.y, 0.1)?.path).toBe(target.path);
  });
});

describe('blastRadius', () => {
  const scene = prepare(ATLAS);
  const at = (path: string): number => scene.nodes.findIndex((node) => node.path === path);

  it('finds everything that transitively depends on the subject', () => {
    const radius = blastRadius(scene, at('a.ts'), 3);
    const paths = [...radius.dependents.keys()].map((ref) => scene.nodes[ref]?.path).sort();
    expect(paths).toEqual(['b.ts', 'c.ts']);
  });

  it('respects the depth bound', () => {
    expect(blastRadius(scene, at('a.ts'), 1).dependents.size).toBe(1);
  });

  it('is empty for a leaf', () => {
    expect(blastRadius(scene, at('c.ts'), 3).dependents.size).toBe(0);
  });
});

describe('semantic zoom', () => {
  it('promotes detail as you zoom in', () => {
    expect(levelFor(DISTRICT_SCALE - 0.01)).toBe('territory');
    expect(levelFor(DISTRICT_SCALE)).toBe('district');
    expect(levelFor(STREET_SCALE)).toBe('street');
  });

  it('withholds node labels until they would be readable', () => {
    expect(styleFor('territory').showNodeLabels).toBe(false);
    expect(styleFor('district').showNodeLabels).toBe(true);
  });

  it('drops region labels once individual files are named', () => {
    expect(styleFor('territory').showRegionLabels).toBe(true);
    expect(styleFor('street').showRegionLabels).toBe(false);
  });

  it('raises the label budget monotonically', () => {
    expect(styleFor('district').nodeLabelBudget).toBeGreaterThan(styleFor('territory').nodeLabelBudget);
    expect(styleFor('street').nodeLabelBudget).toBeGreaterThan(styleFor('district').nodeLabelBudget);
  });

  it('shortens a path to its filename', () => {
    expect(shortLabel('src/indexer/build.ts')).toBe('build.ts');
    expect(shortLabel('package.json')).toBe('package.json');
  });

  it('keeps a long name nameable, head and tail, extension intact', () => {
    // This repo's own decision records are the case: 62 characters drew a label
    // wider than the region it sat in and over the top of two neighbours. The
    // collision pass would otherwise drop it, and a label it drops is a file
    // that can never be named on the map.
    const long = 'docs/decisions/0041-the-legend-was-most-of-the-complaint-and-louvain-is-the-rest.md';
    const short = shortLabel(long);
    expect(short.length).toBeLessThanOrEqual(26);
    expect(short.startsWith('0041-the-legend')).toBe(true);
    // The extension survives, because it is a fact a reader uses and the middle
    // of a long name is where the least of it is.
    expect(short.endsWith('.md')).toBe(true);
    expect(short).toContain('…');
    // A name at the limit is untouched — the rule is a ceiling, not a style.
    expect(shortLabel('a'.repeat(26))).toBe('a'.repeat(26));
    expect(shortLabel('a'.repeat(27))).toContain('…');
  });
});

describe('cost at scale', () => {
  // CLAUDE.md budgets map interaction at 50 fps with 2,000 nodes — 20 ms a
  // frame for everything. Culling is the part that runs every frame, so it has
  // to be a small fraction of that. The layout is precomputed; this is the
  // check that the player has not started recomputing it per frame.
  const paths = Array.from({ length: 2000 }, (_, i) => `src/gen/f${i}.ts`);
  const links: [string, string][] = [];
  for (let i = 0; i < paths.length; i++) {
    const target = i % 97;
    // A node importing itself is not a thing, and the validator says so.
    if (target === i) continue;
    links.push([paths[i] ?? '', paths[target] ?? '']);
  }
  const big = atlasWith(paths, links);

  it('prepares a 2,000-node atlas once, quickly', () => {
    const started = performance.now();
    const scene = prepare(big);
    const elapsed = performance.now() - started;
    expect(scene.nodes).toHaveLength(2000);
    expect(elapsed, `prepare took ${elapsed.toFixed(1)} ms`).toBeLessThan(250);
  });

  it('culls a 2,000-node scene in well under a frame', () => {
    const scene = prepare(big);
    const started = performance.now();
    for (let i = 0; i < 60; i++) {
      const visible = visibleNodes(scene, { x: 0, y: 0, scale: 1, bearing: 0.7 }, { width: 4000, height: 4000 });
      visibleEdges(scene, new Set(visible.map((node) => node.ref)));
    }
    const perFrame = (performance.now() - started) / 60;
    expect(perFrame, `culling took ${perFrame.toFixed(2)} ms/frame`).toBeLessThan(8);
  });
});

describe('legendRows', () => {
  /**
   * `scene.regions` is atlas order, which is sorted by **id** — alphabetical,
   * and therefore unrelated to size. The legend clips, so before ADR-0041
   * *which* rows a reader lost was arbitrary: the visible 17 accounted for 36%
   * of graphql-js's map and 14% of django's.
   *
   * The fixture is deliberately built so that id order, size order and index
   * order all disagree. A test whose fixture happens to be sorted already would
   * pass against the old code.
   */
  const regions = [
    { id: 'a-small', label: 'a-small', index: 0, x: 0, y: 0, nodeCount: 3, kind: 'topology' as const },
    { id: 'b-terrain', label: 'docs', index: TERRAIN_INDEX, x: 0, y: 0, nodeCount: 400, kind: 'terrain' as const },
    { id: 'c-big', label: 'c-big', index: 2, x: 0, y: 0, nodeCount: 90, kind: 'topology' as const },
    { id: 'd-terrain', label: 'root', index: TERRAIN_INDEX, x: 0, y: 0, nodeCount: 7, kind: 'terrain' as const },
    { id: 'e-mid', label: 'e-mid', index: 4, x: 0, y: 0, nodeCount: 40, kind: 'topology' as const },
  ];

  it('lists topology regions largest first', () => {
    const rows = legendRows({ regions });
    expect(rows.filter((row) => row.kind === 'topology').map((row) => row.label)).toEqual([
      'c-big',
      'e-mid',
      'a-small',
    ]);
  });

  it('collapses every terrain region into one row, and puts it last', () => {
    // They already share a single palette slot (TERRAIN_INDEX), so a row each
    // was the legend claiming distinctions the map does not draw — 13 identical
    // grey swatches on prometheus. Last regardless of size: terrain is ground,
    // and hugo's 1,003-file docs lump at the top would push out every real
    // region while saying nothing.
    const rows = legendRows({ regions });
    const terrain = rows.filter((row) => row.kind === 'terrain');
    expect(terrain).toHaveLength(1);
    expect(rows[rows.length - 1]).toBe(terrain[0]);
    expect(terrain[0]?.nodeCount).toBe(407);
    expect(terrain[0]?.index).toBe(TERRAIN_INDEX);
    expect(terrain[0]?.text).toBe('terrain (407 in 2 areas)');
  });

  it('names a lone terrain region without an area count', () => {
    // Templating the regions' `label (count)` over a summary row printed
    // "terrain (4 areas) (56)" on this repo's own map, so the row owns its text.
    const rows = legendRows({ regions: regions.filter((region) => region.id !== 'd-terrain') });
    expect(rows[rows.length - 1]?.text).toBe('terrain (400)');
  });

  it('accounts for every node exactly once', () => {
    // The rows are what a reader adds up to decide how much of the map they can
    // name, so a dropped or double-counted region is a false total.
    const rows = legendRows({ regions });
    expect(rows.reduce((sum, row) => sum + row.nodeCount, 0)).toBe(
      regions.reduce((sum, region) => sum + region.nodeCount, 0),
    );
  });

  it('breaks size ties by atlas index, so the order is total and reproducible', () => {
    const tied = [
      { id: 'y', label: 'y', index: 5, x: 0, y: 0, nodeCount: 10, kind: 'topology' as const },
      { id: 'x', label: 'x', index: 1, x: 0, y: 0, nodeCount: 10, kind: 'topology' as const },
    ];
    expect(legendRows({ regions: tied }).map((row) => row.label)).toEqual(['x', 'y']);
  });
});
