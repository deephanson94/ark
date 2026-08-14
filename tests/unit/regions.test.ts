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
    // The failure this fixture was built for: plain label propagation decides a
    // repo with one shared barrel is a single community — 36 of 64 files in one
    // region here. Louvain has no such failure mode, because a giant community
    // is penalised by modularity's own degree term, so this now guards a
    // property rather than a patch.
    //
    // The six-a-side shape is a leftover from the connector-cutoff heuristic
    // ADR-0041 deleted (it needed the barrel's degree to clear a multiple of the
    // median). Kept because it is still a fair barrel: the two sides are equal
    // and joined only through the hub, which is the structure the assertion is
    // about.
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
    // **This pass performs no merge on any repo measured** — 0 on all eight.
    // Louvain does ship sub-MIN_REGION communities (hono 2, graphql-js 2,
    // kysely 1), but every one is a two-node island with no outward edge, so
    // absorption declines and the terrain fold takes it. An earlier version of
    // this comment quoted those counts as firings; that was the precondition,
    // not the event (ADR-0041 §5.2).
    //
    // The test is kept because the branch is reachable — a sub-floor community
    // *with* an edge leaving it absorbs rather than being greyed — and this
    // fixture is the only thing that executes it at all.
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
    const side = ['side/1.ts', 'side/2.ts', 'side/3.ts', 'side/4.ts', 'side/5.ts'];
    const paths = [...core, ...side, 'edge/1.ts', 'edge/2.ts'];
    const links: [string, string][] = [];
    for (const group of [core, side]) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) links.push([group[i] ?? '', group[j] ?? '']);
      }
    }
    links.push([core[0] ?? '', side[0] ?? '']);
    links.push(['edge/1.ts', 'edge/2.ts']);
    // **One edge to `core`, two to `side`** — the half that makes this a test of
    // *"most connected"* rather than of "absorbed by something". A first version
    // put both edges on `core`, and then folding into the lowest label, the
    // largest region, or the first neighbour found all give the same answer:
    // a mutant ignoring edge weight entirely survived it. Here `core` sorts
    // first and the cliques are the same size, so every one of those rules picks
    // `core` and only the real rule picks `side`.
    links.push(['edge/1.ts', core[1] ?? '']);
    links.push(['edge/2.ts', side[1] ?? '']);
    links.push(['edge/2.ts', side[2] ?? '']);

    const { regions, byPath } = assignment(paths, links);
    expect(byPath.get('edge/1.ts')).toBe(byPath.get('edge/2.ts'));
    expect(byPath.get('edge/1.ts')).toBe(byPath.get('side/1.ts'));
    expect(byPath.get('edge/1.ts')).not.toBe(byPath.get('core/1.ts'));
    // The invariant `test:atlas` and `docs/atlas-format.md` §3.4 both rest on:
    // no topology region is smaller than the floor, which is what bounds the
    // region count without a magic cap.
    for (const region of regions) {
      if (region.kind !== 'topology') continue;
      expect(region.members.length, `${region.id}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('names a region after the directory holding most of it, not one it barely touches', () => {
    // **The defect this rule replaced.** The old `nameFor` took the deepest
    // directory *every* member shares and, when there was none, the directory
    // of the busiest file — so a region of eight `tests/` files whose hub
    // happens to sit in `src/` was called `src`. Measured across eight repos,
    // 39 of 74 topology regions carried a label naming a directory holding
    // under half their members, several at literally 0% (ADR-0041 §12).
    //
    // Here the hub is `src/core.ts` — highest degree by construction — while
    // six of the seven members are under `tests/`.
    const paths = [
      'src/core.ts',
      'tests/a.ts', 'tests/b.ts', 'tests/c.ts', 'tests/d.ts', 'tests/e.ts', 'tests/f.ts',
    ];
    const links: [string, string][] = [
      ['tests/a.ts', 'src/core.ts'],
      ['tests/b.ts', 'src/core.ts'],
      ['tests/c.ts', 'src/core.ts'],
      ['tests/d.ts', 'src/core.ts'],
      ['tests/e.ts', 'src/core.ts'],
      ['tests/f.ts', 'src/core.ts'],
    ];
    const { regions } = assignment(paths, links);
    const home = regions.find((region) => region.members.length === paths.length);
    expect(home?.label).toBe('tests');
  });

  it('names a region after its hub when no directory holds half of it', () => {
    // Three directories, two members each, plus the hub. Nothing reaches the
    // half, so claiming any directory would be false — and a label ending in a
    // file extension reads as a file, which is the point of the fallback.
    const paths = [
      'src/hub.ts',
      'a/one.ts', 'a/two.ts',
      'b/one.ts', 'b/two.ts',
      'c/one.ts', 'c/two.ts',
    ];
    const links: [string, string][] = [
      ['a/one.ts', 'src/hub.ts'], ['a/two.ts', 'src/hub.ts'],
      ['b/one.ts', 'src/hub.ts'], ['b/two.ts', 'src/hub.ts'],
      ['c/one.ts', 'src/hub.ts'], ['c/two.ts', 'src/hub.ts'],
    ];
    const { regions } = assignment(paths, links);
    const home = regions.find((region) => region.members.length === paths.length);
    expect(home?.label).toBe('around src/hub.ts');
  });

  it('gives a contested directory to the region most of it is in', () => {
    // Two clusters that both genuinely describe themselves as `shared` — 3 of 5
    // and 4 of 5. Only one can be it, and refining the loser to
    // `shared/<hub stem>` — what this used to do — states a *second* directory
    // it is mostly not in, so it names its hub instead.
    //
    // **Two earlier fixtures here tested nothing.** The first gave the second
    // cluster 3-of-5 under `far/`, so the rule named it `far` and no contest
    // happened. The second put the *stronger* claimant first in path order, so
    // a mutant awarding the directory to whichever region is met first survived
    // — hence the weaker cluster's paths sort first here. Its other directories
    // hold one member each, so nothing else reaches the half.
    const weak = ['shared/a1.ts', 'shared/a2.ts', 'shared/a3.ts', 'x/a4.ts', 'y/a5.ts'];
    const strong = ['shared/b1.ts', 'shared/b2.ts', 'shared/b3.ts', 'shared/b4.ts', 'other/b5.ts'];
    const ring = (group: readonly string[]): [string, string][] =>
      group.map((path, i) => [path, group[(i + 1) % group.length] ?? ''] as [string, string]);
    const { regions, byPath } = assignment([...weak, ...strong], [...ring(weak), ...ring(strong)]);
    const winner = regions.find((region) => region.id === byPath.get('shared/b1.ts'));
    const loser = regions.find((region) => region.id === byPath.get('shared/a1.ts'));
    expect(winner?.label).toBe('shared');
    expect(loser?.label).not.toBe('shared');
    expect(loser?.label.startsWith('around ')).toBe(true);
  });

  it('will not name a region after a directory it is only a sliver of', () => {
    // Precision, not just coverage. The region's five members are all under
    // `src/`, so recall against `src` is 1.000 — but `src` holds sixteen files,
    // so the label would be describing a sixth of a directory. `src/core` holds
    // three of the five and nothing else, which is the truer name.
    //
    // A mutant scoring by recall alone survives every other fixture in this
    // file, because in each of them the broadest directory is also the tightest.
    const region = ['src/core/a.ts', 'src/core/b.ts', 'src/core/c.ts', 'src/edge/d.ts', 'src/rim/e.ts'];
    const strangers = Array.from({ length: 11 }, (_, i) => `src/other/f${i}.ts`);
    const ring = region.map((path, i) => [path, region[(i + 1) % region.length] ?? ''] as [string, string]);
    const { regions } = assignment([...region, ...strangers], ring);
    const home = regions.find((r) => r.members.length === region.length);
    expect(home?.label).toBe('src/core');
  });

  it('prefers the deepest directory when several describe the region equally', () => {
    // A region that is exactly `src/atlas` scores 1.000 against `src/atlas` and
    // against `src`, when nothing else is under `src`. A shallow-first scan
    // answers `src` and throws the specific name away.
    const paths = ['src/atlas/a.ts', 'src/atlas/b.ts', 'src/atlas/c.ts'];
    const { regions } = assignment(paths, [
      ['src/atlas/a.ts', 'src/atlas/b.ts'],
      ['src/atlas/b.ts', 'src/atlas/c.ts'],
    ]);
    expect(regions.map((region) => region.label)).toContain('src/atlas');
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
