/**
 * The medal shelf's derivation.
 *
 * Every assertion here is about a *claim a medal makes to the player*, not about
 * the shape of the object — this repo's landmine is that a suite checking the
 * shape of a sentence never checks whether it is true, and three cold
 * playtesters found what 780 assertions could not.
 *
 * The fixture's population is asserted first, deliberately. Archaeology's first
 * unit fixture was so regular that its gate refused every board and twelve
 * assertions ran against the single one that shipped: nothing red, nothing
 * tested. Counting the medals a fixture produces is one line and it is the
 * difference between a suite and a decoration.
 */

import { describe, expect, it } from 'vitest';

import type { Challenge, NodeId } from '../../src/atlas/index.js';
import { validateAtlas } from '../../src/atlas/index.js';
import { prepare } from '../../src/player/scene.js';
import { deriveFog, EMPTY_PROGRESS, UNCHECKED, recordPass } from '../../src/player/progress.js';
import { earnedCount, medalsFor, provableNodes } from '../../src/player/medals.js';
import { fillFraction } from '../../src/player/medalArt.js';
import { atlasWith, witnessFor } from '../fixtures/atlas.js';

const PATHS = [
  'src/core/hub.ts',
  'src/core/util.ts',
  'src/core/deep.ts',
  // **In `src/core` and in no answer key.** Without it every node in that region
  // is provable, `coreProvable === coreNodes`, and the assertion that the medal
  // uses the *achievable* denominator distinguishes nothing — which is how the
  // first run of this suite failed: its own anti-vacuity guard caught it.
  // A dependency of the hub rather than a dependent, so it can sit on hub's
  // board as a legitimately wrong answer without violating ADR-0008's
  // `candidates ∩ dependents = truth`.
  'src/core/base.ts',
  'src/ui/panel.ts',
  'src/ui/view.ts',
  // **A provable pair inside a region marked terrain**, which is what isolates
  // the terrain guard. With only `docs` (no edges, no board) to test it, the
  // `achievable === 0` guard excludes terrain regions anyway and a mutant
  // deleting the kind check survived all 15 assertions — this repo's landmine
  // about two rules constraining one search hiding each other's tests, which it
  // first paid for in the arch search. Artificial on purpose: a real terrain
  // region holds edgeless files, so only a fixture can put the two guards in
  // conflict.
  'src/legacy/old.ts',
  'src/legacy/dep.ts',
  'docs/readme.md',
];
const LINKS: (readonly [string, string])[] = [
  ['src/core/util.ts', 'src/core/hub.ts'],
  ['src/core/deep.ts', 'src/core/util.ts'],
  ['src/core/hub.ts', 'src/core/base.ts'],
  ['src/ui/view.ts', 'src/ui/panel.ts'],
  ['src/legacy/dep.ts', 'src/legacy/old.ts'],
];

const plain = atlasWith(PATHS, LINKS);
const idOf = (path: string): NodeId => {
  const node = plain.nodes.find((n) => n.path === path);
  if (node === undefined) throw new Error(`no node ${path}`);
  return node.id;
};

/**
 * `atlasWith` hard-codes **one** region holding every node, so a region medal
 * cannot be tested through it — the fixture would have exactly one territory
 * medal and every assertion about telling two apart would pass vacuously. Two
 * topology regions and one terrain lump, assigned by directory.
 */
function regionOfPath(path: string): string {
  if (path.startsWith('src/core/')) return 'src/core';
  if (path.startsWith('src/ui/')) return 'src/ui';
  if (path.startsWith('src/legacy/')) return 'src/legacy';
  return 'docs';
}

const REGIONS = [
  { id: 'src/core', label: 'src/core', kind: 'topology' as const },
  { id: 'src/ui', label: 'src/ui', kind: 'topology' as const },
  // Terrain: ADR-0010's "files the graph has nothing to say about". A medal must
  // never name one, and without a terrain region in the fixture that assertion
  // would be checking nothing.
  { id: 'docs', label: 'docs', kind: 'terrain' as const },
  // Terrain **with** a provable node, so the kind check is the only thing that
  // can exclude it.
  { id: 'src/legacy', label: 'src/legacy', kind: 'terrain' as const },
];

/** A board about `subject` whose key is `truth`, at a chosen measured depth. */
function board(subject: string, truth: readonly string[], depth: number): Challenge {
  const truthIds = truth.map(idOf).sort();
  const candidates = [...new Set([...truthIds, ...PATHS.map(idOf)])]
    .filter((id) => id !== idOf(subject))
    .sort();
  return {
    id: `blast-${subject.replace(/[^a-z]/gi, '')}`,
    verb: 'blastRadius',
    tier: 3,
    difficulty: 0.5,
    subject: idOf(subject),
    candidates,
    truth: truthIds,
    witness: witnessFor(candidates, truthIds),
    evidence: { kind: 'importGraph', depth },
  };
}

const atlas = validateAtlas({
  ...plain,
  nodes: plain.nodes.map((node) => ({ ...node, region: regionOfPath(node.path) })),
  // Sorted by id, which the validator requires — "sort before you serialise",
  // and `docs` sorts before `src/*`.
  regions: [...REGIONS]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((region) => ({
      ...region,
      nodeCount: plain.nodes.filter((n) => regionOfPath(n.path) === region.id).length,
      centroid: [0, 0] as [number, number],
    })),
  // Sorted by id, like the regions and for the same reason.
  challenges: [
    board('src/core/hub.ts', ['src/core/util.ts', 'src/core/deep.ts'], 3),
    board('src/core/util.ts', ['src/core/deep.ts'], 1),
    board('src/ui/panel.ts', ['src/ui/view.ts'], 1),
    board('src/legacy/old.ts', ['src/legacy/dep.ts'], 1),
  ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
});
const scene = prepare(atlas);

const fogOf = (progress: Parameters<typeof deriveFog>[0]) => deriveFog(progress, UNCHECKED);
const medalsOf = (progress: Parameters<typeof deriveFog>[0]) =>
  medalsFor(scene, progress, UNCHECKED, fogOf(progress));

/** Pass a board, proving the members named. */
function pass(
  progress: typeof EMPTY_PROGRESS,
  subject: string,
  proved: readonly string[],
): typeof EMPTY_PROGRESS {
  // Positional, and the register is **required** — `recordPass`'s own comment
  // records that a permissive `'proved'` default let ADR-0047's register split
  // compile with no test touching it, so a mutant survived 920 unit tests.
  return recordPass(progress, 'blastRadius', idOf(subject), proved.map(idOf).sort(), 'proved');
}

describe('the fixture is not degenerate', () => {
  it('produces more than one medal, and more than one of each family', () => {
    // The anti-vacuity check. Every assertion below is about telling medals
    // apart; if the fixture yielded one there would be nothing to tell apart and
    // the suite would pass without testing anything.
    const medals = medalsOf(EMPTY_PROGRESS);
    expect(medals.length).toBeGreaterThan(3);
    const shelves = new Set(medals.map((m) => m.shelf));
    expect(shelves).toContain('territory');
    expect(shelves).toContain('reach');
    expect(shelves).toContain('craft');
    // Two topology regions, so a region medal can be complete while another is not.
    expect(medals.filter((m) => m.shelf === 'territory').length).toBeGreaterThan(1);
  });

  it('offers a deep board and a shallow one, so the craft medal can discriminate', () => {
    const depths = atlas.challenges.map((c) =>
      c.evidence.kind === 'importGraph' ? c.evidence.depth : 0,
    );
    expect(depths.some((d) => d >= 3)).toBe(true);
    expect(depths.some((d) => d < 3)).toBe(true);
  });
});

describe('nothing is earned before anything is proved', () => {
  it('earns no medal on an empty record', () => {
    expect(earnedCount(medalsOf(EMPTY_PROGRESS))).toBe(0);
  });

  it('still describes every medal, so an empty shelf is a list of goals', () => {
    // Risk #4 is that fog reads as the tool hiding things. An unearned medal with
    // no claim on it is the same feeling with a frame around it.
    for (const medal of medalsOf(EMPTY_PROGRESS)) {
      expect(medal.claim.length).toBeGreaterThan(0);
      expect(medal.need).toBeGreaterThan(0);
    }
  });
});

describe('a region medal', () => {
  it('is scored against the files a question can reach, not every file', () => {
    // The unreachable-threshold bug ADR-0034's `hub` detector had: a bar above
    // the achievable maximum reads as a phenomenon that never occurs. `docs` has
    // a node and no board, so a region scored on raw node count could never
    // complete.
    const provable = provableNodes(atlas);
    expect(provable.has(idOf('docs/readme.md'))).toBe(false);
    const core = medalsOf(EMPTY_PROGRESS).find((m) => m.name === 'src/core');
    expect(core).toBeDefined();
    const coreNodes = scene.nodes.filter(
      (n) => scene.regions[n.regionIndex]?.label === 'src/core',
    ).length;
    const coreProvable = scene.nodes.filter(
      (n) => scene.regions[n.regionIndex]?.label === 'src/core' && provable.has(n.id),
    ).length;
    // The distinction has to be real in this fixture or the assertion is empty.
    expect(coreProvable).toBeLessThan(coreNodes);
    expect(core?.need).toBeLessThanOrEqual(coreProvable);
  });

  it('completes when every provable file in it is proved, and says so', () => {
    // `src/ui` is provable through panel's board: subject panel, member view.
    let progress = EMPTY_PROGRESS;
    progress = pass(progress, 'src/ui/panel.ts', ['src/ui/view.ts']);
    const ui = medalsOf(progress).find((m) => m.name === 'src/ui');
    expect(ui?.earned).toBe(true);
    expect(ui?.tier).toBe(2);
    expect(ui?.claim).toContain('every file a question can reach');
  });

  it('does not complete a region whose files are still fogged', () => {
    let progress = EMPTY_PROGRESS;
    progress = pass(progress, 'src/ui/panel.ts', ['src/ui/view.ts']);
    const core = medalsOf(progress).find((m) => m.name === 'src/core');
    expect(core?.earned).toBe(false);
    // The claim is short and the *name* carries the region, so the assertion is
    // about the count rather than the label.
    expect(core?.claim).toMatch(/^0 of \d+ files proved$/);
  });

  it('never names a terrain region', () => {
    // ADR-0010: a terrain lump is "files the graph has nothing to say about",
    // drawn in one grey precisely so the map does not claim it is a
    // neighbourhood. A medal named after one makes exactly that claim.
    const terrain = scene.regions.filter((r) => r.kind === 'terrain').map((r) => r.label);
    expect(terrain.length).toBeGreaterThan(0);
    const names = medalsOf(EMPTY_PROGRESS).map((m) => m.name);
    for (const label of terrain) expect(names).not.toContain(label);
  });
});

describe('the craft medals reward what the product claims to teach', () => {
  it('is earned by a board whose key travelled three hops, and not by a shallow one', () => {
    const shallow = pass(EMPTY_PROGRESS, 'src/ui/panel.ts', ['src/ui/view.ts']);
    expect(medalsOf(shallow).find((m) => m.id === 'craft:deep')?.earned).toBe(false);
    const deep = pass(EMPTY_PROGRESS, 'src/core/hub.ts', ['src/core/util.ts']);
    expect(medalsOf(deep).find((m) => m.id === 'craft:deep')?.earned).toBe(true);
  });

  it('claims full recall only when every member was found', () => {
    // **The medal says recall and checks recall.** `Pass` records no score, so
    // precision is not recoverable and "you scored 100%" would be a claim this
    // module cannot support. hub's key has two members; proving one is not it.
    const partial = pass(EMPTY_PROGRESS, 'src/core/hub.ts', ['src/core/util.ts']);
    expect(medalsOf(partial).find((m) => m.id === 'craft:complete')?.earned).toBe(false);
    const whole = pass(EMPTY_PROGRESS, 'src/core/hub.ts', [
      'src/core/util.ts',
      'src/core/deep.ts',
    ]);
    expect(medalsOf(whole).find((m) => m.id === 'craft:complete')?.earned).toBe(true);
  });

  it('never claims a score, because the save does not record one', () => {
    const whole = pass(EMPTY_PROGRESS, 'src/core/hub.ts', [
      'src/core/util.ts',
      'src/core/deep.ts',
    ]);
    for (const medal of medalsOf(whole)) {
      expect(medal.claim).not.toMatch(/100%|\bscore/i);
    }
  });
});

describe('the shelf is a view, not a record', () => {
  it('gives the same answer twice for the same record', () => {
    const progress = pass(EMPTY_PROGRESS, 'src/core/hub.ts', ['src/core/util.ts']);
    expect(medalsOf(progress)).toEqual(medalsOf(progress));
  });

  it('is ordered the same on every machine', () => {
    const progress = pass(EMPTY_PROGRESS, 'src/core/hub.ts', ['src/core/util.ts']);
    const once = medalsOf(progress).map((m) => m.id);
    const twice = medalsOf(progress).map((m) => m.id);
    expect(once).toEqual(twice);
    const territory = once.filter((id) => id.startsWith('region:'));
    expect([...territory].sort()).toEqual(territory);
  });

  it('drops a claim the graph no longer supports', () => {
    // ADR-0011: every restored claim is re-checked against the live graph, and a
    // claim it no longer supports is dropped rather than shown stale. A stored
    // medal could not do this — which is why none is stored.
    const progress = pass(EMPTY_PROGRESS, 'src/ui/panel.ts', ['src/ui/view.ts']);
    expect(medalsOf(progress).find((m) => m.name === 'src/ui')?.earned).toBe(true);
    // The same record read against an atlas where that file is gone.
    const shrunk = prepare({
      ...atlas,
      challenges: atlas.challenges.filter((c) => c.subject !== idOf('src/ui/panel.ts')),
    });
    const stale = medalsFor(shrunk, progress, UNCHECKED, fogOf(progress)).find(
      (m) => m.name === 'src/ui',
    );
    // `src/ui` has no provable file left, so it gets no medal at all rather than
    // a completed one about a question that no longer exists.
    expect(stale).toBeUndefined();
  });
});

describe('a wrong answer never takes a medal away', () => {
  it('cannot lose an earned medal by attempting another board', () => {
    // Guardrail 6, as a property rather than as a comment. Passes only ever
    // accumulate, so this asserts the *monotonicity* a collection promises.
    let progress = pass(EMPTY_PROGRESS, 'src/core/hub.ts', [
      'src/core/util.ts',
      'src/core/deep.ts',
    ]);
    const before = earnedCount(medalsOf(progress));
    expect(before).toBeGreaterThan(0);
    // A failed board records no pass at all, so the record is untouched; then a
    // later success adds to it.
    progress = pass(progress, 'src/ui/panel.ts', ['src/ui/view.ts']);
    expect(earnedCount(medalsOf(progress))).toBeGreaterThanOrEqual(before);
  });
});

describe('how full a medal is drawn', () => {
  // `medalArt.ts` needs a DOM and the unit environment has none, so the SVG is
  // e2e's to hold. `fillFraction` is pure and is the one piece of that art with
  // a decision in it.
  const graded = (have: number, need: number, earned: boolean) =>
    fillFraction({
      id: 'x',
      name: 'x',
      claim: 'x',
      have,
      need,
      tier: 0,
      tiers: 3,
      earned,
      shelf: 'territory',
    });

  it('is a fraction of the next tier, so a graded medal reads as a ladder', () => {
    expect(graded(0, 4, false)).toBe(0);
    expect(graded(1, 4, false)).toBeCloseTo(0.25, 6);
    expect(graded(4, 4, true)).toBe(1);
  });

  it('never exceeds full, so overshooting a tier does not overflow the shape', () => {
    expect(graded(9, 4, true)).toBe(1);
  });

  it('is binary for a single-tier medal, because half of it would be invented', () => {
    const one = (earned: boolean) =>
      fillFraction({
        id: 'x',
        name: 'x',
        claim: 'x',
        have: earned ? 1 : 0,
        need: 1,
        tier: 0,
        tiers: 1,
        earned,
        shelf: 'craft',
      });
    expect(one(false)).toBe(0);
    expect(one(true)).toBe(1);
  });
});
