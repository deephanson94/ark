import { describe, expect, it } from 'vitest';

import { commonDirectory, detectRegions } from '../../src/indexer/regions.js';
import type { RegionEdge } from '../../src/indexer/regions.js';

function edgesFrom(paths: readonly string[], links: readonly (readonly [string, string])[]): RegionEdge[] {
  return links.map(([from, to]) => ({ from: paths.indexOf(from), to: paths.indexOf(to) }));
}

/** Which region each path landed in, keyed by path. */
function assignment(paths: readonly string[], links: readonly (readonly [string, string])[]) {
  const regions = detectRegions(paths, edgesFrom(paths, links));
  const byPath = new Map<string, string>();
  for (const region of regions) {
    for (const member of region.members) byPath.set(paths[member] ?? '', region.id);
  }
  return { regions, byPath };
}

describe('detectRegions', () => {
  it('puts every node in exactly one region', () => {
    const paths = ['a.ts', 'b.ts', 'c.ts'];
    const { regions } = assignment(paths, [['a.ts', 'b.ts']]);
    const members = regions.flatMap((region) => region.members).sort((x, y) => x - y);
    expect(members).toEqual([0, 1, 2]);
  });

  it('separates two clusters joined only by a barrel', () => {
    // The failure that made this rewrite necessary: plain label propagation
    // decides a repo with one shared barrel is a single community. On this repo
    // that put 36 of 64 files in one region.
    // Six a side, so the barrel's degree clears the connector cutoff the way a
    // real barrel does. The heuristic is relative to the median degree, so a
    // "hub" with only twice the connections of its neighbours is not treated as
    // one — at that ratio it is a peer, and merging the two groups is arguably
    // the right answer anyway.
    const left = ['left/a.ts', 'left/b.ts', 'left/c.ts', 'left/d.ts', 'left/e.ts', 'left/f.ts'];
    const right = ['right/u.ts', 'right/v.ts', 'right/w.ts', 'right/x.ts', 'right/y.ts', 'right/z.ts'];
    const paths = ['barrel.ts', ...left, ...right];
    const links: [string, string][] = [];
    for (const side of [left, right]) {
      for (let i = 0; i < side.length; i++) {
        links.push([side[i] ?? '', side[(i + 1) % side.length] ?? '']);
        links.push([side[i] ?? '', 'barrel.ts']);
      }
    }
    const { byPath } = assignment(paths, links);
    expect(byPath.get('left/a.ts')).toBe(byPath.get('left/c.ts'));
    expect(byPath.get('right/x.ts')).toBe(byPath.get('right/z.ts'));
    expect(byPath.get('left/a.ts')).not.toBe(byPath.get('right/x.ts'));
  });

  it('folds an undersized community into the region it is most connected to', () => {
    // Louvain ships communities below MIN_REGION and absorption folds them, so
    // this is live machinery rather than a leftover: measured on real repos it
    // fires on hono (2 communities of 2), graphql-js (2) and kysely (1), and
    // not at all on ark, django, flask, hugo or prometheus (ADR-0041).
    //
    // **The fixture has to be chosen, not invented.** The obvious one — a pair
    // hanging off a small cluster — is vacuous, because Louvain merges it
    // itself and absorption never runs; the first draft of this test did
    // exactly that and would have passed with the pass deleted. Modularity's
    // gain for moving `i` into `C` is `k_i,in − γ·k_i·Σ_tot(C)/2m`, so a pair
    // joined to a *large, dense* community by single edges is refused: the one
    // internal edge it gains is outweighed by that community's degree mass.
    // Hence a five-clique, and `probe-fixture2` in this ADR's working set
    // confirms Louvain really does leave `edge/*` standing alone here.
    const core = ['core/1.ts', 'core/2.ts', 'core/3.ts', 'core/4.ts', 'core/5.ts'];
    const side = ['side/1.ts', 'side/2.ts', 'side/3.ts', 'side/4.ts'];
    const paths = [...core, ...side, 'edge/1.ts', 'edge/2.ts'];
    const links: [string, string][] = [];
    for (const group of [core, side]) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) links.push([group[i] ?? '', group[j] ?? '']);
      }
    }
    links.push([core[0] ?? '', side[0] ?? '']);
    links.push(['edge/1.ts', 'edge/2.ts']);
    // Both of the pair's outward edges go to `core`, none to `side` — so this
    // asserts *which* region absorbed it, not merely that something did. A rule
    // that folded into the lowest label, or the largest region, or the first
    // neighbour found, would still have to pick `core` here, so the discriminating
    // half is the assertion below it.
    links.push(['edge/1.ts', core[1] ?? '']);
    links.push(['edge/2.ts', core[2] ?? '']);

    const { regions, byPath } = assignment(paths, links);
    expect(byPath.get('edge/1.ts')).toBe(byPath.get('edge/2.ts'));
    expect(byPath.get('edge/1.ts')).toBe(byPath.get('core/1.ts'));
    expect(byPath.get('edge/1.ts')).not.toBe(byPath.get('side/1.ts'));
    // The invariant `test:atlas` and `docs/atlas-format.md` §3.4 both rest on:
    // no topology region is smaller than the floor, which is what bounds the
    // region count without a magic cap.
    for (const region of regions) {
      if (region.kind !== 'topology') continue;
      expect(region.members.length, `${region.id}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('groups unlinked files by directory, since topology says nothing', () => {
    const paths = ['docs/one.md', 'docs/two.md', 'other/three.md'];
    const { byPath } = assignment(paths, []);
    expect(byPath.get('docs/one.md')).toBe(byPath.get('docs/two.md'));
    expect(byPath.get('docs/one.md')).not.toBe(byPath.get('other/three.md'));
  });

  it('names a region after the directory its members share', () => {
    const paths = ['src/atlas/a.ts', 'src/atlas/b.ts', 'src/atlas/c.ts'];
    const { regions } = assignment(paths, [
      ['src/atlas/a.ts', 'src/atlas/b.ts'],
      ['src/atlas/b.ts', 'src/atlas/c.ts'],
    ]);
    expect(regions.map((region) => region.label)).toContain('src/atlas');
  });

  it('disambiguates same-named regions by their busiest file', () => {
    // Four distinct communities inside src/indexer all called "src/indexer"
    // told you nothing, which is what this rule fixes.
    const paths = [
      'src/x/alpha.ts',
      'src/x/alpha-helper.ts',
      'src/x/alpha-extra.ts',
      'src/x/beta.ts',
      'src/x/beta-helper.ts',
      'src/x/beta-extra.ts',
    ];
    const { regions } = assignment(paths, [
      ['src/x/alpha-helper.ts', 'src/x/alpha.ts'],
      ['src/x/alpha-extra.ts', 'src/x/alpha.ts'],
      ['src/x/beta-helper.ts', 'src/x/beta.ts'],
      ['src/x/beta-extra.ts', 'src/x/beta.ts'],
    ]);
    const labels = regions.map((region) => region.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(new Set(regions.map((region) => region.id)).size).toBe(regions.length);
  });

  it('is deterministic', () => {
    const paths = Array.from({ length: 40 }, (_, i) => `src/f${i}.ts`);
    const links: [string, string][] = [];
    for (let i = 1; i < paths.length; i++) links.push([paths[i] ?? '', paths[i % 6] ?? '']);
    const first = JSON.stringify(detectRegions(paths, edgesFrom(paths, links)));
    const second = JSON.stringify(detectRegions(paths, edgesFrom(paths, links)));
    expect(second).toBe(first);
  });

  it('sorts regions by id and gives each a unique one', () => {
    const paths = Array.from({ length: 30 }, (_, i) => `src/dir${i % 4}/f${i}.ts`);
    const links: [string, string][] = [];
    for (let i = 1; i < paths.length; i++) links.push([paths[i] ?? '', paths[i - 1] ?? '']);
    const regions = detectRegions(paths, edgesFrom(paths, links));
    const ids = regions.map((region) => region.id);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('handles an empty repo', () => {
    expect(detectRegions([], [])).toEqual([]);
  });
});

describe('commonDirectory', () => {
  it('finds the deepest shared directory', () => {
    expect(commonDirectory(['src/a/x.ts', 'src/a/y.ts'])).toBe('src/a');
    expect(commonDirectory(['src/a/x.ts', 'src/b/y.ts'])).toBe('src');
  });

  it('returns empty for paths sharing nothing', () => {
    expect(commonDirectory(['src/a.ts', 'tests/b.ts'])).toBe('');
    expect(commonDirectory(['a.ts', 'b.ts'])).toBe('');
  });

  it('handles a single path and no paths', () => {
    expect(commonDirectory(['src/deep/a.ts'])).toBe('src/deep');
    expect(commonDirectory([])).toBe('');
  });
});

describe('terrain', () => {
  it('aggregates edgeless files by top-level segment, not by exact directory', () => {
    // The rule that took vite from 771 regions to 123. Grouping by exact
    // directory is a finer claim than a degree-0 node supports, and a repo with
    // hundreds of small directories manufactures hundreds of regions from it.
    const paths = [
      'docs/guide/a.md',
      'docs/guide/b.md',
      'docs/api/c.md',
      'docs/blog/posts/d.md',
      'scripts/one.md',
    ];
    const regions = detectRegions(paths, []);
    expect(regions.every((region) => region.kind === 'terrain')).toBe(true);
    expect(regions.map((region) => region.label).sort()).toEqual(['docs', 'scripts']);
    expect(regions.find((region) => region.label === 'docs')?.members).toHaveLength(4);
  });

  it('folds a component below the floor into terrain rather than giving it a legend entry', () => {
    // Two files that import only each other are a true island, and the edge
    // still draws — but a two-node region costs a palette slot and a legend line
    // for a claim the map already makes visually.
    const paths = ['pkg/pair/a.ts', 'pkg/pair/b.ts', 'pkg/big/x.ts', 'pkg/big/y.ts', 'pkg/big/z.ts'];
    const regions = detectRegions(paths, [
      { from: 0, to: 1 },
      { from: 2, to: 3 },
      { from: 3, to: 4 },
    ]);
    const pair = regions.find((region) => region.members.includes(0));
    expect(pair?.kind).toBe('terrain');
    expect(regions.find((region) => region.members.includes(2))?.kind).toBe('topology');
  });

  it('never marks a real cluster as terrain', () => {
    const paths = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'];
    const regions = detectRegions(paths, [
      { from: 0, to: 1 },
      { from: 1, to: 2 },
      { from: 2, to: 3 },
    ]);
    expect(regions.every((region) => region.kind === 'topology')).toBe(true);
  });
});
